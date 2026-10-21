export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const { action, data, adminPassword } = req.body;

  const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
  const API_KEY = process.env.FIREBASE_API_KEY;
  const ADMIN_PASS = process.env.ADMIN_PASS || 'admin1234';
  const LINE_TOKEN = process.env.LINE_TOKEN;
  const LINE_GROUP_ID = process.env.LINE_GROUP_ID;

  if (!PROJECT_ID || !API_KEY) {
    return res.status(500).json({ success: false, message: 'ระบบขาดรหัสเชื่อมต่อ Firebase ใน Vercel' });
  }

  if (data && data.bot_trap) return res.status(400).json({ success: false, message: 'Spam Detected' });

  const adminActions = ['getAdminData', 'deleteRecord', 'updateStatus'];
  if (adminActions.includes(action) && adminPassword !== ADMIN_PASS) {
    return res.status(401).json({ success: false, message: 'รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง' });
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

  function fromFirestore(doc) {
    const obj = {};
    if (!doc.fields) return obj;
    for (const [k, v] of Object.entries(doc.fields)) {
      if (v.stringValue !== undefined) obj[k] = v.stringValue;
      else if (v.doubleValue !== undefined) obj[k] = Number(v.doubleValue);
      else if (v.integerValue !== undefined) obj[k] = Number(v.integerValue);
      else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
      else if (v.nullValue !== undefined) obj[k] = null;
    }
    return obj;
  }

  const dbBase = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  async function fetchCollection(collection) {
    const res = await fetch(`${dbBase}/${collection}?pageSize=1000&key=${API_KEY}`);
    const json = await res.json();
    if (!json.documents) return [];
    return json.documents.map(doc => {
      const parsed = fromFirestore(doc);
      parsed._docId = doc.name.split('/').pop();
      return parsed;
    });
  }

  async function saveDocument(collection, docId, obj) {
    const url = docId ? `${dbBase}/${collection}?documentId=${docId}&key=${API_KEY}` : `${dbBase}/${collection}?key=${API_KEY}`;
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toFirestore(obj)) });
  }

  async function updateDocument(collection, docId, updates) {
    const updateMasks = Object.keys(updates).map(k => `updateMask.fieldPaths=${k}`).join('&');
    await fetch(`${dbBase}/${collection}/${docId}?${updateMasks}&key=${API_KEY}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toFirestore(updates))
    });
  }

  async function deleteDoc(collection, docId) {
    await fetch(`${dbBase}/${collection}/${docId}?key=${API_KEY}`, { method: 'DELETE' });
  }

  async function uploadImagesToFirebase(base64Array, prefix) {
    if (!Array.isArray(base64Array) || base64Array.length === 0) return [];
    const uploadedUrls = [];

    for (let i = 0; i < Math.min(base64Array.length, 5); i++) {
      const base64Str = base64Array[i];
      const matches = base64Str.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (!matches) continue;

      const buffer = Buffer.from(matches[2], 'base64');
      const fileName = `${prefix}_${Date.now()}_${i + 1}.jpg`;
      const filePath = `property-images/${fileName}`;
      const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${PROJECT_ID}.appspot.com/o?name=${encodeURIComponent(filePath)}&key=${API_KEY}`;
      
      const uploadRes = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': matches[1] }, body: buffer });
      if (uploadRes.ok) uploadedUrls.push(`https://firebasestorage.googleapis.com/v0/b/${PROJECT_ID}.appspot.com/o/${encodeURIComponent(filePath)}?alt=media`);
    }
    return uploadedUrls;
  }

  async function extractAndSaveImageFromUrl(targetUrl, prefix) {
    if (!targetUrl || !targetUrl.startsWith('http')) return null;
    try {
      const driveMatch = targetUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      let imageToDownload = null;
      if (driveMatch && driveMatch[1]) {
        imageToDownload = `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
      } else if (/\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(targetUrl)) {
        imageToDownload = targetUrl;
      } else {
        const pageRes = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
          if (ogMatch && ogMatch[1]) imageToDownload = ogMatch[1].replace(/&amp;/g, '&');
        }
      }
      if (!imageToDownload) return null;

      const imgRes = await fetch(imageToDownload, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!imgRes.ok) return null;
      
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      if (buffer.length < 8000) return null;

      const filePath = `property-images/${prefix}_auto_${Date.now()}.jpg`;
      const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${PROJECT_ID}.appspot.com/o?name=${encodeURIComponent(filePath)}&key=${API_KEY}`;
      const uploadRes = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': imgRes.headers.get('content-type') || 'image/jpeg' }, body: buffer });
      if (uploadRes.ok) return `https://firebasestorage.googleapis.com/v0/b/${PROJECT_ID}.appspot.com/o/${encodeURIComponent(filePath)}?alt=media`;
    } catch (e) {}
    return null;
  }

  async function sendLine(text) {
    if (!LINE_TOKEN || !LINE_GROUP_ID) return;
    await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` }, body: JSON.stringify({ to: LINE_GROUP_ID, messages: [{ type: 'text', text }] }) });
  }

  const genId = (prefix) => `${prefix}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  // แก้ไขตรงนี้: กรองเอาเฉพาะลิงก์ที่เป็นไฟล์รูปภาพจริงๆ เท่านั้น
  function extractValidImageUrls(linksStr) {
    if (!linksStr || linksStr === '-') return [];
    return linksStr.split(' , ').map(s => s.trim()).filter(u => 
      u.includes('firebasestorage') || 
      /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(u) || 
      u.includes('unsplash.com') || 
      u.includes('drive.google.com')
    );
  }

  try {
    if (action === 'getMapData' || action === 'getPublicListings') {
      const inv = await fetchCollection('inventory');
      const agents = await fetchCollection('co_agents');
      const publicData = [];

      inv.filter(i => !i.status || i.status.includes('ว่าง') || i.status.includes('Available')).forEach(i => {
        publicData.push({ id: i.prop_id, source: 'Owner', type: i.listing_type, zone: i.zone, project: i.project_name, room: i.room_type, size: i.size_sqm, floor: i.floor, price: Number(i.price), images: extractValidImageUrls(i.images_link), lat: i.lat ? Number(i.lat) : null, lng: i.lng ? Number(i.lng) : null });
      });
      agents.forEach(a => {
        publicData.push({ id: a.id, source: 'Co-Agent', type: a.prop_type, zone: a.project_zone, project: a.project_zone, room: a.details, size: '-', floor: '-', price: Number(a.price), images: extractValidImageUrls(a.images_link), lat: a.lat ? Number(a.lat) : null, lng: a.lng ? Number(a.lng) : null });
      });
      return res.status(200).json({ success: true, data: publicData });
    }

    if (action === 'saveOwner') {
      const propId = genId('PROP');
      const uploadedUrls = await uploadImagesToFirebase(data.uploadedFiles, propId);
      if (uploadedUrls.length === 0 && data.imagesLink) {
        const autoExtracted = await extractAndSaveImageFromUrl(data.imagesLink.trim(), propId);
        if (autoExtracted) uploadedUrls.push(autoExtracted);
      }
      const allImages = [...uploadedUrls];
      if (data.imagesLink) allImages.push(data.imagesLink.trim());
      
      await saveDocument('inventory', propId, {
        prop_id: propId, owner_name: data.ownerName, contact: data.ownerContact, listing_type: data.listingType, zone: data.zone, project_name: data.projectName, room_type: data.roomType, size_sqm: Number(data.sizeSqm) || 0, floor: data.floor || '-', price: Number(data.price) || 0, images_link: allImages.length > 0 ? allImages.join(' , ') : '-', status: 'ว่าง (Available)', lat: data.lat ? Number(data.lat) : null, lng: data.lng ? Number(data.lng) : null, created_at: Date.now()
      });
      await sendLine(`🏠 [ฝากห้องใหม่]\nรหัส: ${propId}\nคุณ: ${data.ownerName}\nโครงการ: ${data.projectName}\nราคา: ${Number(data.price).toLocaleString()} บ.`);
      await checkMatching();
      return res.status(200).json({ success: true, id: propId });
    }

    if (action === 'saveBuyer') {
      const leadId = genId('LEAD');
      await saveDocument('buyers', leadId, {
        lead_id: leadId, buyer_name: data.buyerName, contact: data.buyerContact, req_listing_type: data.reqListingType, req_zone: data.reqZone, req_project: data.reqProject || '-', req_room_type: data.reqRoomType, min_budget: Number(data.minBudget) || 0, max_budget: Number(data.maxBudget) || 0, move_in_date: data.moveInDate || '-', created_at: Date.now()
      });
      await sendLine(`🔍 [ลูกค้าหาห้องใหม่]\nรหัส: ${leadId}\nลูกค้า: ${data.buyerName}\nโซน: ${data.reqZone}\nงบ: ${Number(data.maxBudget).toLocaleString()} บ.`);
      await checkMatching();
      return res.status(200).json({ success: true, id: leadId });
    }

    if (action === 'saveAgent') {
      const coId = genId('CO');
      const uploadedUrls = await uploadImagesToFirebase(data.uploadedFiles, coId);
      if (uploadedUrls.length === 0 && data.imagesLink) {
        const autoExtracted = await extractAndSaveImageFromUrl(data.imagesLink.trim(), coId);
        if (autoExtracted) uploadedUrls.push(autoExtracted);
      }
      const allImages = [...uploadedUrls];
      if (data.imagesLink) allImages.push(data.imagesLink.trim());
      
      await saveDocument('co_agents', coId, {
        id: coId, agent_name: data.agentName, company: data.company || 'อิสระ', phone: data.phone, line_id: data.lineId, prop_type: data.propType, project_zone: data.projectZone, details: data.details, price: Number(data.price) || 0, images_link: allImages.length > 0 ? allImages.join(' , ') : '-', commission_type: data.commissionType, lat: data.lat ? Number(data.lat) : null, lng: data.lng ? Number(data.lng) : null, created_at: Date.now()
      });
      await sendLine(`🤝 [Co-Agent ส่งทรัพย์]\nรหัส: ${coId}\nโดย: ${data.agentName}\nโครงการ: ${data.projectZone}\nราคา: ${Number(data.price).toLocaleString()} บ.`);
      return res.status(200).json({ success: true, id: coId });
    }

    if (action === 'getAdminData') {
      const [inv, buyers, agents] = await Promise.all([fetchCollection('inventory'), fetchCollection('buyers'), fetchCollection('co_agents')]);
      return res.status(200).json({
        success: true,
        inventory: inv.map(i => ({ row: i._docId || i.prop_id, propId: i.prop_id, ownerName: i.owner_name, contact: i.contact, type: i.listing_type, zone: i.zone, project: i.project_name, room: i.room_type, price: i.price, imagesLink: i.images_link, status: i.status })),
        buyers: buyers.map(b => ({ leadId: b.lead_id, buyerName: b.buyer_name, contact: b.contact, type: b.req_listing_type, zone: b.req_zone, room: b.req_room_type, minBudget: b.min_budget, maxBudget: b.max_budget })),
        coAgents: agents.map(a => ({ id: a.id, agentName: a.agent_name, company: a.company, phone: a.phone, lineId: a.line_id, propType: a.prop_type, projectZone: a.project_zone, details: a.details, price: a.price, imagesLink: a.images_link, commissionType: a.commission_type }))
      });
    }

    if (action === 'updateStatus') {
      await updateDocument('inventory', data.row, { status: data.status });
      return res.status(200).json({ success: true });
    }

    if (action === 'deleteRecord') {
      const table = data.tabType === 'inv' ? 'inventory' : data.tabType === 'buyer' ? 'buyers' : 'co_agents';
      await deleteDoc(table, data.id);
      return res.status(200).json({ success: true });
    }

    async function checkMatching() {
      const inv = (await fetchCollection('inventory')).filter(i => !i.status || i.status.includes('ว่าง'));
      const buyers = await fetchCollection('buyers');
      const logs = await fetchCollection('matching_logs');
      const matchedSet = new Set(logs.map(l => `${l.lead_id}_${l.prop_id}`));

      for (const b of buyers) {
        for (const p of inv) {
          if (matchedSet.has(`${b.lead_id}_${p.prop_id}`)) continue;
          if (((b.req_listing_type === p.listing_type) || (p.listing_type === 'ขายและเช่า')) && (b.req_zone === p.zone) && (b.req_room_type === p.room_type) && (Number(p.price) >= (Number(b.min_budget)||0) && Number(p.price) <= (Number(b.max_budget)||Infinity))) {
            await saveDocument('matching_logs', genId('LOG'), { lead_id: b.lead_id, prop_id: p.prop_id });
            matchedSet.add(`${b.lead_id}_${p.prop_id}`);
            await sendLine(`🎯 [จับคู่สำเร็จ!]\nลูกค้า: ${b.buyer_name}\nคู่กับรหัส: ${p.prop_id}`);
          }
        }
      }
    }

    return res.status(400).json({ success: false, message: 'Invalid Action' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
