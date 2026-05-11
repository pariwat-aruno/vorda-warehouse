/**
 * Setup.gs — schema + setup functions
 *
 * รันครั้งเดียวตอนเริ่ม project:
 *   1. setupDatabase()    — สร้าง Sheet 8 tab + headers
 *   2. seedConfig()       — ใส่ Config row default
 *   3. setupDrive()       — สร้าง Drive folder + 6 sub-folders
 *   4. setupProperties()  — set Script Properties (non-secret IDs)
 *
 * รันได้ idempotent — ปลอดภัยถ้ารันซ้ำ
 *
 * **สำคัญ:** secrets (LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET) ต้องใส่
 * ผ่าน UI: Project Settings → Script Properties → Add property
 * ห้ามใส่ใน code นี้
 */

// =====================================================================
// SHEET SCHEMA
// =====================================================================

const SHEET_HEADERS = {

  // 1. Products — master 5 SKU + ยอดเริ่มต้น
  'Products': [
    'product_id',         // SKU-01 ... SKU-05
    'product_name',       // ชื่อสินค้า
    'unit',               // ชิ้น / ขวด / ลัง
    'opening_balance',    // ยอดเริ่มต้น (Stock Take ครั้งแรก)
    'opening_set_at',     // ตั้งเมื่อไร
    'is_active',
  ],

  // 2. Stock — ยอดคงเหลือปัจจุบัน (1 row per SKU, update ทุก movement)
  'Stock': [
    'product_id',
    'product_name',
    'qty_on_hand',        // ยอดคงเหลือล่าสุด
    'last_movement_id',
    'last_movement_at',
    'updated_at',
  ],

  // 3. Movements — ทุกการเคลื่อนไหว (เข้า/ออก/ตัด)
  // หมายเหตุ: คืน + ยกเลิก ใช้ sheet แยก แต่จะ link มา insert row ที่นี่ ตอน owner approve
  'Movements': [
    'movement_id',        // MOV-YYYYMMDD-XXXX
    'movement_type',      // inbound / outbound / adjust / return_in / cancel_in
    'product_id',
    'product_name',
    'qty',                // + เข้า, - ออก
    'reason',             // เฉพาะ adjust + cancel + return — เหตุผล
    'related_doc_id',     // เลขเอกสาร: PICK-xxx / RET-xxx / CXL-xxx
    'submitter1_user_id', // คนกรอกที่ 1 (LINE userId)
    'submitter1_name',
    'submitter1_qty',     // ยอดที่คนที่ 1 กรอก
    'submitter1_at',
    'submitter2_user_id', // คนกรอกที่ 2
    'submitter2_name',
    'submitter2_qty',
    'submitter2_at',
    'supervisor_user_id', // หัวหน้าตัดสิน (กรณีไม่ตรง)
    'supervisor_name',
    'supervisor_qty',
    'supervisor_at',
    'photo_urls',         // 4 รูป — comma-separated URLs
    'status',             // pending_partner / pending_supervisor / confirmed / cancelled
    'cancel_at',          // ถ้ายกเลิกใน 5 นาที
    'cancel_reason',
    'created_at',
    'confirmed_at',
  ],

  // 4. Counts — นับเทียบสัปดาห์ละครั้ง (เทียบกับ Stock.qty_on_hand)
  'Counts': [
    'count_id',           // CNT-YYYYMMDD-XXXX
    'product_id',
    'product_name',
    'system_qty',         // ยอดในระบบตอนนับ (snapshot)
    'submitter1_user_id',
    'submitter1_name',
    'submitter1_qty',
    'submitter1_at',
    'submitter2_user_id',
    'submitter2_name',
    'submitter2_qty',
    'submitter2_at',
    'supervisor_user_id',
    'supervisor_name',
    'supervisor_qty',
    'supervisor_at',
    'photo_urls',
    'final_qty',          // ยอดที่ตกลงสุดท้าย
    'variance',           // final_qty - system_qty
    'status',             // pending_partner / pending_supervisor / awaiting_owner / resolved_by_adjust / no_action
    'owner_action_user_id', // ใคร approve การปรับยอด
    'owner_action_at',
    'cancel_at',
    'cancel_reason',
    'created_at',
  ],

  // 5. Returns — ตีคืนสินค้า (มี VDO + ขั้นเคลม)
  'Returns': [
    'return_id',          // RET-YYYYMMDD-XXXX
    'tracking_number',    // เลข tracking ของออเดอร์
    'product_id',         // ถ้าระบุได้ (กรณีของเรา)
    'product_name',
    'qty',
    'is_our_product',     // TRUE / FALSE
    'condition',          // good / bad
    'video_url',          // VDO ตอนแกะ (Drive URL)
    'photo_urls',         // รูปประกอบ
    'staff_user_id',      // พนักงานที่บันทึก
    'staff_name',
    'staff_at',
    'owner_user_id',      // owner ที่ approve
    'owner_at',
    'owner_decision',     // accept_to_stock / reject_bad / forward_to_claim
    'claim_id',           // ถ้า forward → CLM-...
    'status',             // pending_owner / accepted / rejected / forwarded_to_claim / cancelled
    'cancel_at',
    'cancel_reason',
    'created_at',
  ],

  // 6. Cancellations — ยกเลิกออเดอร์ (ของไม่ถึงปลายทาง ตีกลับ)
  'Cancellations': [
    'cancel_id',          // CXL-YYYYMMDD-XXXX
    'tracking_number',
    'product_id',
    'product_name',
    'qty',
    'photo_urls',
    'staff_user_id',
    'staff_name',
    'staff_at',
    'owner_user_id',
    'owner_at',
    'status',             // pending_owner / accepted / rejected / cancelled
    'cancel_at',
    'cancel_reason',
    'created_at',
  ],

  // 7. Claims — flow เคลม (ของไม่ใช่ของเรา ที่ส่งคืนมา)
  'Claims': [
    'claim_id',           // CLM-YYYYMMDD-XXXX
    'return_id',          // อ้างอิงไป Returns
    'tracking_number',
    'stage',              // submitting / submitted / closed
    'screenshot_submitting',  // Drive URL
    'screenshot_submitted',
    'screenshot_closed',
    'closed_result',      // success / fail
    'last_updated_user_id',
    'last_updated_at',
    'created_at',
  ],

  // 8. Staff — รายชื่อคนที่ใช้ระบบได้ (พนักงาน + หัวหน้า + owner)
  'Staff': [
    'staff_id',           // S-001
    'name',
    'role',               // staff / supervisor / owner
    'line_user_id',
    'is_active',
    'registered_at',
  ],

  // 9. Logs — error + audit log (มาตรฐาน)
  'Logs': [
    'timestamp',
    'level',
    'function',
    'message',
    'payload',
  ],

  // 10. Config — ค่าระบบที่ owner แก้เอง
  'Config': [
    'key',
    'value',
    'description',
  ],
};

// =====================================================================
// CONFIG DEFAULTS
// =====================================================================

const CONFIG_DEFAULTS = [
  ['owner_line_user_ids', '', 'LINE userId ของ owner (comma-separated) — ใส่หลังได้จาก myid.html'],
  ['supervisor_line_user_ids', '', 'LINE userId ของหัวหน้าคลัง (comma-separated)'],
  ['report_daily_time', '18:00', 'เวลาสรุปรายวัน (HH:mm) — trigger ส่ง LINE หัวหน้า'],
  ['report_weekly_day', 'Saturday', 'วันสรุปรายสัปดาห์'],
  ['report_weekly_time', '18:10', 'เวลาสรุปรายสัปดาห์ (HH:mm) — trigger ส่ง LINE owner'],
  ['cancel_window_seconds', '300', 'ระยะเวลาที่ยกเลิก submission ได้ (วินาที) — default 5 นาที'],
  ['count_min_photos', '4', 'จำนวนรูปขั้นต่ำที่ต้องถ่าย (4 มุมลัง)'],
];

// =====================================================================
// FUNCTIONS
// =====================================================================

/**
 * รันครั้งแรกใน Apps Script editor → สร้าง Sheet ใหม่ + 10 tab
 * idempotent: รันซ้ำได้ ถ้าสร้าง Sheet แล้วจะใช้ตัวเดิม (อ่านจาก Properties)
 */
function setupDatabase() {
  let ss;
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty('SHEET_ID');

  if (existingId) {
    try {
      ss = SpreadsheetApp.openById(existingId);
      console.log('using existing Sheet: ' + existingId);
    } catch (e) {
      console.log('existing SHEET_ID invalid, creating new');
      ss = SpreadsheetApp.create('Vorda Warehouse Database');
      props.setProperty('SHEET_ID', ss.getId());
    }
  } else {
    ss = SpreadsheetApp.create('Vorda Warehouse Database');
    props.setProperty('SHEET_ID', ss.getId());
    console.log('created new Sheet: ' + ss.getId());
  }

  // สร้าง tab + headers (idempotent)
  Object.keys(SHEET_HEADERS).forEach(function (sheetName) {
    let sh = ss.getSheetByName(sheetName);
    if (!sh) {
      sh = ss.insertSheet(sheetName);
    }
    const headers = SHEET_HEADERS[sheetName];
    // ถ้า row 1 ว่างหรือไม่ตรง → set headers
    const last = sh.getLastColumn();
    const needWrite = last === 0 || sh.getRange(1, 1).getValue() === '';
    if (needWrite) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  });

  // ลบ Sheet1 default ถ้ามี
  const def = ss.getSheetByName('Sheet1');
  if (def && Object.keys(SHEET_HEADERS).indexOf('Sheet1') < 0) {
    ss.deleteSheet(def);
  }

  console.log('Sheet URL: ' + ss.getUrl());
  console.log('SHEET_ID: ' + ss.getId());
  return ss.getUrl();
}

/**
 * ใส่ Config row default (idempotent — ไม่ทับค่าที่มีอยู่)
 */
function seedConfig() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('SHEET_ID not set — รัน setupDatabase ก่อน');
  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Config');

  const last = sh.getLastRow();
  const existing = {};
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      if (r[0]) existing[r[0]] = true;
    });
  }

  const toAdd = CONFIG_DEFAULTS.filter(function (row) {
    return !existing[row[0]];
  });
  if (toAdd.length > 0) {
    sh.getRange(last + 1, 1, toAdd.length, 3).setValues(toAdd);
  }
  console.log('seedConfig: added ' + toAdd.length + ' rows (skipped ' + (CONFIG_DEFAULTS.length - toAdd.length) + ' existing)');
}

/**
 * Seed สินค้า 5 ตัวเริ่มต้น — upsert: ใส่ใหม่ถ้ายังไม่มี + อัปเดต product_name/unit/is_active ถ้ามีอยู่แล้ว
 * (opening_balance จะ overwrite เฉพาะตอน setup ครั้งแรก — ถ้ามี Stock movement แล้วจะไม่แตะ qty_on_hand)
 *
 * 4 ตัวจริง:
 *   SKU-01 ครีมกันแดด
 *   SKU-02 เซรั่มโสมแดง
 *   SKU-03 ครีมโสมแดง
 *   SKU-04 เซรั่มสาหร่ายแดง
 *   SKU-05 (placeholder — is_active=false ไว้รองรับเพิ่มในอนาคต)
 */
function seedProducts() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('SHEET_ID not set');
  const ss = SpreadsheetApp.openById(sheetId);
  const productsSh = ss.getSheetByName('Products');
  const stockSh = ss.getSheetByName('Stock');

  // [product_id, product_name, unit, opening_balance, is_active]
  const defs = [
    ['SKU-01', 'ครีมกันแดด',         'ชิ้น', 0, true],
    ['SKU-02', 'เซรั่มโสมแดง',        'ชิ้น', 0, true],
    ['SKU-03', 'ครีมโสมแดง',         'ชิ้น', 0, true],
    ['SKU-04', 'เซรั่มสาหร่ายแดง',     'ชิ้น', 0, true],
    ['SKU-05', '(ยังไม่ใช้)',         'ชิ้น', 0, false],
  ];

  // โหลด Products ที่มีอยู่
  const productsLast = productsSh.getLastRow();
  const productsExistingMap = {}; // product_id → row index (เริ่ม 2)
  if (productsLast >= 2) {
    productsSh.getRange(2, 1, productsLast - 1, 1).getValues().forEach(function (r, i) {
      if (r[0]) productsExistingMap[r[0]] = i + 2;
    });
  }

  let added = 0, updated = 0;
  const now = nowBangkok();

  defs.forEach(function (def) {
    const id = def[0];
    const rowIdx = productsExistingMap[id];
    if (rowIdx) {
      // update เฉพาะ name/unit/is_active — ไม่แตะ opening_balance/opening_set_at
      productsSh.getRange(rowIdx, 2).setValue(def[1]); // product_name
      productsSh.getRange(rowIdx, 3).setValue(def[2]); // unit
      productsSh.getRange(rowIdx, 6).setValue(def[4]); // is_active
      updated++;
    } else {
      // insert ใหม่: [product_id, product_name, unit, opening_balance, opening_set_at, is_active]
      productsSh.appendRow([id, def[1], def[2], def[3], now, def[4]]);
      added++;
    }
  });

  // Stock: insert ใหม่ถ้ายังไม่มี + อัปเดต product_name (denormalized)
  const stockLast = stockSh.getLastRow();
  const stockExistingMap = {};
  if (stockLast >= 2) {
    stockSh.getRange(2, 1, stockLast - 1, 1).getValues().forEach(function (r, i) {
      if (r[0]) stockExistingMap[r[0]] = i + 2;
    });
  }

  let stockAdded = 0, stockUpdated = 0;
  defs.forEach(function (def) {
    const id = def[0];
    const rowIdx = stockExistingMap[id];
    if (rowIdx) {
      // อัปเดตชื่อ (denormalized) — ไม่แตะ qty_on_hand
      stockSh.getRange(rowIdx, 2).setValue(def[1]);
      stockSh.getRange(rowIdx, 6).setValue(now); // updated_at
      stockUpdated++;
    } else {
      // [product_id, product_name, qty_on_hand, last_movement_id, last_movement_at, updated_at]
      stockSh.appendRow([id, def[1], def[3], '', '', now]);
      stockAdded++;
    }
  });

  console.log('seedProducts: Products added=' + added + ' updated=' + updated +
              '; Stock added=' + stockAdded + ' updated=' + stockUpdated);
}

/**
 * สร้าง Drive folder root + 6 sub-folder + permission
 */
function setupDrive() {
  const props = PropertiesService.getScriptProperties();
  let rootId = props.getProperty('DRIVE_FOLDER_ID');
  let root;

  if (rootId) {
    try {
      root = DriveApp.getFolderById(rootId);
      console.log('using existing root: ' + rootId);
    } catch (e) {
      root = null;
    }
  }
  if (!root) {
    root = DriveApp.createFolder('Vorda Warehouse Storage');
    rootId = root.getId();
    props.setProperty('DRIVE_FOLDER_ID', rootId);
    console.log('created root: ' + rootId);
  }

  // 6 sub-folders ตาม subfolder enum ของ DriveStore.gs
  const subfolders = [
    ['inbound', 'DRIVE_FOLDER_INBOUND'],
    ['outbound', 'DRIVE_FOLDER_OUTBOUND'],
    ['count', 'DRIVE_FOLDER_COUNT'],
    ['adjust', 'DRIVE_FOLDER_ADJUST'],
    ['return', 'DRIVE_FOLDER_RETURN'],
    ['cancel', 'DRIVE_FOLDER_CANCEL'],
  ];

  subfolders.forEach(function (pair) {
    const folderName = pair[0];
    const propKey = pair[1];
    let subId = props.getProperty(propKey);
    let sub = null;
    if (subId) {
      try { sub = DriveApp.getFolderById(subId); } catch (e) { sub = null; }
    }
    if (!sub) {
      // หาใน root ก่อน เผื่อสร้างมือไว้แล้ว
      const it = root.getFoldersByName(folderName);
      if (it.hasNext()) {
        sub = it.next();
      } else {
        sub = root.createFolder(folderName);
      }
      props.setProperty(propKey, sub.getId());
      console.log('created sub: ' + folderName + ' = ' + sub.getId());
    }
  });

  // permission: anyone with link, viewer (root only — sub-folders inherit)
  try {
    root.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    console.warn('setSharing root failed: ' + e.message);
  }

  console.log('Drive URL: ' + root.getUrl());
  return root.getUrl();
}

/**
 * set Script Properties (non-secret IDs)
 *
 * **ห้ามใส่ secrets ในนี้** — secrets (LINE_CHANNEL_ACCESS_TOKEN/SECRET) ใส่ผ่าน UI:
 *   Project Settings → Script Properties → Add property
 *
 * เปลี่ยนค่าด้านล่างให้ตรงกับ project จริงก่อนรัน
 */
function setupProperties() {
  const props = PropertiesService.getScriptProperties();

  const NON_SECRET_PROPS = {
    // ID ของ LIFF apps ที่สร้างใน LINE Developers console
    // LIFF IDs ไม่ใช่ secret (อยู่ใน URL `https://liff.line.me/<id>` อยู่แล้ว) — committed ใน git ได้
    'LIFF_ID_INBOUND':  '2010039913-l3str31E',
    'LIFF_ID_OUTBOUND': '2010039913-qEVDVQCK',
    'LIFF_ID_COUNT':    '2010039913-Mwxbowp7',
    'LIFF_ID_ADJUST':   '2010039913-Qh70XgVu',
    'LIFF_ID_RETURN':   '2010039913-pbFfeqN5',
    'LIFF_ID_CANCEL':   '2010039913-qn27hLz0',
    'LIFF_ID_OWNER':    '2010039913-nqodMLew',
  };

  const empty = [];
  Object.keys(NON_SECRET_PROPS).forEach(function (key) {
    const val = NON_SECRET_PROPS[key];
    if (val) {
      props.setProperty(key, val);
    } else {
      empty.push(key);
    }
  });

  if (empty.length > 0) {
    console.warn('ยังไม่ได้ใส่ค่าใน setupProperties() สำหรับ: ' + empty.join(', '));
    console.warn('แก้ใน Setup.gs → NON_SECRET_PROPS แล้วรันอีกครั้ง');
  } else {
    console.log('setupProperties: set ' + Object.keys(NON_SECRET_PROPS).length + ' properties');
  }

  // เตือนถ้ายังไม่มี secrets
  const secretsNeeded = ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'SHEET_ID', 'DRIVE_FOLDER_ID'];
  const secretsMissing = secretsNeeded.filter(function (k) { return !props.getProperty(k); });
  if (secretsMissing.length > 0) {
    console.warn('ยังขาด: ' + secretsMissing.join(', ') + ' — secrets ใส่ผ่าน UI; SHEET_ID/DRIVE_FOLDER_ID ใส่จาก setupDatabase/setupDrive');
  }
}

/**
 * รันทีเดียว — ทำทุกอย่าง (เรียงลำดับ)
 * ใช้ตอน setup ครั้งแรก
 */
function setupAll() {
  setupDatabase();
  seedConfig();
  seedProducts();
  setupDrive();
  setupProperties();
  console.log('=== setupAll DONE ===');
  console.log('ขั้นต่อไป:');
  console.log('1. Project Settings → Script Properties → ใส่ LINE_CHANNEL_ACCESS_TOKEN + LINE_CHANNEL_SECRET');
  console.log('2. สร้าง LIFF apps ใน LINE Developers → ใส่ LIFF_ID_* ใน Setup.gs::setupProperties() แล้วรันใหม่');
  console.log('3. แก้ owner_line_user_ids + supervisor_line_user_ids ใน sheet Config');
  console.log('4. Deploy เป็น Web App (Anyone) — ผ่าน UI Apps Script');
}
