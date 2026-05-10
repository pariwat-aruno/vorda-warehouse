/**
 * Owner.gs — endpoints สำหรับ owner LIFF (admin.html)
 *
 * ทุก function เริ่มด้วย `if (!isOwner(payload.lineUserId)) return { ok:false, error:'not_owner' }`
 *
 *   - getOwnerDashboard: รายการที่รอ approve + ยอดสต๊อกปัจจุบัน + alert
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

function handleOwnerDashboard(payload) {
  // payload: { lineUserId }
  // ต้อง isOwner
  // return: {
  //   ok: true,
  //   stock: [{ product_id, product_name, qty_on_hand, unit }, ...],
  //   pending_returns: [{ return_id, ... }, ...],
  //   pending_cancels: [{ cancel_id, ... }, ...],
  //   pending_count_variance: [{ count_id, variance, ... }, ...],
  //   open_claims: [{ claim_id, stage, ... }, ...],
  // }
  return { ok: false, error: 'not_implemented', action: 'getOwnerDashboard' };
}
