/**
 * Utils.gs — helper พื้นฐาน
 *
 * - nowBangkok / todayBangkok / formatThaiDateTime: datetime helpers
 * - nextMovementId / nextReturnId / nextCancelId / nextCountId / nextClaimId: gen running ID
 * - padLeft_: zero-pad
 * - dedupRecentSubmission_: กัน duplicate submit ใน 5 วินาที (idempotent)
 * - findStaffByLineUserId: lookup จาก sheet Staff
 */

/** ปัจจุบันใน Asia/Bangkok ISO 8601 — '2026-05-09T15:30:45+07:00' */
function nowBangkok() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** วันที่ปัจจุบันใน Asia/Bangkok format yyyy-MM-dd */
function todayBangkok() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

/** เดือนปัจจุบัน format yyyy-MM */
function thisMonthBangkok() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
}

/** สัปดาห์ปัจจุบัน format yyyy-Www (ISO week) */
function thisWeekBangkok() {
  // ใช้ ISO week — Monday = day 1
  const d = new Date();
  const tzString = Utilities.formatDate(d, 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss");
  const local = new Date(tzString);
  const day = (local.getDay() + 6) % 7; // Mon=0 ... Sun=6
  local.setDate(local.getDate() - day + 3); // Thursday in this week
  const yyyy = local.getFullYear();
  const jan4 = new Date(yyyy, 0, 4);
  const week = 1 + Math.round(((local - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return yyyy + '-W' + padLeft_(week, 2);
}

/**
 * gen movement_id ถัดไป — `MOV-YYYYMMDD-XXXX`
 * รับ type (inbound/outbound/adjust) + วันที่ปัจจุบัน → รวบใน Movements sheet
 */
function nextMovementId() {
  return _genIdWithPrefix_('MOV', 'Movements', 'movement_id');
}

function nextReturnId() {
  return _genIdWithPrefix_('RET', 'Returns', 'return_id');
}

function nextCancelId() {
  return _genIdWithPrefix_('CXL', 'Cancellations', 'cancel_id');
}

function nextCountId() {
  return _genIdWithPrefix_('CNT', 'Counts', 'count_id');
}

function nextClaimId() {
  return _genIdWithPrefix_('CLM', 'Claims', 'claim_id');
}

/**
 * Generic gen — `<PREFIX>-YYYYMMDD-XXXX`
 * scan sheet, นับ ID ที่ขึ้นต้นด้วย prefix-YYYYMMDD- ของวันนี้, +1
 */
function _genIdWithPrefix_(prefix, sheetName, idColName) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('sheet ' + sheetName + ' not found');

  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd');
  const datedPrefix = prefix + '-' + today + '-';

  // หา column index ของ idColName
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idCol = headers.indexOf(idColName);
  if (idCol < 0) throw new Error('column ' + idColName + ' not in sheet ' + sheetName);

  const last = sh.getLastRow();
  let max = 0;
  if (last >= 2) {
    const ids = sh.getRange(2, idCol + 1, last - 1, 1).getValues();
    ids.forEach(function (row) {
      const id = String(row[0] || '');
      if (id.indexOf(datedPrefix) === 0) {
        const n = parseInt(id.substring(datedPrefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
  }
  return datedPrefix + padLeft_(max + 1, 4);
}

/** zero-pad number → string ความยาว width */
function padLeft_(n, width) {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

/**
 * format datetime ไทย — '9 พ.ค. 2026 15:30 น.'
 * input: Date | ISO 8601 string
 */
function formatThaiDateTime(d) {
  const date = (d instanceof Date) ? d : new Date(d);
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const tzString = Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm');
  // 'yyyy-MM-dd HH:mm' → parse
  const parts = tzString.split(' ');
  const ymd = parts[0].split('-');
  const yyyy = parseInt(ymd[0], 10);
  const mm = parseInt(ymd[1], 10);
  const dd = parseInt(ymd[2], 10);
  const beYear = yyyy + 543;
  return dd + ' ' + months[mm - 1] + ' ' + beYear + ' ' + parts[1] + ' น.';
}

/**
 * auto-register staff ถ้ายังไม่มีใน Sheet `Staff` — return record (มีอยู่แล้วก็คืนตัวเดิม)
 *
 * gen staff_id ถัดไป (S-001, S-002, ...) — role auto จาก isOwner/isSupervisor
 */
function autoRegisterStaff_(lineUserId, displayName) {
  if (!lineUserId) return null;
  const existing = findStaffByLineUserId(lineUserId);
  if (existing) return existing;

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Staff');
  if (!sh) throw new Error('sheet Staff not found');

  const last = sh.getLastRow();
  let maxNum = 0;
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      const id = String(r[0] || '');
      const m = id.match(/^S-(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
  }
  const newId = 'S-' + padLeft_(maxNum + 1, 3);
  // isOwner/isSupervisor มี try-catch — ถ้า config ยังว่าง return false → role='staff'
  const role = isOwner(lineUserId) ? 'owner' : (isSupervisor(lineUserId) ? 'supervisor' : 'staff');
  const name = displayName || 'unknown';
  const now = nowBangkok();
  sh.appendRow([newId, name, role, lineUserId, true, now]);

  return { staff_id: newId, name: name, role: role, line_user_id: lineUserId, is_active: true, registered_at: now };
}

/**
 * lookup staff (พนักงาน + หัวหน้า + owner) จาก line_user_id
 * return: { staff_id, name, role, line_user_id, is_active } | null
 */
function findStaffByLineUserId(lineUserId) {
  if (!lineUserId) return null;
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Staff');
  if (!sh) throw new Error('sheet Staff not found');

  const last = sh.getLastRow();
  if (last < 2) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();

  const luidIdx = headers.indexOf('line_user_id');
  if (luidIdx < 0) throw new Error('column line_user_id not in sheet Staff');

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][luidIdx]) === String(lineUserId)) {
      const row = {};
      headers.forEach(function (h, j) { row[h] = data[i][j]; });
      return row;
    }
  }
  return null;
}

/**
 * dedup helper — ใช้ PropertiesService key + TTL
 * ถ้า submit ซ้ำใน 5 วินาที → return false (ไม่ต้องประมวลผล)
 *
 * key = action + lineUserId + body hash
 */
function dedupRecentSubmission_(actionKey, ttlSeconds) {
  ttlSeconds = ttlSeconds || 5;
  const cache = CacheService.getScriptCache();
  if (cache.get(actionKey)) return false; // เพิ่ง submit ไป
  cache.put(actionKey, '1', ttlSeconds);
  return true;
}
