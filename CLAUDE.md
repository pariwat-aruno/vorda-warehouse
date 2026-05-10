# CLAUDE.md — Vorda Warehouse Mini-App Recipe

> **อ่านไฟล์นี้ก่อนเริ่มทำงานบน project นี้ทุกครั้ง**
> Recipe นี้สรุปจาก partime-checkin pattern ที่ build จริงและรู้ gotcha ทุกอย่าง
> โดย adapt ให้เป็นระบบคลังสินค้า double-blind audit

---

## 1. Stack ที่บังคับใช้

| Layer | ใช้อะไร | เหตุผล |
|---|---|---|
| Frontend (LIFF) | GitHub Pages (vanilla HTML + ES module) | ฟรี + LINE webview compat |
| Backend (API) | Google Apps Script Web App (doPost JSON) | ฟรี + ผูก Sheet ตรง |
| Database | Google Sheet (10 tab) | ฟรี + เจ้าของแก้เองได้ |
| File storage | Google Drive (folder + 6 sub-folders ต่อ movement type) | ฟรี + thumbnail URL render ใน flex |
| Channel | LINE Messaging API + LIFF + rich menu | ผู้ใช้ครอบคลุมในไทย |
| CI/CD | GitHub Actions (pages.yml) | auto-deploy ตอน push |

**ห้าม:**
- ห้าม host LIFF บน Apps Script HtmlService → LIFF SDK ใช้ไม่ได้ใน iframe sandbox
- ห้าม commit secret (token/secret) ลง git → ใช้ Script Properties แทน
- ห้าม set deployment access ผ่าน clasp → reset เป็น "Only myself" ทุกครั้ง — ใช้ UI เท่านั้น
- ห้าม `<input type="file">` ที่ไม่บังคับกล้อง → ใช้ `accept="image/*" capture="environment"` หรือ `getUserMedia` เท่านั้น (anti-fraud requirement: ห้ามให้พนักงานใช้รูปจาก gallery)

---

## 2. โครงสร้าง project

```
vorda-warehouse/
├── CONTEXT.md              # glossary + data model + conventions (บังคับใช้)
├── TASKS.md                # phased tasks
├── README.md               # public readme
├── CLAUDE.md               # ไฟล์นี้
├── docs/
│   └── architecture.md     # flows + setup checklist
├── .github/workflows/
│   └── pages.yml           # auto-deploy liff/ → GitHub Pages
├── .gitignore
├── apps-script/            # backend (push ผ่าน clasp)
│   ├── .clasp.json         # script ID (gitignore)
│   ├── .claspignore
│   ├── appsscript.json     # timeZone Asia/Bangkok
│   ├── package.json        # clasp + scripts
│   ├── Setup.gs            # schema + setupDatabase + seedConfig + seedProducts + setupDrive + setupProperties + setupAll
│   ├── Logger.gs           # logInfo/logWarn/logError → Sheet Logs
│   ├── Config.gs           # getConfig + isOwner + isSupervisor + pushToAllOwners + pushToAllSupervisors
│   ├── Utils.gs            # datetime + gen IDs (Movement/Return/Cancel/Count/Claim) + findStaffByLineUserId + dedup
│   ├── LineApi.gs          # pushMessage/replyMessage/pushText/replyText + retry
│   ├── DriveStore.gs       # uploadImage + uploadImages (4 รูป) + uploadVideo + driveUrlToThumbnail_
│   ├── FlexCard.gs         # build*Card functions
│   ├── WebApp.gs           # doGet/doPost router + 14 actions + LINE webhook
│   ├── Inbound.gs          # หยิบเข้าจากโรงงาน (double-blind)
│   ├── Outbound.gs         # หยิบออกไปแพค (double-blind)
│   ├── Count.gs            # นับเทียบสัปดาห์ละครั้ง (double-blind, ไม่ apply Stock อัตโนมัติ)
│   ├── Adjust.gs           # ตัดสต๊อก ของเสีย (double-blind) + owner-initiated
│   ├── Return.gs           # ตีคืนสินค้า + flow เคลม 3 ขั้น
│   ├── Cancel.gs           # ยกเลิกออเดอร์
│   ├── Submission.gs       # cancelSubmission (5 นาที) + getProducts
│   ├── Owner.gs            # getOwnerDashboard
│   ├── Report.gs           # daily/weekly + scheduled triggers
│   └── node_modules/       # gitignore
├── liff/                   # frontend (host GitHub Pages)
│   ├── css/style.css       # cherry palette + brand utility
│   ├── js/
│   │   ├── config.js       # LIFF_IDs (7 ตัว) + API_URL + DEV_MOCK
│   │   ├── api.js          # POST helper (text/plain CORS workaround)
│   │   ├── auth.js         # initAuth (LIFF init + getProfile)
│   │   ├── utils.js        # fileToResizedBase64 + showError
│   │   └── camera.js       # startCamera + captureFromVideo + captureFromVideoWithStamp + stopCamera
│   ├── img/logo.jpg        # ใส่ logo Vorda Skincare ที่นี่
│   ├── myid.html           # show LINE userId (สำหรับเก็บ owner/supervisor ID)
│   ├── index.html          # landing — list 6 ปุ่มหลัก + redirect ไป LIFF apps
│   ├── inbound.html        # รับเข้า (staff)
│   ├── outbound.html       # หยิบออก (staff)
│   ├── count.html          # นับเทียบ (staff)
│   ├── adjust.html         # ตัดสต๊อก (staff)
│   ├── return.html         # ตีคืน (staff) — มี VDO recording
│   ├── cancel.html         # ยกเลิก (staff)
│   └── admin.html          # owner LIFF — dashboard + approve + claim flow
└── scripts/
    └── setup_rich_menu.py  # generate image + upload via LINE API
```

---

## 3. Phased workflow (เคร่งครัด)

### Phase 1 — Sheet + Drive
- รัน `Setup.gs::setupAll()` (รวม setupDatabase + seedConfig + seedProducts + setupDrive)
- ผู้ใช้ exec → ได้ SHEET_ID + DRIVE_FOLDER_ID + 6 sub-folders ใน Properties

### Phase 2 — LINE Channel + LIFF
- ผู้ใช้สร้าง: LINE OA + Messaging API channel
- สร้าง LIFF apps **7 ตัว** (inbound/outbound/count/adjust/return/cancel/admin)
- Claude เขียน `setup_rich_menu.py` (4 ปุ่มหลัก: รับเข้า / หยิบออก / นับเทียบ / รายการอื่นๆ)
- ขอ: LINE_CHANNEL_ACCESS_TOKEN + LINE_CHANNEL_SECRET + 7 LIFF_IDs

### Phase 3 — Apps Script foundation (มีอยู่แล้วใน template)
- Setup `clasp` (`npm install --save-dev @google/clasp` ใน apps-script/)
- `clasp create-script --type standalone --title "vorda-warehouse-backend"`
- `clasp push --force`
- Foundation ครบแล้ว: Logger / Config / Utils / LineApi / DriveStore / Setup

### Phase 4 — Apps Script endpoints (TASK ส่วนใหญ่อยู่ตรงนี้)
- ทำตาม TASK 11-22 ใน TASKS.md
- เขียน 7 flow handlers + 1 owner handler + report scheduler
- ทุก function: try-catch + log + idempotent
- ทุก double-blind flow ใช้ pattern: pairing key (movement_id ของรอบ 1) + match qty
- ทุก owner-only endpoint: `if (!isOwner(payload.lineUserId)) return { ok: false, error: 'not_owner' };`
- ทุก supervisor-only endpoint: `if (!isSupervisor(payload.lineUserId)) return { ok: false, error: 'not_supervisor' };`

### Phase 5 — LIFF frontend (TASK 23-30)
- เขียน 8 HTML files (myid + 6 staff + admin)
- ใช้ shared CSS + JS modules (config / api / auth / utils / camera)
- ทุกหน้ามี: logo + brand text + footer brand
- กล้อง: `startCamera` + `captureFromVideoWithStamp` (ฝัง timestamp) — ห้าม `<input type=file>` แม้มี `capture` (iOS บางรุ่นเลี่ยงได้)
- การ submit ทุก action: `dedupRecentSubmission_` กัน double-tap

### Phase 6 — Deploy + ทดสอบ (TASK 31-35)
- Apps Script → Deploy → New deployment → Web app → Anyone → Deploy → ส่ง URL กลับ
- update `liff/js/config.js` API_URL + 7 LIFF_IDs → push GitHub
- ตั้ง LINE webhook URL = web app URL
- update LIFF endpoint URLs = `https://<gh-user>.github.io/vorda-warehouse/<page>.html`
- ทดสอบ flow ผ่าน LINE จริง

### Phase 7 (option) — Reminder + Triggers
- รัน `Report.gs::installTriggers()` 1 ครั้ง — ตั้ง daily 18:00 + weekly Saturday 18:10

---

## 4. Workflow per code change (สำคัญ — clasp 3.x bug)

```
แก้ local
   ↓
clasp push --force                      # อัพ HEAD
   ↓
clasp create-version "<desc>"            # สร้าง immutable version snapshot
   ↓
[ผู้ใช้] Apps Script → Deploy → Manage  # ผ่าน UI เพราะ clasp reset access เป็น Only myself
        → Edit เก่า → Version: ใหม่ล่าสุด → Deploy
```

**ห้าม** `clasp create-deployment --deploymentId X` หรือ `clasp update-deployment` — reset access ทุกครั้ง → 404 จาก outside

**Claude Code ต้อง `clasp push` เองทุกครั้งหลังแก้ code** ห้ามบอก user "ไป push เอง" หรือ "อย่าลืม push"

---

## 5. Conventions (บังคับ)

### Code
- Comment ใน .gs/.html = ไทย, function/var = อังกฤษ
- Apps Script function ทุกตัวต้อง try-catch + log ลง Sheet `Logs`
- Datetime: `Asia/Bangkok` ISO 8601 พร้อม `+07:00` → ใช้ `nowBangkok()` / `todayBangkok()` / `formatThaiDateTime()`
- Idempotent: setup functions รันซ้ำได้ปลอดภัย, submit ซ้ำใน 5 วินาที = no-op (ใช้ `dedupRecentSubmission_`)
- ID format: `<PREFIX>-YYYYMMDD-XXXX` running per day
  - Movements: `MOV-YYYYMMDD-XXXX`
  - Counts: `CNT-YYYYMMDD-XXXX`
  - Returns: `RET-YYYYMMDD-XXXX`
  - Cancellations: `CXL-YYYYMMDD-XXXX`
  - Claims: `CLM-YYYYMMDD-XXXX`

### Config separation
- **Script Properties** = secret + immutable IDs (ACCESS_TOKEN, SECRET, SHEET_ID, DRIVE_FOLDER_ID, LIFF_IDs)
- **Sheet `Config` row** = ค่าที่เจ้าของอาจอยากแก้เอง (owner_line_user_ids, supervisor_line_user_ids, report times, cancel_window_seconds)

### Multi-role pattern
- Owner: Sheet Config row `owner_line_user_ids` (comma-separated) — ใช้ `isOwner()` + `pushToAllOwners()`
- Supervisor (หัวหน้าคลัง): Sheet Config row `supervisor_line_user_ids` — ใช้ `isSupervisor()` + `pushToAllSupervisors()`
- Manager (ทั้ง owner + supervisor): `pushToAllManagers()` ใช้ตอน real-time alert
- Staff: ไม่ต้องอยู่ใน Config — ระบบเชื่อ LINE userId เลย แต่บันทึกชื่อจาก profile

### Brand & UI
- Cherry red palette (`#c8102e` primary, `#9a0c24` dark)
- Logo + brand text ทุกหน้า + flex card header
- Footer brand ทุก LIFF page
- **ห้าม emoji** ยกเว้น `⚠️` สำหรับ warning

### Camera (anti-fraud — สำคัญสำหรับ project นี้)
- ใช้ `getUserMedia` (camera.js) — ห้าม `<input type=file>` แม้มี `capture`
- `captureFromVideoWithStamp(videoEl, label)` ฝัง timestamp + brand ลงใน JPEG (tamper-resistant)
- รูป 4 มุม: 4 ครั้งกดถ่าย, 4 frames ที่ภายใต้ stream เดียวกัน — เก็บใน array แล้วส่งทีเดียว

### VDO (เฉพาะ flow ตีคืน)
- `MediaRecorder` API + `getUserMedia({ video: true, audio: false })`
- ลิมิตเวลา 30 วินาที (กันไฟล์ใหญ่เกิน Apps Script payload)
- encode เป็น base64 → upload ผ่าน `uploadVideo` ใน DriveStore.gs

---

## 6. Access control — แยก 4 ระดับชัดเจน

ทุก endpoint ต้องบังคับใช้:

### Staff (พนักงานคลัง)
- ใช้ได้ทุก submit endpoint (`submitInbound`, `submitOutbound`, `submitCount`, `submitAdjust`, `submitReturn`, `submitCancel`)
- ใช้ `cancelSubmission` ได้เฉพาะ row ที่ตัวเองกรอก ใน 5 นาที
- ใช้ `getProducts` ได้

### Supervisor (หัวหน้าคลัง — 1 คน)
- ทุกอย่างของ staff
- เพิ่ม: `submitSupervisorTiebreaker` (ตัดสินกรณี double-blind นับไม่ตรง)
- รับ LINE alert real-time

### Owner (เจ้าของ — 2 คน)
- ทุกอย่างของ staff + supervisor
- เพิ่ม: `getOwnerDashboard` / `approveReturn` / `approveCancel` / `rejectReturn` / `updateClaimStage` / `adjustStock`
- รับสรุปรายวัน 18:00 + รายสัปดาห์ เสาร์ 18:10

### Frontend ห้ามเชื่อเอง
- พนักงานเปิด admin LIFF ได้ (block ไม่ได้ ระดับ LIFF)
- backend `isOwner()` คือ authoritative
- LIFF admin frontend: catch `not_owner` → แสดง error message

```js
// ทุก owner action
function someOwnerOnlyAction(payload) {
  if (!isOwner(payload && payload.lineUserId)) return { ok: false, error: 'not_owner' };
  // ... actual logic ...
}
```

---

## 7. Gotchas (เจอจริงตอน build partime-checkin)

| ปัญหา | สาเหตุ | วิธีแก้ |
|---|---|---|
| LIFF + Apps Script HtmlService = iframe sandbox block LIFF SDK | webview bridge | host LIFF บน GitHub Pages |
| GitHub Pages บน private repo = paid plan | GitHub Free | repo ต้องเป็น public (ตรวจให้ไม่มี secret) |
| `clasp create-deployment` reset access เป็น "Only myself" → 404 | clasp 3.x | ใช้ Apps Script UI ทำ Web App deployment |
| Apps Script Web App POST → 302 redirect | normal behavior | browser fetch + LINE webhook follow ได้ |
| LINE webhook Verify = 302 fail | LINE Verify ไม่ follow redirect | ignore Verify, real event ทำงานปกติ |
| Sheet `08:00` กลายเป็น Date object ตอน read | Sheets auto-convert | format Date → 'HH:mm' string ใน `readSheetConfig_` |
| Drive URL `/file/d/.../view` แสดง HTML viewer (LINE flex render ไม่ได้) | Drive default URL | แปลง → `https://drive.google.com/thumbnail?id=ID&sz=w800` |
| iOS file input บางครั้ง show gallery แม้ใส่ `capture="user"` | browser ignore hint | ใช้ getUserMedia แทน |
| `clasp push` รายงานสำเร็จแต่ server มีไฟล์ไม่ครบ | OAuth expired silently | `clasp login` ใหม่ + force push |
| **VDO base64 ใหญ่เกิน 50MB** (เฉพาะ project นี้) | Apps Script payload limit | จำกัด 30 วินาที + bitrate ต่ำใน MediaRecorder ฝั่ง LIFF |
| **Double-blind ระบบเพิ่มเลขผิด** | ปะ 2 row ของคนเดียวกัน | match ผ่าน pairingMovementId — รอบ 2 ส่ง movement_id ของรอบ 1 มาด้วย |

---

## 8. Test pattern

ทุก Apps Script flow ต้องมี:
- `testSendXxx()` — call handler ตรง bypass time/state check
- `previewXxxToOwner()` — ส่ง flex card หา owner เพื่อดูหน้าตา
- บน LIFF: `DEV_MOCK_LIFF: true` ใน config.js ทดสอบใน browser ปกติได้

ทดสอบ POST API จาก CLI:
```bash
python3 -c "
import urllib.request, json
url = 'https://script.google.com/macros/s/.../exec'
data = json.dumps({'action':'getProducts','payload':{'lineUserId':'U...'}}).encode()
req = urllib.request.Request(url, data=data, headers={'Content-Type':'text/plain;charset=utf-8'})
print(urllib.request.urlopen(req).read().decode())
"
```

---

## 9. ห้ามทำ (Out of scope)

- ❌ Auth เกินกว่า LINE Login (ไม่มี password / role-based UI ขาด)
- ❌ Real-time websocket / push UI update
- ❌ Mobile native app
- ❌ Barcode / QR scanner
- ❌ เชื่อมตรง TikTok Shop / Shopee / e-commerce
- ❌ Lot number / วันหมดอายุ / ที่เก็บในคลัง
- ❌ มากกว่า 5 SKU (ถ้าจะเพิ่ม → re-design)
- ❌ Multi-warehouse / หลายคลัง
- ❌ Real-time dashboard (ดูได้ใน admin LIFF — ไม่ใช่ live update)

ถ้าผู้ใช้ขอเหล่านี้ → ตอบ "ออก scope mini-app — Phase 2"
