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
- [x] เหมือน Inbound/Outbound แต่:
  - field `reason` บังคับ (เก็บลง Movements.reason)
  - apply Stock เป็น delta ติดลบ (ตัดออก)
  - pre-check stock พอตัดไหม — ถ้าไม่พอ → pending_supervisor
- [x] qty ใน Movements บันทึกเป็นลบ
- **Acceptance:** ⏳ test ทีหลังตอน LIFF พร้อม
- **owner-initiated `handleAdjustStock`** → จะทำใน TASK-14

### TASK-12: Count.gs::handleSubmitCount
- [x] **ต่างจาก Movement:** ไม่ apply Stock อัตโนมัติ
- [x] รอบ 1: snapshot `system_qty = Stock.qty_on_hand` ตอนนี้ → insert row
- [x] รอบ 2: match → final_qty = submitter1_qty (ถ้าตรง) → variance = final_qty - system_qty
  - variance === 0 → status='no_action' + push manager info
  - variance ≠ 0 → status='awaiting_owner' + push owner ให้กดปรับยอด
- [x] กรณีไม่ตรง → pending_supervisor + push supervisors
- [x] qty ตรวจนับยอมรับ 0 ได้ (นับแล้วของหมด)
- [x] payload key: `pairingCountId` (แทน pairingMovementId)
- **Acceptance:** ⏳ test ทีหลังตอน LIFF พร้อม

### TASK-13: Count.gs::handleSupervisorTiebreaker
- [x] เช็ค `isSupervisor(lineUserId)` ก่อน (return not_supervisor ถ้าไม่ผ่าน)
- [x] รับ recordType + recordId + qty (+ optional photos)
- [x] update supervisor_user_id/name/qty/at, photos append
- [x] **movement:** apply Stock ตาม movement_type (inbound=+, outbound/adjust=-) → status='confirmed' + push managers
  - pre-check stock พอไหม (สำหรับ outbound/adjust)
- [x] **count:** final_qty = supervisor_qty → variance = final_qty - system_qty
  - variance == 0 → status='no_action' + push managers
  - variance != 0 → status='awaiting_owner' + push owner
- **Acceptance:** ⏳ test ทีหลังตอน LIFF พร้อม

### TASK-14: Adjust.gs::handleAdjustStock (owner-initiated)
- [x] เช็ค `isOwner(lineUserId)` (return not_owner)
- [x] รับ countId + deltaQty (+/-) + reason
- [x] insert Movement row (movement_type='adjust', related_doc_id=countId, single-submitter=owner)
- [x] apply Stock (qty_on_hand += deltaQty) + pre-check ติดลบ
- [x] update Counts row: `status='resolved_by_adjust', owner_action_*`
- [x] push confirmation LINE owner
- **Acceptance:** ⏳ test end-to-end ตอน LIFF พร้อม

### TASK-15: Return.gs::handleSubmitReturn
- [x] dedup
- [x] upload VDO (required, anti-fraud) + รูป (optional)
- [x] insert Returns row: status='pending_owner' + is_our_product + condition
- [x] pushToAllOwners (text alert ตอนนี้ — flex card TASK-20)
- **Acceptance:** ⏳ test ทีหลังตอน LIFF พร้อม

### TASK-16: Return.gs::handleApproveReturn
- [x] เช็ค isOwner + status===pending_owner (with LockService 5s)
- [x] decision='accept_to_stock':
  - validate condition='good' AND isOurProduct=true (else cannot_accept_*)
  - insert Movement (return_in, +qty, related_doc_id=returnId) → apply Stock
  - update status='accepted'
- [x] decision='reject_bad': status='rejected', ไม่ apply Stock
- [x] decision='forward_to_claim': สร้าง Claim stage='submitting' + status='forwarded_to_claim' + claim_id
- [x] push owners confirmation
- [x] `handleRejectReturn` shortcut (decision=reject_bad)
- **Acceptance:** ⏳ test ทีหลังตอน LIFF พร้อม

### TASK-17: Return.gs::handleUpdateClaimStage
- [x] เช็ค isOwner
- [x] รับ claimId + newStage + screenshot (base64) + closedResult?
- [x] เช็ค transition: submitting→submitted (need screenshot) → closed (need screenshot + closedResult)
- [x] upload screenshot → Drive (return subfolder, filename `<claimId>-<stage>.jpg`)
- [x] update Claim row: stage, screenshot_*, closed_result (if closed), last_updated_*
- [x] push owners stage transition
- **Acceptance:** ⏳ test ทีหลังตอน LIFF พร้อม

### TASK-18: Cancel.gs::handleSubmitCancel + handleApproveCancel
- [x] submitCancel: validate + upload photos (≥1) + insert Cancellations row + push owner
- [x] approveCancel (LockService 5s + isOwner + status check):
  - accept → insert Movement (cancel_in, +qty, related_doc_id=cancelId) → apply Stock → status='accepted'
  - reject → status='rejected'
- [x] push owners confirmation
- **Acceptance:** ⏳ test ทีหลังตอน LIFF พร้อม

### TASK-19: Owner.gs::handleOwnerDashboard
- [x] เช็ค isOwner (return not_owner — frontend จัดการ)
- [x] return:
  - `stock` = Sheet Stock (active products + unit จาก Products) เฉพาะ active
  - `pending_returns` = Returns where status='pending_owner'
  - `pending_cancels` = Cancellations where status='pending_owner'
  - `pending_count_variance` = Counts where status='awaiting_owner'
  - `open_claims` = Claims where stage ≠ 'closed'
  - `generated_at` timestamp
- [x] serialize Date → ISO string สำหรับ JSON
- **Acceptance:** ⏳ test ผ่าน LIFF ตอน TASK-30

### TASK-20: FlexCard.gs — สร้าง flex card 6 ตัว
- [x] `buildVarianceAlertCard(count)` — count variance ≠ 0 + ปุ่มไป LIFF
- [x] `buildPendingReturnCard(returnRow)` — รูป hero + VDO link + ข้อมูลครบ
- [x] `buildPendingCancelCard(cancelRow)` — รูป hero + ข้อมูลครบ
- [x] `buildSupervisorTiebreakerCard(record, kind, typeLabel)` — รับทั้ง movement + count
- [x] `buildDailyReportCard(report)` — by_type + top 5 products + pending counts
- [x] `buildWeeklyReportCard(report)` — เพิ่ม counts/returns/claims/cancels summary
- [x] ทุก card: cherry red header + brand footer + ปุ่มเปิด owner LIFF (`https://liff.line.me/<LIFF_ID_OWNER>`)
- [x] ใช้ `driveUrlToThumbnail_` แปลง Drive URLs (hero รูปแรก, sz=w800)
- **Note:** ยังไม่ retrofit handlers (Inbound/Outbound/Adjust/Count/Return/Cancel ยังใช้ text) — จะ retrofit ตอน TASK-22 / TASK-30

### TASK-21: Report.gs::handleGetDailyReport + handleGetWeeklyReport
- [x] daily: รวบ Movements confirmed ของวันนี้ — by_type (inbound/outbound/adjust/return_in/cancel_in)
  + by_product (sort by |delta|) + pending counts (returns/cancels/count_variance)
- [x] weekly: + Counts สรุป group by status (total/no_action/resolved_by_adjust/awaiting_owner/...)
  + Returns + Cancellations + Claims (group by status/stage/closed_result)
- [x] helpers: `_datePartBangkok_`, `_weekPartBangkok_` (ISO week)
- [x] auth: owner หรือ supervisor เรียกได้ทั้งคู่
- **Acceptance:** ⏳ test ผ่าน LIFF ตอน TASK-30 / verify ผ่าน LINE owner command

### TASK-22: Report.gs::sendDailyReport + sendWeeklyReport (scheduled)
- [x] sendDailyReport: `_buildDailyReportData_()` + `buildDailyReportCard()` + `safePushToAllManagers_`
- [x] sendWeeklyReport: `_buildWeeklyReportData_()` + `buildWeeklyReportCard()` + `safePushToAllOwners_`
- [x] refactor: ดึง data builder ออกจาก handler (internal `_buildXxxReportData_`) เพื่อให้ trigger เรียกได้ไม่ต้อง auth
- [x] `installTriggers()` มีอยู่แล้ว (จะรันใน TASK-36)
- [x] test wrappers: `testSendDailyReport()`, `testSendWeeklyReport()`
- [x] **retrofit flex cards ใน handlers:**
  - Inbound/Outbound/Adjust mismatch → `buildSupervisorTiebreakerCard(record, 'movement', label)`
  - Count mismatch → `buildSupervisorTiebreakerCard(record, 'count', 'ตรวจนับ')`
  - Count awaiting_owner (รอบ 2 + tiebreaker path) → `buildVarianceAlertCard()`
  - submitReturn → `buildPendingReturnCard()`
  - submitCancel → `buildPendingCancelCard()`

---

## Phase 5 — LIFF frontend

### TASK-23: liff/index.html — landing
- [x] หน้าแรกหลังเปิด rich menu
- [x] แสดง 6 ปุ่มหลัก (รับเข้า / เตรียมแพ็ค / ตรวจนับ / เสียหาย / ตีคืน / ยกเลิก)
- [x] แต่ละปุ่ม: anchor link ตรงไป <page>.html
- [x] ปุ่มเจ้าของโผล่เฉพาะ owner (เช็คผ่าน getOwnerDashboard — ok=true แสดง)

### TASK-24..27: liff/{inbound,outbound,count,adjust}.html
- [x] **Shared:** `liff/js/movementForm.js` — auth + getProducts dropdown + round toggle + photo capture (4 รูป) + submit + undo countdown
- [x] inbound.html: action=submitInbound, idPrefix=MOV-, no reason
- [x] outbound.html: action=submitOutbound, idPrefix=MOV-, no reason
- [x] count.html: action=submitCount, idPrefix=CNT-, allowZeroQty (ของหมดได้)
- [x] adjust.html: action=submitAdjust, idPrefix=MOV-, hasReason=true (textarea)
- [x] หลัง submit แสดง movement_id + ปุ่มคัดลอก + countdown 5 นาที + ปุ่มยกเลิก

### TASK-28: liff/return.html (ซับซ้อนสุด — มี VDO)
- [x] form: tracking + checkbox "เป็นสินค้าของเรา?" + (ถ้าใช่: dropdown + qty + radio condition / ถ้าไม่ใช่: textbox ชื่อสินค้า + qty)
- [x] **VDO recorder:** MediaRecorder API, picks mp4/webm by isTypeSupported, max 30s (auto-stop)
- [x] preview VDO + ปุ่มอัดใหม่
- [x] submit → action='submitReturn' (videoBase64 required, photos[] empty for v1)
- [x] หลัง submit: undo bar 5 นาที (recordType='return')

### TASK-29: liff/cancel.html
- [x] form: tracking + สินค้า + qty + รูปอย่างน้อย 1 (max 4)
- [x] no VDO, no double-blind
- [x] submit → action='submitCancel' + undo bar 5 นาที (recordType='cancel')

### TASK-30: liff/owner.html (owner LIFF)
- [x] init + เรียก getOwnerDashboard
- [x] ถ้า error='not_owner' → แสดง "คุณไม่มีสิทธิ์เข้าถึง"
- [x] section 1: ยอดสต๊อก (table)
- [x] section 2: ตีคืนรอ approve — VDO link + 3 ปุ่ม (accept_to_stock disabled ถ้า bad / ไม่ใช่ของเรา)
- [x] section 3: ยกเลิกรอ approve — 2 ปุ่ม (accept / reject)
- [x] section 4: count variance — ปุ่ม "ปรับยอดให้ตรง (+/-N)"
- [x] section 5: Claims open — ปุ่ม update stage (file picker → resize → base64)
- [x] section 6: รายงาน daily / weekly (preview ข้อความ)
- [x] ทุก action: confirm → API → reload dashboard
- **Acceptance:** ⏳ test end-to-end (TASK-35)

---

## Phase 6 — Deploy + ทดสอบ end-to-end

### TASK-31: Deploy Apps Script Web App
- [x] Apps Script → Deploy → New deployment → Web app
- [x] Execute as: Me / Who has access: **Anyone**
- [x] copy URL → ใส่ใน `liff/js/config.js` API_URL
- [x] verify: doGet returns `{"ok":true,"service":"vorda-warehouse","now":...}`
- [ ] LINE Developers webhook URL — รอ owner userIds ก่อนใช้ (TASK-06 deferred)
- **URL:** `https://script.google.com/macros/s/AKfycbwLmaNaopejgR2gIKSY3nm1MBHLIcfLw06_KiLx7Tn08MShl8yOZNAIBP4IjYF_BGdw/exec`

### TASK-32: GitHub Pages
- [x] Create public repo `vorda-warehouse` (gh repo create)
- [x] push code → main
- [x] Settings → Pages → Source: GitHub Actions (`.github/workflows/pages.yml`) — enabled via API
- [x] Action เสร็จ + verify HTTP 200 ที่ index + myid
- **Repo:** https://github.com/pariwat-aruno/vorda-warehouse
- **Pages URL:** https://pariwat-aruno.github.io/vorda-warehouse/

### TASK-33: ปรับ LIFF Endpoint URL
- [x] LINE Developers → Channel → LIFF → แต่ละ app → แก้ Endpoint URL = `pariwat-aruno.github.io/vorda-warehouse/...`
- [x] รวม owner.html ด้วย (เดิมตั้งเป็น admin.html)

### TASK-34: Rich menu
- [x] copy `LOGO_VORDA (2).jpg` → `liff/img/logo.jpg`
- [x] รัน `scripts/setup_rich_menu.py` (LIFF_IDs ใส่ไว้แล้ว) — image generated + uploaded
- [x] richmenu set as default for all users (id: `richmenu-94fb34af05431309e307a8a0602b67c6`)
- [x] **LINE webhook URL ตั้งผ่าน API** (PUT /v2/bot/channel/webhook/endpoint) แทนกด UI
- [ ] ตรวจ rich menu ในมือถือ (ทดสอบใน TASK-35)

### TASK-35: ทดสอบ end-to-end (มือถือจริง)
- [ ] รับเข้า: 2 พนักงาน double-blind ผ่าน — Stock update
- [ ] รับเข้า: นับไม่ตรง → หัวหน้าตัดสิน
- [ ] เตรียมแพ็ค: Stock ลด
- [ ] เตรียมแพ็ค: ของไม่พอ — ปฏิเสธ
- [ ] ตรวจนับ: variance ≠ 0 → owner ได้ alert → กดปรับยอด → Stock ตรง
- [ ] เสียหาย: ของเสีย — Stock ลด
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
