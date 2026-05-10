/**
 * Outbound.gs — หยิบของออกไปแพค
 *
 * เหมือน Inbound flow (double-blind 2 คน) แต่:
 *   - movement_type = 'outbound'
 *   - qty บันทึกเป็นจำนวนบวก แต่ apply ไป Stock เป็นลบ (qty_on_hand -= qty)
 *
 * Flow:
 *   1. คนที่ 1 เลือกสินค้า + กรอก qty + ถ่ายรูป → submitOutbound
 *   2. คนที่ 2 กรอกเหมือนเดิม + ส่ง movement_id → match
 *   3. ยกเลิก 5 นาที
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

function handleSubmitOutbound(payload) {
  // payload: { lineUserId, name, productId, qty, photos[4], pairingMovementId? }
  return { ok: false, error: 'not_implemented', action: 'submitOutbound' };
}
