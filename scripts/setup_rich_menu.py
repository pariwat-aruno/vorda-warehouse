#!/usr/bin/env python3
"""
setup_rich_menu.py — สร้าง + อัปโหลด rich menu ของ vorda-warehouse

วิธีใช้:
    export LINE_CHANNEL_ACCESS_TOKEN="..."   # token จาก LINE Developers
    pip install Pillow
    python3 scripts/setup_rich_menu.py

idempotent: ถ้าเจอ rich menu ชื่อ "vorda-warehouse-main" อยู่แล้วจะลบทิ้งก่อน

Layout (2500x1686, 6 cells, 3 cols × 2 rows):
  [รับเข้า]   [หยิบออก]   [นับเทียบ]
  [ตัดสต๊อก]  [ตีคืน]     [ยกเลิก]

โน้ต: เจ้าของเข้าผ่าน direct LIFF URL หรือลิงก์ "ID ของฉัน" บนทุกหน้า
"""

import json
import os
import sys
import urllib.error
import urllib.request

from PIL import Image, ImageDraw, ImageFont

# ----- CONFIG — LIFF IDs ของ vorda-warehouse -----
LIFF_INBOUND  = "2010039913-l3str31E"
LIFF_OUTBOUND = "2010039913-qEVDVQCK"
LIFF_COUNT    = "2010039913-Mwxbowp7"
LIFF_ADJUST   = "2010039913-Qh70XgVu"
LIFF_RETURN   = "2010039913-pbFfeqN5"
LIFF_CANCEL   = "2010039913-qn27hLz0"
LIFF_OWNER    = "2010039913-nqodMLew"

MENU_NAME = "vorda-warehouse-main"
IMAGE_PATH = os.path.join(os.path.dirname(__file__), "rich_menu.png")
LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "liff", "img", "logo.jpg")

# ขนาด rich menu (LINE บังคับ 2500x843 หรือ 2500x1686) — เลือก 1686 สำหรับ 2 แถว
WIDTH = 2500
HEIGHT = 1686

# layout 3 cols × 2 rows
COLS = 3
ROWS = 2

# cherry red palette
CHERRY      = (200, 16, 46)
CHERRY_DARK = (154, 12, 36)
SLATE       = (55, 65, 81)

# 6 sections — รียงตามลำดับใช้งานบ่อย
SECTIONS = [
    {"label": "รับเข้า",   "sublabel": "จากโรงงาน",      "color": CHERRY,      "liff": LIFF_INBOUND},
    {"label": "หยิบออก",   "sublabel": "ไปแพคส่ง",       "color": CHERRY,      "liff": LIFF_OUTBOUND},
    {"label": "นับเทียบ",  "sublabel": "สัปดาห์ละครั้ง",  "color": CHERRY_DARK, "liff": LIFF_COUNT},
    {"label": "ตัดสต๊อก",  "sublabel": "ของเสีย/แตก",    "color": CHERRY_DARK, "liff": LIFF_ADJUST},
    {"label": "ตีคืน",     "sublabel": "ลูกค้าส่งคืน",    "color": SLATE,       "liff": LIFF_RETURN},
    {"label": "ยกเลิก",    "sublabel": "ของไม่ถึง",      "color": SLATE,       "liff": LIFF_CANCEL},
]

LINE_API = "https://api.line.me/v2/bot"
LINE_DATA_API = "https://api-data.line.me/v2/bot"


def get_token():
    token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")
    if not token:
        sys.exit("ERROR: ใส่ LINE_CHANNEL_ACCESS_TOKEN ก่อน")
    return token


def http_request(method, url, token, body=None, content_type="application/json"):
    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        else:
            data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if data is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8") or "{}"
            return json.loads(raw) if raw.strip().startswith(("{", "[")) else raw
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        sys.exit(f"HTTP {e.code} {url}\n{body}")


def _cell_rect(i):
    """return (x0, y0, x1, y1) ของ cell index i ใน grid COLS × ROWS"""
    cell_w = WIDTH // COLS
    cell_h = HEIGHT // ROWS
    col = i % COLS
    row = i // COLS
    x0 = col * cell_w
    y0 = row * cell_h
    x1 = (col + 1) * cell_w if col < COLS - 1 else WIDTH
    y1 = (row + 1) * cell_h if row < ROWS - 1 else HEIGHT
    return x0, y0, x1, y1


def render_image():
    """สร้างภาพ rich menu — COLS × ROWS grid"""
    img = Image.new("RGB", (WIDTH, HEIGHT), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    font_label = None
    font_sub = None
    for path in [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf",
        "/usr/share/fonts/truetype/tlwg/Loma.ttf",
        "C:/Windows/Fonts/leelawui.ttf",
    ]:
        if os.path.exists(path):
            font_label = ImageFont.truetype(path, 130)
            font_sub = ImageFont.truetype(path, 70)
            break
    if font_label is None:
        font_label = ImageFont.load_default()
        font_sub = ImageFont.load_default()

    # logo (top-left ของแต่ละ cell)
    logo = None
    if os.path.exists(LOGO_PATH):
        try:
            logo = Image.open(LOGO_PATH).convert("RGBA")
            logo.thumbnail((110, 110))
        except Exception:
            logo = None

    for i, sec in enumerate(SECTIONS):
        x0, y0, x1, y1 = _cell_rect(i)
        cell_w_actual = x1 - x0
        cell_h_actual = y1 - y0

        # background
        draw.rectangle([(x0, y0), (x1, y1)], fill=sec["color"])

        # divider lines (white, 4px) ระหว่าง cell
        if x0 > 0:
            draw.rectangle([(x0 - 2, y0), (x0 + 2, y1)], fill=(255, 255, 255))
        if y0 > 0:
            draw.rectangle([(x0, y0 - 2), (x1, y0 + 2)], fill=(255, 255, 255))

        # label (กลาง)
        label = sec["label"]
        bbox = draw.textbbox((0, 0), label, font=font_label)
        lw = bbox[2] - bbox[0]
        lh = bbox[3] - bbox[1]
        cx = x0 + cell_w_actual // 2
        ly = y0 + cell_h_actual // 2 - lh // 2 - 40
        draw.text((cx - lw // 2, ly), label, fill=(255, 255, 255), font=font_label)

        # sublabel
        sub = sec["sublabel"]
        bbox2 = draw.textbbox((0, 0), sub, font=font_sub)
        sw = bbox2[2] - bbox2[0]
        sy = ly + lh + 30
        draw.text((cx - sw // 2, sy), sub, fill=(255, 255, 255), font=font_sub)

        # logo top-left ของ cell
        if logo:
            img.paste(logo, (x0 + 40, y0 + 40), logo)

    img.save(IMAGE_PATH, "PNG")
    print(f"image saved: {IMAGE_PATH}")


def build_areas():
    """areas สำหรับ richMenu API — grid COLS × ROWS"""
    areas = []
    for i, sec in enumerate(SECTIONS):
        x0, y0, x1, y1 = _cell_rect(i)
        liff_url = f"line://app/{sec['liff']}"
        areas.append({
            "bounds": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
            "action": {"type": "uri", "uri": liff_url},
        })
    return areas


def delete_existing(token):
    """ถ้ามี rich menu ชื่อเดิม ให้ลบ"""
    res = http_request("GET", LINE_API + "/richmenu/list", token)
    for menu in res.get("richmenus", []):
        if menu.get("name") == MENU_NAME:
            menu_id = menu["richMenuId"]
            print(f"deleting existing: {menu_id}")
            http_request("DELETE", LINE_API + f"/richmenu/{menu_id}", token)


def create_richmenu(token):
    payload = {
        "size": {"width": WIDTH, "height": HEIGHT},
        "selected": True,
        "name": MENU_NAME,
        "chatBarText": "เมนูคลัง Vorda",
        "areas": build_areas(),
    }
    res = http_request("POST", LINE_API + "/richmenu", token, payload)
    menu_id = res["richMenuId"]
    print(f"created richmenu: {menu_id}")
    return menu_id


def upload_image(token, menu_id):
    with open(IMAGE_PATH, "rb") as f:
        body = f.read()
    http_request(
        "POST",
        LINE_DATA_API + f"/richmenu/{menu_id}/content",
        token,
        body=body,
        content_type="image/png",
    )
    print("image uploaded")


def set_default(token, menu_id):
    http_request("POST", LINE_API + f"/user/all/richmenu/{menu_id}", token)
    print("set as default for all users")


def main():
    if any(s["liff"] == "REPLACE_ME" for s in SECTIONS):
        sys.exit("ERROR: แก้ LIFF IDs ใน setup_rich_menu.py ก่อนรัน")

    token = get_token()
    render_image()
    delete_existing(token)
    menu_id = create_richmenu(token)
    upload_image(token, menu_id)
    set_default(token, menu_id)
    print("DONE — rich menu installed:", menu_id)


if __name__ == "__main__":
    main()
