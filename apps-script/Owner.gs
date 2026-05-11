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
