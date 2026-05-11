/**
 * Submission.gs — common helpers สำหรับทุก flow
 *
 *   - cancelSubmission: ยกเลิก row ที่เพิ่ง submit ใน 5 นาที (กันพิมพ์ผิด)
 *     - ใช้ได้กับ Movements / Counts / Returns / Cancellations
 *     - เงื่อนไข: status ต้อง pending_partner หรือ pending_supervisor หรือ pending_owner
 *                + เป็น lineUserId คนกรอกเอง
 *                + อยู่ใน window (ดู Config.cancel_window_seconds, default 300)
 *
 *   - getProducts: คืนรายชื่อ + ยอดล่าสุด ให้ LIFF dropdown
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

/**
 * ยกเลิก submission ที่เพิ่งกรอก ภายใน 5 นาที (กันพิมพ์ผิด)
 *
 * payload: { lineUserId, recordType: 'movement'|'count'|'return'|'cancel', recordId, reason }
 *
 * เงื่อนไข:
 *   - row นี้มีจริง
 *   - lineUserId เป็น submitter ตัวเอง (movement/count: submitter1 หรือ submitter2; return/cancel: staff)
 *   - status ยัง pending_* (ยังไม่ถูก confirm/accept/reject/cancel แล้ว)
 *   - อยู่ใน window cancel_window_seconds (default 300 = 5 นาที) นับจากเวลา submit ของคนนั้น
 *
 * effect: status='cancelled', cancel_at=now, cancel_reason=reason
 *
 * error codes:
 *   - missing_params, unknown_record_type, duplicate_request
 *   - not_found, not_pending, not_owner_of_submission
 *   - cancel_window_expired, invalid_submit_time, server_error
 */
function handleCancelSubmission(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const recordType = payload.recordType;
  const recordId = payload.recordId;
  const reason = String(payload.reason || '');

  if (!lineUserId || !recordType || !recordId) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'recordType', 'recordId'] };
  }

  // dedup กัน double-tap (5 วินาที)
  if (!dedupRecentSubmission_('cancelSubmission:' + lineUserId + ':' + recordId, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  // map recordType → schema config
  const SCHEMA = {
    'movement': {
      sheet: 'Movements',
      idCol: 'movement_id',
      submitters: [
        { idCol: 'submitter1_user_id', atCol: 'submitter1_at' },
        { idCol: 'submitter2_user_id', atCol: 'submitter2_at' },
      ],
    },
    'count': {
      sheet: 'Counts',
      idCol: 'count_id',
      submitters: [
        { idCol: 'submitter1_user_id', atCol: 'submitter1_at' },
        { idCol: 'submitter2_user_id', atCol: 'submitter2_at' },
      ],
    },
    'return': {
      sheet: 'Returns',
      idCol: 'return_id',
      submitters: [{ idCol: 'staff_user_id', atCol: 'staff_at' }],
    },
    'cancel': {
      sheet: 'Cancellations',
      idCol: 'cancel_id',
      submitters: [{ idCol: 'staff_user_id', atCol: 'staff_at' }],
    },
  };

  const conf = SCHEMA[recordType];
  if (!conf) return { ok: false, error: 'unknown_record_type', recordType: recordType };

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const sh = ss.getSheetByName(conf.sheet);
    if (!sh) throw new Error('sheet ' + conf.sheet + ' not found');

    const last = sh.getLastRow();
    if (last < 2) return { ok: false, error: 'not_found', recordId: recordId };

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const idIdx = headers.indexOf(conf.idCol);
    const statusIdx = headers.indexOf('status');
    const cancelAtIdx = headers.indexOf('cancel_at');
    const cancelReasonIdx = headers.indexOf('cancel_reason');
    if (idIdx < 0 || statusIdx < 0 || cancelAtIdx < 0 || cancelReasonIdx < 0) {
      throw new Error('required column missing in ' + conf.sheet);
    }

    // หา row โดย scan column ที่เป็น id (เร็วกว่า getDataRange ทั้งชีต)
    const idValues = sh.getRange(2, idIdx + 1, last - 1, 1).getValues();
    let rowIdx = -1;
    for (let i = 0; i < idValues.length; i++) {
      if (String(idValues[i][0]) === String(recordId)) {
        rowIdx = i + 2;
        break;
      }
    }
    if (rowIdx < 0) return { ok: false, error: 'not_found', recordId: recordId };

    // อ่าน row เต็มแถวเดียวพอ
    const row = sh.getRange(rowIdx, 1, 1, sh.getLastColumn()).getValues()[0];

    const status = String(row[statusIdx] || '');
    if (status.indexOf('pending_') !== 0) {
      return { ok: false, error: 'not_pending', currentStatus: status };
    }

    // หา submitter ที่ตรงกับ lineUserId + เอาเวลา submit ของคนนั้น
    let matchedSubmitter = null;
    let matchedAt = null;
    for (let i = 0; i < conf.submitters.length; i++) {
      const s = conf.submitters[i];
      const sIdx = headers.indexOf(s.idCol);
      const atIdx = headers.indexOf(s.atCol);
      if (sIdx < 0 || atIdx < 0) continue;
      if (String(row[sIdx]) === String(lineUserId)) {
        matchedSubmitter = s.idCol;
        matchedAt = row[atIdx];
        break;
      }
    }
    if (!matchedSubmitter) {
      return { ok: false, error: 'not_owner_of_submission' };
    }

    // เช็ค window
    const cfg = getConfig();
    const windowSec = Number(cfg.cancel_window_seconds) || 300;

    const submitTime = (matchedAt instanceof Date)
      ? matchedAt.getTime()
      : new Date(String(matchedAt)).getTime();
    if (!submitTime || isNaN(submitTime)) {
      return { ok: false, error: 'invalid_submit_time', value: String(matchedAt) };
    }
    const elapsedSec = Math.round((Date.now() - submitTime) / 1000);
    if (elapsedSec > windowSec) {
      return {
        ok: false,
        error: 'cancel_window_expired',
        elapsed_sec: elapsedSec,
        window_sec: windowSec,
      };
    }

    // update row
    sh.getRange(rowIdx, statusIdx + 1).setValue('cancelled');
    sh.getRange(rowIdx, cancelAtIdx + 1).setValue(nowBangkok());
    sh.getRange(rowIdx, cancelReasonIdx + 1).setValue(reason);

    logInfo('handleCancelSubmission', 'cancelled', {
      recordType: recordType,
      recordId: recordId,
      lineUserId: lineUserId,
      submitter: matchedSubmitter,
      reason: reason,
      elapsed_sec: elapsedSec,
    });

    return {
      ok: true,
      recordType: recordType,
      recordId: recordId,
      status: 'cancelled',
      elapsed_sec: elapsedSec,
    };
  } catch (err) {
    logError('handleCancelSubmission', err.message, { recordType: recordType, recordId: recordId });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

function handleGetProducts(payload) {
  // payload: { lineUserId }
  // return: { ok: true, products: [{ product_id, product_name, qty_on_hand, unit }, ...] }
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const stockSh = ss.getSheetByName('Stock');
    const productsSh = ss.getSheetByName('Products');

    const stockData = stockSh.getDataRange().getValues();
    const stockHeaders = stockData[0];
    const stockMap = {};
    for (let i = 1; i < stockData.length; i++) {
      const row = {};
      stockHeaders.forEach(function (h, j) { row[h] = stockData[i][j]; });
      if (row.product_id) stockMap[row.product_id] = row;
    }

    const productsData = productsSh.getDataRange().getValues();
    const productsHeaders = productsData[0];
    const products = [];
    for (let i = 1; i < productsData.length; i++) {
      const row = {};
      productsHeaders.forEach(function (h, j) { row[h] = productsData[i][j]; });
      if (!row.product_id || row.is_active === false) continue;
      const stock = stockMap[row.product_id] || {};
      products.push({
        product_id: row.product_id,
        product_name: row.product_name,
        unit: row.unit || 'ชิ้น',
        qty_on_hand: Number(stock.qty_on_hand || 0),
      });
    }

    return { ok: true, products: products };
  } catch (err) {
    logError('handleGetProducts', err.message);
    return { ok: false, error: 'server_error', message: err.message };
  }
}
