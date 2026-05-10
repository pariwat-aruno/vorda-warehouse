/**
 * Submission.gs — common helpers สำหรับทุก flow
 *
 *   - cancelSubmission: ยกเลิก row ที่เพิ่ง submit ใน 5 นาที (กันพิมพ์ผิด)
 *     - ใช้ได้กับ Movements / Counts / Returns / Cancellations
 *     - เงื่อนไข: status ต้อง pending_partner หรือ pending_supervisor หรือ pending_owner
 *                + เป็น lineUserId คนกรอกเอง
 *                + อยู่ใน window (ดู Config.cancel_window_seconds, default 300)
 *
 *   - getProducts: คืนรายชื่อ + ยอดล่าสุด ให้ LIFF dropdown
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

function handleCancelSubmission(payload) {
  // payload: { lineUserId, recordType: 'movement'|'count'|'return'|'cancel', recordId, reason }
  return { ok: false, error: 'not_implemented', action: 'cancelSubmission' };
}

function handleGetProducts(payload) {
  // payload: { lineUserId }
  // return: { ok: true, products: [{ product_id, product_name, qty_on_hand, unit }, ...] }
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const stockSh = ss.getSheetByName('Stock');
    const productsSh = ss.getSheetByName('Products');

    const stockData = stockSh.getDataRange().getValues();
    const stockHeaders = stockData[0];
    const stockMap = {};
    for (let i = 1; i < stockData.length; i++) {
      const row = {};
      stockHeaders.forEach(function (h, j) { row[h] = stockData[i][j]; });
      if (row.product_id) stockMap[row.product_id] = row;
    }

    const productsData = productsSh.getDataRange().getValues();
    const productsHeaders = productsData[0];
    const products = [];
    for (let i = 1; i < productsData.length; i++) {
      const row = {};
      productsHeaders.forEach(function (h, j) { row[h] = productsData[i][j]; });
      if (!row.product_id || row.is_active === false) continue;
      const stock = stockMap[row.product_id] || {};
      products.push({
        product_id: row.product_id,
        product_name: row.product_name,
        unit: row.unit || 'ชิ้น',
        qty_on_hand: Number(stock.qty_on_hand || 0),
      });
    }

    return { ok: true, products: products };
  } catch (err) {
    logError('handleGetProducts', err.message);
    return { ok: false, error: 'server_error', message: err.message };
  }
}
