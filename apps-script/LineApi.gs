/**
 * LineApi.gs — wrapper เรียก LINE Messaging API (TASK-12)
 *
 * - pushMessage(userId, messages[])
 * - replyMessage(replyToken, messages[])
 * - retry 3 ครั้ง exponential backoff (1s, 2s, 4s)
 * - log error ลง sheet Logs ทุกครั้ง
 *
 * messages[] = array ของ message object ตาม LINE spec
 *   text:  { type: 'text', text: '...' }
 *   flex:  { type: 'flex', altText: '...', contents: {...} }
 */

const LINE_API_BASE = 'https://api.line.me/v2/bot';
const LINE_RETRY_MAX = 3;
const LINE_RETRY_BASE_MS = 1000;

/** Push API — ใช้ตอนส่ง flex card หาเจ้าของ หรือ welcome หาพาร์ทไทม์ */
function pushMessage(userId, messages) {
  return callLineApi_('push', { to: userId, messages: arrify_(messages) });
}

/** Reply API — ใช้ใน webhook handler (ใช้ replyToken) */
function replyMessage(replyToken, messages) {
  return callLineApi_('reply', { replyToken: replyToken, messages: arrify_(messages) });
}

/** shortcut: push text ตัวเดียว */
function pushText(userId, text) {
  return pushMessage(userId, [{ type: 'text', text: text }]);
}

/** shortcut: reply text ตัวเดียว */
function replyText(replyToken, text) {
  return replyMessage(replyToken, [{ type: 'text', text: text }]);
}

function arrify_(x) {
  return Array.isArray(x) ? x : [x];
}

/** core: yield retry + log */
function callLineApi_(kind, body) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) {
    logError('LineApi.' + kind, 'LINE_CHANNEL_ACCESS_TOKEN not set');
    return { ok: false, error: 'no_token' };
  }
  const url = LINE_API_BASE + '/message/' + kind;
  const opts = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= LINE_RETRY_MAX; attempt++) {
    try {
      const res = UrlFetchApp.fetch(url, opts);
      const code = res.getResponseCode();
      if (code === 200) {
        return { ok: true };
      }
      lastErr = 'HTTP ' + code + ' ' + res.getContentText();
      // 4xx (ยกเว้น 429) ไม่ retry — error จาก client เอง
      if (code >= 400 && code < 500 && code !== 429) {
        logError('LineApi.' + kind, lastErr, body);
        return { ok: false, error: lastErr };
      }
    } catch (err) {
      lastErr = err && err.message ? err.message : String(err);
    }

    if (attempt < LINE_RETRY_MAX) {
      Utilities.sleep(LINE_RETRY_BASE_MS * Math.pow(2, attempt - 1));
    }
  }

  logError('LineApi.' + kind, 'failed after ' + LINE_RETRY_MAX + ' retries: ' + lastErr, body);
  return { ok: false, error: lastErr };
}
