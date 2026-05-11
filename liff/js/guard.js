/**
 * guard.js — ใช้ก่อนทำอะไรใน LIFF page ทุกหน้า
 *
 * ลำดับ:
 *   1. initAuth (LIFF init + getProfile)
 *   2. call api.getMyStatus → ถ้า !registered → redirect ไป register.html?returnTo=<current>
 *   3. return state ให้ page ใช้ต่อ
 *
 * usage:
 *   import { ensureRegistered } from './js/guard.js';
 *   await ensureRegistered(CONFIG.LIFF_ID_INBOUND);
 *   // หลังจากนี้ state.profile + state.myStatus พร้อมใช้
 */

import { CONFIG } from './config.js';
import { initAuth, state } from './auth.js';
import { api } from './api.js';

/** แสดง modal ของ LINE userId + ปุ่ม copy (ไม่ navigate ออกจาก LIFF) */
export function showMyIdModal() {
  if (!state.lineUserId) {
    alert('ยังไม่ได้ login LIFF');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'id-modal-overlay';
  overlay.innerHTML =
    '<div class="id-modal">' +
    '  <h3>LINE User ID ของคุณ</h3>' +
    '  <div class="muted" style="font-size:12px">ชื่อโปรไฟล์: <strong>' + (state.profile && state.profile.displayName || '-') + '</strong></div>' +
    '  <div class="id-box" id="_idbox">' + state.lineUserId + '</div>' +
    '  <button class="btn-primary" id="_copybtn" type="button">คัดลอก ID</button>' +
    '  <button class="btn-secondary" id="_closebtn" type="button" style="margin-top:6px">ปิด</button>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('_closebtn').onclick = () => overlay.remove();
  document.getElementById('_copybtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(state.lineUserId);
      document.getElementById('_copybtn').textContent = 'คัดลอกแล้ว';
    } catch (e) {
      const range = document.createRange();
      range.selectNode(document.getElementById('_idbox'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      document.getElementById('_copybtn').textContent = 'กดค้างที่ ID เพื่อคัดลอก';
    }
  };
}

// expose ให้ inline onclick ใช้ได้
if (typeof window !== 'undefined') {
  window.__showMyId = showMyIdModal;
}

/**
 * @param {string} liffId — LIFF ID ของหน้านี้
 * @param {object} [opts]
 *   - skipRedirectIfPath: array of path substrings — ถ้า location.href มีอันใดอันหนึ่ง จะไม่ redirect
 *     (เช่น ['register.html', 'myid.html'])
 * @return {Promise<void>}
 */
export async function ensureRegistered(liffId, opts) {
  opts = opts || {};
  const skipPaths = opts.skipRedirectIfPath || ['register.html', 'myid.html'];

  await initAuth(liffId);

  // dev mock — ข้าม registration check
  if (CONFIG.DEV_MOCK_LIFF) {
    state.myStatus = { registered: true, name: '(dev)', role: 'staff', is_owner: false, is_supervisor: false };
    return;
  }

  try {
    const st = await api.post('getMyStatus', { lineUserId: state.lineUserId });
    state.myStatus = st;
    if (!st.registered) {
      // skip ถ้าเราอยู่ใน register.html หรือ myid.html อยู่แล้ว
      const here = location.pathname;
      if (skipPaths.some(p => here.endsWith(p))) return;

      // redirect → register.html?returnTo=<current page>
      const returnTo = location.pathname.split('/').pop() + location.search;
      location.replace('./register.html?returnTo=' + encodeURIComponent(returnTo));
      // throw to halt callers (location.replace ไม่หยุด JS ทันที)
      throw new Error('redirecting to register');
    }
  } catch (err) {
    if (err.message === 'redirecting to register') throw err;
    // ถ้า getMyStatus ล้ม → ไม่ block (ปล่อยผ่าน — ดีกว่า lockout)
    console.warn('getMyStatus failed:', err);
    state.myStatus = null;
  }
}
