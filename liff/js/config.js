/**
 * config.js — runtime config ของ LIFF frontend
 *
 * แก้ค่าด้านล่างหลังจาก:
 *  1. Deploy Apps Script web app → ได้ API_URL
 *  2. สร้าง LIFF apps 7 ตัว ใน LINE Developers → ได้ LIFF_IDS
 */

export const CONFIG = {
  // Apps Script Web App URL — แก้หลัง deploy Apps Script
  API_URL: 'https://script.google.com/macros/s/__REPLACE_ME__/exec',

  // LIFF IDs — 7 apps (1 ID ต่อ 1 หน้า)
  // staff
  LIFF_ID_INBOUND: '__REPLACE_ME__',  // inbound.html
  LIFF_ID_OUTBOUND: '__REPLACE_ME__', // outbound.html
  LIFF_ID_COUNT: '__REPLACE_ME__',    // count.html
  LIFF_ID_ADJUST: '__REPLACE_ME__',   // adjust.html
  LIFF_ID_RETURN: '__REPLACE_ME__',   // return.html
  LIFF_ID_CANCEL: '__REPLACE_ME__',   // cancel.html
  // owner
  LIFF_ID_ADMIN: '__REPLACE_ME__',    // admin.html
  // helper (ไม่ต้องสร้าง — ใช้ ID เดียวกับ inbound ก็ได้ ไม่ critical)
  LIFF_ID_MYID: '__REPLACE_ME__',     // myid.html — แสดง LINE userId

  // Brand
  BRAND_NAME: 'Vorda Warehouse',
  BRAND_FULL: 'บริษัท วอร์ด้า สกินแคร์ จำกัด',

  // Cancel window (วินาที) — ตรงกับ Sheet Config.cancel_window_seconds
  CANCEL_WINDOW_SECONDS: 300,

  // dev mode — true = mock LIFF (test ใน browser ปกติ ไม่ผ่าน LINE webview)
  DEV_MOCK_LIFF: false,

  // mock profile (ใช้เมื่อ DEV_MOCK_LIFF=true)
  DEV_MOCK_PROFILE: {
    userId: 'Udevtest0000000000000000000000001',
    displayName: 'DEV TESTER',
  },
};
