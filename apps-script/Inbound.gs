/**
 * Inbound.gs — รับเข้าจากโรงงาน
 *
 * Flow:
 *   1. คนที่ 1 กรอก: product_id + qty + รูป 4 มุม → submitInbound
 *      → insert Movements row (status: pending_partner)
 *      → return movement_id
 *   2. คนที่ 2 กรอกฟอร์มเดียวกัน → submitInbound (ส่ง movement_id ของรอบ 1)
 *      → match qty: ตรง → status confirmed + apply ไป Stock + push LINE หัวหน้า
 *               ไม่ตรง → status pending_supervisor + push LINE หัวหน้าเรียกตัดสิน
 *   3. ยกเลิกใน 5 นาที → cancelSubmission
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

/**
 * รับเข้าจากโรงงาน — double-blind
 *
 * payload: {
 *   lineUserId, name,
 *   productId, qty,
 *   photos: [base64×4],
 *   pairingMovementId?: ใส่ตอนรอบ 2 (เพื่อ match กับรอบ 1)
 * }
 *
 * error codes:
 *   missing_params, qty_invalid, duplicate_request, product_not_found
 *   invalid_pairing, same_submitter, product_mismatch, server_error
 */
function handleSubmitInbound(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const name = payload.name || '';
  const productId = payload.productId;
  const qty = Number(payload.qty);
  const photos = payload.photos || [];
  const pairingMovementId = payload.pairingMovementId;

  if (!lineUserId || !productId || !qty || !Array.isArray(photos) || photos.length < 4) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'productId', 'qty', 'photos[≥4]'] };
  }
  if (!isFinite(qty) || qty <= 0 || qty !== Math.floor(qty)) {
    return { ok: false, error: 'qty_invalid', message: 'qty ต้องเป็นจำนวนเต็มบวก' };
  }

  // dedup กัน double-tap
  const dedupKey = 'inbound:' + lineUserId + ':' + productId + ':' + qty + ':' + (pairingMovementId || 'r1');
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  try {
    autoRegisterStaff_(lineUserId, name);

    if (!pairingMovementId) {
      return _handleInboundRound1_(lineUserId, name, productId, qty, photos);
    } else {
      return _handleInboundRound2_(lineUserId, name, productId, qty, photos, pairingMovementId);
    }
  } catch (err) {
    logError('handleSubmitInbound', err.message, {
      lineUserId: lineUserId, productId: productId, qty: qty,
      pairingMovementId: pairingMovementId,
    });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/** รอบ 1 — insert Movements row (pending_partner) */
function _handleInboundRound1_(lineUserId, name, productId, qty, photos) {
  const productName = lookupProductName_(productId);
  if (!productName) return { ok: false, error: 'product_not_found', productId: productId };

  const movementId = nextMovementId();
  const photoUrls = uploadImages(photos, movementId + '-r1', 'inbound');

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const movSh = SpreadsheetApp.openById(sheetId).getSheetByName('Movements');
  const headers = movSh.getRange(1, 1, 1, movSh.getLastColumn()).getValues()[0];
  const row = new Array(headers.length).fill('');
  const now = nowBangkok();

  setCol_(row, headers, 'movement_id', movementId);
  setCol_(row, headers, 'movement_type', 'inbound');
  setCol_(row, headers, 'product_id', productId);
  setCol_(row, headers, 'product_name', productName);
  setCol_(row, headers, 'submitter1_user_id', lineUserId);
  setCol_(row, headers, 'submitter1_name', name);
  setCol_(row, headers, 'submitter1_qty', qty);
  setCol_(row, headers, 'submitter1_at', now);
  setCol_(row, headers, 'photo_urls', photoUrls.join(','));
  setCol_(row, headers, 'status', 'pending_partner');
  setCol_(row, headers, 'created_at', now);

  movSh.appendRow(row);

  logInfo('handleSubmitInbound', 'round1', { movementId: movementId, productId: productId, qty: qty });

  return {
    ok: true,
    movementId: movementId,
    status: 'pending_partner',
    message: 'บันทึกรอบ 1 สำเร็จ — ส่งเลขนี้ให้คนนับ 2: ' + movementId,
  };
}

/** รอบ 2 — match qty + apply Stock หรือ escalate supervisor */
function _handleInboundRound2_(lineUserId, name, productId, qty, photos, pairingMovementId) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const movSh = SpreadsheetApp.openById(sheetId).getSheetByName('Movements');
  const rowIdx = findRowByIdCol_(movSh, 'movement_id', pairingMovementId);
  if (rowIdx < 0) return { ok: false, error: 'invalid_pairing', message: 'ไม่เจอ movement_id นี้' };

  const headers = movSh.getRange(1, 1, 1, movSh.getLastColumn()).getValues()[0];
  const row = movSh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];

  const typeIdx = headers.indexOf('movement_type');
  if (String(row[typeIdx]) !== 'inbound') {
    return { ok: false, error: 'invalid_pairing', message: 'movement_type ไม่ใช่ inbound' };
  }

  const statusIdx = headers.indexOf('status');
  const status = String(row[statusIdx] || '');
  if (status !== 'pending_partner') {
    return { ok: false, error: 'invalid_pairing', message: 'รอบ 1 ไม่อยู่ใน pending_partner (current: ' + status + ')' };
  }

  const s1Idx = headers.indexOf('submitter1_user_id');
  if (String(row[s1Idx]) === String(lineUserId)) {
    return { ok: false, error: 'same_submitter', message: 'คนนับ 1 และ 2 ต้องคนละ user' };
  }

  const pidIdx = headers.indexOf('product_id');
  if (String(row[pidIdx]) !== String(productId)) {
    return { ok: false, error: 'product_mismatch', message: 'สินค้าไม่ตรงกับรอบ 1' };
  }

  // upload รูปรอบ 2 — append ต่อ photo_urls เดิม
  const photoUrls = uploadImages(photos, pairingMovementId + '-r2', 'inbound');
  const photoIdx = headers.indexOf('photo_urls');
  const existing = String(row[photoIdx] || '');
  const combined = existing ? (existing + ',' + photoUrls.join(',')) : photoUrls.join(',');

  // update submitter2_* + photos
  const now = nowBangkok();
  movSh.getRange(rowIdx, headers.indexOf('submitter2_user_id') + 1).setValue(lineUserId);
  movSh.getRange(rowIdx, headers.indexOf('submitter2_name') + 1).setValue(name);
  movSh.getRange(rowIdx, headers.indexOf('submitter2_qty') + 1).setValue(qty);
  movSh.getRange(rowIdx, headers.indexOf('submitter2_at') + 1).setValue(now);
  movSh.getRange(rowIdx, photoIdx + 1).setValue(combined);

  const s1Qty = Number(row[headers.indexOf('submitter1_qty')] || 0);
  const productName = String(row[headers.indexOf('product_name')] || productId);
  const s1Name = String(row[headers.indexOf('submitter1_name')] || '');

  if (s1Qty === qty) {
    // ตรง → confirmed + apply Stock + push managers
    const stock = applyStockDelta_(productId, qty, pairingMovementId);
    movSh.getRange(rowIdx, headers.indexOf('qty') + 1).setValue(qty);
    movSh.getRange(rowIdx, statusIdx + 1).setValue('confirmed');
    movSh.getRange(rowIdx, headers.indexOf('confirmed_at') + 1).setValue(now);

    logInfo('handleSubmitInbound', 'round2 confirmed', {
      movementId: pairingMovementId, productId: productId, qty: qty,
      stock_before: stock.qty_before, stock_after: stock.qty_after,
    });

    safePushToAllManagers_([{
      type: 'text',
      text:
        'รับเข้า confirmed\n' +
        'รหัส: ' + pairingMovementId + '\n' +
        'สินค้า: ' + productName + '\n' +
        'จำนวน: +' + qty + ' ชิ้น\n' +
        'ยอดคงเหลือ: ' + stock.qty_after,
    }], 'handleSubmitInbound');

    return {
      ok: true,
      movementId: pairingMovementId,
      status: 'confirmed',
      qty: qty,
      qty_before: stock.qty_before,
      qty_after: stock.qty_after,
    };
  }

  // ไม่ตรง → pending_supervisor + push supervisors
  movSh.getRange(rowIdx, statusIdx + 1).setValue('pending_supervisor');

  logWarn('handleSubmitInbound', 'round2 mismatch', {
    movementId: pairingMovementId, productId: productId, s1: s1Qty, s2: qty,
  });

  safePushToAllSupervisors_([buildSupervisorTiebreakerCard({
    movement_id: pairingMovementId,
    product_name: productName,
    submitter1_name: s1Name,
    submitter1_qty: s1Qty,
    submitter2_name: name,
    submitter2_qty: qty,
    photo_urls: combined,
  }, 'movement', 'รับเข้า')], 'handleSubmitInbound');

  return {
    ok: true,
    movementId: pairingMovementId,
    status: 'pending_supervisor',
    submitter1_qty: s1Qty,
    submitter2_qty: qty,
  };
}
