/**
 * Return.gs — ตีคืนสินค้า + flow เคลม
 *
 * Flow ปกติ (สินค้าของเรา):
 *   1. พนักงานแกะ + ถ่าย VDO + กรอกสภาพ + ระบุว่าของเรา → submitReturn
 *      → status: pending_owner
 *   2. owner เห็นใน dashboard → approveReturn (decision: 'accept_to_stock')
 *      → ถ้าสภาพดี: insert Movement (movement_type='return_in', +qty) → +1 Stock
 *      → ถ้าสภาพไม่ดี: ปิดเคส status='rejected' ไม่กระทบสต๊อก
 *
 * Flow เคลม (สินค้าไม่ใช่ของเรา):
 *   1. พนักงานบันทึก: is_our_product = FALSE → status: pending_owner
 *   2. owner เลือก decision: 'forward_to_claim' → สร้าง Claim row stage='submitting'
 *   3. owner update stage:
 *      'submitting' → 'submitted' (ยื่นเรื่องแล้ว, ใส่ screenshot)
 *      'submitted' → 'closed' (ปิดเคส, closed_result='success' หรือ 'fail')
 *   ทุกขั้นต้องอัปโหลด screenshot
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

function handleSubmitReturn(payload) {
  // payload: { lineUserId, name, trackingNumber, productId?, productName, qty,
  //           isOurProduct: bool, condition: 'good'|'bad', videoBase64, photos[]? }
  return { ok: false, error: 'not_implemented', action: 'submitReturn' };
}

function handleApproveReturn(payload) {
  // payload: { lineUserId, returnId, decision: 'accept_to_stock'|'reject_bad'|'forward_to_claim' }
  // ต้องเช็ค isOwner
  return { ok: false, error: 'not_implemented', action: 'approveReturn' };
}

function handleRejectReturn(payload) {
  // shortcut: decision='reject_bad'
  return handleApproveReturn(Object.assign({}, payload, { decision: 'reject_bad' }));
}

function handleUpdateClaimStage(payload) {
  // payload: { lineUserId, claimId, newStage: 'submitted'|'closed', screenshot, closedResult? }
  // ต้องเช็ค isOwner
  return { ok: false, error: 'not_implemented', action: 'updateClaimStage' };
}
