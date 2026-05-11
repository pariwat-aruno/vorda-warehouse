/**
 * config.js — runtime config ของ LIFF frontend
 *
 * แก้ค่าด้านล่างหลังจาก:
 *  1. Deploy Apps Script web app → ได้ API_URL
 *  2. สร้าง LIFF apps 7 ตัว ใน LINE Developers → ได้ LIFF_IDS
 */

export const CONFIG = {
  // Apps Script Web App URL
  API_URL: 'https://script.google.com/macros/s/AKfycbwLmaNaopejgR2gIKSY3nm1MBHLIcfLw06_KiLx7Tn08MShl8yOZNAIBP4IjYF_BGdw/exec',

  // LIFF IDs — 7 apps (1 ID ต่อ 1 หน้า)
  // staff
  LIFF_ID_INBOUND:  '2010039913-l3str31E',  // inbound.html
  LIFF_ID_OUTBOUND: '2010039913-qEVDVQCK',  // outbound.html
  LIFF_ID_COUNT:    '2010039913-Mwxbowp7',  // count.html
  LIFF_ID_ADJUST:   '2010039913-Qh70XgVu',  // adjust.html
  LIFF_ID_RETURN:   '2010039913-pbFfeqN5',  // return.html
  LIFF_ID_CANCEL:   '2010039913-qn27hLz0',  // cancel.html
  // owner
  LIFF_ID_OWNER:    '2010039913-nqodMLew',  // owner.html
  // helper (ไม่ต้องสร้าง LIFF แยก — ใช้ ID เดียวกับ inbound)
  LIFF_ID_MYID:     '2010039913-l3str31E',  // myid.html — แสดง LINE userId

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
