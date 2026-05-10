/**
 * Cancel.gs — ยกเลิกออเดอร์
 *
 * (ลูกค้ายกเลิกออเดอร์ ของไม่ถึงปลายทางตีกลับ — ของยังไม่แกะ)
 *
 * Flow:
 *   1. พนักงานบันทึก: tracking + product + qty + รูป → submitCancel
 *      → status: pending_owner
 *   2. owner approveCancel → decision='accept'
 *      → insert Movement (movement_type='cancel_in', +qty) → +1 Stock
 *      → status='accepted'
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

function handleSubmitCancel(payload) {
  // payload: { lineUserId, name, trackingNumber, productId, qty, photos[] }
  return { ok: false, error: 'not_implemented', action: 'submitCancel' };
}

function handleApproveCancel(payload) {
  // payload: { lineUserId, cancelId, decision: 'accept'|'reject' }
  // ต้องเช็ค isOwner
  return { ok: false, error: 'not_implemented', action: 'approveCancel' };
}
