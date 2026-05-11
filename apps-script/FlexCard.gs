/**
 * FlexCard.gs — LINE flex message builders
 *
 *   - buildVarianceAlertCard(count): ตรวจนับไม่ตรงระบบ → push owner
 *   - buildPendingReturnCard(returnRow): ตีคืนรอ approve
 *   - buildPendingCancelCard(cancelRow): ยกเลิกรอ approve
 *   - buildSupervisorTiebreakerCard(record, kind): นับ 2 คนไม่ตรง → หัวหน้าตัดสิน
 *   - buildDailyReportCard(report): สรุปรายวัน
 *   - buildWeeklyReportCard(report): สรุปรายสัปดาห์
 *
 * ทุก card: header (cherry red) + body + footer brand + ปุ่ม "เปิด LIFF เจ้าของ"
 *
 * Cherry palette: #c8102e primary / #9a0c24 dark / #6b6b6b text / #f5f5f5 bg
 */

const BRAND = 'บริษัท วอร์ด้า สกินแคร์ จำกัด';
const BRAND_SHORT = 'Vorda Warehouse';
const CHERRY_PRIMARY = '#c8102e';
const CHERRY_DARK = '#9a0c24';

/** สร้าง LIFF URL ของ owner (สำหรับปุ่มใน flex) */
function _ownerLiffUrl_() {
  const liffId = PropertiesService.getScriptProperties().getProperty('LIFF_ID_OWNER');
  if (!liffId) return 'https://line.me'; // fallback ปลอดภัย
  return 'https://liff.line.me/' + liffId;
}

/** header ร่วม cherry red */
function _flexHeader_(label) {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: CHERRY_PRIMARY,
    paddingAll: 'md',
    contents: [
      { type: 'text', text: BRAND_SHORT, color: '#ffffff', size: 'xs', weight: 'bold' },
      { type: 'text', text: label, color: '#ffffff', size: 'md', weight: 'bold', margin: 'xs' },
    ],
  };
}

/** footer พร้อม postback action buttons + LIFF link + brand */
function _flexFooterActions_(actions) {
  const contents = [];
  (actions || []).forEach(function (a) {
    contents.push({
      type: 'button',
      style: a.style || 'secondary',
      color: a.color,
      height: 'sm',
      action: a.action && a.action.type === 'postback' ? {
        type: 'postback',
        label: a.label,
        data: a.action.data,
        displayText: a.action.displayText || a.label,
      } : {
        type: 'uri',
        label: a.label,
        uri: (a.action && a.action.uri) || _ownerLiffUrl_(),
      },
    });
  });
  // เปิด LIFF เจ้าของ (lock อยู่ท้ายเสมอ — เผื่ออยากไปดูเต็ม)
  contents.push({
    type: 'button',
    style: 'link',
    height: 'sm',
    action: { type: 'uri', label: 'เปิด LIFF เจ้าของ', uri: _ownerLiffUrl_() },
  });
  contents.push({ type: 'text', text: BRAND, size: 'xxs', color: '#999999', align: 'center', margin: 'sm' });
  return { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'md', contents: contents };
}

/** footer brand + ปุ่มเปิด owner LIFF */
function _flexFooter_(buttonLabel) {
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'sm',
    paddingAll: 'md',
    contents: [
      {
        type: 'button',
        style: 'primary',
        color: CHERRY_DARK,
        height: 'sm',
        action: {
          type: 'uri',
          label: buttonLabel || 'เปิด LIFF เจ้าของ',
          uri: _ownerLiffUrl_(),
        },
      },
      { type: 'text', text: BRAND, size: 'xxs', color: '#999999', align: 'center', margin: 'sm' },
    ],
  };
}

/** label + value แถวเดียว */
function _flexRow_(label, value, valueColor) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#888888', size: 'sm', flex: 3 },
      { type: 'text', text: String(value), color: valueColor || '#222222', size: 'sm', flex: 5, wrap: true },
    ],
  };
}

// =====================================================================
// CARDS
// =====================================================================

/** count variance ≠ 0 — รอ owner กดปรับยอด */
function buildVarianceAlertCard(count) {
  const variance = Number(count.variance || 0);
  const varianceStr = (variance > 0 ? '+' : '') + variance;
  const varianceColor = variance > 0 ? '#16a34a' : CHERRY_PRIMARY;
  return {
    type: 'flex',
    altText: '⚠️ ตรวจนับไม่ตรงระบบ — ' + (count.product_name || '') + ' ส่วนต่าง ' + varianceStr,
    contents: {
      type: 'bubble',
      header: _flexHeader_('⚠️ ตรวจนับไม่ตรงระบบ'),
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'md',
        contents: [
          _flexRow_('รหัส', count.count_id || ''),
          _flexRow_('สินค้า', count.product_name || ''),
          _flexRow_('ยอดในระบบ', count.system_qty || 0),
          _flexRow_('ยอดนับจริง', count.final_qty || 0),
          _flexRow_('ส่วนต่าง', varianceStr, varianceColor),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: 'กด "ปรับยอด" ใน LIFF เจ้าของ', size: 'xs', color: '#888888', margin: 'sm' },
        ],
      },
      footer: _flexFooterActions_([
        { label: 'รับทราบ', style: 'secondary',
          action: { type: 'postback', data: 'action=ack', displayText: 'รับทราบ' } },
      ]),
    },
  };
}

/** Movement รอ approve (single-staff mode) — รับเข้า/เตรียมแพ๊ค/เสียหาย */
function buildPendingMovementCard(m) {
  const photoUrls = String(m.photo_urls || '').split(',').filter(function (u) { return u && u.trim(); });
  const thumb = photoUrls.length > 0 ? driveUrlToThumbnail_(photoUrls[0], 800) : null;
  const type = String(m.movement_type || '');
  const typeLabel = type === 'inbound' ? 'รับเข้า'
                  : type === 'outbound' ? 'เตรียมแพ็ค'
                  : type === 'adjust' ? 'เสียหาย' : type;

  const bubble = {
    type: 'bubble',
    header: _flexHeader_('⚠️ ' + typeLabel + ' รอ approve'),
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'md',
      contents: [
        _flexRow_('รหัส', m.movement_id || ''),
        _flexRow_('สินค้า', m.product_name || ''),
        _flexRow_('จำนวน', (m.submitter1_qty || m.qty || 0) + ' ชิ้น', CHERRY_PRIMARY),
        ...(m.reason ? [_flexRow_('เหตุผล', m.reason)] : []),
        _flexRow_('พนักงาน', m.submitter1_name || ''),
      ],
    },
    footer: _flexFooterActions_([
      { label: 'Approve (เข้า Stock)', style: 'primary', color: CHERRY_DARK,
        action: { type: 'postback',
          data: 'action=approveMovement&id=' + m.movement_id + '&decision=accept',
          displayText: 'Approve ' + m.movement_id } },
      { label: 'Reject', style: 'secondary',
        action: { type: 'postback',
          data: 'action=approveMovement&id=' + m.movement_id + '&decision=reject',
          displayText: 'Reject ' + m.movement_id } },
    ]),
  };
  if (thumb) {
    bubble.hero = { type: 'image', url: thumb, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
  }
  return {
    type: 'flex',
    altText: '⚠️ ' + typeLabel + ' รอ approve — ' + (m.product_name || m.movement_id),
    contents: bubble,
  };
}

/** ตีคืนรอ approve */
function buildPendingReturnCard(r) {
  const photoUrls = String(r.photo_urls || '').split(',').filter(function (u) { return u && u.trim(); });
  const thumb = photoUrls.length > 0 ? driveUrlToThumbnail_(photoUrls[0], 800) : null;
  const isOurProduct = r.is_our_product === true || String(r.is_our_product).toLowerCase() === 'true';
  const conditionThai = String(r.condition).toLowerCase() === 'good' ? 'ดี' : 'ไม่ดี';

  const body = {
    type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'md',
    contents: [
      _flexRow_('รหัส', r.return_id || ''),
      _flexRow_('tracking', r.tracking_number || ''),
      _flexRow_('สินค้า', r.product_name || '(ไม่ใช่ของเรา)'),
      _flexRow_('จำนวน', (r.qty || 0) + ' ชิ้น'),
      _flexRow_('สภาพ', conditionThai, conditionThai === 'ดี' ? '#16a34a' : CHERRY_PRIMARY),
      _flexRow_('ของเรา', isOurProduct ? 'ใช่' : 'ไม่ใช่'),
      _flexRow_('พนักงาน', r.staff_name || ''),
    ],
  };
  if (r.video_url) {
    body.contents.push({ type: 'separator', margin: 'md' });
    body.contents.push({
      type: 'button',
      style: 'link',
      height: 'sm',
      action: { type: 'uri', label: 'ดู VDO ตอนแกะ', uri: r.video_url },
    });
  }

  // action buttons — เฉพาะกรณีที่ button ใช้ได้ตรงๆ (ของเรา + ดี = Accept ได้)
  const actions = [];
  if (isOurProduct && conditionThai === 'ดี') {
    actions.push({ label: 'Accept (เข้า Stock)', style: 'primary', color: CHERRY_DARK,
      action: { type: 'postback',
        data: 'action=approveReturn&id=' + r.return_id + '&decision=accept_to_stock',
        displayText: 'Accept ' + r.return_id } });
  }
  actions.push({ label: 'Reject', style: 'secondary',
    action: { type: 'postback',
      data: 'action=approveReturn&id=' + r.return_id + '&decision=reject_bad',
      displayText: 'Reject ' + r.return_id } });
  actions.push({ label: 'ส่งเคลม supplier', style: 'secondary',
    action: { type: 'postback',
      data: 'action=approveReturn&id=' + r.return_id + '&decision=forward_to_claim',
      displayText: 'ส่งเคลม ' + r.return_id } });

  const bubble = {
    type: 'bubble',
    header: _flexHeader_('⚠️ ตีคืนรอ approve'),
    body: body,
    footer: _flexFooterActions_(actions),
  };
  if (thumb) {
    bubble.hero = {
      type: 'image',
      url: thumb,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }

  return {
    type: 'flex',
    altText: '⚠️ ตีคืนรอ approve — ' + (r.product_name || r.tracking_number || '?'),
    contents: bubble,
  };
}

/** ยกเลิกรอ approve */
function buildPendingCancelCard(c) {
  const photoUrls = String(c.photo_urls || '').split(',').filter(function (u) { return u && u.trim(); });
  const thumb = photoUrls.length > 0 ? driveUrlToThumbnail_(photoUrls[0], 800) : null;

  const actions = [
    { label: 'Accept (เข้า Stock)', style: 'primary', color: CHERRY_DARK,
      action: { type: 'postback',
        data: 'action=approveCancel&id=' + c.cancel_id + '&decision=accept',
        displayText: 'Accept ' + c.cancel_id } },
    { label: 'Reject', style: 'secondary',
      action: { type: 'postback',
        data: 'action=approveCancel&id=' + c.cancel_id + '&decision=reject',
        displayText: 'Reject ' + c.cancel_id } },
  ];

  const bubble = {
    type: 'bubble',
    header: _flexHeader_('⚠️ ยกเลิกรอ approve'),
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'md',
      contents: [
        _flexRow_('รหัส', c.cancel_id || ''),
        _flexRow_('tracking', c.tracking_number || ''),
        _flexRow_('สินค้า', c.product_name || ''),
        _flexRow_('จำนวน', (c.qty || 0) + ' ชิ้น'),
        _flexRow_('พนักงาน', c.staff_name || ''),
      ],
    },
    footer: _flexFooterActions_(actions),
  };
  if (thumb) {
    bubble.hero = {
      type: 'image', url: thumb, size: 'full', aspectRatio: '20:13', aspectMode: 'cover',
    };
  }

  return {
    type: 'flex',
    altText: '⚠️ ยกเลิกรอ approve — ' + (c.product_name || c.tracking_number || '?'),
    contents: bubble,
  };
}

/**
 * หัวหน้าตัดสิน — รับ record + kind ('movement'|'count') + type label
 * record: Movements row หรือ Counts row
 */
function buildSupervisorTiebreakerCard(record, kind, typeLabel) {
  const isCount = kind === 'count';
  const recordId = record.movement_id || record.count_id || '';
  const photoUrls = String(record.photo_urls || '').split(',').filter(function (u) { return u && u.trim(); });
  const thumb = photoUrls.length > 0 ? driveUrlToThumbnail_(photoUrls[0], 800) : null;

  const bodyContents = [
    _flexRow_('รหัส', recordId),
    _flexRow_(isCount ? 'ประเภท' : 'ประเภท', typeLabel || (isCount ? 'ตรวจนับ' : 'movement')),
    _flexRow_('สินค้า', record.product_name || ''),
  ];

  if (isCount) {
    bodyContents.push(_flexRow_('ยอดในระบบ', record.system_qty || 0));
  }
  if (record.reason) {
    bodyContents.push(_flexRow_('เหตุผล', record.reason));
  }
  bodyContents.push({ type: 'separator', margin: 'md' });
  bodyContents.push(_flexRow_('คนนับ 1', record.submitter1_name + ' = ' + (record.submitter1_qty || 0)));
  bodyContents.push(_flexRow_('คนนับ 2', record.submitter2_name + ' = ' + (record.submitter2_qty || 0)));

  const bubble = {
    type: 'bubble',
    header: _flexHeader_('⚠️ ขอตัดสิน'),
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'md', contents: bodyContents },
    footer: _flexFooterActions_([
      { label: 'รับทราบ', style: 'secondary',
        action: { type: 'postback', data: 'action=ack', displayText: 'รับทราบ' } },
    ]),
  };
  if (thumb) {
    bubble.hero = { type: 'image', url: thumb, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
  }

  return {
    type: 'flex',
    altText: '⚠️ ขอตัดสิน ' + (typeLabel || '') + ' — ' + recordId,
    contents: bubble,
  };
}

/**
 * สรุปรายวัน — report = {
 *   date, by_type: { inbound, outbound, adjust, return_in, cancel_in } (qty รวม),
 *   by_product: [{ product_id, product_name, delta, end_qty }, ...],
 *   pending: { returns, cancels, count_variance }
 * }
 */
function buildDailyReportCard(report) {
  const byType = report.by_type || {};
  const byProduct = report.by_product || [];

  const productLines = byProduct.slice(0, 5).map(function (p) {
    return _flexRow_(p.product_name || p.product_id || '?',
      ((p.delta > 0 ? '+' : '') + (p.delta || 0)) + ' / คงเหลือ ' + (p.end_qty || 0));
  });

  const bubble = {
    type: 'bubble',
    header: _flexHeader_('สรุปรายวัน ' + (report.date || todayBangkok())),
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: 'md',
      contents: [
        { type: 'text', text: 'การเคลื่อนไหวสต๊อก', weight: 'bold', size: 'sm', color: '#555555' },
        _flexRow_('รับเข้า', '+' + (byType.inbound || 0)),
        _flexRow_('เตรียมแพ็ค', '-' + (byType.outbound || 0)),
        _flexRow_('เสียหาย', '-' + (byType.adjust || 0)),
        _flexRow_('ตีคืนเข้า', '+' + (byType.return_in || 0)),
        _flexRow_('ยกเลิกเข้า', '+' + (byType.cancel_in || 0)),
        { type: 'separator', margin: 'md' },
        { type: 'text', text: 'ยอดคงเหลือล่าสุด', weight: 'bold', size: 'sm', color: '#555555' },
      ].concat(productLines).concat([
        { type: 'separator', margin: 'md' },
        _flexRow_('รอ approve คืน', (report.pending && report.pending.returns) || 0,
          ((report.pending && report.pending.returns) || 0) > 0 ? CHERRY_PRIMARY : '#222222'),
        _flexRow_('รอ approve ยกเลิก', (report.pending && report.pending.cancels) || 0,
          ((report.pending && report.pending.cancels) || 0) > 0 ? CHERRY_PRIMARY : '#222222'),
        _flexRow_('รอปรับยอด (count)', (report.pending && report.pending.count_variance) || 0,
          ((report.pending && report.pending.count_variance) || 0) > 0 ? CHERRY_PRIMARY : '#222222'),
      ]),
    },
    footer: _flexFooterActions_([
      { label: 'รับทราบ', style: 'secondary',
        action: { type: 'postback', data: 'action=ack', displayText: 'รับทราบ' } },
    ]),
  };

  return {
    type: 'flex',
    altText: 'สรุปรายวัน ' + (report.date || todayBangkok()),
    contents: bubble,
  };
}

/** สรุปรายสัปดาห์ — เพิ่มข้อมูล counts + returns/cancels closed ของสัปดาห์ */
function buildWeeklyReportCard(report) {
  const byType = report.by_type || {};
  const byProduct = report.by_product || [];
  const productLines = byProduct.slice(0, 5).map(function (p) {
    return _flexRow_(p.product_name || p.product_id || '?',
      ((p.delta > 0 ? '+' : '') + (p.delta || 0)) + ' / คงเหลือ ' + (p.end_qty || 0));
  });

  const bubble = {
    type: 'bubble',
    header: _flexHeader_('สรุปรายสัปดาห์ ' + (report.week || thisWeekBangkok())),
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: 'md',
      contents: [
        { type: 'text', text: 'การเคลื่อนไหวสต๊อกรวมสัปดาห์', weight: 'bold', size: 'sm', color: '#555555' },
        _flexRow_('รับเข้า', '+' + (byType.inbound || 0)),
        _flexRow_('เตรียมแพ็ค', '-' + (byType.outbound || 0)),
        _flexRow_('เสียหาย', '-' + (byType.adjust || 0)),
        _flexRow_('ตีคืนเข้า', '+' + (byType.return_in || 0)),
        _flexRow_('ยกเลิกเข้า', '+' + (byType.cancel_in || 0)),
        { type: 'separator', margin: 'md' },
        { type: 'text', text: 'ตรวจนับสัปดาห์', weight: 'bold', size: 'sm', color: '#555555' },
        _flexRow_('นับครบ', (report.counts && report.counts.total) || 0),
        _flexRow_('ตรงระบบ', (report.counts && report.counts.no_action) || 0),
        _flexRow_('ปรับยอดแล้ว', (report.counts && report.counts.resolved_by_adjust) || 0),
        _flexRow_('รอปรับยอด', (report.counts && report.counts.awaiting_owner) || 0,
          ((report.counts && report.counts.awaiting_owner) || 0) > 0 ? CHERRY_PRIMARY : '#222222'),
        { type: 'separator', margin: 'md' },
        { type: 'text', text: 'ยอดคงเหลือล่าสุด', weight: 'bold', size: 'sm', color: '#555555' },
      ].concat(productLines).concat([
        { type: 'separator', margin: 'md' },
        _flexRow_('ตีคืน accepted', (report.returns && report.returns.accepted) || 0),
        _flexRow_('ตีคืน rejected', (report.returns && report.returns.rejected) || 0),
        _flexRow_('ส่งเคลม (closed)', (report.claims && report.claims.closed) || 0),
        _flexRow_('ยกเลิก accepted', (report.cancels && report.cancels.accepted) || 0),
      ]),
    },
    footer: _flexFooterActions_([
      { label: 'รับทราบ', style: 'secondary',
        action: { type: 'postback', data: 'action=ack', displayText: 'รับทราบ' } },
    ]),
  };

  return {
    type: 'flex',
    altText: 'สรุปรายสัปดาห์ ' + (report.week || thisWeekBangkok()),
    contents: bubble,
  };
}
