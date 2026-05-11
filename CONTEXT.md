# CONTEXT.md — Vorda Warehouse

> **สำคัญ:** AI / Claude Code ต้องอ่านไฟล์นี้ก่อนทำงานบน project นี้ทุกครั้ง
> ห้ามใช้ศัพท์ที่ไม่ตรงกับที่จดไว้ในนี้

---

## 1. Project Identity

- **ชื่อ:** `vorda-warehouse`
- **ชื่อไทย:** ระบบคลังสินค้า Vorda (double-blind audit)
- **Description:** บันทึกทุก movement (เข้า/ออก/ตัด/คืน/ยกเลิก) แบบ double-blind 2 คน + ตรวจนับรายสัปดาห์ พร้อม approve flow สำหรับ owner
- **Type:** Mini app (ไม่ใช่ enterprise)
- **Stack:** Google Sheet + Apps Script + LINE Messaging API + LIFF + GitHub Pages
- **บริษัท:** บริษัท วอร์ด้า สกินแคร์ จำกัด (Vorda Skincare)
- **เชื่อมต่อกับ:** ใบเตรียมจาก `vorda-shipping-organizer` (อ้าง tracking number ใน Returns/Cancellations)

---

## 2. Glossary — ศัพท์ที่ใช้ใน project นี้

| คำที่ใช้ในระบบ | คำเทคนิค (ห้ามใช้) | ความหมาย |
|---|---|---|
| **สินค้า** | product / item / SKU | สินค้าในคลัง (5 SKU) |
| **ยอดคงเหลือ** | quantity on hand / stock | จำนวนสินค้าในคลังตอนนี้ |
| **รับเข้า** | inbound / receive | ของจากโรงงานเข้าคลัง |
| **หยิบออก** | outbound / pick | หยิบของออกไปแพคส่งลูกค้า |
| **ตรวจนับ** | count / audit | นับสต๊อกจริงเทียบกับยอดในระบบ (สัปดาห์ละครั้ง) |
| **ส่วนต่าง** | variance / discrepancy | ยอดนับจริง − ยอดในระบบ |
| **เสียหาย** | adjust / write-off | ตัดของเสีย/แตก/หาย ออกจากสต๊อก |
| **ตีคืน** | return | ลูกค้าส่งของกลับมา (มี VDO + ตรวจสภาพ) |
| **ยกเลิก** | cancel / RTS | ออเดอร์ยกเลิก ของไม่ถึงปลายทางตีกลับ (ของไม่ได้แกะ) |
| **เคลม** | claim | ของไม่ใช่ของเรา → ส่งคืน supplier ผ่าน flow 3 ขั้น |
| **double-blind** | — | 2 คนกรอกแยกคนละครั้ง โดยไม่เห็นเลขของกัน |
| **คนนับ 1 / คนนับ 2** | submitter1 / submitter2 | พนักงาน 2 คนกรอกฟอร์มเดียวกัน |
| **หัวหน้าคลัง** | supervisor / manager | ตัดสินกรณี double-blind นับไม่ตรง |
| **เจ้าของ** | owner | approve คืน/ยกเลิก, ปรับยอด, รับสรุปรายสัปดาห์ |
| **พนักงานคลัง** | staff / worker | กรอกฟอร์มทั่วไป |
| **ปุ่มยกเลิก** | undo / soft cancel | ยกเลิก submission ที่เพิ่งกรอก ภายใน 5 นาที |

**กฎ:** ใน code, comment, doc, message ทั้งหมดให้ใช้คอลัมน์ซ้าย ห้ามใช้คอลัมน์กลางเด็ดขาด (ตัวแปรในโค้ดอังกฤษได้แต่ map ตรงกัน)

---

## 3. Roles & Permissions

| Role | จำนวน | LIFF apps ที่ใช้ | ทำอะไรได้ | ทำไม่ได้ |
|---|---|---|---|---|
| **พนักงานคลัง** | 2 | inbound / outbound / count / adjust / return / cancel | กรอกฟอร์มทุกอย่าง, ยกเลิก submission ของตัวเอง 5 นาที | approve, ปรับยอด, ดู dashboard |
| **หัวหน้าคลัง** | 1 | ทุกอย่างของ staff + รับ LINE alert | + ตัดสิน double-blind นับไม่ตรง | approve คืน/ยกเลิก |
| **เจ้าของ** | 2 | ทุก LIFF + owner.html | + approve คืน/ยกเลิก, ปรับยอดหลัง count, update claim stage, รับรายงาน | — |

**กฎเข้าระบบ:**
- ทุกคนระบุตัวตนด้วย LINE User ID (จาก LIFF) — ไม่มี password
- เจ้าของระบุใน Sheet Config row `owner_line_user_ids` (comma-separated)
- หัวหน้าคลังระบุใน Sheet Config row `supervisor_line_user_ids` (comma-separated)
- พนักงานคลังไม่ต้องระบุล่วงหน้า — ระบบ `findStaffByLineUserId` ค้นจาก Sheet `Staff` ถ้าไม่เจอ → auto-register row ใหม่ตอน submit ครั้งแรก

---

## 4. Data Model

### Sheet: `Products` — master สินค้า
| Column | Type | ตัวอย่าง | หมายเหตุ |
|---|---|---|---|
| `product_id` | string | `SKU-01` | primary key |
| `product_name` | string | `เซรั่มหน้าใส 30ml` | |
| `unit` | string | `ชิ้น` / `ขวด` / `ลัง` | |
| `opening_balance` | number | `100` | Stock Take ครั้งแรก |
| `opening_set_at` | datetime | ISO 8601 +07:00 | |
| `is_active` | boolean | `TRUE` | |

### Sheet: `Stock` — ยอดคงเหลือปัจจุบัน (1 row per SKU)
| Column | Type | หมายเหตุ |
|---|---|---|
| `product_id` | string | FK Products |
| `product_name` | string | denormalized |
| `qty_on_hand` | number | update ทุก movement confirmed |
| `last_movement_id` | string | reference |
| `last_movement_at` | datetime | |
| `updated_at` | datetime | |

### Sheet: `Movements` — ทุก movement
| Column | Type | หมายเหตุ |
|---|---|---|
| `movement_id` | string | `MOV-YYYYMMDD-XXXX` |
| `movement_type` | enum | `inbound` / `outbound` / `adjust` / `return_in` / `cancel_in` |
| `product_id` | string | |
| `product_name` | string | |
| `qty` | number | + เข้า, - ออก |
| `reason` | string | (เฉพาะ adjust + return + cancel) |
| `related_doc_id` | string | `RET-...` / `CXL-...` |
| `submitter1_user_id` | string | LINE userId คนกรอก 1 |
| `submitter1_name` | string | |
| `submitter1_qty` | number | ยอดที่คนที่ 1 กรอก |
| `submitter1_at` | datetime | |
| `submitter2_user_id` | string | (ถ้ามี — double-blind) |
| `submitter2_name` | string | |
| `submitter2_qty` | number | |
| `submitter2_at` | datetime | |
| `supervisor_user_id` | string | (ถ้านับไม่ตรง) |
| `supervisor_name` | string | |
| `supervisor_qty` | number | ยอดที่หัวหน้าตัดสิน |
| `supervisor_at` | datetime | |
| `photo_urls` | string | comma-separated Drive URLs |
| `status` | enum | `pending_partner` / `pending_supervisor` / `confirmed` / `cancelled` |
| `cancel_at` | datetime | (ถ้ายกเลิก 5 นาที) |
| `cancel_reason` | string | |
| `created_at` | datetime | |
| `confirmed_at` | datetime | |

### Sheet: `Counts` — ตรวจนับสัปดาห์ละครั้ง
| Column | Type | หมายเหตุ |
|---|---|---|
| `count_id` | string | `CNT-YYYYMMDD-XXXX` |
| `product_id`, `product_name` | | |
| `system_qty` | number | snapshot Stock.qty_on_hand ตอนนับ |
| `submitter1_*` ... | | เหมือน Movements |
| `submitter2_*` ... | | |
| `supervisor_*` ... | | |
| `photo_urls` | string | 4 มุม |
| `final_qty` | number | ยอดที่ตกลงสุดท้าย |
| `variance` | number | `final_qty - system_qty` |
| `status` | enum | `pending_partner` / `pending_supervisor` / `awaiting_owner` / `resolved_by_adjust` / `no_action` / `cancelled` |
| `owner_action_user_id` | string | (ถ้า variance ≠ 0 และ owner กดปรับยอด) |
| `owner_action_at` | datetime | |
| `cancel_at`, `cancel_reason` | | |
| `created_at` | datetime | |

### Sheet: `Returns` — ตีคืนสินค้า + เคลม
| Column | Type | หมายเหตุ |
|---|---|---|
| `return_id` | string | `RET-YYYYMMDD-XXXX` |
| `tracking_number` | string | เลข tracking ออเดอร์ |
| `product_id`, `product_name`, `qty` | | |
| `is_our_product` | boolean | TRUE = ของเรา |
| `condition` | enum | `good` / `bad` |
| `video_url` | string | VDO ตอนแกะ |
| `photo_urls` | string | |
| `staff_*` | | คนกรอก |
| `owner_*` | | คน approve |
| `owner_decision` | enum | `accept_to_stock` / `reject_bad` / `forward_to_claim` |
| `claim_id` | string | (ถ้า forward) |
| `status` | enum | `pending_owner` / `accepted` / `rejected` / `forwarded_to_claim` / `cancelled` |
| `cancel_at`, `cancel_reason` | | |
| `created_at` | datetime | |

### Sheet: `Cancellations` — ยกเลิกออเดอร์
| Column | Type | หมายเหตุ |
|---|---|---|
| `cancel_id` | string | `CXL-YYYYMMDD-XXXX` |
| `tracking_number`, `product_id`, `product_name`, `qty` | | |
| `photo_urls` | string | |
| `staff_*`, `owner_*` | | |
| `status` | enum | `pending_owner` / `accepted` / `rejected` / `cancelled` |
| `cancel_at`, `cancel_reason` | | |
| `created_at` | datetime | |

### Sheet: `Claims` — flow เคลม 3 ขั้น
| Column | Type | หมายเหตุ |
|---|---|---|
| `claim_id` | string | `CLM-YYYYMMDD-XXXX` |
| `return_id` | string | FK Returns |
| `tracking_number` | string | |
| `stage` | enum | `submitting` / `submitted` / `closed` |
| `screenshot_submitting` | string | Drive URL |
| `screenshot_submitted` | string | |
| `screenshot_closed` | string | |
| `closed_result` | enum | `success` / `fail` |
| `last_updated_user_id` | string | |
| `last_updated_at` | datetime | |
| `created_at` | datetime | |

### Sheet: `Staff` — รายชื่อคนใช้ระบบ
| Column | Type | หมายเหตุ |
|---|---|---|
| `staff_id` | string | `S-001` |
| `name` | string | จาก LINE displayName |
| `role` | enum | `staff` / `supervisor` / `owner` |
| `line_user_id` | string | unique |
| `is_active` | boolean | |
| `registered_at` | datetime | |

### Sheet: `Logs` — error + audit (มาตรฐาน)
| `timestamp` | `level` | `function` | `message` | `payload` |

### Sheet: `Config` — ค่าตั้งระบบ
| key | value (ตัวอย่าง) | description |
|---|---|---|
| `owner_line_user_ids` | `Uxxx,Uyyy` | comma-separated |
| `supervisor_line_user_ids` | `Uzzz` | comma-separated |
| `report_daily_time` | `18:00` | |
| `report_weekly_day` | `Saturday` | |
| `report_weekly_time` | `18:10` | |
| `cancel_window_seconds` | `300` | 5 นาที |
| `count_min_photos` | `4` | 4 มุม |

---

## 5. Conventions

1. **ภาษา:** Comment ไทย, ตัวแปร/function อังกฤษ
2. **Error handling:** ทุก function Apps Script try-catch + log Sheet `Logs`
3. **Idempotent:** setup functions รันซ้ำได้ปลอดภัย, submit ซ้ำใน 5 วินาที = no-op
4. **Timeout:** Apps Script ต้องจบใน 6 นาที (กังวล: VDO upload 30 วินาที + 4 รูป)
5. **Secrets:** Script Properties (LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, SHEET_ID, DRIVE_FOLDER_ID, LIFF_IDs) — ห้ามใส่ใน code
6. **Time zone:** Asia/Bangkok ISO 8601 +07:00
7. **ID format:** `<PREFIX>-YYYYMMDD-XXXX` running per day
8. **Image storage:** Drive folder + URL ใน Sheet (ห้าม base64 ในเซลล์)
9. **Multi-owner / multi-supervisor:** Sheet Config (comma-separated)
10. **Camera:** ห้ามให้ user เลือกรูปจาก gallery — `getUserMedia` + `captureFromVideoWithStamp` เท่านั้น

---

## 6. State machines

### Movements (inbound / outbound / adjust)
```
[คนที่ 1 submit] → status=pending_partner
                → (ถ้ากดยกเลิก 5 นาที) → status=cancelled

[คนที่ 2 submit + match qty]
   ↓ ตรง        → status=confirmed → apply Stock + push LINE manager
   ↓ ไม่ตรง     → status=pending_supervisor → push LINE หัวหน้า
                 ↓
              [หัวหน้า submitSupervisorTiebreaker]
                 → status=confirmed (qty=supervisor_qty) → apply Stock
```

### Counts
```
เหมือน Movement แต่ตอนสุดท้าย:
   final_qty = system_qty?  → status=no_action (ไม่กระทบ Stock)
            ≠ system_qty?  → status=awaiting_owner → push LINE owner
                              ↓
                           [owner adjustStock] → insert Movement (adjust)
                              → status=resolved_by_adjust
```

### Returns
```
[staff submit (is_our_product, condition)] → status=pending_owner
                                            → push LINE owner

[owner approveReturn]
   decision=accept_to_stock (good) → insert Movement (return_in, +qty) → status=accepted
   decision=reject_bad             → status=rejected (ไม่กระทบ Stock)
   decision=forward_to_claim       → สร้าง Claim row stage=submitting → status=forwarded_to_claim

[owner updateClaimStage]
   submitting → submitted (ใส่ screenshot_submitted)
   submitted  → closed    (ใส่ screenshot_closed + closed_result)
```

### Cancellations
```
[staff submit] → status=pending_owner
              → push LINE owner

[owner approveCancel]
   accept → insert Movement (cancel_in, +qty) → status=accepted
   reject → status=rejected
```

---

## 7. ห้ามทำ (Out of Scope)

- ❌ Authentication เกินกว่า LINE Login
- ❌ Real-time websocket
- ❌ Mobile native app
- ❌ Custom domain / SSL ของตัวเอง
- ❌ เปลี่ยน stack เป็น Firebase / Supabase / AWS
- ❌ Barcode / QR scanner
- ❌ Multi-warehouse
- ❌ Lot number / วันหมดอายุ / ที่เก็บในคลัง (ตัดออกจาก Brief)
- ❌ มากกว่า 5 SKU
- ❌ เชื่อมตรง TikTok Shop / Shopee / e-commerce

ถ้าขอเหล่านี้ → "ออก scope mini app — Phase 2"

---

## 8. Brand & UI

- Logo: `liff/img/logo.jpg` (ใส่เพิ่ม)
- ชื่อ: บริษัท วอร์ด้า สกินแคร์ จำกัด
- Palette: cherry red (`#c8102e` primary / `#9a0c24` dark)
- Style: minimal professional — **ห้าม emoji** (ยกเว้น `⚠️` สำหรับ warning)
- ทุก LIFF page: logo + brand text + footer brand
- ทุก flex card: header มี logo + brand
