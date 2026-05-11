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
