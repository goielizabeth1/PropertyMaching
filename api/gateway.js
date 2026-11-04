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

  // 1. เพิ่ม manualMatch เข้าไปในรายการ Action ที่ต้องตรวจรหัสแอดมิน
  const adminActions = ['getAdminData', 'deleteRecord', 'updateStatus', 'manualMatch'];
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

  function extractValidImageUrls(linksStr) {
    if (!linksStr || linksStr === '-') return [];
    return linksStr.split(' , ').map(s => s.trim()).filter(u => 
      u.includes('firebasestorage') || /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(u) || u.includes('unsplash.com') || u.includes('drive.google.com')
    );
  }

  // ระบบจับคู่อัตโนมัติ (Auto Matching)
  async function checkMatching() {
    const inv = (await fetchCollection('inventory')).filter(i => !i.status || i.status.includes('ว่าง') || i.status.includes('Available'));
    const agents = (await fetchCollection('co_agents')).filter(a => !a.status || a.status.includes('ว่าง') || a.status.includes('Available'));
    const buyers = (await fetchCollection('buyers')).filter(b => !b.status || (!b.status.includes('ปิด') && !b.status.includes('จับคู่')));
    const logs = await fetchCollection('matching_logs');
    
    const matchedSet = new Set(logs.map(l => `${l.lead_id}_${l.prop_id}`));
    const allProps = [];
    
    inv.forEach(i => allProps.push({ collection: 'inventory', docId: i._docId || i.prop_id, prop_id: i.prop_id, project_name: i.project_name, zone: i.zone, listing_type: i.listing_type, room_type: i.room_type, price: Number(i.price) }));
    agents.forEach(a => allProps.push({ collection: 'co_agents', docId: a._docId || a.id, prop_id: a.id, project_name: a.project_zone, zone: a.project_zone, listing_type: 'ขายและเช่า', room_type: a.prop_type, price: Number(a.price) }));

    const normalize = (str) => (str || '').toLowerCase().replace(/\s+/g, '');

    for (const b of buyers) {
      for (const p of allProps) {
        if (matchedSet.has(`${b.lead_id}_${p.prop_id}`)) continue;
        
        let isTypeMatch = (b.req_listing_type === p.listing_type) || (p.listing_type === 'ขายและเช่า');
        let bZone = normalize(b.req_zone);
        let pZone = normalize(p.zone);
        let bProj = normalize(b.req_project);
        let pProj = normalize(p.project_name);
        
        let isZoneMatch = (pZone.includes(bZone) || bZone.includes(pZone));
        if (bProj && bProj !== '-' && pProj !== '-' && (pProj.includes(bProj) || bProj.includes(pProj))) isZoneMatch = true;
        if (bZone && pProj !== '-' && pProj.includes(bZone)) isZoneMatch = true;

        let isRoomMatch = p.collection === 'co_agents' ? true : (b.req_room_type === p.room_type); 
        let isPriceMatch = (p.price >= (Number(b.min_budget)||0) && p.price <= (Number(b.max_budget)||Infinity));

        if (isTypeMatch && isZoneMatch && isRoomMatch && isPriceMatch) {
          await saveDocument('matching_logs', genId('LOG'), { lead_id: b.lead_id, prop_id: p.prop_id, match_type: 'AUTO', created_at: Date.now() });
          matchedSet.add(`${b.lead_id}_${p.prop_id}`);
          
          // บันทึกสถานะจับคู่แล้ว พร้อมผูกรหัสลูกค้า (matched_buyer_id) และรหัสห้อง (matched_prop_id)
          await updateDocument(p.collection, p.docId, { 
            status: 'จับคู่แล้ว', 
            matched_buyer_id: b.lead_id 
          });
          await updateDocument('buyers', b._docId || b.lead_id, { 
            status: '✅ [ปิดงานสำเร็จ]', 
            matched_prop_id: p.prop_id 
          });
          b.status = '✅ [ปิดงานสำเร็จ]';
          
          await sendLine(`🎯 [ระบบจับคู่อัตโนมัติสำเร็จ!]\nลูกค้า: ${b.buyer_name} (${b.lead_id})\nคู่กับรหัส: ${p.prop_id} (${p.project_name})\n(ระบบซ่อนทรัพย์นี้จากหน้าเว็บ และผูกข้อมูลในหน้าแอดมินแล้ว)`);
          break; 
        }
      }
    }
  }

  try {
    if (action === 'getMapData' || action === 'getPublicListings') {
      const inv = await fetchCollection('inventory');
      const agents = await fetchCollection('co_agents');
      const publicData = [];

      // แสดงเฉพาะห้องที่ว่าง หรือติดจอง (ห้องที่จับคู่แล้ว/ปิดการขายจะถูกซ่อนจากหน้าเว็บอัตโนมัติ)
      inv.filter(i => !i.status || i.status.includes('ว่าง') || i.status.includes('Available') || i.status.includes('ติดจอง')).forEach(i => {
        publicData.push({ id: i.prop_id, source: 'Owner', type: i.listing_type, zone: i.zone, project: i.project_name, room: i.room_type, size: i.size_sqm, floor: i.floor, price: Number(i.price), status: i.status || 'ว่าง', images: extractValidImageUrls(i.images_link), lat: i.lat ? Number(i.lat) : null, lng: i.lng ? Number(i.lng) : null });
      });
      agents.filter(a => !a.status || a.status.includes('ว่าง') || a.status.includes('Available') || a.status.includes('ติดจอง')).forEach(a => {
        publicData.push({ id: a.id, source: 'Co-Agent', type: a.prop_type, zone: a.project_zone, project: a.project_zone, room: a.details, size: '-', floor: '-', price: Number(a.price), status: a.status || 'ว่าง', images: extractValidImageUrls(a.images_link), lat: a.lat ? Number(a.lat) : null, lng: a.lng ? Number(a.lng) : null });
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
      
      await saveDocument('inventory', propId, { prop_id: propId, owner_name: data.ownerName, contact: data.ownerContact, listing_type: data.listingType, zone: data.zone, project_name: data.projectName, room_type: data.roomType, size_sqm: Number(data.sizeSqm) || 0, floor: data.floor || '-', price: Number(data.price) || 0, images_link: allImages.length > 0 ? allImages.join(' , ') : '-', status: 'ว่าง', matched_buyer_id: '', lat: data.lat ? Number(data.lat) : null, lng: data.lng ? Number(data.lng) : null, created_at: Date.now() });
      await sendLine(`🏠 [ฝากห้องใหม่]\nรหัส: ${propId}\nคุณ: ${data.ownerName}\nโครงการ: ${data.projectName}\nราคา: ${Number(data.price).toLocaleString()} บ.`);
      await checkMatching();
      return res.status(200).json({ success: true, id: propId });
    }

    if (action === 'saveBuyer') {
      const leadId = genId('LEAD');
      await saveDocument('buyers', leadId, { lead_id: leadId, buyer_name: data.buyerName, contact: data.buyerContact, req_listing_type: data.reqListingType, req_zone: data.reqZone, req_project: data.reqProject || '-', req_room_type: data.reqRoomType, min_budget: Number(data.minBudget) || 0, max_budget: Number(data.maxBudget) || 0, move_in_date: data.moveInDate || '-', status: 'กำลังหาห้อง', matched_prop_id: '', created_at: Date.now() });
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
      
      await saveDocument('co_agents', coId, { id: coId, agent_name: data.agentName, company: data.company || 'อิสระ', phone: data.phone, line_id: data.lineId, prop_type: data.propType, project_zone: data.projectZone, details: data.details, price: Number(data.price) || 0, images_link: allImages.length > 0 ? allImages.join(' , ') : '-', commission_type: data.commissionType, lat: data.lat ? Number(data.lat) : null, lng: data.lng ? Number(data.lng) : null, status: 'ว่าง', matched_buyer_id: '', created_at: Date.now() });
      await sendLine(`🤝 [Co-Agent ส่งทรัพย์]\nรหัส: ${coId}\nโดย: ${data.agentName}\nโครงการ: ${data.projectZone}\nราคา: ${Number(data.price).toLocaleString()} บ.`);
      await checkMatching();
      return res.status(200).json({ success: true, id: coId });
    }

    if (action === 'getAdminData') {
      await checkMatching();
      const [inv, buyers, agents, logs] = await Promise.all([
        fetchCollection('inventory'), 
        fetchCollection('buyers'), 
        fetchCollection('co_agents'),
        fetchCollection('matching_logs')
      ]);

      // ดึงประวัติจาก matching_logs มาสำรองกรณีข้อมูลเก่าเคยจับคู่ไว้แต่ยังไม่มีฟิลด์ matched_buyer_id
      const propToBuyerMap = {};
      logs.forEach(l => { if (l.prop_id && l.lead_id) propToBuyerMap[l.prop_id] = l.lead_id; });

      const normalizeStatus = (statusStr) => {
        if (!statusStr) return 'ว่าง';
        if (statusStr.includes('ติดจอง')) return 'ติดจอง';
        if (statusStr.includes('ปิด') || statusStr.includes('จับคู่') || statusStr.includes('Sold')) return 'จับคู่แล้ว';
        return 'ว่าง';
      };

      return res.status(200).json({
        success: true,
        inventory: inv.sort((a,b) => (b.created_at||0) - (a.created_at||0)).map(i => ({ 
          row: i._docId || i.prop_id, 
          propId: i.prop_id, 
          ownerName: i.owner_name, 
          contact: i.contact, 
          type: i.listing_type, 
          zone: i.zone, 
          project: i.project_name, 
          room: i.room_type, 
          price: i.price, 
          imagesLink: i.images_link, 
          status: normalizeStatus(i.status),
          matchedBuyerId: i.matched_buyer_id !== undefined ? i.matched_buyer_id : (propToBuyerMap[i.prop_id] || '')
        })),
        buyers: buyers.sort((a,b) => (b.created_at||0) - (a.created_at||0)).map(b => ({ 
          leadId: b.lead_id, 
          buyerName: b.buyer_name, 
          contact: b.contact, 
          type: b.req_listing_type, 
          zone: b.req_zone, 
          room: b.req_room_type, 
          reqProject: b.req_project,
          minBudget: b.min_budget, 
          maxBudget: b.max_budget,
          status: b.status || 'กำลังหาห้อง',
          matchedPropId: b.matched_prop_id || ''
        })),
        coAgents: agents.sort((a,b) => (b.created_at||0) - (a.created_at||0)).map(a => ({ 
          id: a.id, 
          agentName: a.agent_name, 
          company: a.company, 
          phone: a.phone, 
          lineId: a.line_id, 
          propType: a.prop_type, 
          projectZone: a.project_zone, 
          details: a.details, 
          price: a.price, 
          imagesLink: a.images_link, 
          commissionType: a.commission_type, 
          status: normalizeStatus(a.status),
          matchedBuyerId: a.matched_buyer_id !== undefined ? a.matched_buyer_id : (propToBuyerMap[a.id] || '')
        }))
      });
    }

    // 2. อัปเดตสถานะ (ว่าง / ติดจอง / จับคู่แล้ว) รองรับทั้งตารางคลังทรัพย์และ Co-Agent
    if (action === 'updateStatus') {
      const collectionName = data.tabType === 'agent' ? 'co_agents' : 'inventory';
      const targetId = data.propId || data.row;
      const updates = { status: data.status };
      // ถ้าแอดมินเปลี่ยนสถานะกลับเป็น "ว่าง" ให้ล้างรหัสลูกค้าที่เคยจับคู่ออกด้วย
      if (data.status === 'ว่าง') updates.matched_buyer_id = '';
      
      await updateDocument(collectionName, targetId, updates);
      return res.status(200).json({ success: true });
    }

    // 3. ฟังก์ชันใหม่: แอดมินจับคู่ห้องกับลูกค้าด้วยตัวเอง (Manual Match)
    if (action === 'manualMatch') {
      const collectionName = data.tabType === 'agent' ? 'co_agents' : 'inventory';
      const propId = data.propId;
      const buyerId = data.buyerId || '';
      const newStatus = buyerId ? 'จับคู่แล้ว' : 'ว่าง';

      // อัปเดตสถานะและรหัสลูกค้าลงในตารางทรัพย์ (inventory หรือ co_agents)
      await updateDocument(collectionName, propId, {
        status: newStatus,
        matched_buyer_id: buyerId
      });

      if (buyerId) {
        // อัปเดตสถานะฝั่งลูกค้า และบันทึกประวัติลง matching_logs
        await updateDocument('buyers', buyerId, {
          status: '✅ [ปิดงานสำเร็จ]',
          matched_prop_id: propId
        });
        await saveDocument('matching_logs', genId('LOG'), {
          lead_id: buyerId,
          prop_id: propId,
          match_type: 'MANUAL_ADMIN',
          created_at: Date.now()
        });
        await sendLine(`🤝 [แอดมินจับคู่สำเร็จ - Manual Match]\nรหัสทรัพย์: ${propId}\nคู่กับลูกค้ารหัส: ${buyerId}\nสถานะ: ปิดการขาย/ซ่อนจากหน้าเว็บเรียบร้อย`);
      }

      return res.status(200).json({ success: true });
    }

    if (action === 'deleteRecord') {
      const table = data.tabType === 'inv' ? 'inventory' : data.tabType === 'buyer' ? 'buyers' : 'co_agents';
      await deleteDoc(table, data.id);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, message: 'Invalid Action' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
