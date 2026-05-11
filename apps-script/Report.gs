/**
 * Report.gs — รายงานรายวัน + รายสัปดาห์
 *
 * Schedule (ใส่ trigger ผ่าน installTriggers()):
 *   - ทุกวัน 18:00 → sendDailyReport() → push LINE หัวหน้า
 *   - ทุกวันเสาร์ 18:10 → sendWeeklyReport() → push LINE owner
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4 + 7
 */

/** Owner ขอรายงานรายวัน (manual)
 *
 * payload: { lineUserId, date? }   // date = 'yyyy-MM-dd', default = วันนี้
 *
 * return: { ok, date, by_type: {...}, by_product: [...], pending: {...} }
 */
function handleGetDailyReport(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const date = payload.date || todayBangkok();

  if (!lineUserId) return { ok: false, error: 'missing_params', need: ['lineUserId'] };
  // ให้ owner หรือ supervisor ดูได้ทั้งคู่ (รายงานนี้ใช้ภายใน)
  if (!isOwner(lineUserId) && !isSupervisor(lineUserId)) {
    return { ok: false, error: 'not_authorized' };
  }

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);

    const report = _aggregateMovements_(ss, function (createdAt) {
      return _datePartBangkok_(createdAt) === date;
    });

    const pending = _pendingCounts_(ss);

    return Object.assign({ ok: true, date: date }, report, { pending: pending });
  } catch (err) {
    logError('handleGetDailyReport', err.message, { date: date });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/** Owner ขอรายงานรายสัปดาห์
 *
 * payload: { lineUserId, week? }   // week = ISO 'yyyy-Www', default = สัปดาห์นี้
 */
function handleGetWeeklyReport(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const targetWeek = payload.week || thisWeekBangkok();

  if (!lineUserId) return { ok: false, error: 'missing_params', need: ['lineUserId'] };
  if (!isOwner(lineUserId) && !isSupervisor(lineUserId)) {
    return { ok: false, error: 'not_authorized' };
  }

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);

    // movements
    const movement = _aggregateMovements_(ss, function (createdAt) {
      return _weekPartBangkok_(createdAt) === targetWeek;
    });

    // counts ของสัปดาห์
    const counts = _aggregateCounts_(ss, function (createdAt) {
      return _weekPartBangkok_(createdAt) === targetWeek;
    });

    // returns / claims / cancels ของสัปดาห์
    const returns = _aggregateReturnsCancels_(ss, 'Returns', 'created_at', 'status', targetWeek);
    const cancels = _aggregateReturnsCancels_(ss, 'Cancellations', 'created_at', 'status', targetWeek);
    const claims = _aggregateClaims_(ss, targetWeek);

    return Object.assign(
      { ok: true, week: targetWeek },
      movement,
      { counts: counts, returns: returns, cancels: cancels, claims: claims }
    );
  } catch (err) {
    logError('handleGetWeeklyReport', err.message, { week: targetWeek });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

// =====================================================================
// AGGREGATION HELPERS
// =====================================================================

/** สรุป Movements ที่ status=confirmed ตาม filterFn (ตัวคัด confirmed_at หรือ created_at) */
function _aggregateMovements_(ss, dateFilterFn) {
  const movSh = ss.getSheetByName('Movements');
  const last = movSh.getLastRow();
  const byType = { inbound: 0, outbound: 0, adjust: 0, return_in: 0, cancel_in: 0 };
  const byProductMap = {}; // product_id → { product_name, delta }

  if (last >= 2) {
    const headers = movSh.getRange(1, 1, 1, movSh.getLastColumn()).getValues()[0];
    const data = movSh.getRange(2, 1, last - 1, headers.length).getValues();
    const typeIdx = headers.indexOf('movement_type');
    const qtyIdx = headers.indexOf('qty');
    const pidIdx = headers.indexOf('product_id');
    const pnameIdx = headers.indexOf('product_name');
    const statusIdx = headers.indexOf('status');
    const createdIdx = headers.indexOf('created_at');
    const confirmedIdx = headers.indexOf('confirmed_at');

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (String(row[statusIdx] || '') !== 'confirmed') continue;
      const when = row[confirmedIdx] || row[createdIdx];
      if (!dateFilterFn(when)) continue;
      const type = String(row[typeIdx] || '');
      const qty = Number(row[qtyIdx] || 0);
      // by_type: นับ "ของกระทบสต๊อกเท่าไหร่" — ใช้ |qty|
      if (byType.hasOwnProperty(type)) {
        byType[type] += Math.abs(qty);
      }
      // by_product: สะสม delta (qty รวมเครื่องหมาย)
      const pid = String(row[pidIdx] || '');
      if (!pid) continue;
      if (!byProductMap[pid]) {
        byProductMap[pid] = { product_id: pid, product_name: row[pnameIdx], delta: 0 };
      }
      byProductMap[pid].delta += qty;
    }
  }

  // join end_qty จาก Stock
  const stockSh = ss.getSheetByName('Stock');
  const stockLast = stockSh.getLastRow();
  const endQty = {};
  if (stockLast >= 2) {
    const sHeaders = stockSh.getRange(1, 1, 1, stockSh.getLastColumn()).getValues()[0];
    const sData = stockSh.getRange(2, 1, stockLast - 1, sHeaders.length).getValues();
    const pidIdx = sHeaders.indexOf('product_id');
    const qtyIdx = sHeaders.indexOf('qty_on_hand');
    sData.forEach(function (r) {
      const pid = String(r[pidIdx] || '');
      if (pid) endQty[pid] = Number(r[qtyIdx] || 0);
    });
  }

  const byProduct = Object.keys(byProductMap).map(function (pid) {
    return {
      product_id: pid,
      product_name: byProductMap[pid].product_name,
      delta: byProductMap[pid].delta,
      end_qty: endQty[pid] != null ? endQty[pid] : 0,
    };
  }).sort(function (a, b) {
    return Math.abs(b.delta) - Math.abs(a.delta);
  });

  return { by_type: byType, by_product: byProduct };
}

/** สรุป Counts ตามสถานะ */
function _aggregateCounts_(ss, dateFilterFn) {
  const sh = ss.getSheetByName('Counts');
  const last = sh.getLastRow();
  const out = { total: 0, no_action: 0, resolved_by_adjust: 0, awaiting_owner: 0, pending_supervisor: 0, pending_partner: 0, cancelled: 0 };
  if (last < 2) return out;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, headers.length).getValues();
  const statusIdx = headers.indexOf('status');
  const createdIdx = headers.indexOf('created_at');
  for (let i = 0; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (!dateFilterFn(data[i][createdIdx])) continue;
    out.total++;
    const status = String(data[i][statusIdx] || '');
    if (out.hasOwnProperty(status)) out[status]++;
  }
  return out;
}

/** สรุป Returns/Cancellations group by status */
function _aggregateReturnsCancels_(ss, sheetName, dateCol, statusCol, targetWeek) {
  const sh = ss.getSheetByName(sheetName);
  const last = sh.getLastRow();
  const out = { total: 0, pending_owner: 0, accepted: 0, rejected: 0, forwarded_to_claim: 0, cancelled: 0 };
  if (last < 2) return out;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, headers.length).getValues();
  const sIdx = headers.indexOf(statusCol);
  const dIdx = headers.indexOf(dateCol);
  for (let i = 0; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (_weekPartBangkok_(data[i][dIdx]) !== targetWeek) continue;
    out.total++;
    const status = String(data[i][sIdx] || '');
    if (out.hasOwnProperty(status)) out[status]++;
  }
  return out;
}

/** สรุป Claims group by stage + closed_result */
function _aggregateClaims_(ss, targetWeek) {
  const sh = ss.getSheetByName('Claims');
  const last = sh.getLastRow();
  const out = { total: 0, submitting: 0, submitted: 0, closed: 0, closed_success: 0, closed_fail: 0 };
  if (last < 2) return out;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, headers.length).getValues();
  const stageIdx = headers.indexOf('stage');
  const createdIdx = headers.indexOf('created_at');
  const resultIdx = headers.indexOf('closed_result');
  for (let i = 0; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (_weekPartBangkok_(data[i][createdIdx]) !== targetWeek) continue;
    out.total++;
    const stage = String(data[i][stageIdx] || '');
    if (out.hasOwnProperty(stage)) out[stage]++;
    if (stage === 'closed') {
      const result = String(data[i][resultIdx] || '');
      if (result === 'success') out.closed_success++;
      else if (result === 'fail') out.closed_fail++;
    }
  }
  return out;
}

function _pendingCounts_(ss) {
  return {
    returns: _countRows_(ss, 'Returns', 'status', 'pending_owner'),
    cancels: _countRows_(ss, 'Cancellations', 'status', 'pending_owner'),
    count_variance: _countRows_(ss, 'Counts', 'status', 'awaiting_owner'),
  };
}

function _countRows_(ss, sheetName, col, val) {
  const sh = ss.getSheetByName(sheetName);
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, headers.length).getValues();
  const cIdx = headers.indexOf(col);
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (String(data[i][cIdx] || '') === val) n++;
  }
  return n;
}

/** parse value → 'yyyy-MM-dd' ใน Asia/Bangkok */
function _datePartBangkok_(v) {
  if (!v) return '';
  let d;
  if (v instanceof Date) d = v;
  else d = new Date(String(v));
  if (!d || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
}

/** parse value → 'yyyy-Www' (ISO week) ใน Asia/Bangkok */
function _weekPartBangkok_(v) {
  if (!v) return '';
  let d;
  if (v instanceof Date) d = v;
  else d = new Date(String(v));
  if (!d || isNaN(d.getTime())) return '';
  // คำนวณ ISO week
  const tzString = Utilities.formatDate(d, 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss");
  const local = new Date(tzString);
  const day = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - day + 3);
  const yyyy = local.getFullYear();
  const jan4 = new Date(yyyy, 0, 4);
  const week = 1 + Math.round(((local - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return yyyy + '-W' + padLeft_(week, 2);
}

// =====================================================================
// Scheduled triggers
// =====================================================================

/** รัน 1 ครั้งเพื่อ install triggers ทั้ง 2 ตัว */
function installTriggers() {
  // ลบ trigger เก่าทุกตัวที่ชื่อเดียวกัน
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'sendDailyReport' || fn === 'sendWeeklyReport') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // ทุกวัน 18:00 (Bangkok)
  ScriptApp.newTrigger('sendDailyReport')
    .timeBased()
    .atHour(18)
    .everyDays(1)
    .inTimezone('Asia/Bangkok')
    .create();

  // เสาร์ 18:10 — ใช้ onWeekDay + atHour
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(18)
    .nearMinute(10)
    .inTimezone('Asia/Bangkok')
    .create();

  console.log('triggers installed: daily 18:00 + weekly Saturday 18:10');
}

/** เรียกโดย trigger 18:00 ทุกวัน */
function sendDailyReport() {
  // TODO: รวบยอดวันนี้ + push LINE หัวหน้า + owner
  logInfo('sendDailyReport', 'fired');
}

/** เรียกโดย trigger เสาร์ 18:10 */
function sendWeeklyReport() {
  // TODO: รวบยอดสัปดาห์ + push LINE owner
  logInfo('sendWeeklyReport', 'fired');
}
