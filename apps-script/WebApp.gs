/**
 * WebApp.gs — entry points สำหรับ Apps Script Web App
 *
 *   - doGet(e)  = LIFF ping / health check
 *   - doPost(e) = ทุก action จาก LIFF + LINE webhook
 *
 * action JSON shape:
 *   { action: 'submitInbound', payload: { ... } }
 *   หรือ
 *   LINE webhook body (มี events array)
 *
 * แต่ละ action handler อยู่ในไฟล์แยก (Inbound.gs, Outbound.gs, ฯลฯ) — ที่นี่แค่ route
 *
 * **CORS workaround:** LIFF POST ใช้ Content-Type 'text/plain;charset=utf-8'
 * (Apps Script ไม่รับ application/json จาก browser)
 */

/** GET → health check */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    service: 'vorda-warehouse',
    now: nowBangkok(),
  })).setMimeType(ContentService.MimeType.JSON);
}

/** POST entry — route by body */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents || '{}');
  } catch (err) {
    logError('doPost', 'invalid JSON: ' + err.message);
    return _jsonResponse_({ ok: false, error: 'invalid_json' });
  }

  // 1. LINE webhook (มี events array)
  if (body && Array.isArray(body.events)) {
    return _handleLineWebhook_(body);
  }

  // 2. LIFF action
  if (body && body.action) {
    return _handleLiffAction_(body);
  }

  return _jsonResponse_({ ok: false, error: 'unknown_request' });
}

// =====================================================================
// LIFF ROUTER
// =====================================================================

function _handleLiffAction_(body) {
  const action = body.action;
  const payload = body.payload || {};

  try {
    let result;
    switch (action) {

      // STAFF flows (6 หน้า)
      case 'submitInbound':
        result = handleSubmitInbound(payload); break;
      case 'submitOutbound':
        result = handleSubmitOutbound(payload); break;
      case 'submitCount':
        result = handleSubmitCount(payload); break;
      case 'submitAdjust':
        result = handleSubmitAdjust(payload); break;
      case 'submitReturn':
        result = handleSubmitReturn(payload); break;
      case 'submitCancel':
        result = handleSubmitCancel(payload); break;

      // STAFF: ยกเลิกใน 5 นาที
      case 'cancelSubmission':
        result = handleCancelSubmission(payload); break;

      // STAFF: lookup รายชื่อสินค้า + ยอดล่าสุด (ใช้ใน dropdown ฟอร์ม)
      case 'getProducts':
        result = handleGetProducts(payload); break;

      // SUPERVISOR: ตัดสิน double-blind ที่นับไม่ตรง
      case 'submitSupervisorTiebreaker':
        result = handleSupervisorTiebreaker(payload); break;

      // OWNER ONLY (isOwner check ใน handler)
      case 'getOwnerDashboard':
        result = handleOwnerDashboard(payload); break;
      case 'approveReturn':
        result = handleApproveReturn(payload); break;
      case 'approveCancel':
        result = handleApproveCancel(payload); break;
      case 'rejectReturn':
        result = handleRejectReturn(payload); break;
      case 'updateClaimStage':
        result = handleUpdateClaimStage(payload); break;
      case 'adjustStock':
        result = handleAdjustStock(payload); break; // หลัง count variance — owner กดปรับยอด

      // OWNER report
      case 'getDailyReport':
        result = handleGetDailyReport(payload); break;
      case 'getWeeklyReport':
        result = handleGetWeeklyReport(payload); break;

      default:
        result = { ok: false, error: 'unknown_action', action: action };
    }
    return _jsonResponse_(result);
  } catch (err) {
    logError('handleLiffAction', err.message, { action: action, stack: err.stack });
    return _jsonResponse_({ ok: false, error: 'server_error', message: err.message });
  }
}

// =====================================================================
// LINE WEBHOOK ROUTER
// =====================================================================

function _handleLineWebhook_(body) {
  body.events.forEach(function (event) {
    try {
      _routeLineEvent_(event);
    } catch (err) {
      logError('_handleLineWebhook_', err.message, { event: event });
    }
  });
  return _jsonResponse_({ ok: true });
}

function _routeLineEvent_(event) {
  if (event.type === 'message') {
    return _handleMessageEvent_(event);
  }
  if (event.type === 'postback') {
    return _handlePostbackEvent_(event);
  }
  if (event.type === 'follow') {
    return _handleFollowEvent_(event);
  }
  // อื่นๆ ไม่สนใจ
}

/** ผู้ใช้พิมพ์ข้อความหา bot */
function _handleMessageEvent_(event) {
  const text = (event.message && event.message.text || '').trim();
  const userId = event.source && event.source.userId;
  const replyToken = event.replyToken;

  // คำสั่ง owner
  if (isOwner(userId)) {
    if (text === 'รายงานวันนี้' || text === 'daily') {
      const result = handleGetDailyReport({ lineUserId: userId });
      replyText(replyToken, JSON.stringify(result, null, 2));
      return;
    }
    if (text === 'รายงานสัปดาห์' || text === 'weekly') {
      const result = handleGetWeeklyReport({ lineUserId: userId });
      replyText(replyToken, JSON.stringify(result, null, 2));
      return;
    }
  }

  // default: ไม่ตอบ (กัน spam)
}

/** กดปุ่มใน flex card (postback) */
function _handlePostbackEvent_(event) {
  const data = event.postback && event.postback.data;
  // implement ตาม flex card postback ที่กำหนดใน FlexCard.gs
  // เช่น: action=approve_return&return_id=RET-...
  logInfo('_handlePostbackEvent_', 'postback received', { data: data });
}

/** ผู้ใช้ add bot เป็นเพื่อนครั้งแรก */
function _handleFollowEvent_(event) {
  const userId = event.source && event.source.userId;
  const replyToken = event.replyToken;
  replyText(replyToken,
    'ยินดีต้อนรับสู่ระบบคลัง Vorda\n' +
    'หากเป็นเจ้าของหรือหัวหน้า กรุณาส่ง LINE userId นี้ให้ admin เพื่อเพิ่มสิทธิ์'
  );
  logInfo('_handleFollowEvent_', 'new follower', { userId: userId });
}

// =====================================================================
// HELPERS
// =====================================================================

function _jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
