# Vorda Warehouse

ระบบคลังสินค้า Vorda Skincare — บันทึกทุก movement (รับเข้า/หยิบออก/ตัดสต๊อก/ตีคืน/ยกเลิก) แบบ double-blind 2 คน + นับเทียบรายสัปดาห์ พร้อม approve flow ผ่าน LINE

**Stack:** GitHub Pages (LIFF) + Apps Script (API) + Google Sheet (DB) + LINE Messaging API + Drive (storage)

---

## ขั้นตอน setup (สำหรับ Claude Code / dev)

### 1. อ่านเอกสารตามลำดับ
- [CLAUDE.md](CLAUDE.md) — recipe + gotchas + workflow (อ่านก่อนเสมอ)
- [CONTEXT.md](CONTEXT.md) — domain glossary + data model + roles
- [docs/architecture.md](docs/architecture.md) — 6 flows + edge cases
- [TASKS.md](TASKS.md) — 36 tasks ทำตามลำดับ

### 2. เริ่ม setup ตาม TASKS.md
- TASK-01 ถึง TASK-07: setup foundation
- TASK-08 ถึง TASK-22: implement Apps Script flows
- TASK-23 ถึง TASK-30: implement LIFF frontend
- TASK-31 ถึง TASK-36: deploy + test

---

## โครงสร้าง

```
vorda-warehouse/
├── CLAUDE.md              # recipe + gotchas (Claude อ่านก่อน)
├── CONTEXT.md             # glossary + data model + roles
├── TASKS.md               # 36 tasks ตาม phase
├── README.md              # ไฟล์นี้
├── docs/architecture.md   # 6 flows + edge cases
├── apps-script/           # backend (Apps Script + clasp)
├── liff/                  # frontend (GitHub Pages)
├── scripts/               # rich menu setup
└── .github/workflows/     # auto-deploy GitHub Pages
```

---

## Flow โดยย่อ

| Flow | ใครทำ | Double-blind? | รูป | VDO |
|---|---|---|---|---|
| รับเข้าจากโรงงาน | staff 2 คน | ✅ | 4 มุม | — |
| หยิบออกไปแพค | staff 2 คน | ✅ | 4 มุม | — |
| นับเทียบ (สัปดาห์ละครั้ง) | staff 2 คน | ✅ | 4 มุม | — |
| ตัดสต๊อก ของเสีย | staff 2 คน | ✅ | 4 มุม | — |
| ตีคืนสินค้า | staff 1 + owner approve | — | optional | ✅ ตอนแกะ |
| ยกเลิกออเดอร์ | staff 1 + owner approve | — | บังคับ | — |
| ตัดสินกรณีนับไม่ตรง | supervisor | — | — | — |
| ปรับยอดหลัง count | owner | — | — | — |

---

## Roles

| Role | จำนวน | LINE userId เก็บที่ |
|---|---|---|
| พนักงานคลัง | 2 | Sheet `Staff` (auto-register ตอน submit ครั้งแรก) |
| หัวหน้าคลัง | 1 | Sheet `Config` row `supervisor_line_user_ids` |
| เจ้าของ | 2 | Sheet `Config` row `owner_line_user_ids` |

---

## รายงาน

- **รายวัน** ทุกวัน 18:00 → LINE หัวหน้า + เจ้าของ
- **รายสัปดาห์** เสาร์ 18:10 → LINE เจ้าของ
- **Real-time alerts:**
  - นับ double-blind ไม่ตรง → หัวหน้า
  - count variance ≠ 0 → เจ้าของ
  - มีตีคืน/ยกเลิกรอ approve → เจ้าของ

---

## License

Internal use — Vorda Skincare
