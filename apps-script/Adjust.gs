/**
 * Adjust.gs — เสียหายของเสีย/แตกหัก
 *
 * เหมือน Inbound flow (double-blind 2 คน + รูป 4 มุม) แต่:
 *   - movement_type = 'adjust'
 *   - qty เป็นลบ (ลดสต๊อก)
 *   - ต้องระบุ reason
 *
 * นอกจากนี้ owner-initiated adjust ก็เรียก function นี้ตอน count variance:
 *   - handleAdjustStock(ownerPayload) → insert Movement (single approved by owner)
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

/**
 * เสียหายของเสีย/แตกหัก — staff double-blind
 *
 * payload: { lineUserId, name, productId, qty, reason, photos[4], pairingMovementId? }
 * qty: จำนวนของเสียที่จะตัด (เก็บเป็นลบใน Movements)
 * reason: บังคับ — เช่น "ของแตก", "หมดอายุ", "หาย"
 */
function handleSubmitAdjust(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const name = payload.name || '';
  const productId = payload.productId;
  const qty = Number(payload.qty);
  const reason = String(payload.reason || '').trim();
  const photos = payload.photos || [];
  const pairingMovementId = payload.pairingMovementId;

  if (!lineUserId || !productId || !qty || !Array.isArray(photos) || photos.length < 4) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'productId', 'qty', 'reason', 'photos[≥4]'] };
  }
  if (!reason) {
    return { ok: false, error: 'reason_required', message: 'เสียหายต้องระบุเหตุผล' };
  }
  if (!isFinite(qty) || qty <= 0 || qty !== Math.floor(qty)) {
    return { ok: false, error: 'qty_invalid', message: 'qty ต้องเป็นจำนวนเต็มบวก' };
  }

  const dedupKey = 'adjust:' + lineUserId + ':' + productId + ':' + qty + ':' + (pairingMovementId || 'r1');
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  try {
    autoRegisterStaff_(lineUserId, name);

    if (!pairingMovementId) {
      return _handleAdjustRound1_(lineUserId, name, productId, qty, reason, photos);
    } else {
      return _handleAdjustRound2_(lineUserId, name, productId, qty, reason, photos, pairingMovementId);
    }
  } catch (err) {
    logError('handleSubmitAdjust', err.message, {
      lineUserId: lineUserId, productId: productId, qty: qty, pairingMovementId: pairingMovementId,
    });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

function _handleAdjustRound1_(lineUserId, name, productId, qty, reason, photos) {
  const productName = lookupProductName_(productId);
  if (!productName) return { ok: false, error: 'product_not_found', productId: productId };

  const cfg = (function () { try { return getConfig(); } catch (e) { return {}; } })();
  const singleMode = !!cfg.SINGLE_STAFF_MODE;

  if (singleMode) {
    const stockNow = readStockQty_(productId);
    if (stockNow < qty) {
      return {
        ok: false, error: 'insufficient_stock',
        qty_on_hand: stockNow, requested: qty,
        message: 'เสียหายไม่ได้ — สต๊อกมี ' + stockNow + ' ชิ้น',
      };
    }
  }

  const movementId = nextMovementId();
  const photoUrls = uploadImages(photos, movementId + '-r1', 'adjust');

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const movSh = SpreadsheetApp.openById(sheetId).getSheetByName('Movements');
  const headers = movSh.getRange(1, 1, 1, movSh.getLastColumn()).getValues()[0];
  const row = new Array(headers.length).fill('');
  const now = nowBangkok();

  setCol_(row, headers, 'movement_id', movementId);
  setCol_(row, headers, 'movement_type', 'adjust');
  setCol_(row, headers, 'product_id', productId);
  setCol_(row, headers, 'product_name', productName);
  setCol_(row, headers, 'reason', reason);
  setCol_(row, headers, 'submitter1_user_id', lineUserId);
  setCol_(row, headers, 'submitter1_name', name);
  setCol_(row, headers, 'submitter1_qty', qty);
  setCol_(row, headers, 'submitter1_at', now);
  setCol_(row, headers, 'photo_urls', photoUrls.join(','));
  setCol_(row, headers, 'status', singleMode ? 'pending_owner' : 'pending_partner');
  setCol_(row, headers, 'created_at', now);

  movSh.appendRow(row);

  logInfo('handleSubmitAdjust', singleMode ? 'single_mode pending_owner' : 'round1', {
    movementId: movementId, productId: productId, qty: qty, reason: reason,
  });

  if (singleMode) {
    safePushToAllOwners_([buildPendingMovementCard({
      movement_id: movementId,
      movement_type: 'adjust',
      product_name: productName,
      submitter1_qty: qty,
      submitter1_name: name,
      reason: reason,
      photo_urls: photoUrls.join(','),
    })], 'handleSubmitAdjust');
    return {
      ok: true,
      movementId: movementId,
      status: 'pending_owner',
      message: 'บันทึกแล้ว — รอเจ้าของ approve',
    };
  }

  return {
    ok: true,
    movementId: movementId,
    status: 'pending_partner',
    message: 'บันทึกรอบ 1 สำเร็จ — ส่งเลขนี้ให้คนนับ 2: ' + movementId,
  };
}

function _handleAdjustRound2_(lineUserId, name, productId, qty, reason, photos, pairingMovementId) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const movSh = SpreadsheetApp.openById(sheetId).getSheetByName('Movements');
  const rowIdx = findRowByIdCol_(movSh, 'movement_id', pairingMovementId);
  if (rowIdx < 0) return { ok: false, error: 'invalid_pairing', message: 'ไม่เจอ movement_id นี้' };

  const headers = movSh.getRange(1, 1, 1, movSh.getLastColumn()).getValues()[0];
  const row = movSh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];

  if (String(row[headers.indexOf('movement_type')]) !== 'adjust') {
    return { ok: false, error: 'invalid_pairing', message: 'movement_type ไม่ใช่ adjust' };
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
  const photoUrls = uploadImages(photos, pairingMovementId + '-r2', 'adjust');
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

  if (s1Qty !== qty) {
    movSh.getRange(rowIdx, statusIdx + 1).setValue('pending_supervisor');
    logWarn('handleSubmitAdjust', 'round2 mismatch', { movementId: pairingMovementId, s1: s1Qty, s2: qty });
    safePushToAllSupervisors_([buildSupervisorTiebreakerCard({
      movement_id: pairingMovementId,
      product_name: productName,
      reason: reason,
      submitter1_name: s1Name,
      submitter1_qty: s1Qty,
      submitter2_name: name,
      submitter2_qty: qty,
      photo_urls: combined,
    }, 'movement', 'เสียหาย')], 'handleSubmitAdjust');
    return {
      ok: true,
      movementId: pairingMovementId,
      status: 'pending_supervisor',
      submitter1_qty: s1Qty,
      submitter2_qty: qty,
    };
  }

  // ตรง → apply Stock (-qty) — allow negative (ของเสียอาจติดลบได้ ในเชิง theoretical แต่ปกติไม่ควร)
  const stockNow = readStockQty_(productId);
  if (stockNow < qty) {
    // ของไม่พอจะตัด — pending_supervisor + push managers
    movSh.getRange(rowIdx, statusIdx + 1).setValue('pending_supervisor');
    logWarn('handleSubmitAdjust', 'round2 confirmed but insufficient stock', {
      movementId: pairingMovementId, qty: qty, stockNow: stockNow,
    });
    safePushToAllManagers_([{
      type: 'text',
      text:
        '⚠️ เสียหายไม่ได้ — ของไม่พอ\n' +
        'รหัส: ' + pairingMovementId + '\n' +
        'สินค้า: ' + productName + '\n' +
        'จะตัด: ' + qty + ' ชิ้น\n' +
        'คงเหลือ: ' + stockNow + ' ชิ้น\n' +
        'เหตุผล: ' + reason + '\n' +
        'รอหัวหน้าตัดสิน',
    }], 'handleSubmitAdjust');
    return {
      ok: false,
      error: 'insufficient_stock',
      movementId: pairingMovementId,
      qty_on_hand: stockNow,
      requested: qty,
    };
  }

  const stock = applyStockDelta_(productId, -qty, pairingMovementId);
  movSh.getRange(rowIdx, headers.indexOf('qty') + 1).setValue(-qty);
  movSh.getRange(rowIdx, statusIdx + 1).setValue('confirmed');
  movSh.getRange(rowIdx, headers.indexOf('confirmed_at') + 1).setValue(now);

  logInfo('handleSubmitAdjust', 'round2 confirmed', {
    movementId: pairingMovementId, productId: productId, qty: qty,
    reason: reason, stock_before: stock.qty_before, stock_after: stock.qty_after,
  });

  safePushToAllManagers_([{
    type: 'text',
    text:
      'เสียหาย confirmed\n' +
      'รหัส: ' + pairingMovementId + '\n' +
      'สินค้า: ' + productName + '\n' +
      'จำนวน: -' + qty + ' ชิ้น\n' +
      'เหตุผล: ' + reason + '\n' +
      'ยอดคงเหลือ: ' + stock.qty_after,
  }], 'handleSubmitAdjust');

  return {
    ok: true,
    movementId: pairingMovementId,
    status: 'confirmed',
    qty: qty,
    qty_before: stock.qty_before,
    qty_after: stock.qty_after,
  };
}

// =====================================================================
// OWNER-INITIATED ADJUST (หลัง count variance) — TASK-14 จะทำต่อ
// =====================================================================

/**
 * owner ปรับยอด Stock หลัง count variance (TASK-14)
 *
 * payload: { lineUserId, countId, deltaQty, reason }
 *   - deltaQty = +n เพิ่ม / -n ลด (โดยปกติ = final_qty - system_qty ของ Counts row)
 *   - reason: เหตุผลที่ปรับ (เช่น "ตรวจนับสัปดาห์ที่ 19")
 *
 * effect:
 *   1. insert Movements row (movement_type='adjust', single-submitter=owner)
 *   2. apply Stock — รองรับ delta บวก/ลบ (allow negative ถ้า owner ยืนยัน — แต่กันติดลบเหมือนเดิม)
 *   3. update Counts row: status='resolved_by_adjust', owner_action_*
 *   4. push owner confirmation
 *
 * error codes:
 *   missing_params, not_owner, count_not_found, count_not_awaiting,
 *   qty_invalid, insufficient_stock, server_error
 */
function handleAdjustStock(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const countId = payload.countId;
  const deltaQty = Number(payload.deltaQty);
  const reason = String(payload.reason || '').trim();

  if (!lineUserId || !countId || payload.deltaQty == null) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'countId', 'deltaQty'] };
  }
  if (!isOwner(lineUserId)) {
    return { ok: false, error: 'not_owner' };
  }
  if (!isFinite(deltaQty) || deltaQty !== Math.floor(deltaQty)) {
    return { ok: false, error: 'qty_invalid', message: 'deltaQty ต้องเป็นจำนวนเต็ม' };
  }
  if (deltaQty === 0) {
    return { ok: false, error: 'qty_invalid', message: 'deltaQty=0 ไม่ต้องปรับยอด' };
  }

  const dedupKey = 'adjustStock:' + lineUserId + ':' + countId;
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const countsSh = ss.getSheetByName('Counts');
    const movSh = ss.getSheetByName('Movements');

    const rowIdx = findRowByIdCol_(countsSh, 'count_id', countId);
    if (rowIdx < 0) return { ok: false, error: 'count_not_found', countId: countId };

    const headers = countsSh.getRange(1, 1, 1, countsSh.getLastColumn()).getValues()[0];
    const row = countsSh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];

    const status = String(row[headers.indexOf('status')] || '');
    if (status !== 'awaiting_owner') {
      return { ok: false, error: 'count_not_awaiting', currentStatus: status };
    }

    const productId = String(row[headers.indexOf('product_id')] || '');
    const productName = String(row[headers.indexOf('product_name')] || productId);
    const systemQty = Number(row[headers.indexOf('system_qty')] || 0);
    const finalQty = Number(row[headers.indexOf('final_qty')] || 0);
    const ownerName = (function () {
      const s = findStaffByLineUserId(lineUserId);
      return (s && s.name) || 'owner';
    })();

    // pre-check stock ถ้า delta ลบ
    if (deltaQty < 0) {
      const stockNow = readStockQty_(productId);
      if (stockNow + deltaQty < 0) {
        return {
          ok: false, error: 'insufficient_stock',
          qty_on_hand: stockNow, delta: deltaQty,
        };
      }
    }

    // 1. insert Movements row (single-submitter = owner)
    const movementId = nextMovementId();
    const movHeaders = movSh.getRange(1, 1, 1, movSh.getLastColumn()).getValues()[0];
    const mrow = new Array(movHeaders.length).fill('');
    const now = nowBangkok();
    setCol_(mrow, movHeaders, 'movement_id', movementId);
    setCol_(mrow, movHeaders, 'movement_type', 'adjust');
    setCol_(mrow, movHeaders, 'product_id', productId);
    setCol_(mrow, movHeaders, 'product_name', productName);
    setCol_(mrow, movHeaders, 'qty', deltaQty);
    setCol_(mrow, movHeaders, 'reason', reason || ('count adjust: ' + countId));
    setCol_(mrow, movHeaders, 'related_doc_id', countId);
    // owner เป็น submitter1 (ไม่มี submitter2 — single-submitter)
    setCol_(mrow, movHeaders, 'submitter1_user_id', lineUserId);
    setCol_(mrow, movHeaders, 'submitter1_name', ownerName);
    setCol_(mrow, movHeaders, 'submitter1_qty', deltaQty);
    setCol_(mrow, movHeaders, 'submitter1_at', now);
    setCol_(mrow, movHeaders, 'status', 'confirmed');
    setCol_(mrow, movHeaders, 'created_at', now);
    setCol_(mrow, movHeaders, 'confirmed_at', now);
    movSh.appendRow(mrow);

    // 2. apply Stock
    const stock = applyStockDelta_(productId, deltaQty, movementId);

    // 3. update Counts row
    countsSh.getRange(rowIdx, headers.indexOf('status') + 1).setValue('resolved_by_adjust');
    countsSh.getRange(rowIdx, headers.indexOf('owner_action_user_id') + 1).setValue(lineUserId);
    countsSh.getRange(rowIdx, headers.indexOf('owner_action_at') + 1).setValue(now);

    logInfo('handleAdjustStock', 'count adjusted', {
      countId: countId, movementId: movementId, productId: productId,
      deltaQty: deltaQty, system_qty: systemQty, final_qty: finalQty,
      stock_before: stock.qty_before, stock_after: stock.qty_after,
    });

    // 4. push owner confirmation
    const deltaStr = (deltaQty > 0 ? '+' : '') + deltaQty;
    safePushToAllOwners_([{
      type: 'text',
      text:
        'ปรับยอด confirmed\n' +
        'รหัส: ' + countId + '\n' +
        'สินค้า: ' + productName + '\n' +
        'ปรับยอด: ' + deltaStr + ' ชิ้น\n' +
        'ยอดคงเหลือ: ' + stock.qty_after + ' (เดิม ' + stock.qty_before + ')\n' +
        (reason ? 'เหตุผล: ' + reason + '\n' : '') +
        'movement: ' + movementId,
    }], 'handleAdjustStock');

    return {
      ok: true,
      countId: countId,
      movementId: movementId,
      deltaQty: deltaQty,
      qty_before: stock.qty_before,
      qty_after: stock.qty_after,
      countStatus: 'resolved_by_adjust',
    };
  } catch (err) {
    logError('handleAdjustStock', err.message, { countId: countId, deltaQty: deltaQty });
    return { ok: false, error: 'server_error', message: err.message };
  }
}
