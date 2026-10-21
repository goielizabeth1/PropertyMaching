export default async function handler(req, res) {
  const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
  const API_KEY = process.env.FIREBASE_API_KEY;

  if (!PROJECT_ID || !API_KEY) {
    return res.status(500).send('<h2 style="color:red;text-align:center;">ยังไม่ได้ใส่รหัส FIREBASE_PROJECT_ID หรือ FIREBASE_API_KEY ใน Vercel ครับ</h2>');
  }

  function toFirestore(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) fields[k] = { nullValue: null };
      else if (typeof v === 'string') fields[k] = { stringValue: v };
      else if (typeof v === 'number') fields[k] = { doubleValue: v };
      else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    }
    return { fields };
  }

  const dbBase = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  const inventory = [
    { prop_id: 'PROP-7CCAB0', owner_name: 'Pharchamon Chimkul', contact: '0646632428', listing_type: 'ขาย', zone: 'กรุงเทพมหานคร', project_name: 'Groove Condo Ratchada-Ladprao', room_type: '1 Bedroom', size_sqm: 22, floor: '4', price: 2100000, images_link: 'https://www.facebook.com/share/p/196FCZNTQG/?mibextid=wwXIfr', status: 'ว่าง (Available)', created_at: Date.now() },
    { prop_id: 'PROP-F307E5', owner_name: 'แอร์', contact: '0840447876', listing_type: 'เช่า', zone: 'ชลบุรี', project_name: 'ธาดา ทาวน์ ศรีราชา', room_type: 'บ้านเดี่ยว / ทาวน์โฮม', size_sqm: 60, floor: '-', price: 25000, images_link: 'https://www.facebook.com/share/p/18gshZWE9i/?mibextid=wwXIfr', status: 'ว่าง (Available)', created_at: Date.now() },
    { prop_id: 'PROP-14C7ED', owner_name: 'Chutika Boonthittanont', contact: '0946295456', listing_type: 'เช่า', zone: 'กรุงเทพมหานคร', project_name: 'Rhythm Asoke', room_type: '2 Bedrooms', size_sqm: 42, floor: '27', price: 29000, images_link: 'https://www.facebook.com/share/p/1H2G4NciiM/?mibextid=wwXIfr', status: 'ว่าง (Available)', created_at: Date.now() },
    { prop_id: 'PROP-E4DCB3', owner_name: 'นพ', contact: 'Shaman119', listing_type: 'เช่า', zone: 'กรุงเทพมหานคร', project_name: 'IDEO Sukhumvit Rama4', room_type: '1 Bedroom', size_sqm: 30, floor: '15', price: 22000, images_link: 'https://www.facebook.com/share/p/1L9J2VSkWE/?mibextid=wwXIfr', status: 'ว่าง (Available)', created_at: Date.now() },
    { prop_id: 'PROP-418A06', owner_name: 'Janny แจนนี่', contact: 'Janny แจนนี่', listing_type: 'ขาย', zone: 'กรุงเทพมหานคร', project_name: 'COBE RATCHADA RAMA9', room_type: '1 Bedroom', size_sqm: 26, floor: 'ตึก B', price: 2590000, images_link: '-', status: 'ว่าง (Available)', created_at: Date.now() },
    { prop_id: 'PROP-92AFED', owner_name: 'Purithut', contact: '0813907008', listing_type: 'ขาย', zone: 'ชลบุรี', project_name: 'เดอะ เซนทรัล รีเจ้นท์ ศรีราชา', room_type: '3+ Bedrooms', size_sqm: 45, floor: '-', price: 3200000, images_link: '-', status: 'ว่าง (Available)', created_at: Date.now() },
    { prop_id: 'PROP-F3B0A3', owner_name: 'Waratthasit Daivagunika', contact: '0898947533', listing_type: 'เช่า', zone: 'สมุทรปราการ', project_name: 'CENTRO Bangna Phase 2', room_type: '3+ Bedrooms', size_sqm: 70, floor: '-', price: 120000, images_link: 'https://www.facebook.com/share/p/1Jvfu1tN1k/', status: 'ว่าง (Available)', created_at: Date.now() },
    { prop_id: 'PROP-9881EF', owner_name: 'Komin Chaikesris', contact: '0934928966', listing_type: 'เช่า', zone: 'สมุทรปราการ', project_name: 'CENTRO Bangna Phase 2', room_type: '3+ Bedrooms', size_sqm: 77.6, floor: '-', price: 150000, images_link: 'https://www.facebook.com/share/p/1LZjgGQFmC/', status: 'ว่าง (Available)', created_at: Date.now() },
    { prop_id: 'PROP-CA35B5', owner_name: 'Tomo Tomo', contact: '0854857120', listing_type: 'เช่า', zone: 'สุขุมวิท-ทองหล่อ', project_name: 'Bangkokfeliz Sukhumvit 69-2', room_type: '1 Bedroom', size_sqm: 29, floor: '4', price: 14500, images_link: 'https://www.facebook.com/share/p/1bLXnbzvc3/?mibextid=wwXIfr', status: 'ว่าง (Available)', created_at: Date.now() },
    { prop_id: 'PROP-4AA768', owner_name: 'Goi Elizabeth', contact: '0898947533', listing_type: 'เช่า', zone: 'ชลบุรี', project_name: 'Dcondo Vale Sriracha', room_type: '1 Bedroom', size_sqm: 25, floor: '2', price: 12000, images_link: 'https://www.facebook.com/share/p/1E2UmM5X6E/?mibextid=wwXIfr', status: 'ว่าง (Available)', created_at: Date.now() }
  ];

  const buyers = [
    { lead_id: 'LEAD-6BAEAE', buyer_name: 'Wipavee', contact: 'Wipaveemsds', req_listing_type: 'เช่า', req_zone: 'ชลบุรี', req_project: 'DCondo Vale', req_room_type: '1 Bedroom', min_budget: 8000, max_budget: 12000, move_in_date: '2026-12-01', created_at: Date.now() }
  ];

  const logs = [
    { log_id: 'LOG-F93B79', lead_id: 'LEAD-6BAEAE', prop_id: 'PROP-4AA768' }
  ];

  try {
    for (const item of inventory) {
      await fetch(`${dbBase}/inventory?documentId=${item.prop_id}&key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toFirestore(item))
      });
    }
    for (const item of buyers) {
      await fetch(`${dbBase}/buyers?documentId=${item.lead_id}&key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toFirestore(item))
      });
    }
    for (const item of logs) {
      await fetch(`${dbBase}/matching_logs?documentId=${item.log_id}&key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toFirestore(item))
      });
    }

    return res.status(200).send(`
      <html><head><meta charset="UTF-8"></head>
      <body style="font-family:sans-serif; text-align:center; padding: 50px; background:#f8fafc;">
        <div style="font-size: 60px; margin-bottom: 20px;">🎉</div>
        <h2 style="color: #059669;">นำเข้าข้อมูลเก่าสำเร็จ 100%!</h2>
        <p style="color: #475569; margin-bottom: 30px;">รายการห้อง 10 รายการ และประวัติการจับคู่ ถูกบันทึกลง Firebase เรียบร้อยแล้ว</p>
        <a href="/" style="padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">กลับไปหน้าหลักเว็บไซต์</a>
      </body></html>
    `);
  } catch (e) {
    return res.status(500).send(`<h2 style="color:red;text-align:center;">เกิดข้อผิดพลาด: ${e.message}</h2>`);
  }
}
