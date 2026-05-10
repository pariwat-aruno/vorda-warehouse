/**
 * Logger.gs — เขียน log ลง sheet `Logs` (TASK-10)
 *
 * usage:
 *   logInfo('inbound', 'movement created', { movementId: 'MOV-20260509-0001' });
 *   logError('outbound', 'qty insufficient', { qtyOnHand: 50, requested: 80 });
 *
 * timestamp: Asia/Bangkok ISO 8601
 */

function logInfo(fnName, message, payload) {
  return appendLog_('info', fnName, message, payload);
}

function logWarn(fnName, message, payload) {
  return appendLog_('warn', fnName, message, payload);
}

function logError(fnName, message, payload) {
  console.error('[' + fnName + '] ' + message, payload);
  return appendLog_('error', fnName, message, payload);
}

function appendLog_(level, fnName, message, payload) {
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!sheetId) {
      console.error('SHEET_ID not set — cannot log');
      return;
    }
    const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Logs');
    if (!sh) {
      console.error('sheet Logs not found');
      return;
    }
    sh.appendRow([
      nowBangkok(),
      level,
      String(fnName || ''),
      String(message || ''),
      payload == null ? '' : (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    ]);
  } catch (err) {
    // log ไม่ได้ก็ห้าม throw — ไม่งั้นวน
    console.error('appendLog_ failed:', err && err.message ? err.message : err);
  }
}
