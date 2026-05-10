/**
 * FlexCard.gs — สร้าง LINE flex message สำหรับแจ้งเตือน
 *
 *   - buildVarianceAlertCard(count): นับเทียบไม่ตรงกับระบบ → push owner
 *   - buildPendingReturnCard(returnRow): มี return รอ approve
 *   - buildPendingCancelCard(cancelRow): มี cancel รอ approve
 *   - buildSupervisorTiebreakerCard(record): นับ 2 คนไม่ตรง → ขอหัวหน้าตัดสิน
 *   - buildDailyReportCard(report): สรุปรายวัน
 *   - buildWeeklyReportCard(report): สรุปรายสัปดาห์
 *
 * helper:
 *   - driveUrlToThumbnail_(url) — มาจาก DriveStore.gs
 *
 * @TODO Claude Code ตาม TASKS.md PHASE 4
 */

function buildVarianceAlertCard(count) {
  // count: row จาก Counts sheet (variance ≠ 0)
  return {
    type: 'flex',
    altText: 'นับเทียบไม่ตรง: ' + count.product_name + ' ส่วนต่าง ' + count.variance,
    contents: {
      type: 'bubble',
      // TODO: header + body + footer พร้อมปุ่ม "ดู dashboard"
      body: { type: 'box', layout: 'vertical', contents: [
        { type: 'text', text: 'นับเทียบไม่ตรง', weight: 'bold' },
        { type: 'text', text: 'ยังไม่ implement (FlexCard.gs)', size: 'sm' }
      ]}
    }
  };
}
