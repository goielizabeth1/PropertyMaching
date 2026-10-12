export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { action, data, adminPassword } = req.body;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
  const ADMIN_PASS = process.env.ADMIN_PASS || 'admin1234';
  const LINE_TOKEN = process.env.LINE_TOKEN;
  const LINE_GROUP_ID = process.env.LINE_GROUP_ID;

  if (data && data.bot_trap) {
    return res.status(400).json({ success: false, message: 'Spam Detected' });
  }

  const adminActions = ['getAdminData', 'deleteRecord', 'updateStatus'];
  if (adminActions.includes(action) && adminPassword !== ADMIN_PASS) {
    return res.status(401).json({ success: false, message: 'รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง' });
  }

  async function supabaseFetch(endpoint, method = 'GET', body = null) {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
    return response.json();
  }

  // ฟังก์ชันอัปโหลดรูปภาพ Base64 ขึ้น Supabase Storage
  async function uploadImagesToSupabase(base64Array, prefix) {
    if (!Array.isArray(base64Array) || base64Array.length === 0) return [];
    const uploadedUrls = [];

    for (let i = 0; i < Math.min(base64Array.length, 5); i++) {
      const base64Str = base64Array[i];
      const matches = base64Str.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (!matches) continue;

      const contentType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');
      const fileName = `${prefix}_${Date.now()}_${i + 1}.jpg`;

      const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/property-images/${fileName}`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': contentType,
          'x-upsert': 'true'
        },
        body: buffer
      });

      if (uploadRes.ok) {
        uploadedUrls.push(`${SUPABASE_URL}/storage/v1/object/public/property-images/${fileName}`);
      }
    }
    return uploadedUrls;
  }

  async function sendLine(text) {
    if (!LINE_TOKEN || !LINE_GROUP_ID) return;
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify({ to: LINE_GROUP_ID, messages: [{ type: 'text', text }] })
    });
  }

  const genId = (prefix) => `${prefix}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  try {
    if (action === 'getMapData') {
      const inv = await supabaseFetch(`inventory?status=eq.${encodeURIComponent('ว่าง (Available)')}&select=*`);
      const agents = await supabaseFetch(`co_agents?select=*`);
      const mapData = [];

      if (Array.isArray(inv)) {
        inv.forEach(i => {
          if (i.lat && i.lng) mapData.push({ id: i.prop_id, type: i.listing_type, project: i.project_name, room: i.room_type, price: Number(i.price), lat: Number(i.lat), lng: Number(i.lng) });
        });
      }
      if (Array.isArray(agents)) {
        agents.forEach(a => {
          if (a.lat && a.lng) mapData.push({ id: a.id, type: a.prop_type, project: a.project_zone, room: a.details, price: Number(a.price), lat: Number(a.lat), lng: Number(a.lng) });
        });
      }
      return res.status(200).json({ success: true, data: mapData });
    }

    if (action === 'saveOwner') {
      const propId = genId('PROP');
      const uploadedUrls = await uploadImagesToSupabase(data.uploadedFiles, propId);
      const allImages = [...uploadedUrls];
      if (data.imagesLink && data.imagesLink.trim() !== '') allImages.push(data.imagesLink.trim());
      const finalImagesStr = allImages.length > 0 ? allImages.join(' , ') : '-';

      await supabaseFetch('inventory', 'POST', {
        prop_id: propId,
        owner_name: data.ownerName,
        contact: data.ownerContact,
        listing_type: data.listingType,
        zone: data.zone,
        project_name: data.projectName,
        room_type: data.roomType,
        size_sqm: Number(data.sizeSqm) || 0,
        floor: data.floor || '-',
        price: Number(data.price) || 0,
        images_link: finalImagesStr,
        status: 'ว่าง (Available)',
        lat: data.lat ? Number(data.lat) : null,
        lng: data.lng ? Number(data.lng) : null
      });

      const imgText = uploadedUrls.length > 0 ? `\n📷 รูปภาพ: ${uploadedUrls[0]} (รวม ${uploadedUrls.length} รูป)` : (data.imagesLink ? `\n🔗 ลิงก์รูป: ${data.imagesLink}` : '');
      await sendLine(`🏠 [มีห้องฝากใหม่!]\nรหัส: ${propId}\nคุณ: ${data.ownerName} (${data.ownerContact})\nโครงการ: ${data.projectName} (${data.zone})\nประเภท: ${data.roomType} | ราคา: ${Number(data.price).toLocaleString()} บ.${imgText}`);
      await checkMatching();
      return res.status(200).json({ success: true, id: propId });
    }

    if (action === 'saveBuyer') {
      const leadId = genId('LEAD');
      await supabaseFetch('buyers', 'POST', {
        lead_id: leadId,
        buyer_name: data.buyerName,
        contact: data.buyerContact,
        req_listing_type: data.reqListingType,
        req_zone: data.reqZone,
        req_project: data.reqProject || '-',
        req_room_type: data.reqRoomType,
        min_budget: Number(data.minBudget) || 0,
        max_budget: Number(data.maxBudget) || 0,
        move_in_date: data.moveInDate || '-'
      });

      await sendLine(`🔍 [มีลูกค้าหาห้องใหม่!]\nรหัส: ${leadId}\nลูกค้า: ${data.buyerName} (${data.buyerContact})\nโซน: ${data.reqZone} (${data.reqRoomType})\nงบ: ${Number(data.minBudget).toLocaleString()} - ${Number(data.maxBudget).toLocaleString()} บ.`);
      await checkMatching();
      return res.status(200).json({ success: true, id: leadId });
    }

    if (action === 'saveAgent') {
      const coId = genId('CO');
      const uploadedUrls = await uploadImagesToSupabase(data.uploadedFiles, coId);
      const allImages = [...uploadedUrls];
      if (data.imagesLink && data.imagesLink.trim() !== '') allImages.push(data.imagesLink.trim());
      const finalImagesStr = allImages.length > 0 ? allImages.join(' , ') : '-';

      await supabaseFetch('co_agents', 'POST', {
        id: coId,
        agent_name: data.agentName,
        company: data.company || 'อิสระ',
        phone: data.phone,
        line_id: data.lineId,
        prop_type: data.propType,
        project_zone: data.projectZone,
        details: data.details,
        price: Number(data.price) || 0,
        images_link: finalImagesStr,
        commission_type: data.commissionType,
        lat: data.lat ? Number(data.lat) : null,
        lng: data.lng ? Number(data.lng) : null
      });

      const imgText = uploadedUrls.length > 0 ? `\n📷 รูปภาพ: ${uploadedUrls[0]} (รวม ${uploadedUrls.length} รูป)` : (data.imagesLink ? `\n🔗 ลิงก์รูป: ${data.imagesLink}` : '');
      await sendLine(`🤝 [Co-Agent ส่งทรัพย์ใหม่!]\nรหัส: ${coId}\nเอเจนต์: ${data.agentName} (${data.company || 'อิสระ'})\nโทร: ${data.phone} | LINE: ${data.lineId}\nโครงการ: ${data.projectZone} (${data.propType})\nราคา: ${Number(data.price).toLocaleString()} บ.\nคอมมิชชัน: ${data.commissionType}${imgText}`);
      return res.status(200).json({ success: true, id: coId });
    }

    if (action === 'getAdminData') {
      const inv = await supabaseFetch('inventory?order=created_at.desc');
      const buyers = await supabaseFetch('buyers?order=created_at.desc');
      const agents = await supabaseFetch('co_agents?order=created_at.desc');

      return res.status(200).json({
        success: true,
        inventory: (inv || []).map(i => ({ row: i.prop_id, propId: i.prop_id, ownerName: i.owner_name, contact: i.contact, type: i.listing_type, zone: i.zone, project: i.project_name, room: i.room_type, price: i.price, imagesLink: i.images_link, status: i.status })),
        buyers: (buyers || []).map(b => ({ leadId: b.lead_id, buyerName: b.buyer_name, contact: b.contact, type: b.req_listing_type, zone: b.req_zone, room: b.req_room_type, minBudget: b.min_budget, maxBudget: b.max_budget })),
        coAgents: (agents || []).map(a => ({ id: a.id, agentName: a.agent_name, company: a.company, phone: a.phone, lineId: a.line_id, propType: a.prop_type, projectZone: a.project_zone, details: a.details, price: a.price, imagesLink: a.images_link, commissionType: a.commission_type }))
      });
    }

    if (action === 'updateStatus') {
      await supabaseFetch(`inventory?prop_id=eq.${data.row}`, 'PATCH', { status: data.status });
      return res.status(200).json({ success: true });
    }

    if (action === 'deleteRecord') {
      const table = data.tabType === 'inv' ? 'inventory' : data.tabType === 'buyer' ? 'buyers' : 'co_agents';
      const col = data.tabType === 'inv' ? 'prop_id' : data.tabType === 'buyer' ? 'lead_id' : 'id';
      await supabaseFetch(`${table}?${col}=eq.${data.id}`, 'DELETE');
      return res.status(200).json({ success: true });
    }

    async function checkMatching() {
      const inv = await supabaseFetch(`inventory?status=eq.${encodeURIComponent('ว่าง (Available)')}`);
      const buyers = await supabaseFetch('buyers');
      const logs = await supabaseFetch('matching_logs');
      if (!Array.isArray(inv) || !Array.isArray(buyers)) return;

      const matchedSet = new Set((logs || []).map(l => `${l.lead_id}_${l.prop_id}`));

      for (const b of buyers) {
        const minB = Number(b.min_budget) || 0;
        const maxB = Number(b.max_budget) || Infinity;

        for (const p of inv) {
          const key = `${b.lead_id}_${p.prop_id}`;
          if (matchedSet.has(key)) continue;

          const isType = (b.req_listing_type === p.listing_type) || (p.listing_type === 'ขายและเช่า');
          const isZone = (b.req_zone === p.zone);
          const isRoom = (b.req_room_type === p.room_type);
          const isPrice = (Number(p.price) >= minB && Number(p.price) <= maxB);

          if (isType && isZone && isRoom && isPrice) {
            await supabaseFetch('matching_logs', 'POST', { log_id: genId('LOG'), lead_id: b.lead_id, prop_id: p.prop_id });
            matchedSet.add(key);
            await sendLine(`🎯 [จับคู่ทรัพย์สำเร็จ 100%!]\n👤 ลูกค้า: ${b.buyer_name} (${b.contact})\n💰 งบ: ${minB.toLocaleString()}-${maxB.toLocaleString()} บ.\n------------------\n🏠 คู่กับรหัส: ${p.prop_id}\n🏢 โครงการ: ${p.project_name} (${p.zone})\n💵 ราคา: ${Number(p.price).toLocaleString()} บ.\n👤 เจ้าของ: ${p.owner_name} (${p.contact})`);
          }
        }
      }
    }

    return res.status(400).json({ success: false, message: 'Invalid Action' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
