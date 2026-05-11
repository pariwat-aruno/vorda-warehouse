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

    return {
      ok: true,
      stock: _readStock_(ss),
      pending_returns: _readSheetFiltered_(ss, 'Returns', 'status', 'pending_owner'),
      pending_cancels: _readSheetFiltered_(ss, 'Cancellations', 'status', 'pending_owner'),
      pending_count_variance: _readSheetFiltered_(ss, 'Counts', 'status', 'awaiting_owner'),
      open_claims: _readSheetFilteredNotEqual_(ss, 'Claims', 'stage', 'closed'),
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
    return { ok: true, targetLineUserId: targetId, name: name };
  } catch (err) {
    logError('handleSetStaffName', err.message, { targetId: targetId });
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
