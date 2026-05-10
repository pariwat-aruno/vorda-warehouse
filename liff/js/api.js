import { CONFIG } from './config.js';

/**
 * POST → Apps Script Web App
 * ใช้ Content-Type: text/plain เพื่อข้าม CORS preflight
 * (Apps Script ไม่ส่ง CORS header — pattern จาก factory-stock-liff)
 */
export const api = {
  async post(action, payload) {
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.ok) {
      const err = new Error(data.error || 'unknown_error');
      err.code = data.error;
      err.data = data;
      throw err;
    }
    return data;
  },
};
