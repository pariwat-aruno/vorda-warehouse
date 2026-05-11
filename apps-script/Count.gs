/**
 * Count.gs — นับเทียบ (สัปดาห์ละครั้ง)
 *
 * ต่างจาก Inbound/Outbound:
 *   - ไม่ apply ไป Stock โดยอัตโนมัติ (ผลนับ ≠ การเปลี่ยนแปลง)
 *   - บันทึก variance = final_qty - system_qty
 *   - ถ้า variance ≠ 0 → push LINE owner รอกดปุ่ม "ปรับยอด" ใน owner LIFF
 *   - owner กดปรับยอด → adjustStock → insert Movement (movement_type='adjust')
 *
 * Flow:
 *   1. คนที่ 1 กรอก: เลือกสินค้า + qty นับได้ + รูป 4 มุม
 *      → snapshot system_qty (Stock.qty_on_hand) ตอนนี้
 *      → status pending_partner
 *   2. คนที่ 2 กรอก → match
 *      ตรง → status awaiting_owner ถ้า variance≠0, ไม่งั้น no_action
 *      ไม่ตรง → status pending_supervisor → หัวหน้าตัดสิน
 *   3. หัวหน้าตัดสิน → submitSupervisorTiebreaker
 *   4. owner เห็นใน dashboard → กด adjustStock → ปิด count
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

function handleSubmitCount(payload) {
  // payload: { lineUserId, name, productId, qty, photos[4], pairingCountId? }
  return { ok: false, error: 'not_implemented', action: 'submitCount' };
}

function handleSupervisorTiebreaker(payload) {
  // payload: { lineUserId, name, recordType: 'count'|'inbound'|'outbound'|'adjust', recordId, qty, photos[4]? }
  // ต้องเช็ค isSupervisor(lineUserId)
  return { ok: false, error: 'not_implemented', action: 'submitSupervisorTiebreaker' };
}
