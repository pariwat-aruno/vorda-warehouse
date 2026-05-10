/**
 * Adjust.gs — ตัดสต๊อกของเสีย/แตกหัก
 *
 * เหมือน Inbound flow (double-blind 2 คน + รูป 4 มุม) แต่:
 *   - movement_type = 'adjust'
 *   - qty เป็นลบ (ลดสต๊อก)
 *   - ต้องระบุ reason
 *
 * นอกจากนี้ owner-initiated adjust ก็เรียก function นี้ตอน count variance:
 *   - handleAdjustStock(ownerPayload) → insert Movement (single approved by owner)
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

function handleSubmitAdjust(payload) {
  // staff-initiated (2 คน double-blind)
  // payload: { lineUserId, name, productId, qty, reason, photos[4], pairingMovementId? }
  return { ok: false, error: 'not_implemented', action: 'submitAdjust' };
}

function handleAdjustStock(payload) {
  // owner-initiated หลัง count variance
  // payload: { lineUserId, countId, deltaQty, reason }
  // ต้องเช็ค isOwner
  return { ok: false, error: 'not_implemented', action: 'adjustStock' };
}
