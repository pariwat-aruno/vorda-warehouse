/**
 * Cancel.gs — ยกเลิกออเดอร์
 *
 * (ลูกค้ายกเลิกออเดอร์ ของไม่ถึงปลายทางตีกลับ — ของยังไม่แกะ)
 *
 * Flow:
 *   1. พนักงานบันทึก: tracking + product + qty + รูป → submitCancel
 *      → status: pending_owner
 *   2. owner approveCancel → decision='accept'
 *      → insert Movement (movement_type='cancel_in', +qty) → +1 Stock
 *      → status='accepted'
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

/**
 * staff บันทึกยกเลิกออเดอร์ (ของยังไม่แกะ ตีกลับ)
 *
 * payload: { lineUserId, name, trackingNumber, productId, qty, photos[] }
 *   - ไม่ต้องมี VDO (ต่างจาก return) — แค่รูปประกอบ
 *
 * effect: insert Cancellations row status='pending_owner' → push owner
 */
function handleSubmitCancel(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const name = payload.name || '';
  const trackingNumber = String(payload.trackingNumber || '').trim();
  const photos = payload.photos || [];

  if (!lineUserId || !trackingNumber || !Array.isArray(photos) || photos.length < 1) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'trackingNumber', 'items', 'photos[≥1]'] };
  }

  const norm = normalizeItems_(payload);
  if (!norm.ok) return norm;

  const dedupKey = 'cancel:' + lineUserId + ':' + trackingNumber + ':' + norm.totalQty + ':' + norm.items.length;
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  try {
    autoRegisterStaff_(lineUserId, name);

    const cancelId = nextCancelId();
    const photoUrls = uploadImages(photos, cancelId, 'cancel');

    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Cancellations');
    let headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

    // เพิ่ม items_json column ถ้ายังไม่มี
    if (headers.indexOf('items_json') < 0) {
      sh.getRange(1, headers.length + 1).setValue('items_json').setFontWeight('bold');
      headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    }

    const row = new Array(headers.length).fill('');
    const now = nowBangkok();
    const first = norm.items[0];
    const itemsLabel = norm.items.length > 1
      ? first.product_name + ' +' + (norm.items.length - 1) + ' รายการ'
      : first.product_name;

    setCol_(row, headers, 'cancel_id', cancelId);
    setCol_(row, headers, 'tracking_number', trackingNumber);
    setCol_(row, headers, 'product_id', first.product_id);  // legacy: ใช้ตัวแรกเป็นตัวแทน
    setCol_(row, headers, 'product_name', itemsLabel);
    setCol_(row, headers, 'qty', norm.totalQty);            // legacy: ยอดรวม
    setCol_(row, headers, 'items_json', JSON.stringify(norm.items));
    setCol_(row, headers, 'photo_urls', photoUrls.join(','));
    setCol_(row, headers, 'staff_user_id', lineUserId);
    setCol_(row, headers, 'staff_name', name);
    setCol_(row, headers, 'staff_at', now);
    setCol_(row, headers, 'status', 'pending_owner');
    setCol_(row, headers, 'created_at', now);

    sh.appendRow(row);

    logInfo('handleSubmitCancel', 'submitted', {
      cancelId: cancelId, trackingNumber: trackingNumber, items: norm.items.length, totalQty: norm.totalQty,
    });

    safePushToAllOwners_([buildPendingCancelCard({
      cancel_id: cancelId,
      tracking_number: trackingNumber,
      product_name: itemsLabel,
      qty: norm.totalQty,
      photo_urls: photoUrls.join(','),
      staff_name: name,
    })], 'handleSubmitCancel');

    return {
      ok: true,
      cancelId: cancelId,
      status: 'pending_owner',
      items: norm.items,
      totalQty: norm.totalQty,
      photo_urls: photoUrls,
    };
  } catch (err) {
    logError('handleSubmitCancel', err.message, { trackingNumber: trackingNumber });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/**
 * owner approve ยกเลิก
 *
 * payload: { lineUserId, cancelId, decision: 'accept'|'reject' }
 *
 * accept → insert Movement (cancel_in, +qty) + apply Stock → status='accepted'
 * reject → status='rejected' ไม่กระทบ Stock
 */
function handleApproveCancel(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const cancelId = payload.cancelId;
  const decision = String(payload.decision || '').toLowerCase();

  if (!lineUserId || !cancelId || !decision) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'cancelId', 'decision'] };
  }
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };
  if (decision !== 'accept' && decision !== 'reject') {
    return { ok: false, error: 'decision_invalid', valid: ['accept', 'reject'] };
  }

  const dedupKey = 'approveCancel:' + lineUserId + ':' + cancelId;
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const sh = ss.getSheetByName('Cancellations');
    const rowIdx = findRowByIdCol_(sh, 'cancel_id', cancelId);
    if (rowIdx < 0) return { ok: false, error: 'not_found', cancelId: cancelId };

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];

    const status = String(row[headers.indexOf('status')] || '');
    if (status !== 'pending_owner') {
      return { ok: false, error: 'not_pending_owner', currentStatus: status };
    }

    const trackingNumber = String(row[headers.indexOf('tracking_number')] || '');
    const itemsJsonRaw = String(row[headers.indexOf('items_json')] || '');
    let items;
    if (itemsJsonRaw) {
      try { items = JSON.parse(itemsJsonRaw); } catch (e) { items = null; }
    }
    if (!items || !items.length) {
      // legacy row → ใช้ product_id/qty เป็น 1 item
      const pid = String(row[headers.indexOf('product_id')] || '');
      const pName = String(row[headers.indexOf('product_name')] || pid);
      const qtyVal = Number(row[headers.indexOf('qty')] || 0);
      items = [{ product_id: pid, product_name: pName, qty: qtyVal }];
    }
    const ownerName = (function () {
      const s = findStaffByLineUserId(lineUserId);
      return (s && s.name) || 'owner';
    })();
    const now = nowBangkok();

    sh.getRange(rowIdx, headers.indexOf('owner_user_id') + 1).setValue(lineUserId);
    sh.getRange(rowIdx, headers.indexOf('owner_at') + 1).setValue(now);

    if (decision === 'accept') {
      const movSh = ss.getSheetByName('Movements');
      const movHeaders = movSh.getRange(1, 1, 1, movSh.getLastColumn()).getValues()[0];
      const movementIds = [];
      const appliedItems = [];

      // insert 1 Movement row per item + apply Stock
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const movementId = nextMovementId();
        const mrow = new Array(movHeaders.length).fill('');
        setCol_(mrow, movHeaders, 'movement_id', movementId);
        setCol_(mrow, movHeaders, 'movement_type', 'cancel_in');
        setCol_(mrow, movHeaders, 'product_id', it.product_id);
        setCol_(mrow, movHeaders, 'product_name', it.product_name);
        setCol_(mrow, movHeaders, 'qty', it.qty);
        setCol_(mrow, movHeaders, 'related_doc_id', cancelId);
        setCol_(mrow, movHeaders, 'submitter1_user_id', lineUserId);
        setCol_(mrow, movHeaders, 'submitter1_name', ownerName);
        setCol_(mrow, movHeaders, 'submitter1_qty', it.qty);
        setCol_(mrow, movHeaders, 'submitter1_at', now);
        setCol_(mrow, movHeaders, 'status', 'confirmed');
        setCol_(mrow, movHeaders, 'created_at', now);
        setCol_(mrow, movHeaders, 'confirmed_at', now);
        movSh.appendRow(mrow);

        const stock = applyStockDelta_(it.product_id, +it.qty, movementId);
        movementIds.push(movementId);
        appliedItems.push(Object.assign({}, it, { movement_id: movementId, stock_after: stock.qty_after }));
      }

      sh.getRange(rowIdx, headers.indexOf('status') + 1).setValue('accepted');

      logInfo('handleApproveCancel', 'accepted', {
        cancelId: cancelId, movementIds: movementIds, items: items.length,
      });
      logOwnerAction_(lineUserId, 'approveCancel', cancelId, 'accept', { movementIds: movementIds, items: items.length });

      const itemsText = appliedItems.map(it =>
        '  • ' + it.product_name + ' +' + it.qty + ' (คงเหลือ ' + it.stock_after + ')'
      ).join('\n');
      safePushToAllOwners_([{
        type: 'text',
        text:
          'ยกเลิก accepted (เข้า Stock)\n' +
          'รหัส: ' + cancelId + '\n' +
          'tracking: ' + trackingNumber + '\n' +
          itemsText,
      }], 'handleApproveCancel');

      return {
        ok: true, cancelId: cancelId, decision: decision,
        status: 'accepted', movementIds: movementIds, items: appliedItems,
      };
    }

    // reject
    sh.getRange(rowIdx, headers.indexOf('status') + 1).setValue('rejected');
    logInfo('handleApproveCancel', 'rejected', { cancelId: cancelId });
    logOwnerAction_(lineUserId, 'approveCancel', cancelId, 'reject', {});
    safePushToAllOwners_([{
      type: 'text',
      text:
        'ยกเลิก rejected (ไม่กระทบ Stock)\n' +
        'รหัส: ' + cancelId + '\n' +
        'tracking: ' + trackingNumber + '\n' +
        'รวม: ' + items.map(it => it.product_name + ' ×' + it.qty).join(', '),
    }], 'handleApproveCancel');

    return { ok: true, cancelId: cancelId, decision: decision, status: 'rejected' };
  } catch (err) {
    logError('handleApproveCancel', err.message, { cancelId: cancelId, decision: decision });
    return { ok: false, error: 'server_error', message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
