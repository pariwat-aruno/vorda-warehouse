/**
 * Count.gs — นับเทียบ (สัปดาห์ละครั้ง)
 *
 * ต่างจาก Inbound/Outbound:
 *   - ไม่ apply ไป Stock โดยอัตโนมัติ (ผลนับ ≠ การเปลี่ยนแปลง)
 *   - บันทึก variance = final_qty - system_qty
 *   - ถ้า variance ≠ 0 → push LINE owner รอกดปุ่ม "ปรับยอด" ใน owner LIFF
 *   - owner กดปรับยอด → adjustStock → insert Movement (movement_type='adjust')
 *
 * Flow:
 *   1. คนที่ 1 กรอก: เลือกสินค้า + qty นับได้ + รูป 4 มุม
 *      → snapshot system_qty (Stock.qty_on_hand) ตอนนี้
 *      → status pending_partner
 *   2. คนที่ 2 กรอก → match
 *      ตรง → status awaiting_owner ถ้า variance≠0, ไม่งั้น no_action
 *      ไม่ตรง → status pending_supervisor → หัวหน้าตัดสิน
 *   3. หัวหน้าตัดสิน → submitSupervisorTiebreaker
 *   4. owner เห็นใน dashboard → กด adjustStock → ปิด count
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

/**
 * นับเทียบสัปดาห์ละครั้ง — double-blind
 *
 * ต่างจาก Movement:
 *   - ไม่ apply Stock อัตโนมัติ
 *   - บันทึก system_qty (snapshot Stock ตอนรอบ 1) — ใช้คำนวณ variance
 *   - หลังรอบ 2 match: variance = final_qty - system_qty
 *     - variance === 0 → status='no_action'
 *     - variance !== 0 → status='awaiting_owner' + push owner ให้กดปรับยอด
 *
 * payload: { lineUserId, name, productId, qty, photos[4], pairingCountId? }
 */
function handleSubmitCount(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const name = payload.name || '';
  const productId = payload.productId;
  const qty = Number(payload.qty);
  const photos = payload.photos || [];
  const pairingCountId = payload.pairingCountId;

  if (!lineUserId || !productId || qty === '' || qty == null || !Array.isArray(photos) || photos.length < 4) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'productId', 'qty', 'photos[≥4]'] };
  }
  // qty นับเทียบอาจเป็น 0 ได้ (นับแล้วของหมด) แต่ต้องไม่ติดลบ
  if (!isFinite(qty) || qty < 0 || qty !== Math.floor(qty)) {
    return { ok: false, error: 'qty_invalid', message: 'qty ต้องเป็นจำนวนเต็มไม่ติดลบ' };
  }

  const dedupKey = 'count:' + lineUserId + ':' + productId + ':' + qty + ':' + (pairingCountId || 'r1');
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  try {
    autoRegisterStaff_(lineUserId, name);

    if (!pairingCountId) {
      return _handleCountRound1_(lineUserId, name, productId, qty, photos);
    } else {
      return _handleCountRound2_(lineUserId, name, productId, qty, photos, pairingCountId);
    }
  } catch (err) {
    logError('handleSubmitCount', err.message, {
      lineUserId: lineUserId, productId: productId, qty: qty, pairingCountId: pairingCountId,
    });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

function _handleCountRound1_(lineUserId, name, productId, qty, photos) {
  const productName = lookupProductName_(productId);
  if (!productName) return { ok: false, error: 'product_not_found', productId: productId };

  // snapshot system_qty จาก Stock ตอนนี้
  const systemQty = readStockQty_(productId);

  const countId = nextCountId();
  const photoUrls = uploadImages(photos, countId + '-r1', 'count');

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Counts');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = new Array(headers.length).fill('');
  const now = nowBangkok();

  setCol_(row, headers, 'count_id', countId);
  setCol_(row, headers, 'product_id', productId);
  setCol_(row, headers, 'product_name', productName);
  setCol_(row, headers, 'system_qty', systemQty);
  setCol_(row, headers, 'submitter1_user_id', lineUserId);
  setCol_(row, headers, 'submitter1_name', name);
  setCol_(row, headers, 'submitter1_qty', qty);
  setCol_(row, headers, 'submitter1_at', now);
  setCol_(row, headers, 'photo_urls', photoUrls.join(','));
  setCol_(row, headers, 'status', 'pending_partner');
  setCol_(row, headers, 'created_at', now);

  sh.appendRow(row);

  logInfo('handleSubmitCount', 'round1', {
    countId: countId, productId: productId, system_qty: systemQty, submitter1_qty: qty,
  });

  return {
    ok: true,
    countId: countId,
    status: 'pending_partner',
    system_qty: systemQty,
    message: 'บันทึกรอบ 1 สำเร็จ — ส่งเลขนี้ให้คนนับ 2: ' + countId,
  };
}

function _handleCountRound2_(lineUserId, name, productId, qty, photos, pairingCountId) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Counts');
  const rowIdx = findRowByIdCol_(sh, 'count_id', pairingCountId);
  if (rowIdx < 0) return { ok: false, error: 'invalid_pairing', message: 'ไม่เจอ count_id นี้' };

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];

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

  const photoUrls = uploadImages(photos, pairingCountId + '-r2', 'count');
  const photoIdx = headers.indexOf('photo_urls');
  const combined = String(row[photoIdx] || '')
    ? row[photoIdx] + ',' + photoUrls.join(',')
    : photoUrls.join(',');

  const now = nowBangkok();
  sh.getRange(rowIdx, headers.indexOf('submitter2_user_id') + 1).setValue(lineUserId);
  sh.getRange(rowIdx, headers.indexOf('submitter2_name') + 1).setValue(name);
  sh.getRange(rowIdx, headers.indexOf('submitter2_qty') + 1).setValue(qty);
  sh.getRange(rowIdx, headers.indexOf('submitter2_at') + 1).setValue(now);
  sh.getRange(rowIdx, photoIdx + 1).setValue(combined);

  const s1Qty = Number(row[headers.indexOf('submitter1_qty')] || 0);
  const systemQty = Number(row[headers.indexOf('system_qty')] || 0);
  const productName = String(row[headers.indexOf('product_name')] || productId);
  const s1Name = String(row[headers.indexOf('submitter1_name')] || '');

  if (s1Qty !== qty) {
    // ไม่ตรง → pending_supervisor
    sh.getRange(rowIdx, statusIdx + 1).setValue('pending_supervisor');
    logWarn('handleSubmitCount', 'round2 mismatch', { countId: pairingCountId, s1: s1Qty, s2: qty });
    safePushToAllSupervisors_([{
      type: 'text',
      text:
        '⚠️ นับเทียบไม่ตรง — ขอตัดสิน\n' +
        'รหัส: ' + pairingCountId + ' (นับเทียบ)\n' +
        'สินค้า: ' + productName + '\n' +
        'ยอดในระบบ: ' + systemQty + '\n' +
        'คนนับ 1 (' + s1Name + '): ' + s1Qty + '\n' +
        'คนนับ 2 (' + name + '): ' + qty,
    }], 'handleSubmitCount');
    return {
      ok: true,
      countId: pairingCountId,
      status: 'pending_supervisor',
      system_qty: systemQty,
      submitter1_qty: s1Qty,
      submitter2_qty: qty,
    };
  }

  // ตรง → final_qty = qty, คำนวณ variance
  const finalQty = qty;
  const variance = finalQty - systemQty;

  sh.getRange(rowIdx, headers.indexOf('final_qty') + 1).setValue(finalQty);
  sh.getRange(rowIdx, headers.indexOf('variance') + 1).setValue(variance);

  if (variance === 0) {
    // ไม่ต้องปรับยอด
    sh.getRange(rowIdx, statusIdx + 1).setValue('no_action');
    logInfo('handleSubmitCount', 'round2 no_action (variance=0)', {
      countId: pairingCountId, productId: productId, final_qty: finalQty, system_qty: systemQty,
    });
    safePushToAllManagers_([{
      type: 'text',
      text:
        'นับเทียบ ตรงระบบ\n' +
        'รหัส: ' + pairingCountId + '\n' +
        'สินค้า: ' + productName + '\n' +
        'ยอดในระบบ = ยอดนับ = ' + finalQty,
    }], 'handleSubmitCount');
    return {
      ok: true,
      countId: pairingCountId,
      status: 'no_action',
      system_qty: systemQty,
      final_qty: finalQty,
      variance: 0,
    };
  }

  // variance ≠ 0 → awaiting_owner
  sh.getRange(rowIdx, statusIdx + 1).setValue('awaiting_owner');
  logWarn('handleSubmitCount', 'round2 awaiting_owner (variance≠0)', {
    countId: pairingCountId, productId: productId,
    final_qty: finalQty, system_qty: systemQty, variance: variance,
  });

  const varianceStr = (variance > 0 ? '+' : '') + variance;
  safePushToAllOwners_([{
    type: 'text',
    text:
      '⚠️ นับเทียบไม่ตรงระบบ — รอปรับยอด\n' +
      'รหัส: ' + pairingCountId + '\n' +
      'สินค้า: ' + productName + '\n' +
      'ยอดในระบบ: ' + systemQty + '\n' +
      'ยอดนับจริง: ' + finalQty + '\n' +
      'ส่วนต่าง: ' + varianceStr + '\n' +
      'กด "ปรับยอด" ใน LIFF เจ้าของ',
  }], 'handleSubmitCount');

  return {
    ok: true,
    countId: pairingCountId,
    status: 'awaiting_owner',
    system_qty: systemQty,
    final_qty: finalQty,
    variance: variance,
  };
}

// =====================================================================
// SUPERVISOR TIEBREAKER (TASK-13) — implement ทีหลัง
// =====================================================================

function handleSupervisorTiebreaker(payload) {
  // payload: { lineUserId, name, recordType, recordId, qty, photos[4]? }
  return { ok: false, error: 'not_implemented', action: 'submitSupervisorTiebreaker' };
}
