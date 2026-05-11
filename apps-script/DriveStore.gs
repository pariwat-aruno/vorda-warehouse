/**
 * DriveStore.gs — รับ base64 → upload Drive → return URL
 *
 * subfolder enum สำหรับ vorda-warehouse:
 *   - 'inbound'   = รูปรับเข้าจากโรงงาน
 *   - 'outbound'  = รูปเตรียมแพ็คไปแพค
 *   - 'count'     = รูปตรวจนับสัปดาห์ละครั้ง
 *   - 'adjust'    = รูปเสียหาย/ของเสีย
 *   - 'return'    = VDO + รูปตีคืนสินค้า + screenshot ขั้นเคลม
 *   - 'cancel'    = รูปยกเลิกออเดอร์
 *
 * permission: anyone with link, viewer (ให้ LINE flex render thumbnail ได้)
 */

const DRIVE_SUBFOLDER_PROP_KEY = {
  'inbound': 'DRIVE_FOLDER_INBOUND',
  'outbound': 'DRIVE_FOLDER_OUTBOUND',
  'count': 'DRIVE_FOLDER_COUNT',
  'adjust': 'DRIVE_FOLDER_ADJUST',
  'return': 'DRIVE_FOLDER_RETURN',
  'cancel': 'DRIVE_FOLDER_CANCEL',
};

/**
 * upload base64 image → Drive → คืน public URL
 *
 * @param {string} base64 — data URL (data:image/...;base64,xxx) หรือ raw base64
 * @param {string} filename
 * @param {string} subfolder — ตาม enum ข้างบน
 * @return {string} public URL ที่ดู preview ได้
 */
function uploadImage(base64, filename, subfolder) {
  if (!base64) throw new Error('uploadImage: base64 ว่าง');
  if (!filename) throw new Error('uploadImage: filename ว่าง');
  const propKey = DRIVE_SUBFOLDER_PROP_KEY[subfolder];
  if (!propKey) throw new Error('uploadImage: subfolder ไม่รู้จัก ' + subfolder);

  const folderId = PropertiesService.getScriptProperties().getProperty(propKey);
  if (!folderId) throw new Error('uploadImage: ' + propKey + ' not set');

  // strip data: prefix ถ้ามี — รองรับ data:mime;param=val;base64,xxx
  const parsed = _parseDataUrl_(base64, 'image/jpeg');
  let bytes;
  try {
    bytes = Utilities.base64Decode(parsed.raw);
  } catch (err) {
    logError('uploadImage', 'base64 decode failed', { filename: filename, err: err.message });
    throw new Error('invalid_base64');
  }

  const blob = Utilities.newBlob(bytes, parsed.mimeType, filename);
  const folder = DriveApp.getFolderById(folderId);
  const file = folder.createFile(blob);

  // permission: anyone with link, viewer
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    logWarn('uploadImage', 'setSharing failed: ' + err.message, { fileId: file.getId() });
  }

  return file.getUrl();
}

/**
 * upload หลายรูป (4 มุม) — return array ของ URL ตามลำดับ
 * เผื่อ array บาง slot เป็น null/empty (กรณี optional)
 */
function uploadImages(base64Array, filenamePrefix, subfolder) {
  if (!Array.isArray(base64Array)) throw new Error('uploadImages: base64Array ต้องเป็น array');
  return base64Array.map(function (b64, i) {
    if (!b64) return '';
    return uploadImage(b64, filenamePrefix + '-' + (i + 1) + '.jpg', subfolder);
  });
}

/**
 * upload video (สำหรับ flow ตีคืน — แกะของถ่าย VDO)
 * ลิมิตขนาด: ขึ้นกับ Apps Script payload limit ~50MB
 * ต้องลด bitrate / ลดเวลาก่อน encode base64 ฝั่ง LIFF
 */
function uploadVideo(base64, filename, subfolder) {
  if (!base64) throw new Error('uploadVideo: base64 ว่าง');
  const propKey = DRIVE_SUBFOLDER_PROP_KEY[subfolder];
  if (!propKey) throw new Error('uploadVideo: subfolder ไม่รู้จัก ' + subfolder);

  const folderId = PropertiesService.getScriptProperties().getProperty(propKey);
  if (!folderId) throw new Error('uploadVideo: ' + propKey + ' not set');

  const parsed = _parseDataUrl_(base64, 'video/mp4');
  const raw = parsed.raw;
  const mimeType = parsed.mimeType;

  let bytes;
  try {
    bytes = Utilities.base64Decode(raw);
  } catch (err) {
    logError('uploadVideo', 'base64 decode failed', { filename: filename, err: err.message });
    throw new Error('invalid_base64');
  }

  const blob = Utilities.newBlob(bytes, mimeType, filename);
  const folder = DriveApp.getFolderById(folderId);
  const file = folder.createFile(blob);

  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    logWarn('uploadVideo', 'setSharing failed: ' + err.message, { fileId: file.getId() });
  }

  return file.getUrl();
}

/**
 * parse data URL → { raw, mimeType }
 * รองรับ:
 *   data:image/jpeg;base64,xxx
 *   data:video/webm;codecs=vp8;base64,xxx
 *   data:video/mp4;codecs=h264,base64,xxx   (เบราเซอร์บางตัว)
 * ถ้าไม่ใช่ data URL → คืน base64 ดิบ + defaultMime
 */
function _parseDataUrl_(s, defaultMime) {
  if (typeof s !== 'string') return { raw: '', mimeType: defaultMime || 'application/octet-stream' };
  const idx = s.indexOf(';base64,');
  if (idx < 0 || !s.startsWith('data:')) {
    // ไม่มี prefix — base64 ดิบ
    return { raw: s, mimeType: defaultMime || 'application/octet-stream' };
  }
  const header = s.substring(5, idx); // ตัด "data:" และทุกอย่างก่อน ";base64,"
  // mime อยู่ก่อน ';' ตัวแรก
  const semi = header.indexOf(';');
  const mimeType = semi >= 0 ? header.substring(0, semi) : header;
  const raw = s.substring(idx + 8);
  return { raw: raw, mimeType: mimeType || (defaultMime || 'application/octet-stream') };
}

/**
 * Drive URL `/file/d/ID/view` → render thumbnail URL ที่ใช้ใน LINE flex card ได้
 */
function driveUrlToThumbnail_(url, sizePx) {
  sizePx = sizePx || 800;
  if (!url) return '';
  const m = String(url).match(/\/d\/([^\/]+)/);
  if (!m) return url;
  return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w' + sizePx;
}
