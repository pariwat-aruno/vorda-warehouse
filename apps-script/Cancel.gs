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
  const productId = String(payload.productId || '').trim();
  const qty = Number(payload.qty);
  const photos = payload.photos || [];

  if (!lineUserId || !trackingNumber || !productId || !qty || !Array.isArray(photos) || photos.length < 1) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'trackingNumber', 'productId', 'qty', 'photos[≥1]'] };
  }
  if (!isFinite(qty) || qty <= 0 || qty !== Math.floor(qty)) {
    return { ok: false, error: 'qty_invalid', message: 'qty ต้องเป็นจำนวนเต็มบวก' };
  }

  const dedupKey = 'cancel:' + lineUserId + ':' + trackingNumber + ':' + productId + ':' + qty;
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  try {
    autoRegisterStaff_(lineUserId, name);

    const productName = lookupProductName_(productId);
    if (!productName) return { ok: false, error: 'product_not_found', productId: productId };

    const cancelId = nextCancelId();
    const photoUrls = uploadImages(photos, cancelId, 'cancel');

    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Cancellations');
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = new Array(headers.length).fill('');
    const now = nowBangkok();

    setCol_(row, headers, 'cancel_id', cancelId);
    setCol_(row, headers, 'tracking_number', trackingNumber);
    setCol_(row, headers, 'product_id', productId);
    setCol_(row, headers, 'product_name', productName);
    setCol_(row, headers, 'qty', qty);
    setCol_(row, headers, 'photo_urls', photoUrls.join(','));
    setCol_(row, headers, 'staff_user_id', lineUserId);
    setCol_(row, headers, 'staff_name', name);
    setCol_(row, headers, 'staff_at', now);
    setCol_(row, headers, 'status', 'pending_owner');
    setCol_(row, headers, 'created_at', now);

    sh.appendRow(row);

    logInfo('handleSubmitCancel', 'submitted', {
      cancelId: cancelId, trackingNumber: trackingNumber, productId: productId, qty: qty,
    });

    safePushToAllOwners_([{
      type: 'text',
      text:
        '⚠️ ยกเลิกออเดอร์รอ approve\n' +
        'รหัส: ' + cancelId + '\n' +
        'tracking: ' + trackingNumber + '\n' +
        'สินค้า: ' + productName + '\n' +
        'จำนวน: ' + qty + ' ชิ้น\n' +
        'พนักงาน: ' + name + '\n' +
        'กด approve ใน LIFF เจ้าของ',
    }], 'handleSubmitCancel');

    return {
      ok: true,
      cancelId: cancelId,
      status: 'pending_owner',
      photo_urls: photoUrls,
    };
  } catch (err) {
    logError('handleSubmitCancel', err.message, { trackingNumber: trackingNumber, productId: productId });
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

    const productId = String(row[headers.indexOf('product_id')] || '');
    const productName = String(row[headers.indexOf('product_name')] || productId);
    const qty = Number(row[headers.indexOf('qty')] || 0);
    const trackingNumber = String(row[headers.indexOf('tracking_number')] || '');
    const ownerName = (function () {
      const s = findStaffByLineUserId(lineUserId);
      return (s && s.name) || 'owner';
    })();
    const now = nowBangkok();

    sh.getRange(rowIdx, headers.indexOf('owner_user_id') + 1).setValue(lineUserId);
    sh.getRange(rowIdx, headers.indexOf('owner_at') + 1).setValue(now);

    if (decision === 'accept') {
      // insert Movement (cancel_in, +qty) + apply Stock
      const movementId = nextMovementId();
      const movSh = ss.getSheetByName('Movements');
      const movHeaders = movSh.getRange(1, 1, 1, movSh.getLastColumn()).getValues()[0];
      const mrow = new Array(movHeaders.length).fill('');
      setCol_(mrow, movHeaders, 'movement_id', movementId);
      setCol_(mrow, movHeaders, 'movement_type', 'cancel_in');
      setCol_(mrow, movHeaders, 'product_id', productId);
      setCol_(mrow, movHeaders, 'product_name', productName);
      setCol_(mrow, movHeaders, 'qty', qty);
      setCol_(mrow, movHeaders, 'related_doc_id', cancelId);
      setCol_(mrow, movHeaders, 'submitter1_user_id', lineUserId);
      setCol_(mrow, movHeaders, 'submitter1_name', ownerName);
      setCol_(mrow, movHeaders, 'submitter1_qty', qty);
      setCol_(mrow, movHeaders, 'submitter1_at', now);
      setCol_(mrow, movHeaders, 'status', 'confirmed');
      setCol_(mrow, movHeaders, 'created_at', now);
      setCol_(mrow, movHeaders, 'confirmed_at', now);
      movSh.appendRow(mrow);

      const stock = applyStockDelta_(productId, +qty, movementId);

      sh.getRange(rowIdx, headers.indexOf('status') + 1).setValue('accepted');

      logInfo('handleApproveCancel', 'accepted', {
        cancelId: cancelId, movementId: movementId, qty: qty,
        stock_before: stock.qty_before, stock_after: stock.qty_after,
      });

      safePushToAllOwners_([{
        type: 'text',
        text:
          'ยกเลิก accepted (เข้า Stock)\n' +
          'รหัส: ' + cancelId + '\n' +
          'tracking: ' + trackingNumber + '\n' +
          'สินค้า: ' + productName + '\n' +
          'จำนวน: +' + qty + ' ชิ้น\n' +
          'ยอดคงเหลือ: ' + stock.qty_after + '\n' +
          'movement: ' + movementId,
      }], 'handleApproveCancel');

      return {
        ok: true, cancelId: cancelId, decision: decision,
        status: 'accepted', movementId: movementId,
        qty_before: stock.qty_before, qty_after: stock.qty_after,
      };
    }

    // reject
    sh.getRange(rowIdx, headers.indexOf('status') + 1).setValue('rejected');
    logInfo('handleApproveCancel', 'rejected', { cancelId: cancelId });
    safePushToAllOwners_([{
      type: 'text',
      text:
        'ยกเลิก rejected (ไม่กระทบ Stock)\n' +
        'รหัส: ' + cancelId + '\n' +
        'tracking: ' + trackingNumber + '\n' +
        'สินค้า: ' + productName,
    }], 'handleApproveCancel');

    return { ok: true, cancelId: cancelId, decision: decision, status: 'rejected' };
  } catch (err) {
    logError('handleApproveCancel', err.message, { cancelId: cancelId, decision: decision });
    return { ok: false, error: 'server_error', message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
