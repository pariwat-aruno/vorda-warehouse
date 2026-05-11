/**
 * Outbound.gs — หยิบของออกไปแพค
 *
 * เหมือน Inbound flow (double-blind 2 คน) แต่:
 *   - movement_type = 'outbound'
 *   - qty บันทึกเป็นจำนวนบวก แต่ apply ไป Stock เป็นลบ (qty_on_hand -= qty)
 *
 * Flow:
 *   1. คนที่ 1 เลือกสินค้า + กรอก qty + ถ่ายรูป → submitOutbound
 *   2. คนที่ 2 กรอกเหมือนเดิม + ส่ง movement_id → match
 *   3. ยกเลิก 5 นาที
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

/**
 * หยิบออกไปแพค — double-blind
 *
 * เหมือน Inbound แต่:
 *   - movement_type='outbound'
 *   - apply Stock เป็นลบ (qty_on_hand -= qty)
 *   - ก่อน apply: ตรวจ qty_on_hand >= qty → ถ้าไม่พอ มาร์ก pending_supervisor + push managers
 *
 * payload: { lineUserId, name, productId, qty, photos[4], pairingMovementId? }
 */
function handleSubmitOutbound(payload) {
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

  const dedupKey = 'outbound:' + lineUserId + ':' + productId + ':' + qty + ':' + (pairingMovementId || 'r1');
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  try {
    autoRegisterStaff_(lineUserId, name);

    if (!pairingMovementId) {
      return _handleOutboundRound1_(lineUserId, name, productId, qty, photos);
    } else {
      return _handleOutboundRound2_(lineUserId, name, productId, qty, photos, pairingMovementId);
    }
  } catch (err) {
    logError('handleSubmitOutbound', err.message, {
      lineUserId: lineUserId, productId: productId, qty: qty,
      pairingMovementId: pairingMovementId,
    });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

function _handleOutboundRound1_(lineUserId, name, productId, qty, photos) {
  const productName = lookupProductName_(productId);
  if (!productName) return { ok: false, error: 'product_not_found', productId: productId };

  const movementId = nextMovementId();
  const photoUrls = uploadImages(photos, movementId + '-r1', 'outbound');

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const movSh = SpreadsheetApp.openById(sheetId).getSheetByName('Movements');
  const headers = movSh.getRange(1, 1, 1, movSh.getLastColumn()).getValues()[0];
  const row = new Array(headers.length).fill('');
  const now = nowBangkok();

  setCol_(row, headers, 'movement_id', movementId);
  setCol_(row, headers, 'movement_type', 'outbound');
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

  logInfo('handleSubmitOutbound', 'round1', { movementId: movementId, productId: productId, qty: qty });

  return {
    ok: true,
    movementId: movementId,
    status: 'pending_partner',
    message: 'บันทึกรอบ 1 สำเร็จ — ส่งเลขนี้ให้คนนับ 2: ' + movementId,
  };
}

function _handleOutboundRound2_(lineUserId, name, productId, qty, photos, pairingMovementId) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const movSh = SpreadsheetApp.openById(sheetId).getSheetByName('Movements');
  const rowIdx = findRowByIdCol_(movSh, 'movement_id', pairingMovementId);
  if (rowIdx < 0) return { ok: false, error: 'invalid_pairing', message: 'ไม่เจอ movement_id นี้' };

  const headers = movSh.getRange(1, 1, 1, movSh.getLastColumn()).getValues()[0];
  const row = movSh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];

  const typeIdx = headers.indexOf('movement_type');
  if (String(row[typeIdx]) !== 'outbound') {
    return { ok: false, error: 'invalid_pairing', message: 'movement_type ไม่ใช่ outbound' };
  }

  const statusIdx = headers.indexOf('status');
  const status = String(row[statusIdx] || '');
  if (status !== 'pending_partner') {
    return { ok: false, error: 'invalid_pairing', message: 'รอบ 1 ไม่อยู่ใน pending_partner (current: ' + status + ')' };
  }

  if (String(row[headers.indexOf('submitter1_user_id')]) === String(lineUserId)) {
    return { ok: false, error: 'same_submitter', message: 'คนนับ 1 และ 2 ต้องคนละ user' };
  }

  if (String(row[headers.indexOf('product_id')]) !== String(productId)) {
    return { ok: false, error: 'product_mismatch', message: 'สินค้าไม่ตรงกับรอบ 1' };
  }

  // upload + append photos
  const photoUrls = uploadImages(photos, pairingMovementId + '-r2', 'outbound');
  const photoIdx = headers.indexOf('photo_urls');
  const combined = String(row[photoIdx] || '')
    ? row[photoIdx] + ',' + photoUrls.join(',')
    : photoUrls.join(',');

  const now = nowBangkok();
  movSh.getRange(rowIdx, headers.indexOf('submitter2_user_id') + 1).setValue(lineUserId);
  movSh.getRange(rowIdx, headers.indexOf('submitter2_name') + 1).setValue(name);
  movSh.getRange(rowIdx, headers.indexOf('submitter2_qty') + 1).setValue(qty);
  movSh.getRange(rowIdx, headers.indexOf('submitter2_at') + 1).setValue(now);
  movSh.getRange(rowIdx, photoIdx + 1).setValue(combined);

  const s1Qty = Number(row[headers.indexOf('submitter1_qty')] || 0);
  const productName = String(row[headers.indexOf('product_name')] || productId);
  const s1Name = String(row[headers.indexOf('submitter1_name')] || '');

  // mismatch → pending_supervisor
  if (s1Qty !== qty) {
    movSh.getRange(rowIdx, statusIdx + 1).setValue('pending_supervisor');
    logWarn('handleSubmitOutbound', 'round2 mismatch', {
      movementId: pairingMovementId, s1: s1Qty, s2: qty,
    });
    safePushToAllSupervisors_([{
      type: 'text',
      text:
        '⚠️ นับไม่ตรง — ขอตัดสิน\n' +
        'รหัส: ' + pairingMovementId + ' (หยิบออก)\n' +
        'สินค้า: ' + productName + '\n' +
        'คนนับ 1 (' + s1Name + '): ' + s1Qty + '\n' +
        'คนนับ 2 (' + name + '): ' + qty,
    }], 'handleSubmitOutbound');
    return {
      ok: true,
      movementId: pairingMovementId,
      status: 'pending_supervisor',
      submitter1_qty: s1Qty,
      submitter2_qty: qty,
    };
  }

  // numbers match — ตรวจ stock พอไหม
  const stockNow = readStockQty_(productId);
  if (stockNow < qty) {
    // ไม่พอ → pending_supervisor + push managers (insufficient_stock)
    movSh.getRange(rowIdx, statusIdx + 1).setValue('pending_supervisor');
    logWarn('handleSubmitOutbound', 'round2 confirmed but insufficient stock', {
      movementId: pairingMovementId, productId: productId, qty: qty, stockNow: stockNow,
    });
    safePushToAllManagers_([{
      type: 'text',
      text:
        '⚠️ หยิบออกไม่ได้ — ของไม่พอ\n' +
        'รหัส: ' + pairingMovementId + '\n' +
        'สินค้า: ' + productName + '\n' +
        'ต้องการ: ' + qty + ' ชิ้น\n' +
        'คงเหลือ: ' + stockNow + ' ชิ้น\n' +
        'รอหัวหน้าตัดสิน',
    }], 'handleSubmitOutbound');
    return {
      ok: false,
      error: 'insufficient_stock',
      movementId: pairingMovementId,
      qty_on_hand: stockNow,
      requested: qty,
    };
  }

  // ตรง + พอ → confirmed + apply Stock (-qty)
  const stock = applyStockDelta_(productId, -qty, pairingMovementId);
  movSh.getRange(rowIdx, headers.indexOf('qty') + 1).setValue(-qty); // เก็บเป็นลบสำหรับ outbound
  movSh.getRange(rowIdx, statusIdx + 1).setValue('confirmed');
  movSh.getRange(rowIdx, headers.indexOf('confirmed_at') + 1).setValue(now);

  logInfo('handleSubmitOutbound', 'round2 confirmed', {
    movementId: pairingMovementId, productId: productId, qty: qty,
    stock_before: stock.qty_before, stock_after: stock.qty_after,
  });

  safePushToAllManagers_([{
    type: 'text',
    text:
      'หยิบออก confirmed\n' +
      'รหัส: ' + pairingMovementId + '\n' +
      'สินค้า: ' + productName + '\n' +
      'จำนวน: -' + qty + ' ชิ้น\n' +
      'ยอดคงเหลือ: ' + stock.qty_after,
  }], 'handleSubmitOutbound');

  return {
    ok: true,
    movementId: pairingMovementId,
    status: 'confirmed',
    qty: qty,
    qty_before: stock.qty_before,
    qty_after: stock.qty_after,
  };
}
