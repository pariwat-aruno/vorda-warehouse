# TASKS.md — Vorda Warehouse

> Claude Code อ่านไฟล์นี้คู่กับ CONTEXT.md + docs/architecture.md + CLAUDE.md
> ทำทีละ task ตามลำดับ ห้ามข้าม dependency

## วิธีใช้
1. หยิบ task แรกที่ยังไม่ติ๊ก
2. อ่าน acceptance criteria
3. Implement
4. ทดสอบ
5. ติ๊ก ✅ → task ถัดไป

## Status legend
- `[ ]` = ยังไม่ทำ
- `[~]` = กำลังทำ
- `[x]` = เสร็จและ tested

---

## Phase 1 — Setup ฐานข้อมูล + storage

### TASK-01: Apps Script project + clasp setup
- [x] cd apps-script/
- [x] `npm install --save-dev @google/clasp`
- [x] `./node_modules/.bin/clasp login` (already logged in globally)
- [x] `./node_modules/.bin/clasp create-script --type standalone --title "vorda-warehouse-backend"`
- [x] copy `Setup.gs / Logger.gs / Config.gs / Utils.gs / LineApi.gs / DriveStore.gs / WebApp.gs` (มีอยู่แล้ว) ไป Apps Script
- [x] `clasp push --force`
- **Acceptance:** เห็น 7 ไฟล์ใน Apps Script editor — ✅ pushed 18 files (17 .gs + appsscript.json)
- **Script ID:** `1baxE8RNxwgqG3SGT0RrgV0eR1oM1r9gEjEWdoxvKeaH6pBJ3UoN7kywh`
- **Editor:** https://script.google.com/d/1baxE8RNxwgqG3SGT0RrgV0eR1oM1r9gEjEWdoxvKeaH6pBJ3UoN7kywh/edit

### TASK-02: รัน setupAll()
- [x] เปิด Apps Script editor → เลือก `Setup.gs`
- [x] รัน `setupAll()` (รวม setupDatabase + seedConfig + seedProducts + setupDrive + setupProperties)
- [x] อนุญาต OAuth ตามที่ขอ (Sheets + Drive + UrlFetch + Triggers + UserInfo)
- [x] copy SHEET_ID + DRIVE_FOLDER_ID จาก Logger output
- **Acceptance:** Sheet 10 tab พร้อม headers + Drive folder root + 6 sub-folder + Properties มี SHEET_ID/DRIVE_FOLDER_ID/sub-folder IDs ✅
- **SHEET_ID:** `1nhI71qba9n8yef-WhJ9WUQYzaHAGT8c6bg7nXoY9YVI`
- **DRIVE_FOLDER_ID:** `1K2heZPHZkgZP9oQgDmGtapyC7TkK_xFG`
- **Sheet:** https://docs.google.com/spreadsheets/d/1nhI71qba9n8yef-WhJ9WUQYzaHAGT8c6bg7nXoY9YVI/edit
- **Drive:** https://drive.google.com/drive/folders/1K2heZPHZkgZP9oQgDmGtapyC7TkK_xFG

### TASK-03: แก้ชื่อสินค้าจริง 5 SKU + ยอดเริ่มต้น
- [x] แก้ `seedProducts()` ใน Setup.gs ให้เป็น upsert + ใส่ชื่อจริง 4 SKU + 1 placeholder
- [x] clasp push + ผู้ใช้รัน `seedProducts()` → 5 row updated
- [x] opening_balance = 0 ทุกตัว (จะ count รอบแรกผ่าน LIFF)
- **Acceptance:** Products + Stock มี 5 row ตรงกัน ✅
  - SKU-01 ครีมกันแดด (active)
  - SKU-02 เซรั่มโสมแดง (active)
  - SKU-03 ครีมโสมแดง (active)
  - SKU-04 เซรั่มสาหร่ายแดง (active)
  - SKU-05 (ยังไม่ใช้) (inactive — placeholder)

---

## Phase 2 — LINE Channel + LIFF

### TASK-04: สร้าง LINE Messaging API channel
- [x] https://developers.line.biz/console/ → Create Provider
- [x] Create Messaging API channel "Vorda Warehouse"
- [x] เปิด Webhook + ปิด Auto-reply messages
- [x] เปิด channel เป็น Published (Status: Public)
- [x] copy `Channel access token` + `Channel secret` → ใส่ใน `apps-script/Secrets.gs` (gitignored)
- [x] รัน `setupSecrets()` → Properties มี LINE_CHANNEL_ACCESS_TOKEN + LINE_CHANNEL_SECRET
- **Acceptance:** Properties มี 2 ค่านี้ ✅ (LINE bot ทดสอบ webhook ทีหลัง TASK-31)

### TASK-05: สร้าง LIFF apps 7 ตัว
- [x] LINE Developers → Channel → LIFF tab → Add LIFF app × 7:

| LIFF | Endpoint URL (placeholder ก่อน) | Size | Scope | Bot link |
|---|---|---|---|---|
| inbound | `https://<gh>.github.io/vorda-warehouse/inbound.html` | Full | profile, openid | Aggressive |
| outbound | `.../outbound.html` | Full | profile, openid | Aggressive |
| count | `.../count.html` | Full | profile, openid | Aggressive |
| adjust | `.../adjust.html` | Full | profile, openid | Aggressive |
| return | `.../return.html` | Full | profile, openid | Aggressive |
| cancel | `.../cancel.html` | Full | profile, openid | Aggressive |
| owner | `.../owner.html` | Full | profile, openid | Aggressive |

- [x] copy 7 LIFF IDs
- [x] แก้ `Setup.gs::setupProperties()` ใส่ LIFF_ID_* ทั้ง 7 → รัน `setupProperties()` อีกครั้ง
- [x] rename admin → owner ทั้ง project (file/property/doc) + LIFF endpoint URL
- **Acceptance:** Properties มี LIFF_ID_INBOUND/OUTBOUND/COUNT/ADJUST/RETURN/CANCEL/OWNER ✅
- **LIFF IDs:**
  - inbound:  `2010039913-l3str31E`
  - outbound: `2010039913-qEVDVQCK`
  - count:    `2010039913-Mwxbowp7`
  - adjust:   `2010039913-Qh70XgVu`
  - return:   `2010039913-pbFfeqN5`
  - cancel:   `2010039913-qn27hLz0`
  - owner:    `2010039913-nqodMLew`

### TASK-06: เก็บ owner + supervisor LINE userId — **DEFERRED**
> Deferred to after Phase 5 — จะทำ get-userid flow ผ่าน bot follow event + dedicated LIFF page หลัง deploy
- [ ] (later) เปิด `liff/myid.html` ผ่าน LIFF inbound หรือใช้ bot follow event auto-reply userId
- [ ] (later) ให้ owner 2 คน + supervisor 1 คน เปิดและ copy userId
- [ ] (later) ใส่ Sheet `Config`:
  - row `owner_line_user_ids` = `Uxxx,Uyyy`
  - row `supervisor_line_user_ids` = `Uzzz`
- **Acceptance:** isOwner('Uxxx') === true, isSupervisor('Uzzz') === true

---

## Phase 3 — Apps Script foundation (มีไฟล์แล้ว)

### TASK-07: ตรวจ foundation ทำงาน — **DEFERRED**
> blocked โดย TASK-06 (ต้องมี owner userId ก่อนถึงทดสอบ pushToAllOwners ได้)
- [ ] (later) รัน `getConfig()` ใน Apps Script editor
- [ ] (later) ไม่มี error → return object มี SHEET_ID + LIFF_IDs + OWNER_LINE_USER_IDS
- [ ] (later) รัน `pushToAllOwners(['ทดสอบ push'])` → owner ได้ข้อความใน LINE
- **Acceptance:** ผ่าน 2 อย่างข้างบน

---

## Phase 4 — Apps Script endpoints (Implement TODOs)

### TASK-08: Submission.gs::handleCancelSubmission
- [x] รับ payload: `{ lineUserId, recordType, recordId, reason }`
- [x] เช็ค: row นี้มีจริง + lineUserId เป็น submitter1 หรือ submitter2 เอง + status ยัง pending_* + อยู่ใน window 5 นาที
- [x] update row: `status='cancelled', cancel_at, cancel_reason`
- [x] log info + dedup กัน double-tap
- [x] รองรับ 4 recordType: movement / count / return / cancel (return/cancel ใช้ staff_*)
- **Acceptance:** test ผ่าน LIFF (submit แล้ว undo ได้, ครบ 5 นาทีกดไม่ได้, คนอื่นกดของเราไม่ได้) — ⏳ test ทีหลังตอน LIFF พร้อม
- **Implemented errors:** missing_params, unknown_record_type, duplicate_request, not_found, not_pending, not_owner_of_submission, cancel_window_expired, invalid_submit_time, server_error

### TASK-09: Inbound.gs::handleSubmitInbound
- [x] dedup ผ่าน `dedupRecentSubmission_('inbound:' + lineUserId + ':' + productId + ':' + qty + ':r1|<movId>', 5)`
- [x] auto-register staff ถ้ายังไม่มี (Sheet Staff) — ผ่าน `autoRegisterStaff_()` ใน Utils.gs
- [x] **กรณีไม่มี pairingMovementId (รอบ 1):**
  - upload 4 รูป → photo_urls
  - insert Movements row: `status='pending_partner'`, submitter1_*, photo_urls
  - return: `{ ok: true, movementId, status: 'pending_partner' }`
- [x] **กรณีมี pairingMovementId (รอบ 2):**
  - validate: movement_type='inbound', status='pending_partner', submitter1 ≠ ตัวเอง, product ตรง
  - update submitter2_*, photo_urls (append)
  - **match qty:**
    - ตรง → status='confirmed', qty=submitter1_qty → `applyStockDelta_(+qty)` → push manager LINE
    - ไม่ตรง → status='pending_supervisor' → push supervisor LINE
- [x] shared helpers ใน Submission.gs: `applyStockDelta_` (LockService), `lookupProductName_`, `setCol_`, `findRowByIdCol_`, `safePushToAllManagers_` etc.
- **Acceptance:** ⏳ test ทีหลังตอน LIFF พร้อม

### TASK-10: Outbound.gs::handleSubmitOutbound
- [x] เหมือน Inbound แต่ apply Stock เป็น `qty_on_hand -= qty` + qty บันทึกเป็นลบใน Movements
- [x] ตรวจ qty_on_hand ก่อน apply: ถ้าไม่พอ → status='pending_supervisor' + push managers (insufficient_stock) + return error
- [x] เพิ่ม `readStockQty_(productId)` ใน Submission.gs
- **Acceptance:** ⏳ test ทีหลังตอน LIFF พร้อม

### TASK-11: Adjust.gs::handleSubmitAdjust
- [ ] เหมือน Inbound/Outbound แต่:
  - field `reason` บังคับ
  - apply Stock เป็น delta ติดลบ (ตัดออก)

### TASK-12: Count.gs::handleSubmitCount
- [ ] **ต่างจาก Movement:** ไม่ apply Stock อัตโนมัติ
- [ ] รอบ 1: snapshot `system_qty = Stock.qty_on_hand` ตอนนี้ → insert row
- [ ] รอบ 2: match → final_qty = submitter1_qty (ถ้าตรง)
  - variance = final_qty - system_qty
  - ถ้า variance === 0 → status='no_action' + push LINE manager
  - ถ้า variance ≠ 0 → status='awaiting_owner' + pushToAllManagers พร้อมปุ่มไป owner LIFF
- [ ] กรณีไม่ตรง → pending_supervisor (เหมือน movement)
- **Acceptance:** owner ได้ alert เฉพาะ variance ≠ 0

### TASK-13: Count.gs::handleSupervisorTiebreaker
- [ ] เช็ค `isSupervisor(lineUserId)` ก่อน
- [ ] รับ recordType + recordId + qty
- [ ] update supervisor_*, final_qty (= supervisor_qty), status
- [ ] ถ้าเป็น count → continue logic เช็ค variance (เหมือน TASK-12)
- [ ] ถ้าเป็น movement → apply Stock + status=confirmed
- **Acceptance:** หัวหน้าตัดสินแล้ว flow ต่อถูกต้อง

### TASK-14: Adjust.gs::handleAdjustStock (owner-initiated)
- [ ] เช็ค `isOwner(lineUserId)`
- [ ] รับ countId + deltaQty + reason
- [ ] insert Movement row (movement_type='adjust') — single submitter (owner เอง), ไม่ต้อง double-blind
- [ ] apply Stock (qty_on_hand += deltaQty)
- [ ] update Counts row: `status='resolved_by_adjust', owner_action_*`
- [ ] push confirmation LINE owner
- **Acceptance:** count variance หาย, Stock ตรง

### TASK-15: Return.gs::handleSubmitReturn
- [ ] dedup
- [ ] upload VDO + รูป (ถ้ามี)
- [ ] insert Returns row: status='pending_owner'
- [ ] pushToAllOwners flex card (มี VDO link + ปุ่ม approve/reject/forward)
- **Acceptance:** owner ได้ LINE flex พร้อมข้อมูลครบ

### TASK-16: Return.gs::handleApproveReturn
- [ ] เช็ค isOwner + status===pending_owner
- [ ] decision='accept_to_stock':
  - ตรวจ condition===good (ถ้า bad → reject อัตโนมัติ)
  - insert Movement (movement_type='return_in', qty=+) → apply Stock
  - update status='accepted'
- [ ] decision='reject_bad':
  - status='rejected', ไม่ apply Stock
- [ ] decision='forward_to_claim':
  - สร้าง Claim row (stage='submitting')
  - update Returns: status='forwarded_to_claim', claim_id
- [ ] reply LINE owner ว่าทำสำเร็จ

### TASK-17: Return.gs::handleUpdateClaimStage
- [ ] เช็ค isOwner
- [ ] รับ claimId + newStage + screenshot (base64) + closedResult?
- [ ] เช็ค transition ถูกต้อง (submitting→submitted→closed เท่านั้น)
- [ ] upload screenshot → Drive
- [ ] update Claim row

### TASK-18: Cancel.gs::handleSubmitCancel + handleApproveCancel
- [ ] submitCancel: insert Cancellations row + push owner
- [ ] approveCancel:
  - accept → insert Movement (cancel_in, +qty) → apply Stock → status='accepted'
  - reject → status='rejected'

### TASK-19: Owner.gs::handleOwnerDashboard
- [ ] เช็ค isOwner
- [ ] return:
  - `stock` = Sheet Stock (ทุก row)
  - `pending_returns` = Returns where status='pending_owner'
  - `pending_cancels` = Cancellations where status='pending_owner'
  - `pending_count_variance` = Counts where status='awaiting_owner'
  - `open_claims` = Claims where stage ≠ 'closed'
- **Acceptance:** dashboard LIFF render ครบ 5 section

### TASK-20: FlexCard.gs — สร้าง flex card 6 ตัว
- [ ] `buildVarianceAlertCard(count)` — count variance ≠ 0
- [ ] `buildPendingReturnCard(returnRow)` — มี VDO link + ปุ่ม
- [ ] `buildPendingCancelCard(cancelRow)`
- [ ] `buildSupervisorTiebreakerCard(record)` — ขอหัวหน้าตัดสิน
- [ ] `buildDailyReportCard(report)`
- [ ] `buildWeeklyReportCard(report)`
- [ ] ทุก card: header มี logo + brand, footer brand, ปุ่มเปิด owner LIFF
- [ ] ใช้ `driveUrlToThumbnail_` แปลง Drive URLs

### TASK-21: Report.gs::handleGetDailyReport + handleGetWeeklyReport
- [ ] daily: รวบ Movements ของวันนี้ (group by movement_type) + summary by_product
- [ ] weekly: เพิ่ม Counts ของสัปดาห์ + Returns + Cancellations ที่ closed

### TASK-22: Report.gs::sendDailyReport + sendWeeklyReport (scheduled)
- [ ] sendDailyReport: เรียก handleGetDailyReport + buildDailyReportCard + pushToAllManagers
- [ ] sendWeeklyReport: เรียก handleGetWeeklyReport + buildWeeklyReportCard + pushToAllOwners
- [ ] เพิ่ม `installTriggers()` ในชุด setup (ถ้ายังไม่ได้รัน)

---

## Phase 5 — LIFF frontend

### TASK-23: liff/index.html — landing
- [ ] หน้าแรกหลังเปิด rich menu
- [ ] แสดง 6 ปุ่มหลัก (รับเข้า / หยิบออก / นับเทียบ / ตัดสต๊อก / ตีคืน / ยกเลิก)
- [ ] แต่ละปุ่ม: `liff.openWindow({ url: '<page>.html', external: false })` หรือ link ตรง
- [ ] ปุ่มเจ้าของโผล่เฉพาะ owner/supervisor (เช็คผ่าน API getOwnerDashboard ถ้า ok=true)

### TASK-24: liff/inbound.html
- [ ] init LIFF (LIFF_ID_INBOUND) + getProfile
- [ ] เรียก `getProducts` → fill dropdown
- [ ] form: เลือกสินค้า + กรอก qty + ถ่ายรูป 4 มุม (กล้อง getUserMedia)
- [ ] toggle "รอบที่ 1" หรือ "รอบที่ 2 + ใส่ MOV-...":
  - รอบ 1: submit แสดง movement_id + ปุ่ม "คัดลอก ID"
  - รอบ 2: input MOV-... → submit ส่ง pairingMovementId
- [ ] หลัง submit: แสดงปุ่ม "ยกเลิกการบันทึก" countdown 5 นาที
- [ ] ทุก field validate ก่อน submit

### TASK-25: liff/outbound.html
- [ ] copy จาก inbound + เปลี่ยน LIFF_ID + action='submitOutbound'

### TASK-26: liff/count.html
- [ ] เหมือน inbound แต่ action='submitCount' + label "นับเทียบ"

### TASK-27: liff/adjust.html
- [ ] inbound + เพิ่ม textarea reason

### TASK-28: liff/return.html (ซับซ้อนสุด — มี VDO)
- [ ] form: tracking + เลือกสินค้า + qty + checkbox "เป็นสินค้าของเรา?"
- [ ] dropdown สภาพ (ดี / ไม่ดี)
- [ ] **VDO recorder:** MediaRecorder API, max 30s, encode webm/mp4
- [ ] preview VDO + ปุ่มถ่ายใหม่
- [ ] รูปประกอบ (optional)
- [ ] submit → action='submitReturn'

### TASK-29: liff/cancel.html
- [ ] form: tracking + สินค้า + qty + รูป
- [ ] simple — ไม่มี VDO ไม่มี double-blind
- [ ] submit → action='submitCancel'

### TASK-30: liff/owner.html (owner LIFF)
- [ ] init + เรียก getOwnerDashboard
- [ ] ถ้า return error='not_owner' → แสดง "คุณไม่มีสิทธิ์เข้าถึง"
- [ ] section 1: ยอดสต๊อก 5 SKU
- [ ] section 2: ตีคืนรอ approve — ดู VDO + ปุ่ม accept_to_stock / reject_bad / forward_to_claim
- [ ] section 3: ยกเลิกรอ approve — ปุ่ม accept / reject
- [ ] section 4: count variance รอปรับยอด — ปุ่ม "ปรับยอดให้ตรง" / "ไม่ปรับยอด"
- [ ] section 5: Claims ค้าง — ปุ่ม update stage
- [ ] section 6: report ปุ่มดู daily / weekly
- **Acceptance:** ทุก action submit แล้ว update dashboard ทันที

---

## Phase 6 — Deploy + ทดสอบ end-to-end

### TASK-31: Deploy Apps Script Web App
- [ ] Apps Script → Deploy → New deployment → Web app
- [ ] Execute as: Me / Who has access: **Anyone**
- [ ] copy URL → ใส่ใน:
  - `liff/js/config.js` API_URL
  - LINE Developers webhook URL

### TASK-32: GitHub Pages
- [ ] Create public repo `vorda-warehouse` (ถ้ายังไม่มี)
- [ ] push code → main
- [ ] Settings → Pages → Source: GitHub Actions (ดู `.github/workflows/pages.yml`)
- [ ] รอ Action เสร็จ → ได้ URL `https://<gh>.github.io/vorda-warehouse/`

### TASK-33: ปรับ LIFF Endpoint URL
- [ ] LINE Developers → Channel → LIFF → แต่ละ app → แก้ Endpoint URL = GitHub Pages URL จริง
- [ ] อย่าลืม owner.html ด้วย

### TASK-34: Rich menu
- [ ] รัน `scripts/setup_rich_menu.py` — แก้ LIFF_IDs ก่อนรัน
- [ ] ตรวจ rich menu ในมือถือ

### TASK-35: ทดสอบ end-to-end (มือถือจริง)
- [ ] รับเข้า: 2 พนักงาน double-blind ผ่าน — Stock update
- [ ] รับเข้า: นับไม่ตรง → หัวหน้าตัดสิน
- [ ] หยิบออก: Stock ลด
- [ ] หยิบออก: ของไม่พอ — ปฏิเสธ
- [ ] นับเทียบ: variance ≠ 0 → owner ได้ alert → กดปรับยอด → Stock ตรง
- [ ] ตัดสต๊อก: ของเสีย — Stock ลด
- [ ] ตีคืน: ของเรา + ดี — Stock เพิ่ม
- [ ] ตีคืน: ของเรา + ไม่ดี — Stock ไม่เปลี่ยน
- [ ] ตีคืน: ไม่ใช่ของเรา → claim 3 ขั้น
- [ ] ยกเลิก: tracking + รูป → owner approve → Stock เพิ่ม
- [ ] ยกเลิก submission ใน 5 นาที — ทำงาน
- [ ] ยกเลิก submission หลัง 5 นาที — ปฏิเสธ

---

## Phase 7 — Scheduled triggers

### TASK-36: install daily/weekly triggers
- [ ] รัน `Report.gs::installTriggers()` 1 ครั้ง
- [ ] verify Apps Script → Triggers tab มี 2 trigger
- [ ] รอวัน-เวลาจริง → ตรวจ LINE ส่งสรุปถูก

---

## Definition of Done
- [ ] ทุก task ติ๊กครบ
- [ ] Test ทุก flow ผ่านในมือถือจริง
- [ ] CONTEXT.md ตรงกับ implementation
- [ ] commit + push GitHub
- [ ] ส่ง LIFF URL ให้ owner/supervisor
