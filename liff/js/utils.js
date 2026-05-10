/**
 * resize รูปก่อนแปลงเป็น base64
 * - max width 1280px (กันไฟล์ใหญ่ ส่งไม่ทันใน Apps Script timeout)
 * - JPEG quality 85%
 */
export async function fileToResizedBase64(file, maxWidth = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('no file'));
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('invalid image'));
      img.onload = () => {
        const ratio = Math.min(maxWidth / img.width, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** เรียก geolocation ของ browser (LINE webview รองรับ) */
export function getGeolocation(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('GPS ไม่รองรับ'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => reject(new Error('GPS error: ' + err.message)),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

export function showError(el, msg) {
  el.style.display = 'block';
  el.textContent = msg;
}

export function clearError(el) {
  el.style.display = 'none';
  el.textContent = '';
}
