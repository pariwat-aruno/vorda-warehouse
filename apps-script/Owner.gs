/**
 * Owner.gs — endpoints สำหรับ owner LIFF (owner.html)
 *
 * ทุก function เริ่มด้วย `if (!isOwner(payload.lineUserId)) return { ok:false, error:'not_owner' }`
 *
 *   - getOwnerDashboard: รายการที่รอ approve + ยอดสต๊อกปัจจุบัน + alert
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

/**
 * dashboard สำหรับ owner LIFF (owner.html)
 *
 * payload: { lineUserId }
 *
 * return: {
 *   ok: true,
 *   stock: [{ product_id, product_name, qty_on_hand, unit }, ...],
 *   pending_returns: [...],
 *   pending_cancels: [...],
 *   pending_count_variance: [...],   // Counts status='awaiting_owner'
 *   open_claims: [...],              // Claims stage ≠ 'closed'
 * }
 */
function handleOwnerDashboard(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  if (!lineUserId) return { ok: false, error: 'missing_params', need: ['lineUserId'] };
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);

    const cfg = (function () { try { return getConfig(); } catch (e) { return {}; } })();
    return {
      ok: true,
      stock: _readStock_(ss),
      pending_movements: _readSheetFiltered_(ss, 'Movements', 'status', 'pending_owner'),
      pending_returns: _readSheetFiltered_(ss, 'Returns', 'status', 'pending_owner'),
      pending_cancels: _readSheetFiltered_(ss, 'Cancellations', 'status', 'pending_owner'),
      pending_count_variance: _readSheetFiltered_(ss, 'Counts', 'status', 'awaiting_owner'),
      open_claims: _readSheetFilteredNotEqual_(ss, 'Claims', 'stage', 'closed'),
      settings: {
        single_staff_mode: !!cfg.SINGLE_STAFF_MODE,
      },
      generated_at: nowBangkok(),
    };
  } catch (err) {
    logError('handleOwnerDashboard', err.message, { lineUserId: lineUserId });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/** อ่าน Stock + join unit จาก Products */
function _readStock_(ss) {
  const stockSh = ss.getSheetByName('Stock');
  const productsSh = ss.getSheetByName('Products');

  const productsLast = productsSh.getLastRow();
  const unitMap = {};
  if (productsLast >= 2) {
    const pHeaders = productsSh.getRange(1, 1, 1, productsSh.getLastColumn()).getValues()[0];
    const pData = productsSh.getRange(2, 1, productsLast - 1, pHeaders.length).getValues();
    const pidIdx = pHeaders.indexOf('product_id');
    const unitIdx = pHeaders.indexOf('unit');
    const activeIdx = pHeaders.indexOf('is_active');
    pData.forEach(function (r) {
      const id = String(r[pidIdx] || '');
      if (!id) return;
      unitMap[id] = {
        unit: r[unitIdx] || 'ชิ้น',
        is_active: r[activeIdx] === true || String(r[activeIdx]).toLowerCase() === 'true',
      };
    });
  }

  const last = stockSh.getLastRow();
  if (last < 2) return [];
  const headers = stockSh.getRange(1, 1, 1, stockSh.getLastColumn()).getValues()[0];
  const data = stockSh.getRange(2, 1, last - 1, headers.length).getValues();

  const out = [];
  for (let i = 0; i < data.length; i++) {
    const r = {};
    headers.forEach(function (h, j) { r[h] = data[i][j]; });
    if (!r.product_id) continue;
    const meta = unitMap[r.product_id] || {};
    if (meta.is_active === false) continue; // ซ่อนตัว inactive
    out.push({
      product_id: r.product_id,
      product_name: r.product_name,
      qty_on_hand: Number(r.qty_on_hand || 0),
      unit: meta.unit || 'ชิ้น',
      last_movement_id: r.last_movement_id,
      last_movement_at: _serializeDate_(r.last_movement_at),
      updated_at: _serializeDate_(r.updated_at),
    });
  }
  return out;
}

/** filter rows by colName === value — return array of plain objects (Date → string) */
function _readSheetFiltered_(ss, sheetName, colName, value) {
  return _readSheet_(ss, sheetName, function (r) {
    return String(r[colName] || '') === String(value);
  });
}

function _readSheetFilteredNotEqual_(ss, sheetName, colName, value) {
  return _readSheet_(ss, sheetName, function (r) {
    return String(r[colName] || '') !== String(value);
  });
}

function _readSheet_(ss, sheetName, filterFn) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, headers.length).getValues();
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const r = {};
    headers.forEach(function (h, j) { r[h] = data[i][j]; });
    // ถ้า col แรก (id) ว่าง — ข้าม (row ว่าง)
    if (!data[i][0]) continue;
    if (!filterFn(r)) continue;
    // serialize Date → string สำหรับ JSON
    Object.keys(r).forEach(function (k) {
      r[k] = _serializeDate_(r[k]);
    });
    out.push(r);
  }
  return out;
}

function _serializeDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return v;
}

// =====================================================================
// USER MANAGEMENT — owner add/remove owners + supervisors + view staff
// =====================================================================

const LINE_USER_ID_RE = /^U[0-9a-fA-F]{32}$/;

/**
 * list ทุกคนที่ใช้ระบบได้
 *
 * return: {
 *   ok, owners: [{ line_user_id, name?, staff_id? }],
 *   supervisors: [...],
 *   staff: [{ staff_id, name, line_user_id, role, registered_at }],
 * }
 */
function handleListUsers(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  if (!lineUserId) return { ok: false, error: 'missing_params', need: ['lineUserId'] };
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };

  try {
    const cfg = getConfig();
    const staff = _readStaffSheet_();
    const staffByLineId = {};
    staff.forEach(function (s) { if (s.line_user_id) staffByLineId[s.line_user_id] = s; });

    function decorate(idList) {
      return idList.map(function (id) {
        const s = staffByLineId[id];
        return {
          line_user_id: id,
          name: (s && s.name) || '',
          staff_id: (s && s.staff_id) || '',
          registered_at: (s && s.registered_at) || '',
        };
      });
    }

    return {
      ok: true,
      owners: decorate(cfg.OWNER_LINE_USER_IDS || []),
      supervisors: decorate(cfg.SUPERVISOR_LINE_USER_IDS || []),
      staff: staff,
    };
  } catch (err) {
    logError('handleListUsers', err.message);
    return { ok: false, error: 'server_error', message: err.message };
  }
}

function _readStaffSheet_() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Staff');
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, headers.length).getValues();
  const out = [];
  for (let i = 0; i < data.length; i++) {
    if (!data[i][0]) continue;
    const r = {};
    headers.forEach(function (h, j) {
      const v = data[i][j];
      r[h] = (v instanceof Date) ? _serializeDate_(v) : v;
    });
    out.push(r);
  }
  return out;
}

/**
 * เพิ่ม manager (owner หรือ supervisor)
 *
 * payload: { lineUserId, role: 'owner'|'supervisor', addLineUserId, name? }
 * (ถ้าใส่ name + lineUserId ยังไม่อยู่ใน Staff → register ให้)
 */
function handleAddManager(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const role = String(payload.role || '').toLowerCase();
  const addId = String(payload.addLineUserId || '').trim();
  const name = String(payload.name || '').trim();

  if (!lineUserId || !role || !addId) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'role', 'addLineUserId'] };
  }
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };
  if (role !== 'owner' && role !== 'supervisor') {
    return { ok: false, error: 'invalid_role', valid: ['owner', 'supervisor'] };
  }
  if (!LINE_USER_ID_RE.test(addId)) {
    return { ok: false, error: 'invalid_user_id', message: 'LINE userId ต้องขึ้นต้นด้วย U + 32 ตัวอักษร hex' };
  }

  try {
    _setManagerList_(role, addId, true, name);
    logOwnerAction_(lineUserId, 'addManager', addId, role, { name: name });
    return Object.assign({ ok: true, role: role, addLineUserId: addId, added: true }, handleListUsers({ lineUserId: lineUserId }));
  } catch (err) {
    logError('handleAddManager', err.message, { role: role, addId: addId });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/**
 * ลบ manager
 *
 * payload: { lineUserId, role, removeLineUserId }
 *
 * safety: ห้ามลบ owner คนสุดท้าย (กัน lockout)
 */
function handleRemoveManager(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const role = String(payload.role || '').toLowerCase();
  const removeId = String(payload.removeLineUserId || '').trim();

  if (!lineUserId || !role || !removeId) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'role', 'removeLineUserId'] };
  }
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };
  if (role !== 'owner' && role !== 'supervisor') {
    return { ok: false, error: 'invalid_role' };
  }

  try {
    const cfg = getConfig();
    if (role === 'owner' && cfg.OWNER_LINE_USER_IDS.length <= 1) {
      return { ok: false, error: 'last_owner', message: 'ลบ owner คนสุดท้ายไม่ได้ — จะถูก lockout' };
    }
    _setManagerList_(role, removeId, false);
    logOwnerAction_(lineUserId, 'removeManager', removeId, role, {});
    return Object.assign({ ok: true, role: role, removeLineUserId: removeId, removed: true }, handleListUsers({ lineUserId: lineUserId }));
  } catch (err) {
    logError('handleRemoveManager', err.message, { role: role, removeId: removeId });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/**
 * helper: เพิ่ม/ลบ userId จาก Sheet Config row + (optional) sync Staff role
 */
function _setManagerList_(role, targetId, add, displayName) {
  const configKey = role === 'owner' ? 'owner_line_user_ids' : 'supervisor_line_user_ids';
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName('Config');
  if (!sh) throw new Error('sheet Config not found');

  const last = sh.getLastRow();
  if (last < 2) throw new Error('Config sheet empty');
  const data = sh.getRange(2, 1, last - 1, 2).getValues();

  let rowIdx = -1;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === configKey) { rowIdx = i + 2; break; }
  }
  if (rowIdx < 0) {
    sh.appendRow([configKey, '', 'managed via owner LIFF']);
    rowIdx = sh.getLastRow();
  }

  const currentValue = String(sh.getRange(rowIdx, 2).getValue() || '');
  const ids = currentValue.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });

  const has = ids.indexOf(targetId) >= 0;
  if (add && !has) ids.push(targetId);
  if (!add && has) ids.splice(ids.indexOf(targetId), 1);

  sh.getRange(rowIdx, 2).setValue(ids.join(','));

  // sync Staff role (auto-register ถ้าจำเป็น)
  if (add) {
    autoRegisterStaff_(targetId, displayName || '');
    _setStaffRole_(targetId, role);
  } else {
    _setStaffRole_(targetId, 'staff');
  }

  clearConfigCache();
}

/**
 * owner ตั้งชื่อ staff ที่ยังไม่มีชื่อ
 *
 * payload: { lineUserId, targetLineUserId, name }
 */
function handleSetStaffName(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const targetId = String(payload.targetLineUserId || '').trim();
  const name = String(payload.name || '').trim();

  if (!lineUserId || !targetId || !name) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'targetLineUserId', 'name'] };
  }
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };
  if (!LINE_USER_ID_RE.test(targetId)) return { ok: false, error: 'invalid_user_id' };

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Staff');
    if (!sh) throw new Error('sheet Staff not found');
    _updateStaffName_(sh, targetId, name);
    logOwnerAction_(lineUserId, 'setStaffName', targetId, '', { name: name });
    return { ok: true, targetLineUserId: targetId, name: name };
  } catch (err) {
    logError('handleSetStaffName', err.message, { targetId: targetId });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/**
 * owner approve Movement ที่ pending_owner (single-staff mode)
 *
 * payload: { lineUserId, movementId, decision: 'accept'|'reject' }
 *
 * accept → apply Stock ตาม movement_type → status='confirmed'
 * reject → status='rejected' ไม่กระทบ Stock
 */
function handleApproveMovement(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const movementId = payload.movementId;
  const decision = String(payload.decision || '').toLowerCase();

  if (!lineUserId || !movementId || !decision) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'movementId', 'decision'] };
  }
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };
  if (decision !== 'accept' && decision !== 'reject') {
    return { ok: false, error: 'decision_invalid', valid: ['accept', 'reject'] };
  }

  const dedupKey = 'approveMovement:' + lineUserId + ':' + movementId;
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Movements');
    const rowIdx = findRowByIdCol_(sh, 'movement_id', movementId);
    if (rowIdx < 0) return { ok: false, error: 'not_found', movementId: movementId };

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];

    const status = String(row[headers.indexOf('status')] || '');
    if (status !== 'pending_owner') {
      return { ok: false, error: 'not_pending_owner', currentStatus: status };
    }

    const movementType = String(row[headers.indexOf('movement_type')] || '');
    const productId = String(row[headers.indexOf('product_id')] || '');
    const productName = String(row[headers.indexOf('product_name')] || productId);
    const qtyValue = Number(row[headers.indexOf('submitter1_qty')] || 0);
    const reason = String(row[headers.indexOf('reason')] || '');
    const ownerName = (function () {
      const s = findStaffByLineUserId(lineUserId);
      return (s && s.name) || 'owner';
    })();
    const now = nowBangkok();

    if (decision === 'reject') {
      sh.getRange(rowIdx, headers.indexOf('status') + 1).setValue('rejected');
      // ใช้ supervisor_user_id field ก็ได้ แต่ตรงกว่าใช้ cancel field
      sh.getRange(rowIdx, headers.indexOf('cancel_at') + 1).setValue(now);
      sh.getRange(rowIdx, headers.indexOf('cancel_reason') + 1).setValue('owner rejected');
      logInfo('handleApproveMovement', 'rejected', { movementId: movementId, type: movementType });
      logOwnerAction_(lineUserId, 'approveMovement', movementId, 'reject', { movementType: movementType, qty: qtyValue });
      const typeLabel = _movementTypeLabel_(movementType);
      safePushToAllManagers_([{
        type: 'text',
        text: typeLabel + ' rejected\n' +
              'รหัส: ' + movementId + '\n' +
              'สินค้า: ' + productName + '\n' +
              'จำนวน: ' + qtyValue + ' (ไม่กระทบ Stock)\n' +
              'โดย: ' + ownerName,
      }], 'handleApproveMovement');
      return { ok: true, movementId: movementId, decision: 'reject', status: 'rejected' };
    }

    // accept → กำหนด delta จาก type
    let delta;
    let typeLabel;
    if (movementType === 'inbound') { delta = +qtyValue; typeLabel = 'รับเข้า'; }
    else if (movementType === 'outbound') { delta = -qtyValue; typeLabel = 'เตรียมแพ็ค'; }
    else if (movementType === 'adjust') { delta = -qtyValue; typeLabel = 'เสียหาย'; }
    else return { ok: false, error: 'unknown_movement_type', movementType: movementType };

    if (delta < 0) {
      const stockNow = readStockQty_(productId);
      if (stockNow + delta < 0) {
        return {
          ok: false, error: 'insufficient_stock',
          qty_on_hand: stockNow, requested: qtyValue,
        };
      }
    }

    const stock = applyStockDelta_(productId, delta, movementId);

    sh.getRange(rowIdx, headers.indexOf('qty') + 1).setValue(delta);
    sh.getRange(rowIdx, headers.indexOf('status') + 1).setValue('confirmed');
    sh.getRange(rowIdx, headers.indexOf('confirmed_at') + 1).setValue(now);
    // บันทึก owner ใน supervisor_* fields (re-use schema)
    sh.getRange(rowIdx, headers.indexOf('supervisor_user_id') + 1).setValue(lineUserId);
    sh.getRange(rowIdx, headers.indexOf('supervisor_name') + 1).setValue(ownerName);
    sh.getRange(rowIdx, headers.indexOf('supervisor_at') + 1).setValue(now);

    logInfo('handleApproveMovement', 'accepted', {
      movementId: movementId, type: movementType, qty: qtyValue,
      stock_before: stock.qty_before, stock_after: stock.qty_after,
    });
    logOwnerAction_(lineUserId, 'approveMovement', movementId, 'accept', {
      movementType: movementType, delta: delta, stock_after: stock.qty_after,
    });

    safePushToAllManagers_([{
      type: 'text',
      text: typeLabel + ' confirmed (owner approved)\n' +
            'รหัส: ' + movementId + '\n' +
            'สินค้า: ' + productName + '\n' +
            'จำนวน: ' + (delta > 0 ? '+' : '') + delta + ' ชิ้น\n' +
            (reason ? 'เหตุผล: ' + reason + '\n' : '') +
            'ยอดคงเหลือ: ' + stock.qty_after,
    }], 'handleApproveMovement');

    return {
      ok: true, movementId: movementId, decision: 'accept',
      status: 'confirmed', qty_applied: delta,
      qty_before: stock.qty_before, qty_after: stock.qty_after,
    };
  } catch (err) {
    logError('handleApproveMovement', err.message, { movementId: movementId });
    return { ok: false, error: 'server_error', message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function _movementTypeLabel_(t) {
  return t === 'inbound' ? 'รับเข้า'
       : t === 'outbound' ? 'เตรียมแพ็ค'
       : t === 'adjust' ? 'เสียหาย'
       : t;
}

/**
 * อ่าน/เขียน setting ใน Sheet Config — owner ใช้ toggle single_staff_mode etc.
 *
 * payload: { lineUserId, key, value? }
 *   - ถ้าไม่มี value → return ค่าปัจจุบัน
 *   - ถ้ามี value → update + clear cache
 */
function handleSetSetting(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const key = String(payload.key || '').trim();
  if (!lineUserId || !key) return { ok: false, error: 'missing_params', need: ['lineUserId', 'key'] };
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };

  // whitelist เฉพาะ key ที่อนุญาตให้ toggle
  const ALLOWED = ['single_staff_mode'];
  if (ALLOWED.indexOf(key) < 0) return { ok: false, error: 'key_not_allowed', allowed: ALLOWED };

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Config');
    const last = sh.getLastRow();
    if (last < 2) throw new Error('Config sheet empty');
    const data = sh.getRange(2, 1, last - 1, 2).getValues();
    let rowIdx = -1;
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === key) { rowIdx = i + 2; break; }
    }
    if (rowIdx < 0) {
      sh.appendRow([key, '', 'set via owner LIFF']);
      rowIdx = sh.getLastRow();
    }

    if (payload.value !== undefined) {
      const newVal = payload.value === true || String(payload.value).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
      sh.getRange(rowIdx, 2).setValue(newVal);
      clearConfigCache();
      logInfo('handleSetSetting', 'updated', { key: key, value: newVal });
      logOwnerAction_(lineUserId, 'setSetting', key, newVal, {});
      return { ok: true, key: key, value: newVal, updated: true };
    }

    return { ok: true, key: key, value: sh.getRange(rowIdx, 2).getValue() };
  } catch (err) {
    logError('handleSetSetting', err.message, { key: key });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

// =====================================================================
// OWNER ACTION LOG — บันทึกทุก mutating action ของ owner
// =====================================================================

const OWNER_LOG_HEADERS = ['timestamp', 'owner_user_id', 'owner_name', 'action', 'target_id', 'decision', 'detail'];

/**
 * เขียน log การกระทำ owner — sheet `OwnerLog` (สร้างอัตโนมัติ)
 * never throws — log failure ไม่ block business logic
 */
function logOwnerAction_(lineUserId, action, targetId, decision, detail) {
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    let sh = ss.getSheetByName('OwnerLog');
    if (!sh) {
      sh = ss.insertSheet('OwnerLog');
      sh.getRange(1, 1, 1, OWNER_LOG_HEADERS.length).setValues([OWNER_LOG_HEADERS]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, OWNER_LOG_HEADERS.length).setFontWeight('bold');
    }
    const staff = findStaffByLineUserId(lineUserId);
    const ownerName = (staff && staff.name) || '';
    sh.appendRow([
      nowBangkok(),
      String(lineUserId || ''),
      ownerName,
      String(action || ''),
      String(targetId || ''),
      String(decision || ''),
      detail == null ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail)),
    ]);
  } catch (err) {
    console.error('logOwnerAction_ failed:', err && err.message ? err.message : err);
  }
}

/**
 * owner ดู log ของตัวเอง / ทุกคน
 *
 * payload: { lineUserId, ownerUserId?, action?, limit?, from?, to? }
 */
function handleGetOwnerLog(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  if (!lineUserId) return { ok: false, error: 'missing_params', need: ['lineUserId'] };
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };

  const filterOwnerId = payload.ownerUserId ? String(payload.ownerUserId) : '';
  const filterAction = payload.action ? String(payload.action) : '';
  const from = payload.from ? String(payload.from) : '';
  const to = payload.to ? String(payload.to) : '';
  const limit = Math.min(Math.max(Number(payload.limit) || 100, 1), 500);

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const sh = ss.getSheetByName('OwnerLog');
    if (!sh) return { ok: true, items: [], count: 0 };

    const last = sh.getLastRow();
    if (last < 2) return { ok: true, items: [], count: 0 };
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const data = sh.getRange(2, 1, last - 1, headers.length).getValues();
    const items = [];
    for (let i = 0; i < data.length; i++) {
      if (!data[i][0]) continue;
      const r = {};
      headers.forEach(function (h, j) {
        const v = data[i][j];
        r[h] = (v instanceof Date) ? _serializeDate_(v) : v;
      });
      // filter
      if (filterOwnerId && String(r.owner_user_id) !== filterOwnerId) continue;
      if (filterAction && String(r.action) !== filterAction) continue;
      if (from || to) {
        const d = _datePartBangkok_(r.timestamp);
        if (from && d < from) continue;
        if (to && d > to) continue;
      }
      items.push(r);
    }
    items.sort(function (a, b) { return String(b.timestamp || '').localeCompare(String(a.timestamp || '')); });
    return { ok: true, items: items.slice(0, limit), count: items.length };
  } catch (err) {
    logError('handleGetOwnerLog', err.message);
    return { ok: false, error: 'server_error', message: err.message };
  }
}

// =====================================================================
// HISTORY / AUDIT — list approved records with filters
// =====================================================================

/**
 * รวมประวัติ approve ทั้งหมด (movement / return / cancel) — filter ได้ตามวัน/ประเภท
 *
 * payload: {
 *   lineUserId,
 *   type?: 'all'|'movement'|'return'|'cancel',   default 'all'
 *   from?: 'yyyy-MM-dd',  to?: 'yyyy-MM-dd',     local Asia/Bangkok dates
 *   limit?: number (default 100, max 300)
 * }
 *
 * return: { ok, items: [{ kind, id, ... full record, when }], count }
 */
function handleGetHistory(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  if (!lineUserId) return { ok: false, error: 'missing_params', need: ['lineUserId'] };
  if (!isOwner(lineUserId) && !isSupervisor(lineUserId)) {
    return { ok: false, error: 'not_authorized' };
  }

  const type = String(payload.type || 'all').toLowerCase();
  const from = payload.from ? String(payload.from) : '';
  const to = payload.to ? String(payload.to) : '';
  const limit = Math.min(Math.max(Number(payload.limit) || 100, 1), 300);

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    let items = [];

    function inRange(when) {
      if (!when) return false;
      const d = _datePartBangkok_(when);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    }

    if (type === 'all' || type === 'movement') {
      _readSheetAll_(ss, 'Movements').forEach(r => {
        if (String(r.status || '') !== 'confirmed') return;
        const when = r.confirmed_at || r.created_at;
        if (!inRange(when)) return;
        items.push(Object.assign({ kind: 'movement', when: when }, r));
      });
    }
    if (type === 'all' || type === 'return') {
      _readSheetAll_(ss, 'Returns').forEach(r => {
        const st = String(r.status || '');
        if (['accepted', 'rejected', 'forwarded_to_claim'].indexOf(st) < 0) return;
        const when = r.owner_at || r.staff_at;
        if (!inRange(when)) return;
        items.push(Object.assign({ kind: 'return', when: when }, r));
      });
    }
    if (type === 'all' || type === 'cancel') {
      _readSheetAll_(ss, 'Cancellations').forEach(r => {
        const st = String(r.status || '');
        if (['accepted', 'rejected'].indexOf(st) < 0) return;
        const when = r.owner_at || r.staff_at;
        if (!inRange(when)) return;
        items.push(Object.assign({ kind: 'cancel', when: when }, r));
      });
    }

    // sort by when desc, take limit
    items.sort((a, b) => String(b.when || '').localeCompare(String(a.when || '')));
    items = items.slice(0, limit);

    return { ok: true, items: items, count: items.length };
  } catch (err) {
    logError('handleGetHistory', err.message);
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/** อ่านทุก row ของ sheet เป็น array of objects (Date → ISO string) — helper */
function _readSheetAll_(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, headers.length).getValues();
  const out = [];
  for (let i = 0; i < data.length; i++) {
    if (!data[i][0]) continue;
    const r = {};
    headers.forEach(function (h, j) {
      const v = data[i][j];
      r[h] = (v instanceof Date) ? _serializeDate_(v) : v;
    });
    out.push(r);
  }
  return out;
}

// =====================================================================
// PRODUCT MANAGEMENT — owner add/edit/toggle products
// =====================================================================

/** list ทุก product (รวม inactive) สำหรับ owner LIFF */
function handleListProducts(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  if (!lineUserId) return { ok: false, error: 'missing_params', need: ['lineUserId'] };
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const productsSh = ss.getSheetByName('Products');
    const stockSh = ss.getSheetByName('Stock');

    const stockMap = {};
    const stockLast = stockSh.getLastRow();
    if (stockLast >= 2) {
      const sH = stockSh.getRange(1, 1, 1, stockSh.getLastColumn()).getValues()[0];
      const sD = stockSh.getRange(2, 1, stockLast - 1, sH.length).getValues();
      const pid = sH.indexOf('product_id');
      const qty = sH.indexOf('qty_on_hand');
      sD.forEach(function (r) { if (r[pid]) stockMap[r[pid]] = Number(r[qty] || 0); });
    }

    const last = productsSh.getLastRow();
    if (last < 2) return { ok: true, products: [] };
    const headers = productsSh.getRange(1, 1, 1, productsSh.getLastColumn()).getValues()[0];
    const data = productsSh.getRange(2, 1, last - 1, headers.length).getValues();
    const out = [];
    for (let i = 0; i < data.length; i++) {
      if (!data[i][0]) continue;
      const r = {};
      headers.forEach(function (h, j) {
        const v = data[i][j];
        r[h] = (v instanceof Date) ? _serializeDate_(v) : v;
      });
      r.qty_on_hand = stockMap[r.product_id] != null ? stockMap[r.product_id] : 0;
      r.is_active = r.is_active === true || String(r.is_active).toLowerCase() === 'true';
      out.push(r);
    }
    return { ok: true, products: out };
  } catch (err) {
    logError('handleListProducts', err.message);
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/** เพิ่มสินค้าใหม่ — auto-gen SKU-NN; payload: { lineUserId, name, unit? } */
function handleAddProduct(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const name = String(payload.name || '').trim();
  const unit = String(payload.unit || 'ชิ้น').trim();

  if (!lineUserId || !name) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'name'] };
  }
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: 'name_invalid', message: 'ชื่อสินค้าต้องยาว 2-80 ตัวอักษร' };
  }

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const productsSh = ss.getSheetByName('Products');
    const stockSh = ss.getSheetByName('Stock');

    const last = productsSh.getLastRow();
    let maxNum = 0;
    if (last >= 2) {
      productsSh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
        const id = String(r[0] || '');
        const m = id.match(/^SKU-(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxNum) maxNum = n;
        }
      });
    }
    const newId = 'SKU-' + padLeft_(maxNum + 1, 2);
    const now = nowBangkok();

    productsSh.appendRow([newId, name, unit, 0, now, true]);
    stockSh.appendRow([newId, name, 0, '', '', now]);

    logInfo('handleAddProduct', 'added', { productId: newId, name: name, unit: unit });
    logOwnerAction_(lineUserId, 'addProduct', newId, '', { name: name, unit: unit });
    return { ok: true, product_id: newId, name: name, unit: unit };
  } catch (err) {
    logError('handleAddProduct', err.message);
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/** แก้ไขสินค้า — payload: { lineUserId, productId, name?, unit?, isActive? } */
function handleUpdateProduct(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const productId = String(payload.productId || '').trim();
  if (!lineUserId || !productId) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'productId'] };
  }
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };

  const name = payload.name != null ? String(payload.name).trim() : null;
  const unit = payload.unit != null ? String(payload.unit).trim() : null;
  const isActive = payload.isActive != null ? !!payload.isActive : null;

  if (name !== null && (name.length < 2 || name.length > 80)) {
    return { ok: false, error: 'name_invalid' };
  }

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const productsSh = ss.getSheetByName('Products');
    const stockSh = ss.getSheetByName('Stock');

    const rowIdx = findRowByIdCol_(productsSh, 'product_id', productId);
    if (rowIdx < 0) return { ok: false, error: 'product_not_found', productId: productId };

    const headers = productsSh.getRange(1, 1, 1, productsSh.getLastColumn()).getValues()[0];
    if (name !== null) productsSh.getRange(rowIdx, headers.indexOf('product_name') + 1).setValue(name);
    if (unit !== null) productsSh.getRange(rowIdx, headers.indexOf('unit') + 1).setValue(unit);
    if (isActive !== null) productsSh.getRange(rowIdx, headers.indexOf('is_active') + 1).setValue(isActive);

    if (name !== null) {
      const stockRowIdx = findRowByIdCol_(stockSh, 'product_id', productId);
      if (stockRowIdx > 0) {
        const sH = stockSh.getRange(1, 1, 1, stockSh.getLastColumn()).getValues()[0];
        stockSh.getRange(stockRowIdx, sH.indexOf('product_name') + 1).setValue(name);
      }
    }

    logInfo('handleUpdateProduct', 'updated', { productId: productId, name: name, unit: unit, isActive: isActive });
    logOwnerAction_(lineUserId, 'updateProduct', productId, '', { name: name, unit: unit, isActive: isActive });
    return { ok: true, productId: productId };
  } catch (err) {
    logError('handleUpdateProduct', err.message, { productId: productId });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/** update Staff.role โดย LINE userId (ถ้ามี row นั้น) */
function _setStaffRole_(targetId, role) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Staff');
  const last = sh.getLastRow();
  if (last < 2) return;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const luidIdx = headers.indexOf('line_user_id');
  const roleIdx = headers.indexOf('role');
  if (luidIdx < 0 || roleIdx < 0) return;
  const data = sh.getRange(2, luidIdx + 1, last - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === String(targetId)) {
      sh.getRange(i + 2, roleIdx + 1).setValue(role);
      return;
    }
  }
}
