/**
 * Report.gs — รายงานรายวัน + รายสัปดาห์
 *
 * Schedule (ใส่ trigger ผ่าน installTriggers()):
 *   - ทุกวัน 18:00 → sendDailyReport() → push LINE หัวหน้า
 *   - ทุกวันเสาร์ 18:10 → sendWeeklyReport() → push LINE owner
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4 + 7
 */

/** Owner ขอรายงานรายวัน (manual) */
function handleGetDailyReport(payload) {
  // payload: { lineUserId, date? }
  // return: { ok, date, inbound, outbound, adjust, returns, cancels, by_product: [...] }
  return { ok: false, error: 'not_implemented', action: 'getDailyReport' };
}

/** Owner ขอรายงานรายสัปดาห์ */
function handleGetWeeklyReport(payload) {
  // payload: { lineUserId, weekStart? }
  return { ok: false, error: 'not_implemented', action: 'getWeeklyReport' };
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
