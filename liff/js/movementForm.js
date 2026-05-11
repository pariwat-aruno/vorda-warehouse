/**
 * movementForm.js — shared form logic สำหรับ flow double-blind:
 *   inbound / outbound / count / adjust
 *
 * รับ config object → wire ปุ่ม + form ที่ฝัง HTML แล้ว
 *
 * HTML skeleton ที่ต้องมีใน page (id ตามนี้):
 *   #error          — error banner (.error)
 *   #round-r1, #round-r2 — toggle buttons
 *   #r1-section, #r2-section
 *   #r2-pairing     — input pairingId รอบ 2
 *   #product-select — <select>
 *   #qty-input      — <input type=number>
 *   #reason-input?  — textarea (เฉพาะ flow ที่ hasReason)
 *   #camera-video   — <video>
 *   #photo-grid     — <div class="photo-grid"> มี 4 .photo-slot
 *   #photo-counter
 *   #capture-btn, #retake-btn
 *   #submit-btn
 *   #after-submit   — แสดงผลหลัง submit (hidden by default)
 *   #result-id-text — ที่แสดง movement_id หลังรอบ 1
 *   #copy-id-btn
 *   #undo-bar, #undo-text, #undo-btn
 *   #new-btn        — ปุ่ม "บันทึกรายการใหม่"
 */

import { CONFIG } from './config.js';
import { state } from './auth.js';
import { ensureRegistered } from './guard.js';
import { api } from './api.js';
import { startCamera, captureFromVideoWithStamp, stopCamera } from './camera.js';
import { showError, clearError } from './utils.js';

const PHOTO_LABELS = ['มุม 1', 'มุม 2', 'มุม 3', 'มุม 4'];

export async function initMovementForm(opts) {
  const cfg = Object.assign({
    liffId: '',
    pageTitle: '',
    action: '',
    pairingKey: 'pairingMovementId',
    resultIdKey: 'movementId',
    cancelRecordType: 'movement',
    idPrefix: 'MOV-',
    hasReason: false,
    allowZeroQty: false,
  }, opts);

  // fallback: หา id ก่อน — ถ้าไม่เจอ ลอง class (กรณี HTML cache เก่ายังไม่มี id)
  const $id = (id) => document.getElementById(id);
  const ui = {
    err: $id('error'),
    roundR1: $id('round-r1'),
    roundR2: $id('round-r2'),
    r1Sec: $id('r1-section'),
    r2Sec: $id('r2-section'),
    pairing: $id('r2-pairing'),
    productSel: $id('product-select'),
    qty: $id('qty-input'),
    reason: $id('reason-input'),
    camVid: $id('camera-video'),
    grid: $id('photo-grid') || document.querySelector('.photo-grid'),
    counter: $id('photo-counter'),
    captureBtn: $id('capture-btn'),
    retakeBtn: $id('retake-btn'),
    submitBtn: $id('submit-btn'),
    afterSubmit: $id('after-submit'),
    resultIdText: $id('result-id-text'),
    copyIdBtn: $id('copy-id-btn'),
    undoBar: $id('undo-bar'),
    undoText: $id('undo-text'),
    undoBtn: $id('undo-btn'),
    newBtn: $id('new-btn'),
  };

  // sanity check — ถ้า DOM ไม่ครบ แสดง error ชัดเจน (กัน confusion จาก cache)
  const missing = [];
  ['err','grid','captureBtn','submitBtn','productSel','qty','camVid'].forEach(k => {
    if (!ui[k]) missing.push(k);
  });
  if (missing.length > 0) {
    const msg = 'DOM ขาด element: ' + missing.join(', ') + ' — ปิด LIFF + เปิดใหม่ เพื่อล้าง cache';
    if (ui.err) { ui.err.textContent = msg; ui.err.style.display = 'block'; }
    else alert(msg);
    console.error('movementForm: missing DOM', missing);
    return;
  }

  const photos = []; // base64 array
  let round = 'r1';
  let cameraStream = null;
  let lastResult = null; // จาก response
  let undoTimer = null;
  let undoExpiresAt = 0;

  // ===== auth + registration guard =====
  try {
    await ensureRegistered(cfg.liffId);
  } catch (err) {
    if (String(err.message || '').indexOf('redirecting') === 0) return; // กำลัง redirect ไป register
    showError(ui.err, 'LIFF init ไม่สำเร็จ: ' + err.message);
    return;
  }
  // ใช้ชื่อจาก myStatus (ที่ user ใส่เอง) แทน LINE displayName
  if (state.myStatus && state.myStatus.name) {
    state.profile = state.profile || {};
    state.profile.displayName = state.myStatus.name;
  }

  // single-staff mode → ซ่อน round toggle (ไม่มีรอบ 2)
  const singleMode = !!(state.myStatus && state.myStatus.settings && state.myStatus.settings.single_staff_mode);
  if (singleMode) {
    // ซ่อน toggle + section รอบ 2
    const toggle = ui.roundR1 && ui.roundR1.parentNode;
    if (toggle && toggle.classList && toggle.classList.contains('round-toggle')) {
      toggle.style.display = 'none';
    }
    if (ui.r2Sec) ui.r2Sec.style.display = 'none';
    // เปลี่ยนข้อความ warning ใน r1 section
    if (ui.r1Sec) {
      ui.r1Sec.innerHTML =
        '<div class="warning-block">' +
        '<strong>โหมด staff คนเดียว:</strong> นับเอง บันทึก → เจ้าของ approve' +
        '</div>';
    }
  }

  // ===== products =====
  try {
    const res = await api.post('getProducts', { lineUserId: state.lineUserId });
    ui.productSel.innerHTML = '<option value="">— เลือกสินค้า —</option>';
    (res.products || []).forEach(function (p) {
      const opt = document.createElement('option');
      opt.value = p.product_id;
      opt.textContent = p.product_name + ' (คงเหลือ ' + p.qty_on_hand + ' ' + (p.unit || 'ชิ้น') + ')';
      ui.productSel.appendChild(opt);
    });
  } catch (err) {
    showError(ui.err, 'โหลดสินค้าไม่ได้: ' + (err.code || err.message));
  }

  // ===== round toggle =====
  ui.roundR1.addEventListener('click', function () { setRound('r1'); });
  ui.roundR2.addEventListener('click', function () { setRound('r2'); });
  function setRound(r) {
    round = r;
    ui.roundR1.classList.toggle('active', r === 'r1');
    ui.roundR2.classList.toggle('active', r === 'r2');
    ui.r1Sec.style.display = r === 'r1' ? 'block' : 'none';
    ui.r2Sec.style.display = r === 'r2' ? 'block' : 'none';
  }
  setRound('r1');

  // ===== camera =====
  try {
    cameraStream = await startCamera(ui.camVid, 'environment');
  } catch (err) {
    showError(ui.err, 'เปิดกล้องไม่ได้: ' + err.message);
  }

  ui.captureBtn.addEventListener('click', function () {
    if (photos.length >= 4) return;
    clearError(ui.err);
    try {
      const label = PHOTO_LABELS[photos.length] || ('มุม ' + (photos.length + 1));
      const b64 = captureFromVideoWithStamp(ui.camVid, label);
      photos.push(b64);
      renderPhotos();
    } catch (err) {
      showError(ui.err, 'ถ่ายไม่สำเร็จ: ' + err.message);
    }
  });

  ui.retakeBtn.addEventListener('click', function () {
    photos.length = 0;
    renderPhotos();
  });

  function renderPhotos() {
    const slots = ui.grid.querySelectorAll('.photo-slot');
    slots.forEach(function (slot, i) {
      slot.innerHTML = '';
      slot.classList.remove('filled');
      if (photos[i]) {
        const img = document.createElement('img');
        img.src = photos[i];
        slot.appendChild(img);
        slot.classList.add('filled');
      } else {
        slot.textContent = PHOTO_LABELS[i] || ('มุม ' + (i + 1));
      }
    });
    ui.counter.textContent = 'ถ่ายแล้ว ' + photos.length + ' / 4';
    ui.captureBtn.disabled = photos.length >= 4;
    ui.captureBtn.textContent = photos.length >= 4 ? 'ครบ 4 รูปแล้ว' : ('ถ่าย ' + PHOTO_LABELS[photos.length]);
  }
  renderPhotos();

  // ===== submit =====
  ui.submitBtn.addEventListener('click', async function () {
    clearError(ui.err);

    const productId = ui.productSel.value;
    const qtyRaw = ui.qty.value;
    const qty = Number(qtyRaw);
    const reason = ui.reason ? ui.reason.value.trim() : '';
    const pairing = round === 'r2' ? ui.pairing.value.trim() : '';

    if (!productId) return showError(ui.err, 'เลือกสินค้าก่อน');
    if (qtyRaw === '' || isNaN(qty)) return showError(ui.err, 'ใส่จำนวนก่อน');
    if (!cfg.allowZeroQty && qty <= 0) return showError(ui.err, 'จำนวนต้อง > 0');
    if (cfg.allowZeroQty && qty < 0) return showError(ui.err, 'จำนวนต้อง ≥ 0');
    if (qty !== Math.floor(qty)) return showError(ui.err, 'จำนวนต้องเป็นจำนวนเต็ม');
    if (cfg.hasReason && !reason) return showError(ui.err, 'ใส่เหตุผลก่อน (ตัดสต๊อก)');
    if (photos.length < 4) return showError(ui.err, 'ถ่ายให้ครบ 4 รูปก่อน');
    if (round === 'r2' && !pairing) return showError(ui.err, 'ใส่เลข ' + cfg.idPrefix + 'YYYYMMDD-XXXX ของรอบ 1');

    const payload = {
      lineUserId: state.lineUserId,
      name: state.profile && state.profile.displayName || '',
      productId: productId,
      qty: qty,
      photos: photos.slice(),
    };
    if (cfg.hasReason) payload.reason = reason;
    if (round === 'r2') payload[cfg.pairingKey] = pairing;

    ui.submitBtn.disabled = true;
    ui.submitBtn.textContent = 'กำลังบันทึก...';
    try {
      const res = await api.post(cfg.action, payload);
      onSuccess(res);
    } catch (err) {
      ui.submitBtn.disabled = false;
      ui.submitBtn.textContent = 'บันทึก';
      showError(ui.err, 'บันทึกไม่ได้: ' + (err.code || err.message)
        + (err.data && err.data.message ? ' — ' + err.data.message : ''));
    }
  });

  function onSuccess(res) {
    lastResult = res;
    stopCamera(cameraStream); cameraStream = null;
    ui.afterSubmit.style.display = 'block';
    document.getElementById('form-section').style.display = 'none';

    const status = res.status || '';
    const idVal = res[cfg.resultIdKey] || '';
    ui.resultIdText.textContent = idVal;

    const banner = document.getElementById('result-banner');
    if (banner) {
      if (status === 'pending_partner') {
        banner.className = 'success-banner';
        banner.textContent = 'บันทึกรอบ 1 สำเร็จ — ส่งเลขนี้ให้คนนับ 2 กรอกตามที่ "รอบ 2"';
      } else if (status === 'pending_owner') {
        banner.className = 'warning-block';
        banner.textContent = '⚠️ บันทึกแล้ว — รอเจ้าของ approve (จะแจ้งใน LINE)';
      } else if (status === 'confirmed') {
        banner.className = 'success-banner';
        banner.textContent = 'รอบ 2 ตรงกัน — confirmed' + (res.qty_after != null ? ' (ยอดคงเหลือ ' + res.qty_after + ')' : '');
      } else if (status === 'pending_supervisor') {
        banner.className = 'warning-block';
        banner.textContent = '⚠️ รอบ 2 ไม่ตรงกับรอบ 1 — รอหัวหน้าตัดสิน';
      } else if (status === 'no_action') {
        banner.className = 'success-banner';
        banner.textContent = 'นับเทียบตรงระบบ — ไม่ต้องปรับยอด';
      } else if (status === 'awaiting_owner') {
        banner.className = 'warning-block';
        banner.textContent = '⚠️ นับเทียบไม่ตรงระบบ — รอเจ้าของปรับยอด (ส่วนต่าง '
          + ((res.variance > 0 ? '+' : '') + res.variance) + ')';
      } else {
        banner.className = 'success-banner';
        banner.textContent = 'บันทึกสำเร็จ — status: ' + status;
      }
    }

    // copy id — แสดงเฉพาะ pending_partner (ต้องส่งให้คนนับ 2)
    if (ui.copyIdBtn) {
      ui.copyIdBtn.style.display = status === 'pending_partner' ? 'block' : 'none';
      // ใน pending_owner ก็ซ่อน mov-id-box ทั้งกล่อง (ไม่ต้องส่งให้ใคร)
      const movIdBox = document.querySelector('.mov-id-box');
      if (movIdBox && status === 'pending_owner') {
        // แสดงเลข id เล็กๆ ให้รู้ที่จะตามต่อได้
        movIdBox.style.display = 'block';
      }
      ui.copyIdBtn.onclick = async function () {
        try {
          await navigator.clipboard.writeText(idVal);
          ui.copyIdBtn.textContent = 'คัดลอกแล้ว';
          setTimeout(function () { ui.copyIdBtn.textContent = 'คัดลอกเลข ' + cfg.idPrefix.replace('-', ''); }, 1500);
        } catch (e) {
          showError(ui.err, 'คัดลอกไม่สำเร็จ — กดค้างที่เลข ID เพื่อ copy');
        }
      };
    }

    // undo countdown — only if status is pending_*
    if (ui.undoBar && /^pending_/.test(status)) {
      startUndoCountdown(idVal);
    }

    if (ui.newBtn) {
      ui.newBtn.onclick = function () { location.reload(); };
    }
  }

  function startUndoCountdown(recordId) {
    const windowSec = CONFIG.CANCEL_WINDOW_SECONDS || 300;
    undoExpiresAt = Date.now() + windowSec * 1000;
    ui.undoBar.style.display = 'block';
    tickUndo();
    undoTimer = setInterval(tickUndo, 1000);

    ui.undoBtn.onclick = async function () {
      if (Date.now() >= undoExpiresAt) return;
      const reason = prompt('เหตุผล (optional):') || '';
      ui.undoBtn.disabled = true;
      try {
        await api.post('cancelSubmission', {
          lineUserId: state.lineUserId,
          recordType: cfg.cancelRecordType,
          recordId: recordId,
          reason: reason,
        });
        clearInterval(undoTimer);
        ui.undoBar.classList.add('expired');
        ui.undoText.textContent = 'ยกเลิกแล้ว';
        ui.undoBtn.style.display = 'none';
      } catch (err) {
        ui.undoBtn.disabled = false;
        showError(ui.err, 'ยกเลิกไม่สำเร็จ: ' + (err.code || err.message));
      }
    };

    function tickUndo() {
      const remaining = Math.max(0, Math.round((undoExpiresAt - Date.now()) / 1000));
      const mm = Math.floor(remaining / 60);
      const ss = remaining % 60;
      ui.undoText.textContent = 'ยกเลิกได้อีก ' + mm + ':' + (ss < 10 ? '0' : '') + ss;
      if (remaining <= 0) {
        clearInterval(undoTimer);
        ui.undoBar.classList.add('expired');
        ui.undoText.textContent = 'หมดเวลายกเลิก (เกิน 5 นาที)';
        ui.undoBtn.style.display = 'none';
      }
    }
  }
}
