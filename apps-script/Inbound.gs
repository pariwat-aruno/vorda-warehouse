/**
 * Inbound.gs — รับเข้าจากโรงงาน
 *
 * Flow:
 *   1. คนที่ 1 กรอก: product_id + qty + รูป 4 มุม → submitInbound
 *      → insert Movements row (status: pending_partner)
 *      → return movement_id
 *   2. คนที่ 2 กรอกฟอร์มเดียวกัน → submitInbound (ส่ง movement_id ของรอบ 1)
 *      → match qty: ตรง → status confirmed + apply ไป Stock + push LINE หัวหน้า
 *               ไม่ตรง → status pending_supervisor + push LINE หัวหน้าเรียกตัดสิน
 *   3. ยกเลิกใน 5 นาที → cancelSubmission
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

function handleSubmitInbound(payload) {
  // payload: {
  //   lineUserId, name,
  //   productId, qty,
  //   photos: [base64×4],
  //   pairingMovementId?: optional ของคนที่ 2 (เพื่อ match กับรอบ 1)
  // }
  // TODO: ดู CONTEXT.md § Flow Inbound + architecture.md
  return { ok: false, error: 'not_implemented', action: 'submitInbound' };
}
