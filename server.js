const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FILES = {
  reports:   path.join(__dirname, 'data', 'reports.json'),
  orders:    path.join(__dirname, 'data', 'orders.json'),
  customers: path.join(__dirname, 'data', 'customers.json'),
  casts:     path.join(__dirname, 'data', 'casts.json'),
  shifts:    path.join(__dirname, 'data', 'shifts.json'),
  traffic:   path.join(__dirname, 'data', 'traffic.json'),
  goals:     path.join(__dirname, 'data', 'goals.json'),
};

function read(file) {
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
function readObj(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function nextId(arr) {
  return arr.length === 0 ? 1 : Math.max(...arr.map(r => r.id || 0)) + 1;
}

// ────────────────────────────────────────────────────────
//  顧客管理  /api/customers
//  customers.json 構造:
//  { id, phone, name, firstVisit, lastVisit, totalVisits,
//    store, lastCast, favoriteCast, createdAt }
//
//  ★ /search と /:id は必ず /search が先
// ────────────────────────────────────────────────────────

// ── 電話番号正規化 ──
function normPhone(p) { return String(p || '').replace(/[^\d]/g, ''); }

// ── 顧客1件を orders 全件から完全再計算してcustomers.jsonを更新 ──
// phone: 正規化済み電話番号
function rebuildCustomer(phone) {
  if (!phone) return;
  const allOrders   = read(FILES.orders);
  const customers   = read(FILES.customers);
  const mine = allOrders.filter(o => normPhone(o.customerPhone) === phone && o.castName);

  // まだ顧客レコードがない場合は作成しない（オーダー経由で初回登録済みのはず）
  const idx = customers.findIndex(c => normPhone(c.phone) === phone);
  if (idx === -1) return;

  // 集計
  const visits    = mine.length;
  const sorted    = [...mine].sort((a, b) => b.date > a.date ? 1 : -1);
  const lastCast  = sorted.length > 0 ? sorted[0].castName : '';

  // よく呼ぶキャスト：castName の出現回数 → 最多
  const freq = {};
  mine.forEach(o => { freq[o.castName] = (freq[o.castName] || 0) + 1; });
  const favoriteCast = Object.keys(freq).length > 0
    ? Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
    : '';

  // 日付リスト（ソート済み）
  const dates     = sorted.map(o => o.date).filter(Boolean);
  const firstVisit = dates.length > 0 ? dates[dates.length - 1] : customers[idx].firstVisit || '';
  const lastVisit  = dates.length > 0 ? dates[0]                : customers[idx].lastVisit  || '';

  // 最後のオーダーの名前と店舗
  const lastOrder = sorted[0];
  if (lastOrder && lastOrder.customerName && lastOrder.customerName.trim()) {
    customers[idx].name = lastOrder.customerName.trim();
  }

  customers[idx].totalVisits  = visits;
  customers[idx].firstVisit   = firstVisit;
  customers[idx].lastVisit    = lastVisit;
  customers[idx].lastCast     = lastCast;
  customers[idx].favoriteCast = favoriteCast;
  if (lastOrder && lastOrder.store) customers[idx].store = lastOrder.store;

  write(FILES.customers, customers);
}

// ── オーダー保存時の新規顧客登録（電話番号が初回の場合のみレコード生成） ──
function ensureCustomer(phone, name, store, date) {
  if (!phone) return;
  const norm      = normPhone(phone);
  const customers = read(FILES.customers);
  if (customers.find(c => normPhone(c.phone) === norm)) return; // 既存なら何もしない
  customers.push({
    id:          nextId(customers),
    phone:       norm,
    name:        (name || '').trim(),
    store:       store || '',
    firstVisit:  date  || '',
    lastVisit:   date  || '',
    totalVisits: 0,
    lastCast:    '',
    favoriteCast:'',
    createdAt:   new Date().toISOString(),
  });
  write(FILES.customers, customers);
}

// ── GET /api/customers/search?phone=xxx  ★ /:id より前 ──
app.get('/api/customers/search', (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.json(null);
  const norm = String(phone).replace(/[^\d]/g, '');
  const hit  = read(FILES.customers).find(
    c => String(c.phone).replace(/[^\d]/g, '').startsWith(norm) && norm.length >= 4
  );
  res.json(hit || null);
});

// ── GET /api/customers ──
app.get('/api/customers', (_req, res) => {
  const data = read(FILES.customers);
  data.sort((a, b) => (b.lastVisit > a.lastVisit ? 1 : -1));
  res.json(data);
});

// ── GET /api/customers/:id ──
app.get('/api/customers/:id', (req, res) => {
  const row = read(FILES.customers).find(r => r.id === +req.params.id);
  row ? res.json(row) : res.status(404).json({ error: 'Not found' });
});

// ── POST /api/customers（手動登録） ──
app.post('/api/customers', (req, res) => {
  const { phone, name, store } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const customers = read(FILES.customers);
  const norm = String(phone).replace(/[^\d]/g, '');
  if (customers.find(c => String(c.phone).replace(/[^\d]/g, '') === norm)) {
    return res.status(409).json({ error: 'already exists' });
  }
  const row = {
    id: nextId(customers), phone: norm, name: (name||'').trim(),
    store: store||'', firstVisit: '', lastVisit: '', totalVisits: 0,
    createdAt: new Date().toISOString(),
  };
  customers.push(row);
  write(FILES.customers, customers);
  res.status(201).json({ id: row.id });
});

// ── PUT /api/customers/:id ──
app.put('/api/customers/:id', (req, res) => {
  const data = read(FILES.customers);
  const idx  = data.findIndex(r => r.id === +req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data[idx] = { ...data[idx], ...req.body };
  write(FILES.customers, data);
  res.json({ ok: true });
});

// ── DELETE /api/customers/:id ──
app.delete('/api/customers/:id', (req, res) => {
  write(FILES.customers, read(FILES.customers).filter(r => r.id !== +req.params.id));
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────
//  オーダー CRUD + 集計
//  構造: { id, date, store, castName, sales, castPay,
//          profit, isHonshimei, isNew, note, createdAt }
//
//  ★ /api/orders/summary は /api/orders/:id より先に定義する
//    （Express は上から順にマッチするため "summary" が :id に吸われる）
// ────────────────────────────────────────────────────────

// ── 集計ヘルパー ──
function buildSummary(rows) {
  const calc = (rs) => ({
    sales:     rs.reduce((s,r) => s + (+r.sales    || 0), 0),
    castPay:   rs.reduce((s,r) => s + (+r.castPay  || 0), 0),
    profit:    rs.reduce((s,r) => s + (+r.profit   || 0), 0),
    count:     rs.length,
    honshimei: rs.filter(r => r.isHonshimei).length,
    newCount:  rs.filter(r => r.isNew).length,
  });
  return {
    dino: calc(rows.filter(r => r.store === 'dino')),
    ai:   calc(rows.filter(r => r.store === 'ai')),
  };
}

// ── フィルタリングヘルパー ──
function filterOrders(data, q) {
  // date と month は排他的に扱う（date が優先）
  if (q.date)  data = data.filter(r => r.date === q.date);
  else if (q.month) data = data.filter(r => r.date && r.date.startsWith(q.month));
  if (q.store) data = data.filter(r => r.store === q.store);
  return data;
}

// ── GET /api/orders/summary  ★ /:id より前 ──
app.get('/api/orders/summary', (req, res) => {
  const rows = filterOrders(read(FILES.orders), req.query);
  res.json(buildSummary(rows));
});

// ── GET /api/orders ──
app.get('/api/orders', (req, res) => {
  let data = filterOrders(read(FILES.orders), req.query);
  data.sort((a, b) => b.date > a.date ? 1 : b.date < a.date ? -1 : b.id - a.id);
  res.json(data);
});

// ── GET /api/orders/:id ──
app.get('/api/orders/:id', (req, res) => {
  const row = read(FILES.orders).find(r => r.id === +req.params.id);
  row ? res.json(row) : res.status(404).json({ error: 'Not found' });
});

// ── POST /api/orders ──
app.post('/api/orders', (req, res) => {
  const data = read(FILES.orders);
  const row  = { id: nextId(data), createdAt: new Date().toISOString(), ...req.body };
  data.push(row);
  write(FILES.orders, data);
  // 新規顧客レコードを確保してから全件再計算
  const norm = normPhone(row.customerPhone);
  if (norm) {
    ensureCustomer(norm, row.customerName, row.store, row.date);
    rebuildCustomer(norm);
  }
  res.status(201).json({ id: row.id });
});

// ── PUT /api/orders/:id ──
app.put('/api/orders/:id', (req, res) => {
  const data = read(FILES.orders);
  const idx  = data.findIndex(r => r.id === +req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const oldPhone = normPhone(data[idx].customerPhone);
  data[idx] = { ...data[idx], ...req.body };
  write(FILES.orders, data);
  // 電話番号が変わった場合は旧番号も再計算
  const newPhone = normPhone(data[idx].customerPhone);
  if (newPhone) {
    ensureCustomer(newPhone, data[idx].customerName, data[idx].store, data[idx].date);
    rebuildCustomer(newPhone);
  }
  if (oldPhone && oldPhone !== newPhone) rebuildCustomer(oldPhone);
  res.json({ ok: true });
});

// ── DELETE /api/orders/:id ──
app.delete('/api/orders/:id', (req, res) => {
  const data = read(FILES.orders);
  const idx  = data.findIndex(r => r.id === +req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const phone = normPhone(data[idx].customerPhone);
  data.splice(idx, 1);
  write(FILES.orders, data);
  // 削除後も顧客情報を再計算（来店回数・最終キャストなど）
  if (phone) rebuildCustomer(phone);
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────
//  終業報告
// ────────────────────────────────────────────────────────
app.get('/api/reports', (req, res) => {
  let data = read(FILES.reports);
  const { date, month, staff } = req.query;
  if (date)  data = data.filter(r => r.date === date);
  if (month) data = data.filter(r => r.date && r.date.startsWith(month));
  if (staff) data = data.filter(r => r.staff && r.staff.includes(staff));
  data.sort((a, b) => (b.date > a.date ? 1 : -1));
  res.json(data);
});
app.get('/api/reports/:id', (req, res) => {
  const row = read(FILES.reports).find(r => r.id === +req.params.id);
  row ? res.json(row) : res.status(404).json({ error: 'Not found' });
});
app.post('/api/reports', (req, res) => {
  const data = read(FILES.reports);
  const row  = { id: nextId(data), createdAt: new Date().toISOString(), ...req.body };
  data.push(row); write(FILES.reports, data);
  res.status(201).json({ id: row.id });
});
app.put('/api/reports/:id', (req, res) => {
  const data = read(FILES.reports);
  const idx  = data.findIndex(r => r.id === +req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data[idx] = { ...data[idx], ...req.body }; write(FILES.reports, data);
  res.json({ ok: true });
});
app.delete('/api/reports/:id', (req, res) => {
  write(FILES.reports, read(FILES.reports).filter(r => r.id !== +req.params.id));
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────
//  キャスト台帳
// ────────────────────────────────────────────────────────
app.get('/api/casts', (_req, res) => res.json(read(FILES.casts)));
app.post('/api/casts', (req, res) => {
  const data = read(FILES.casts);
  const row  = { id: nextId(data), createdAt: new Date().toISOString(), active: true, ...req.body };
  data.push(row); write(FILES.casts, data);
  res.status(201).json({ id: row.id });
});
app.put('/api/casts/:id', (req, res) => {
  const data = read(FILES.casts);
  const idx  = data.findIndex(r => r.id === +req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data[idx] = { ...data[idx], ...req.body }; write(FILES.casts, data);
  res.json({ ok: true });
});
app.delete('/api/casts/:id', (req, res) => {
  write(FILES.casts, read(FILES.casts).filter(r => r.id !== +req.params.id));
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────
//  出勤管理
// ────────────────────────────────────────────────────────
app.get('/api/shifts', (req, res) => {
  let data = read(FILES.shifts);
  const { date, month } = req.query;
  if (date)  data = data.filter(r => r.date === date);
  if (month) data = data.filter(r => r.date && r.date.startsWith(month));
  res.json(data);
});
app.post('/api/shifts', (req, res) => {
  const data = read(FILES.shifts);
  const idx  = data.findIndex(r => r.date === req.body.date && r.castId === req.body.castId);
  if (idx !== -1) { data[idx] = { ...data[idx], ...req.body }; }
  else { data.push({ id: nextId(data), ...req.body }); }
  write(FILES.shifts, data); res.json({ ok: true });
});
app.delete('/api/shifts', (req, res) => {
  const { date, castId } = req.query;
  write(FILES.shifts, read(FILES.shifts).filter(
    r => !(r.date === date && String(r.castId) === String(castId))
  ));
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────
//  集客データ
// ────────────────────────────────────────────────────────
app.get('/api/traffic', (req, res) => {
  let data = read(FILES.traffic);
  const { month } = req.query;
  if (month) data = data.filter(r => r.date && r.date.startsWith(month));
  data.sort((a, b) => (b.date > a.date ? 1 : -1));
  res.json(data);
});
app.post('/api/traffic', (req, res) => {
  const data = read(FILES.traffic);
  const idx  = data.findIndex(r => r.date === req.body.date);
  if (idx !== -1) { data[idx] = { ...data[idx], ...req.body }; }
  else { data.push({ id: nextId(data), ...req.body }); }
  write(FILES.traffic, data); res.json({ ok: true });
});

// ────────────────────────────────────────────────────────
//  月間目標
// ────────────────────────────────────────────────────────
app.get('/api/goals', (req, res) => {
  const goals = readObj(FILES.goals);
  const { month } = req.query;
  res.json(month ? (goals[month] || {}) : goals);
});
app.post('/api/goals', (req, res) => {
  const goals = readObj(FILES.goals);
  const { month, ...values } = req.body;
  if (!month) return res.status(400).json({ error: 'month required' });
  goals[month] = { ...goals[month], ...values };
  write(FILES.goals, goals); res.json({ ok: true });
});

// ────────────────────────────────────────────────────────
//  集計 /api/stats（ダッシュボード用・reportsベース）
// ────────────────────────────────────────────────────────
const TEL_SLOTS = ['tel_9_12','tel_12_15','tel_15_18','tel_18_21','tel_21_24','tel_24_27'];

function calcMetrics(rows, storeKey) {
  const xs = rows.map(r => r[storeKey] || {});
  const sales      = xs.reduce((s,x) => s+(+x.sales     ||0), 0);
  const profit     = xs.reduce((s,x) => s+(+x.profit    ||0), 0);
  const count      = xs.reduce((s,x) => s+(+x.count     ||0), 0);
  const honshimei  = xs.reduce((s,x) => s+(+x.honshimei ||0), 0);
  const tel        = xs.reduce((s,x) => s+(+x.tel       ||0), 0);
  const kadouSum   = xs.reduce((s,x) => s+(+x.kadou     ||0), 0);
  const activeDates = rows.filter(r => {
    const x = r[storeKey] || {};
    return (+x.sales||0)+(+x.count||0)+(+x.tel||0)+(+x.kadou||0) > 0;
  }).map(r => r.date);
  const eigyoDays  = new Set(activeDates).size;
  const kadouAvg   = eigyoDays>0 ? Math.round(kadouSum/eigyoDays*10)/10 : 0;
  const avgTanka      = count>0 ? Math.round(sales    /count*10)/10 : 0;
  const honshimeiRate = count>0 ? Math.round(honshimei/count*1000)/10 : 0;
  const seiyakuRate   = tel  >0 ? Math.round(count    /tel  *1000)/10 : 0;
  const telBySlot = {};
  TEL_SLOTS.forEach(s => { telBySlot[s] = xs.reduce((acc,x) => acc+(+x[s]||0), 0); });
  return { sales, profit, count, honshimei, tel, kadouSum, kadouAvg, eigyoDays,
           avgTanka, honshimeiRate, seiyakuRate, telBySlot };
}

function calcTotal(rows) {
  const merged = rows.map(r => {
    const d = r.dino||{}, a = r.ai||{};
    const m = {};
    ['sales','profit','count','honshimei','tel','kadou'].forEach(k => { m[k]=(+d[k]||0)+(+a[k]||0); });
    TEL_SLOTS.forEach(s => { m[s]=(+d[s]||0)+(+a[s]||0); });
    return m;
  });
  const sales      = merged.reduce((s,x) => s+x.sales,     0);
  const profit     = merged.reduce((s,x) => s+x.profit,    0);
  const count      = merged.reduce((s,x) => s+x.count,     0);
  const honshimei  = merged.reduce((s,x) => s+x.honshimei, 0);
  const tel        = merged.reduce((s,x) => s+x.tel,       0);
  const kadouSum   = merged.reduce((s,x) => s+x.kadou,     0);
  const eigyoDays  = new Set(rows.map(r => r.date)).size;
  const kadouAvg   = eigyoDays>0 ? Math.round(kadouSum/eigyoDays*10)/10 : 0;
  const avgTanka      = count>0 ? Math.round(sales    /count*10)/10 : 0;
  const honshimeiRate = count>0 ? Math.round(honshimei/count*1000)/10 : 0;
  const seiyakuRate   = tel  >0 ? Math.round(count    /tel  *1000)/10 : 0;
  const telBySlot = {};
  TEL_SLOTS.forEach(s => { telBySlot[s] = merged.reduce((acc,x) => acc+(+x[s]||0), 0); });
  return { sales, profit, count, honshimei, tel, kadouSum, kadouAvg, eigyoDays,
           avgTanka, honshimeiRate, seiyakuRate, telBySlot };
}

app.get('/api/stats', (req, res) => {
  const { month } = req.query;
  let reports = read(FILES.reports);
  if (month) reports = reports.filter(r => r.date && r.date.startsWith(month));
  const dayMap = {};
  reports.forEach(r => {
    const d = r.dino||{}, a = r.ai||{};
    if (!dayMap[r.date]) dayMap[r.date] = {
      date:r.date, dino_sales:0,dino_count:0,dino_kadou:0,
      ai_sales:0,ai_count:0,ai_kadou:0
    };
    dayMap[r.date].dino_sales += +d.sales||0;
    dayMap[r.date].dino_count += +d.count||0;
    dayMap[r.date].dino_kadou += +d.kadou||0;
    dayMap[r.date].ai_sales   += +a.sales||0;
    dayMap[r.date].ai_count   += +a.count||0;
    dayMap[r.date].ai_kadou   += +a.kadou||0;
  });
  const daily = Object.values(dayMap)
    .sort((a,b) => (a.date>b.date?1:-1))
    .map(d => ({...d, total_sales: d.dino_sales+d.ai_sales}));
  const goals = month ? (readObj(FILES.goals)[month]||{}) : {};
  res.json({ dino:calcMetrics(reports,'dino'), ai:calcMetrics(reports,'ai'),
             total:calcTotal(reports), daily, goals });
});

// ────────────────────────────────────────────────────────
const PORT = 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('✅ サーバーが起動しました！');
  console.log(`👉 ブラウザで開いてください: http://localhost:${PORT}`);
  console.log('終了: Ctrl + C');
  console.log('');
});
