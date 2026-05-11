/**
 * Config.gs — อ่านค่าตั้งระบบ
 *
 * 2 แหล่ง:
 *   1) Script Properties — secret + ID (Sheet ID, LINE token, LIFF IDs ...)
 *   2) Sheet `Config` — ค่าที่ owner อยากแก้เอง (owner_line_user_ids, รายชื่อสินค้า, ...)
 *
 * cache 5 นาที กัน read sheet ซ้ำ
 */

const CONFIG_CACHE_KEY = 'vorda_warehouse_runtime_config';
const CONFIG_CACHE_TTL = 300; // 5 นาที

/**
 * คืนค่า config object รวมทุก property ที่ใช้บ่อย
 * required keys → ถ้าหายไป throw ทันที (fail fast)
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();

  // LIFF apps ของ vorda-warehouse — 7 ตัว
  // staff: inbound / outbound / count / adjust / return / cancel
  // owner: owner
  const required = [
    'SHEET_ID',
    'DRIVE_FOLDER_ID',
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LIFF_ID_INBOUND',
    'LIFF_ID_OUTBOUND',
    'LIFF_ID_COUNT',
    'LIFF_ID_ADJUST',
    'LIFF_ID_RETURN',
    'LIFF_ID_CANCEL',
    'LIFF_ID_OWNER',
  ];

  const cfg = {};
  const missing = [];
  required.forEach(function (key) {
    const v = props.getProperty(key);
    if (!v) missing.push(key);
    cfg[key] = v;
  });

  if (missing.length) {
    throw new Error('missing required Script Properties: ' + missing.join(', '));
  }

  // optional secrets
  cfg.LINE_CHANNEL_SECRET = props.getProperty('LINE_CHANNEL_SECRET') || '';

  // sub-folder Drive (set โดย setupDrive แล้วเก็บใน Properties)
  cfg.DRIVE_FOLDER_INBOUND = props.getProperty('DRIVE_FOLDER_INBOUND') || '';
  cfg.DRIVE_FOLDER_OUTBOUND = props.getProperty('DRIVE_FOLDER_OUTBOUND') || '';
  cfg.DRIVE_FOLDER_COUNT = props.getProperty('DRIVE_FOLDER_COUNT') || '';
  cfg.DRIVE_FOLDER_ADJUST = props.getProperty('DRIVE_FOLDER_ADJUST') || '';
  cfg.DRIVE_FOLDER_RETURN = props.getProperty('DRIVE_FOLDER_RETURN') || '';
  cfg.DRIVE_FOLDER_CANCEL = props.getProperty('DRIVE_FOLDER_CANCEL') || '';

  // sheet `Config` — owner_line_user_ids + อื่นๆ
  Object.assign(cfg, readSheetConfig_(cfg.SHEET_ID));

  // owners (ที่ approve คืน/ยกเลิก/ปรับยอด)
  let ownerIds = [];
  if (cfg.owner_line_user_ids) {
    ownerIds = String(cfg.owner_line_user_ids)
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }
  if (ownerIds.length === 0) {
    throw new Error('ไม่มี owner: เพิ่ม row owner_line_user_ids ใน sheet Config (comma-separated)');
  }
  cfg.OWNER_LINE_USER_IDS = ownerIds;
  cfg.OWNER_LINE_USER_ID = ownerIds[0]; // backward compat

  // หัวหน้าคลัง (ตัดสิน double-blind ไม่ตรง — ไม่ใช่ owner)
  let supervisorIds = [];
  if (cfg.supervisor_line_user_ids) {
    supervisorIds = String(cfg.supervisor_line_user_ids)
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }
  cfg.SUPERVISOR_LINE_USER_IDS = supervisorIds;

  return cfg;
}

/** เช็คว่า userId เป็น owner ไหม */
function isOwner(userId) {
  if (!userId) return false;
  try {
    const cfg = getConfig();
    return cfg.OWNER_LINE_USER_IDS.indexOf(userId) >= 0;
  } catch (e) {
    return false;
  }
}

/** เช็คว่า userId เป็นหัวหน้าคลังไหม */
function isSupervisor(userId) {
  if (!userId) return false;
  try {
    const cfg = getConfig();
    return cfg.SUPERVISOR_LINE_USER_IDS.indexOf(userId) >= 0;
  } catch (e) {
    return false;
  }
}

/** push message ให้ owner ทุกคน */
function pushToAllOwners(messages) {
  const cfg = getConfig();
  cfg.OWNER_LINE_USER_IDS.forEach(function (uid) {
    pushMessage(uid, messages);
  });
}

/** push ให้หัวหน้าคลังทุกคน */
function pushToAllSupervisors(messages) {
  const cfg = getConfig();
  cfg.SUPERVISOR_LINE_USER_IDS.forEach(function (uid) {
    pushMessage(uid, messages);
  });
}

/** push ให้ทั้ง owner + หัวหน้า (ใช้ตอน real-time alert) */
function pushToAllManagers(messages) {
  const cfg = getConfig();
  const seen = {};
  [].concat(cfg.OWNER_LINE_USER_IDS, cfg.SUPERVISOR_LINE_USER_IDS).forEach(function (uid) {
    if (!uid || seen[uid]) return;
    seen[uid] = true;
    pushMessage(uid, messages);
  });
}

/**
 * อ่าน sheet Config → object (cache)
 */
function readSheetConfig_(sheetId) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONFIG_CACHE_KEY);
  if (cached) {
    return JSON.parse(cached);
  }

  const sh = SpreadsheetApp.openById(sheetId).getSheetByName('Config');
  if (!sh) throw new Error('sheet Config not found');

  const last = sh.getLastRow();
  const result = {};
  if (last >= 2) {
    const data = sh.getRange(2, 1, last - 1, 2).getValues();
    data.forEach(function (row) {
      const k = row[0];
      let v = row[1];
      if (!k) return;
      if (v instanceof Date) {
        v = Utilities.formatDate(v, 'Asia/Bangkok', 'HH:mm');
      } else if (typeof v === 'number') {
        // keep
      } else if (typeof v === 'string' && !isNaN(parseFloat(v)) && isFinite(v)) {
        v = Number(v);
      }
      result[k] = v;
    });
  }

  cache.put(CONFIG_CACHE_KEY, JSON.stringify(result), CONFIG_CACHE_TTL);
  return result;
}

/** invalidate cache (เรียกตอน owner แก้ค่าใน sheet) */
function clearConfigCache() {
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
}
