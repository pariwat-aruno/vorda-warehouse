#!/usr/bin/env python3
"""
setup_rich_menu.py — สร้าง + อัปโหลด rich menu ของ vorda-warehouse

วิธีใช้:
    export LINE_CHANNEL_ACCESS_TOKEN="..."   # token จาก LINE Developers
    pip install Pillow
    python3 scripts/setup_rich_menu.py

idempotent: ถ้าเจอ rich menu ชื่อ "vorda-warehouse-main" อยู่แล้วจะลบทิ้งก่อน

Layout (2500x843, 4 cells):
  [รับเข้า] [หยิบออก] [รายการอื่น] [เจ้าของ]

โน้ต: "รายการอื่น" เปิด LIFF index.html ที่มี 4 ปุ่มย่อย (count/adjust/return/cancel)
แทนที่จะใส่ทุกปุ่มใน rich menu (rich menu มีพื้นที่จำกัด)
"""

import json
import os
import sys
import urllib.error
import urllib.request

from PIL import Image, ImageDraw, ImageFont

# ----- CONFIG — LIFF IDs ของ vorda-warehouse -----
LIFF_INBOUND  = "2010039913-l3str31E"  # LIFF_ID_INBOUND
LIFF_OUTBOUND = "2010039913-qEVDVQCK"  # LIFF_ID_OUTBOUND
LIFF_INDEX    = "2010039913-l3str31E"  # shared กับ inbound (index.html ยังไม่มี LIFF แยก)
LIFF_OWNER    = "2010039913-nqodMLew"  # LIFF_ID_OWNER

MENU_NAME = "vorda-warehouse-main"
IMAGE_PATH = os.path.join(os.path.dirname(__file__), "rich_menu.png")
LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "liff", "img", "logo.jpg")

# ขนาดมาตรฐาน rich menu (LINE บังคับ 2500x843 หรือ 2500x1686)
WIDTH = 2500
HEIGHT = 843

# cherry red palette — บริษัท วอร์ด้า สกินแคร์ จำกัด
# 4 sections — ปุ่มเจ้าของขวาสุด สีเข้มเพื่อแยกชัด
SECTIONS = [
    {"label": "รับเข้า",     "sublabel": "จากโรงงาน",     "color": (200, 16, 46),  "liff": LIFF_INBOUND},
    {"label": "หยิบออก",     "sublabel": "ไปแพคส่ง",      "color": (200, 16, 46),  "liff": LIFF_OUTBOUND},
    {"label": "รายการอื่น",  "sublabel": "นับ/ตัด/คืน",   "color": (154, 12, 36),  "liff": LIFF_INDEX},
    {"label": "เจ้าของ",     "sublabel": "ผู้บริหารเท่านั้น","color": (55, 65, 81),   "liff": LIFF_OWNER},
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


def render_image():
    """สร้างภาพ rich menu — 4 cells แบ่งแนวนอน"""
    img = Image.new("RGB", (WIDTH, HEIGHT), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    # font — fallback หาฟอนต์ไทยที่มี
    font_label = None
    font_sub = None
    for path in [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf",
        "/usr/share/fonts/truetype/tlwg/Loma.ttf",
        "C:/Windows/Fonts/leelawui.ttf",
    ]:
        if os.path.exists(path):
            font_label = ImageFont.truetype(path, 90)
            font_sub = ImageFont.truetype(path, 50)
            break
    if font_label is None:
        font_label = ImageFont.load_default()
        font_sub = ImageFont.load_default()

    # logo (ถ้ามี) — แสดงตรงกลางบน เป็น watermark จางๆ
    if os.path.exists(LOGO_PATH):
        try:
            logo = Image.open(LOGO_PATH).convert("RGBA")
            logo.thumbnail((140, 140))
        except Exception:
            logo = None
    else:
        logo = None

    cell_w = WIDTH // len(SECTIONS)
    for i, sec in enumerate(SECTIONS):
        x0 = i * cell_w
        x1 = (i + 1) * cell_w if i < len(SECTIONS) - 1 else WIDTH
        # background
        draw.rectangle([(x0, 0), (x1, HEIGHT)], fill=sec["color"])

        # label (กลาง)
        label = sec["label"]
        bbox = draw.textbbox((0, 0), label, font=font_label)
        lw = bbox[2] - bbox[0]
        lh = bbox[3] - bbox[1]
        cx = x0 + (cell_w if i < len(SECTIONS) - 1 else (WIDTH - x0)) // 2
        ly = HEIGHT // 2 - lh // 2 - 30
        draw.text((cx - lw // 2, ly), label, fill=(255, 255, 255), font=font_label)

        # sublabel
        sub = sec["sublabel"]
        bbox2 = draw.textbbox((0, 0), sub, font=font_sub)
        sw = bbox2[2] - bbox2[0]
        sh = bbox2[3] - bbox2[1]
        sy = ly + lh + 20
        draw.text((cx - sw // 2, sy), sub, fill=(255, 255, 255, 220), font=font_sub)

        # logo top-left ของ cell
        if logo:
            img.paste(logo, (x0 + 30, 30), logo)

    img.save(IMAGE_PATH, "PNG")
    print(f"image saved: {IMAGE_PATH}")


def build_areas():
    """สร้าง areas สำหรับ richMenu API — 4 cells แบ่งแนวนอน"""
    cell_w = WIDTH // len(SECTIONS)
    areas = []
    for i, sec in enumerate(SECTIONS):
        x = i * cell_w
        w = cell_w if i < len(SECTIONS) - 1 else WIDTH - x
        liff_url = f"line://app/{sec['liff']}"
        areas.append({
            "bounds": {"x": x, "y": 0, "width": w, "height": HEIGHT},
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
