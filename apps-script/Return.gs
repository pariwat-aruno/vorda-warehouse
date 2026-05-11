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

/**
 * staff บันทึกตีคืน — มี VDO + รูป + กรอกสภาพ
 *
 * payload: {
 *   lineUserId, name,
 *   trackingNumber,
 *   productId?, productName?, qty,
 *   isOurProduct: bool,
 *   condition: 'good'|'bad',
 *   videoBase64,         // จำเป็น — VDO ตอนแกะของ (anti-fraud)
 *   photos?: [base64]    // optional
 * }
 *
 * effect: insert Returns row status=pending_owner → push owner
 */
function handleSubmitReturn(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const name = payload.name || '';
  const trackingNumber = String(payload.trackingNumber || '').trim();
  const productId = String(payload.productId || '').trim();
  const productName = String(payload.productName || '').trim();
  const qty = Number(payload.qty);
  const isOurProduct = !!payload.isOurProduct;
  const condition = String(payload.condition || '').toLowerCase();
  const videoBase64 = payload.videoBase64;
  const photos = payload.photos || [];

  if (!lineUserId || !trackingNumber || !qty || !condition || !videoBase64) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'trackingNumber', 'qty', 'condition', 'videoBase64'] };
  }
  if (!isFinite(qty) || qty <= 0 || qty !== Math.floor(qty)) {
    return { ok: false, error: 'qty_invalid', message: 'qty ต้องเป็นจำนวนเต็มบวก' };
  }
  if (condition !== 'good' && condition !== 'bad') {
    return { ok: false, error: 'condition_invalid', message: "condition ต้องเป็น 'good' หรือ 'bad'" };
  }
  if (isOurProduct && !productId) {
    return { ok: false, error: 'product_required', message: 'ของเราต้องระบุ productId' };
  }

  const dedupKey = 'return:' + lineUserId + ':' + trackingNumber + ':' + qty;
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  try {
    autoRegisterStaff_(lineUserId, name);

    // resolve product_name
    let finalProductName = productName;
    if (isOurProduct && !finalProductName) {
      finalProductName = lookupProductName_(productId) || '';
    }

    const returnId = nextReturnId();

    // upload VDO + photos
    const videoUrl = uploadVideo(videoBase64, returnId + '.mp4', 'return');
    const photoUrls = (Array.isArray(photos) && photos.length > 0)
      ? uploadImages(photos, returnId, 'return')
      : [];

    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Returns');
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = new Array(headers.length).fill('');
    const now = nowBangkok();

    setCol_(row, headers, 'return_id', returnId);
    setCol_(row, headers, 'tracking_number', trackingNumber);
    setCol_(row, headers, 'product_id', productId);
    setCol_(row, headers, 'product_name', finalProductName);
    setCol_(row, headers, 'qty', qty);
    setCol_(row, headers, 'is_our_product', isOurProduct);
    setCol_(row, headers, 'condition', condition);
    setCol_(row, headers, 'video_url', videoUrl);
    setCol_(row, headers, 'photo_urls', photoUrls.join(','));
    setCol_(row, headers, 'staff_user_id', lineUserId);
    setCol_(row, headers, 'staff_name', name);
    setCol_(row, headers, 'staff_at', now);
    setCol_(row, headers, 'status', 'pending_owner');
    setCol_(row, headers, 'created_at', now);

    sh.appendRow(row);

    logInfo('handleSubmitReturn', 'submitted', {
      returnId: returnId, trackingNumber: trackingNumber, qty: qty,
      isOurProduct: isOurProduct, condition: condition,
    });

    safePushToAllOwners_([{
      type: 'text',
      text:
        '⚠️ ตีคืนรอ approve\n' +
        'รหัส: ' + returnId + '\n' +
        'tracking: ' + trackingNumber + '\n' +
        'สินค้า: ' + (finalProductName || '(ไม่ใช่ของเรา)') + '\n' +
        'จำนวน: ' + qty + ' ชิ้น\n' +
        'สภาพ: ' + (condition === 'good' ? 'ดี' : 'ไม่ดี') + '\n' +
        'ของเรา: ' + (isOurProduct ? 'ใช่' : 'ไม่ใช่') + '\n' +
        'VDO: ' + videoUrl + '\n' +
        'พนักงาน: ' + name + '\n' +
        'กด approve ใน LIFF เจ้าของ',
    }], 'handleSubmitReturn');

    return {
      ok: true,
      returnId: returnId,
      status: 'pending_owner',
      video_url: videoUrl,
      photo_urls: photoUrls,
    };
  } catch (err) {
    logError('handleSubmitReturn', err.message, {
      lineUserId: lineUserId, trackingNumber: trackingNumber, qty: qty,
    });
    return { ok: false, error: 'server_error', message: err.message };
  }
}

/**
 * owner ตัดสินตีคืน
 *
 * payload: { lineUserId, returnId, decision: 'accept_to_stock'|'reject_bad'|'forward_to_claim' }
 *
 * decision rules:
 *   accept_to_stock — ต้อง is_our_product=true AND condition='good'
 *                     → insert Movement (return_in, +qty) + apply Stock → status='accepted'
 *   reject_bad      — ปิดเคส status='rejected' ไม่กระทบ Stock
 *   forward_to_claim — สร้าง Claim row stage='submitting' → status='forwarded_to_claim'
 */
function handleApproveReturn(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const returnId = payload.returnId;
  const decision = String(payload.decision || '').toLowerCase();

  if (!lineUserId || !returnId || !decision) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'returnId', 'decision'] };
  }
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };

  const VALID = ['accept_to_stock', 'reject_bad', 'forward_to_claim'];
  if (VALID.indexOf(decision) < 0) {
    return { ok: false, error: 'decision_invalid', valid: VALID };
  }

  const dedupKey = 'approveReturn:' + lineUserId + ':' + returnId;
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const sh = ss.getSheetByName('Returns');
    const rowIdx = findRowByIdCol_(sh, 'return_id', returnId);
    if (rowIdx < 0) return { ok: false, error: 'not_found', returnId: returnId };

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];

    const status = String(row[headers.indexOf('status')] || '');
    if (status !== 'pending_owner') {
      return { ok: false, error: 'not_pending_owner', currentStatus: status };
    }

    const productId = String(row[headers.indexOf('product_id')] || '');
    const productName = String(row[headers.indexOf('product_name')] || productId);
    const qty = Number(row[headers.indexOf('qty')] || 0);
    const isOurProduct = !!row[headers.indexOf('is_our_product')];
    const condition = String(row[headers.indexOf('condition')] || '');
    const trackingNumber = String(row[headers.indexOf('tracking_number')] || '');
    const ownerName = (function () {
      const s = findStaffByLineUserId(lineUserId);
      return (s && s.name) || 'owner';
    })();

    // validate decision vs record state
    if (decision === 'accept_to_stock') {
      if (!isOurProduct) return { ok: false, error: 'cannot_accept_foreign', message: 'ไม่ใช่ของเรา — ใช้ forward_to_claim' };
      if (condition !== 'good') return { ok: false, error: 'cannot_accept_bad', message: 'สภาพไม่ดี — ใช้ reject_bad' };
      if (!productId) return { ok: false, error: 'product_missing', message: 'ไม่มี productId — แก้ Sheet Returns ก่อน' };
    }

    const now = nowBangkok();
    sh.getRange(rowIdx, headers.indexOf('owner_user_id') + 1).setValue(lineUserId);
    sh.getRange(rowIdx, headers.indexOf('owner_at') + 1).setValue(now);
    sh.getRange(rowIdx, headers.indexOf('owner_decision') + 1).setValue(decision);

    if (decision === 'accept_to_stock') {
      // insert Movement (return_in, +qty) + apply Stock
      const movementId = nextMovementId();
      const movSh = ss.getSheetByName('Movements');
      const movHeaders = movSh.getRange(1, 1, 1, movSh.getLastColumn()).getValues()[0];
      const mrow = new Array(movHeaders.length).fill('');
      setCol_(mrow, movHeaders, 'movement_id', movementId);
      setCol_(mrow, movHeaders, 'movement_type', 'return_in');
      setCol_(mrow, movHeaders, 'product_id', productId);
      setCol_(mrow, movHeaders, 'product_name', productName);
      setCol_(mrow, movHeaders, 'qty', qty);
      setCol_(mrow, movHeaders, 'related_doc_id', returnId);
      setCol_(mrow, movHeaders, 'submitter1_user_id', lineUserId);
      setCol_(mrow, movHeaders, 'submitter1_name', ownerName);
      setCol_(mrow, movHeaders, 'submitter1_qty', qty);
      setCol_(mrow, movHeaders, 'submitter1_at', now);
      setCol_(mrow, movHeaders, 'status', 'confirmed');
      setCol_(mrow, movHeaders, 'created_at', now);
      setCol_(mrow, movHeaders, 'confirmed_at', now);
      movSh.appendRow(mrow);

      const stock = applyStockDelta_(productId, +qty, movementId);

      sh.getRange(rowIdx, headers.indexOf('status') + 1).setValue('accepted');

      logInfo('handleApproveReturn', 'accepted', {
        returnId: returnId, movementId: movementId, qty: qty,
        stock_before: stock.qty_before, stock_after: stock.qty_after,
      });

      safePushToAllOwners_([{
        type: 'text',
        text:
          'ตีคืน accepted (เข้า Stock)\n' +
          'รหัส: ' + returnId + '\n' +
          'tracking: ' + trackingNumber + '\n' +
          'สินค้า: ' + productName + '\n' +
          'จำนวน: +' + qty + ' ชิ้น\n' +
          'ยอดคงเหลือ: ' + stock.qty_after + '\n' +
          'movement: ' + movementId,
      }], 'handleApproveReturn');

      return {
        ok: true, returnId: returnId, decision: decision,
        status: 'accepted', movementId: movementId,
        qty_before: stock.qty_before, qty_after: stock.qty_after,
      };
    }

    if (decision === 'reject_bad') {
      sh.getRange(rowIdx, headers.indexOf('status') + 1).setValue('rejected');
      logInfo('handleApproveReturn', 'rejected', { returnId: returnId });

      safePushToAllOwners_([{
        type: 'text',
        text:
          'ตีคืน rejected (ไม่กระทบ Stock)\n' +
          'รหัส: ' + returnId + '\n' +
          'tracking: ' + trackingNumber + '\n' +
          'สินค้า: ' + (productName || '(ไม่ใช่ของเรา)') + '\n' +
          'สภาพ: ' + (condition === 'good' ? 'ดี' : 'ไม่ดี'),
      }], 'handleApproveReturn');

      return { ok: true, returnId: returnId, decision: decision, status: 'rejected' };
    }

    // forward_to_claim
    const claimId = nextClaimId();
    const claimsSh = ss.getSheetByName('Claims');
    const claimHeaders = claimsSh.getRange(1, 1, 1, claimsSh.getLastColumn()).getValues()[0];
    const crow = new Array(claimHeaders.length).fill('');
    setCol_(crow, claimHeaders, 'claim_id', claimId);
    setCol_(crow, claimHeaders, 'return_id', returnId);
    setCol_(crow, claimHeaders, 'tracking_number', trackingNumber);
    setCol_(crow, claimHeaders, 'stage', 'submitting');
    setCol_(crow, claimHeaders, 'last_updated_user_id', lineUserId);
    setCol_(crow, claimHeaders, 'last_updated_at', now);
    setCol_(crow, claimHeaders, 'created_at', now);
    claimsSh.appendRow(crow);

    sh.getRange(rowIdx, headers.indexOf('claim_id') + 1).setValue(claimId);
    sh.getRange(rowIdx, headers.indexOf('status') + 1).setValue('forwarded_to_claim');

    logInfo('handleApproveReturn', 'forwarded_to_claim', {
      returnId: returnId, claimId: claimId, trackingNumber: trackingNumber,
    });

    safePushToAllOwners_([{
      type: 'text',
      text:
        'ตีคืน forwarded_to_claim\n' +
        'รหัส: ' + returnId + '\n' +
        'tracking: ' + trackingNumber + '\n' +
        'claim_id: ' + claimId + '\n' +
        'stage: submitting (รอยื่นเรื่อง supplier)',
    }], 'handleApproveReturn');

    return {
      ok: true, returnId: returnId, decision: decision,
      status: 'forwarded_to_claim', claimId: claimId, claimStage: 'submitting',
    };
  } catch (err) {
    logError('handleApproveReturn', err.message, { returnId: returnId, decision: decision });
    return { ok: false, error: 'server_error', message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** shortcut: reject_bad */
function handleRejectReturn(payload) {
  return handleApproveReturn(Object.assign({}, payload, { decision: 'reject_bad' }));
}

/**
 * owner update claim stage (TASK-17)
 *
 * payload: { lineUserId, claimId, newStage: 'submitted'|'closed',
 *            screenshot: base64, closedResult?: 'success'|'fail' }
 *
 * transitions ที่อนุญาต:
 *   submitting → submitted (ต้อง screenshot_submitted)
 *   submitted  → closed    (ต้อง screenshot_closed + closedResult)
 *
 * error codes:
 *   missing_params, not_owner, claim_not_found, invalid_transition,
 *   screenshot_required, closed_result_required, server_error
 */
function handleUpdateClaimStage(payload) {
  payload = payload || {};
  const lineUserId = payload.lineUserId;
  const claimId = payload.claimId;
  const newStage = String(payload.newStage || '').toLowerCase();
  const screenshot = payload.screenshot;
  const closedResult = String(payload.closedResult || '').toLowerCase();

  if (!lineUserId || !claimId || !newStage) {
    return { ok: false, error: 'missing_params', need: ['lineUserId', 'claimId', 'newStage'] };
  }
  if (!isOwner(lineUserId)) return { ok: false, error: 'not_owner' };
  if (newStage !== 'submitted' && newStage !== 'closed') {
    return { ok: false, error: 'invalid_transition', message: 'newStage ต้องเป็น submitted หรือ closed' };
  }
  if (!screenshot) {
    return { ok: false, error: 'screenshot_required' };
  }
  if (newStage === 'closed' && closedResult !== 'success' && closedResult !== 'fail') {
    return { ok: false, error: 'closed_result_required', message: 'closedResult ต้องเป็น success หรือ fail' };
  }

  const dedupKey = 'updateClaim:' + lineUserId + ':' + claimId + ':' + newStage;
  if (!dedupRecentSubmission_(dedupKey, 5)) {
    return { ok: false, error: 'duplicate_request' };
  }

  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Claims');
    const rowIdx = findRowByIdCol_(sh, 'claim_id', claimId);
    if (rowIdx < 0) return { ok: false, error: 'claim_not_found', claimId: claimId };

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];

    const currentStage = String(row[headers.indexOf('stage')] || '');
    const trackingNumber = String(row[headers.indexOf('tracking_number')] || '');

    // validate transition
    if (newStage === 'submitted' && currentStage !== 'submitting') {
      return { ok: false, error: 'invalid_transition', currentStage: currentStage };
    }
    if (newStage === 'closed' && currentStage !== 'submitted') {
      return { ok: false, error: 'invalid_transition', currentStage: currentStage };
    }

    // upload screenshot → return subfolder
    const filename = claimId + '-' + newStage + '.jpg';
    const screenshotUrl = uploadImage(screenshot, filename, 'return');

    const now = nowBangkok();
    sh.getRange(rowIdx, headers.indexOf('stage') + 1).setValue(newStage);
    sh.getRange(rowIdx, headers.indexOf('last_updated_user_id') + 1).setValue(lineUserId);
    sh.getRange(rowIdx, headers.indexOf('last_updated_at') + 1).setValue(now);

    if (newStage === 'submitted') {
      sh.getRange(rowIdx, headers.indexOf('screenshot_submitted') + 1).setValue(screenshotUrl);
    } else {
      sh.getRange(rowIdx, headers.indexOf('screenshot_closed') + 1).setValue(screenshotUrl);
      sh.getRange(rowIdx, headers.indexOf('closed_result') + 1).setValue(closedResult);
    }

    logInfo('handleUpdateClaimStage', 'stage updated', {
      claimId: claimId, from: currentStage, to: newStage,
      closedResult: newStage === 'closed' ? closedResult : null,
    });

    const resultStr = newStage === 'closed' ? (' (' + (closedResult === 'success' ? 'สำเร็จ' : 'ไม่สำเร็จ') + ')') : '';
    safePushToAllOwners_([{
      type: 'text',
      text:
        'เคลม update stage\n' +
        'claim_id: ' + claimId + '\n' +
        'tracking: ' + trackingNumber + '\n' +
        'stage: ' + currentStage + ' → ' + newStage + resultStr + '\n' +
        'screenshot: ' + screenshotUrl,
    }], 'handleUpdateClaimStage');

    return {
      ok: true, claimId: claimId, stage: newStage,
      closedResult: newStage === 'closed' ? closedResult : undefined,
      screenshotUrl: screenshotUrl,
    };
  } catch (err) {
    logError('handleUpdateClaimStage', err.message, { claimId: claimId, newStage: newStage });
    return { ok: false, error: 'server_error', message: err.message };
  }
}
