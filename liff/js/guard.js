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
 * @return {Promise<void>}
 *
 * ถ้า user ยังไม่ register → show overlay (รอจนกว่าจะลงทะเบียน) แทน redirect
 * (กัน LIFF 400 จากการ navigate ออกนอก endpoint ที่ register)
 */
export async function ensureRegistered(liffId) {
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
      // show overlay — block ไว้จน user ลงทะเบียน
      await showRegisterOverlay();
      // refresh status หลัง register
      try {
        const after = await api.post('getMyStatus', { lineUserId: state.lineUserId });
        state.myStatus = after;
      } catch (e) {}
    }
  } catch (err) {
    if (err && err.code === 'unknown_action') {
      // backend ยังไม่ deploy getMyStatus → ปล่อยผ่าน (เก่า flow)
      console.warn('getMyStatus action not deployed, skipping registration guard');
      state.myStatus = null;
      return;
    }
    // อื่นๆ — log + ปล่อยผ่าน (กัน lockout)
    console.warn('getMyStatus failed:', err);
    state.myStatus = null;
  }
}

/**
 * แสดง overlay register บนหน้าปัจจุบัน — return Promise resolved เมื่อ user save
 *
 * ทำเป็น overlay เพื่อกัน LIFF cross-page navigation 400
 */
function showRegisterOverlay() {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'id-modal-overlay';
    overlay.style.zIndex = '300';
    overlay.innerHTML =
      '<div class="id-modal" style="max-width: 420px">' +
      '  <h3>ลงทะเบียนก่อนใช้งาน</h3>' +
      '  <div class="muted" style="font-size:13px; margin-bottom:10px">' +
      '    สวัสดี <strong>' + esc((state.profile && state.profile.displayName) || '') + '</strong> — ใส่ชื่อที่จะใช้ในระบบคลัง' +
      '  </div>' +
      '  <div id="_regErr" class="error" style="display:none"></div>' +
      '  <div class="label" style="margin-top:8px">ชื่อในระบบ</div>' +
      '  <input id="_regName" type="text" placeholder="เช่น สมหญิง / Aiko" maxlength="60" value="' + esc((state.profile && state.profile.displayName) || '') + '" />' +
      '  <div class="label" style="margin-top:8px">ขอสิทธิ์ (optional)</div>' +
      '  <select id="_regRole">' +
      '    <option value="">พนักงาน (ใช้ได้ทันที)</option>' +
      '    <option value="supervisor">หัวหน้าคลัง (รอ approve)</option>' +
      '    <option value="owner">เจ้าของ (รอ approve)</option>' +
      '  </select>' +
      '  <button id="_regSubmit" class="btn-primary" type="button" style="margin-top:10px">ลงทะเบียน</button>' +
      '</div>';
    document.body.appendChild(overlay);

    const errEl = document.getElementById('_regErr');
    const nameEl = document.getElementById('_regName');
    const roleEl = document.getElementById('_regRole');
    const btnEl = document.getElementById('_regSubmit');

    btnEl.onclick = async () => {
      errEl.style.display = 'none';
      const name = nameEl.value.trim();
      const requestedRole = roleEl.value;
      if (!name || name.length < 2) {
        errEl.textContent = 'ชื่อต้องยาว ≥ 2 ตัวอักษร';
        errEl.style.display = 'block';
        return;
      }
      btnEl.disabled = true;
      btnEl.textContent = 'กำลังบันทึก...';
      try {
        await api.post('registerSelf', {
          lineUserId: state.lineUserId,
          name: name,
          requestedRole: requestedRole,
        });
        // อัปเดต profile แสดง name ใหม่
        state.profile = state.profile || {};
        state.profile.displayName = name;
        overlay.remove();
        resolve();
      } catch (err) {
        btnEl.disabled = false;
        btnEl.textContent = 'ลงทะเบียน';
        errEl.textContent = 'บันทึกไม่ได้: ' + (err.code || err.message) +
          (err.data && err.data.message ? ' — ' + err.data.message : '');
        errEl.style.display = 'block';
      }
    };
  });
}

function esc(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
