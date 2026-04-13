// ============================================================
//  server.js  ― Supabase（PostgreSQL）対応版
//
//  【変更点まとめ】
//  ・fs（ファイル保存）を全廃し、Supabaseに保存するように変更
//  ・read() / write() の代わりに db系ヘルパー関数を使用
//  ・APIのURL・レスポンス形式・フロントのHTMLは一切変更なし
//
//  【必要な環境変数（.env または Render の Environment）】
//  SUPABASE_URL  = https://xxxx.supabase.co
//  SUPABASE_KEY  = eyJ...（anon/public キー）
//  PORT          = 3000（Renderは自動設定のため不要）
// ============================================================

const express = require('express');
const path    = require('path');
const cors    = require('cors');
const { createClient } = require('@supabase/supabase-js');

// ── ローカル開発時だけ .env を読み込む ────────────────────
// Render本番では環境変数を直接設定するのでdotenvは不要
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv未インストールでも無視 */ }
}

// ── Expressの基本設定 ──────────────────────────────────────
const app = express();
app.use(cors());                                           // CORS許可
app.use(express.json());                                   // JSONボディを解析
app.use(express.static(path.join(__dirname, 'public')));  // フロントHTML配信

// ============================================================
//  Supabase クライアント初期化
//  ・SUPABASE_URL と SUPABASE_KEY は環境変数から取得
//  ・どちらかが未設定の場合、起動時にエラーになる
// ============================================================
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL または SUPABASE_KEY が設定されていません');
  console.error('   .env ファイルまたは Render の Environment に設定してください');
  process.exit(1); // 環境変数なしでは起動しない
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ============================================================
//  【DB ヘルパー関数】
//
//  Supabaseのテーブル構造:
//    orders    → id, date, store, data(JSONB), created_at
//    customers → id, phone(UNIQUE), data(JSONB), updated_at
//    reports   → id, date, data(JSONB), created_at
//    casts     → id, data(JSONB), created_at
//    shifts    → id, date, cast_id, data(JSONB)  ※UNIQUE(date,cast_id)
//    traffic   → id, date(UNIQUE), data(JSONB), updated_at
//    goals     → month(PRIMARY KEY), data(JSONB)
//
//  アプリは「フラットなオブジェクト」を使うが、
//  DBは一部のキー列（date/store/phone等）+ data(JSONB)の構造。
//  flattenRow → DBの行をアプリ用フラットオブジェクトに変換
//  toDbRow    → アプリ用オブジェクトをDB行形式に変換
// ============================================================

// DBの行 → アプリが使うフラットなオブジェクトに変換
function flattenRow(table, row) {
  if (!row) return null;
  switch (table) {
    case 'orders':
      // id・date・store はDB列、残りは data(JSONB) に入っている
      return { id: row.id, date: row.date, store: row.store,
               createdAt: row.created_at, ...row.data };
    case 'customers':
      // id・phone はDB列、残りは data(JSONB)
      return { id: row.id, phone: row.phone, ...row.data };
    case 'reports':
      // id・date はDB列、残りは data(JSONB)（staff/dino/ai/miss/improve/handover等）
      return { id: row.id, date: row.date, createdAt: row.created_at, ...row.data };
    case 'casts':
      // id だけDB列、残りは data(JSONB)（name/status/period/note等）
      return { id: row.id, createdAt: row.created_at, ...row.data };
    case 'shifts':
      // id・date・cast_id はDB列（※cast_id → castId に変換）、残りはdata(JSONB)
      return { id: row.id, date: row.date, castId: row.cast_id, ...row.data };
    case 'traffic':
      return { id: row.id, date: row.date, ...row.data };
    default:
      return row;
  }
}

// アプリのフラットオブジェクト → DBに保存する形式に変換
function toDbRow(table, obj) {
  switch (table) {
    case 'orders': {
      // date・store をDB列に分離し、残りをdata(JSONB)に格納
      const { id, date, store, createdAt, ...rest } = obj;
      return { date: date || '', store: store || '', data: rest };
    }
    case 'customers': {
      // phone をDB列に分離（数字のみに正規化）
      const { id, phone, ...rest } = obj;
      return { phone: normPhone(phone), data: rest };
    }
    case 'reports': {
      const { id, date, createdAt, ...rest } = obj;
      return { date: date || '', data: rest };
    }
    case 'casts': {
      const { id, createdAt, ...rest } = obj;
      return { data: rest };
    }
    case 'shifts': {
      // castId → cast_id に変換
      const { id, date, castId, ...rest } = obj;
      return { date: date || '', cast_id: castId || 0, data: rest };
    }
    case 'traffic': {
      const { id, date, ...rest } = obj;
      return { date: date || '', data: rest };
    }
    default:
      return obj;
  }
}

// INSERT して挿入された行を返す
async function dbInsert(table, obj) {
  const row = toDbRow(table, obj);
  const { data, error } = await supabase
    .from(table).insert(row).select().single();
  if (error) throw error;
  return flattenRow(table, data);
}

// UPDATE（id指定）
async function dbUpdate(table, id, obj) {
  const row = toDbRow(table, obj);
  const { error } = await supabase.from(table).update(row).eq('id', id);
  if (error) throw error;
}

// DELETE（id指定）
async function dbDelete(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

// id指定で1件取得
async function dbFindById(table, id) {
  const { data, error } = await supabase
    .from(table).select('*').eq('id', id).single();
  if (error) return null;
  return flattenRow(table, data);
}

// goals テーブルは month が主キーなので専用関数
async function dbReadGoals(month) {
  if (month) {
    // 特定月だけ取得
    const { data } = await supabase.from('goals').select('*')
      .eq('month', month).single();
    return data ? data.data : {};
  }
  // 全月取得
  const { data } = await supabase.from('goals').select('*');
  const obj = {};
  (data || []).forEach(r => { obj[r.month] = r.data; });
  return obj;
}

async function dbUpsertGoal(month, values) {
  const { error } = await supabase.from('goals')
    .upsert({ month, data: values }, { onConflict: 'month' });
  if (error) throw error;
}

// ============================================================
//  ユーティリティ
// ============================================================

// 電話番号を数字のみに正規化（例: 090-1234-5678 → 09012345678）
function normPhone(p) {
  return String(p || '').replace(/[^\d]/g, '');
}

// エラーレスポンスを送信（エラーをconsole.errorにも出力）
function sendErr(res, err) {
  console.error('[ERROR]', err.message || err);
  res.status(500).json({ error: String(err.message || err) });
}

// ============================================================
//  顧客関連ヘルパー
//  オーダー保存のたびに customers.data を再計算して更新する
// ============================================================

// 顧客1件を orders 全件から完全再計算（保存・編集・削除後に呼ぶ）
async function rebuildCustomer(phone) {
  if (!phone) return;
  const norm = normPhone(phone);

  // まず customers に存在するか確認（なければ何もしない）
  const { data: custRow } = await supabase.from('customers')
    .select('*').eq('phone', norm).single();
  if (!custRow) return;

  // この電話番号のオーダーを全件取得
  // ※ data->>'customerPhone' = norm という条件で絞る
  const { data: orderRows } = await supabase.from('orders')
    .select('*').filter('data->>customerPhone', 'eq', norm);

  // キャスト名があるオーダーだけを使って集計
  const mine   = (orderRows || []).map(r => flattenRow('orders', r)).filter(o => o.castName);
  const sorted = [...mine].sort((a, b) => (b.date > a.date ? 1 : -1));

  // よく呼ぶキャスト（出現回数が最多）
  const freq = {};
  mine.forEach(o => { freq[o.castName] = (freq[o.castName] || 0) + 1; });
  const favoriteCast = Object.keys(freq).length > 0
    ? Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
    : '';

  const dates      = sorted.map(o => o.date).filter(Boolean);
  const lastOrder  = sorted[0];
  const existData  = custRow.data || {};

  // customers.data を更新
  const updatedData = {
    ...existData,
    totalVisits:  mine.length,
    firstVisit:   dates.length > 0 ? dates[dates.length - 1] : existData.firstVisit || '',
    lastVisit:    dates.length > 0 ? dates[0]                : existData.lastVisit  || '',
    lastCast:     lastOrder ? lastOrder.castName             : existData.lastCast   || '',
    favoriteCast,
    store:        lastOrder ? lastOrder.store                : existData.store      || '',
    // 最新オーダーに名前があれば更新
    name:         lastOrder?.customerName?.trim() || existData.name || '',
  };

  await supabase.from('customers')
    .update({ data: updatedData }).eq('phone', norm);
}

// 初回来店時に customers にレコードを作成する（既存なら何もしない）
async function ensureCustomer(phone, name, store, date) {
  if (!phone) return;
  const norm = normPhone(phone);

  // 既存チェック
  const { data: existing } = await supabase.from('customers')
    .select('id').eq('phone', norm).single();
  if (existing) return; // すでに存在するので作成しない

  await supabase.from('customers').insert({
    phone: norm,
    data: {
      name:        (name || '').trim(),
      store:       store || '',
      firstVisit:  date  || '',
      lastVisit:   date  || '',
      totalVisits: 0,
      lastCast:    '',
      favoriteCast:'',
      createdAt:   new Date().toISOString(),
    }
  });
}

// ============================================================
//  API: 顧客管理  /api/customers
//  ★ /search は /:id より前に定義する（Expressはルートを上から順に評価する）
// ============================================================

// 電話番号前方一致検索（オーダー入力フォームのオートフィル用）
app.get('/api/customers/search', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.json(null);
    const norm = normPhone(phone);
    if (norm.length < 4) return res.json(null); // 4桁未満は検索しない

    const { data } = await supabase.from('customers')
      .select('*').like('phone', `${norm}%`).limit(1).single();
    res.json(data ? flattenRow('customers', data) : null);
  } catch {
    res.json(null); // 見つからなくてもエラーにしない
  }
});

// 顧客一覧（最終来店の新しい順）
app.get('/api/customers', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('customers')
      .select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(r => flattenRow('customers', r)));
  } catch (e) { sendErr(res, e); }
});

// 顧客詳細（オーダー履歴・キャスト集計つき）
app.get('/api/customers/:id', async (req, res) => {
  try {
    const { data: custRow, error } = await supabase.from('customers')
      .select('*').eq('id', req.params.id).single();
    if (error || !custRow) return res.status(404).json({ error: 'Not found' });

    const customer = flattenRow('customers', custRow);
    const norm     = normPhone(customer.phone);

    // この顧客のオーダー履歴（新しい順）
    const { data: orderRows } = await supabase.from('orders')
      .select('*').filter('data->>customerPhone', 'eq', norm)
      .order('date', { ascending: false });
    const myOrders = (orderRows || []).map(r => flattenRow('orders', r));

    // キャスト別集計
    const castFreq = {};
    myOrders.forEach(o => {
      if (o.castName) castFreq[o.castName] = (castFreq[o.castName] || 0) + 1;
    });
    const castHistory = Object.entries(castFreq)
      .map(([cast, count]) => ({ cast, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ ...customer, orders: myOrders, castHistory });
  } catch (e) { sendErr(res, e); }
});

// 顧客手動登録
app.post('/api/customers', async (req, res) => {
  try {
    const { phone, name, store } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const norm = normPhone(phone);

    // 重複チェック
    const { data: existing } = await supabase.from('customers')
      .select('id').eq('phone', norm).single();
    if (existing) return res.status(409).json({ error: 'already exists' });

    const { data, error } = await supabase.from('customers').insert({
      phone: norm,
      data: {
        name: (name || '').trim(), store: store || '',
        firstVisit: '', lastVisit: '', totalVisits: 0,
        lastCast: '', favoriteCast: '',
        createdAt: new Date().toISOString(),
      }
    }).select().single();
    if (error) throw error;
    res.status(201).json({ id: data.id });
  } catch (e) { sendErr(res, e); }
});

// 顧客情報更新
app.put('/api/customers/:id', async (req, res) => {
  try {
    const cur = await dbFindById('customers', req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const { id, phone, ...rest } = req.body; // id/phone は更新しない
    await supabase.from('customers')
      .update({ data: { ...cur, ...rest } }).eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// 顧客削除
app.delete('/api/customers/:id', async (req, res) => {
  try {
    await dbDelete('customers', req.params.id);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// ============================================================
//  API: オーダー  /api/orders
//  ★ /summary は /:id より前に定義する
// ============================================================

// 集計ヘルパー（店舗別KPIを計算）
function buildSummary(rows) {
  const calc = rs => ({
    sales:     rs.reduce((s, r) => s + (+r.sales    || 0), 0),
    castPay:   rs.reduce((s, r) => s + (+r.castPay  || 0), 0),
    profit:    rs.reduce((s, r) => s + (+r.profit   || 0), 0),
    count:     rs.length,
    honshimei: rs.filter(r => r.isHonshimei).length,
    newCount:  rs.filter(r => r.isNew).length,
  });
  return {
    dino: calc(rows.filter(r => r.store === 'dino')),
    ai:   calc(rows.filter(r => r.store === 'ai')),
  };
}

// 日付 or 月でオーダー集計（リアルタイム集計カード用）
app.get('/api/orders/summary', async (req, res) => {
  try {
    const { date, month } = req.query;
    let q = supabase.from('orders').select('*');
    if (date)        q = q.eq('date', date);
    else if (month)  q = q.like('date', `${month}%`);
    const { data, error } = await q;
    if (error) throw error;
    res.json(buildSummary((data || []).map(r => flattenRow('orders', r))));
  } catch (e) { sendErr(res, e); }
});

// オーダー一覧（日付・月・店舗フィルタ対応）
app.get('/api/orders', async (req, res) => {
  try {
    const { date, month, store } = req.query;
    // date と month は排他的に使う（date が優先）
    let q = supabase.from('orders').select('*').order('date', { ascending: false });
    if (date)        q = q.eq('date', date);
    else if (month)  q = q.like('date', `${month}%`);
    if (store)       q = q.eq('store', store);
    const { data, error } = await q;
    if (error) throw error;
    res.json((data || []).map(r => flattenRow('orders', r)));
  } catch (e) { sendErr(res, e); }
});

// オーダー1件取得
app.get('/api/orders/:id', async (req, res) => {
  try {
    const row = await dbFindById('orders', req.params.id);
    row ? res.json(row) : res.status(404).json({ error: 'Not found' });
  } catch (e) { sendErr(res, e); }
});

// オーダー新規保存（→ 顧客情報も更新）
app.post('/api/orders', async (req, res) => {
  try {
    const inserted = await dbInsert('orders', req.body);
    // 電話番号があれば顧客を作成・更新
    const phone = normPhone(req.body.customerPhone);
    if (phone) {
      await ensureCustomer(phone, req.body.customerName, req.body.store, req.body.date);
      await rebuildCustomer(phone);
    }
    res.status(201).json({ id: inserted.id });
  } catch (e) { sendErr(res, e); }
});

// オーダー更新（→ 顧客情報も再計算）
app.put('/api/orders/:id', async (req, res) => {
  try {
    const old = await dbFindById('orders', req.params.id);
    if (!old) return res.status(404).json({ error: 'Not found' });
    const oldPhone = normPhone(old.customerPhone);
    await dbUpdate('orders', req.params.id, { ...old, ...req.body });
    const newPhone = normPhone(req.body.customerPhone);
    if (newPhone) {
      await ensureCustomer(newPhone, req.body.customerName, req.body.store, req.body.date);
      await rebuildCustomer(newPhone);
    }
    // 電話番号が変わった場合は旧番号も再計算
    if (oldPhone && oldPhone !== newPhone) await rebuildCustomer(oldPhone);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// オーダー削除（→ 顧客情報も再計算）
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const old = await dbFindById('orders', req.params.id);
    const phone = old ? normPhone(old.customerPhone) : '';
    await dbDelete('orders', req.params.id);
    if (phone) await rebuildCustomer(phone); // 削除後に再計算
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// ============================================================
//  API: 終業報告  /api/reports
// ============================================================
app.get('/api/reports', async (req, res) => {
  try {
    const { date, month, staff } = req.query;
    let q = supabase.from('reports').select('*').order('date', { ascending: false });
    if (date)        q = q.eq('date', date);
    else if (month)  q = q.like('date', `${month}%`);
    const { data, error } = await q;
    if (error) throw error;
    let rows = (data || []).map(r => flattenRow('reports', r));
    // staff 絞り込みはDB側のJSONB検索が複雑なのでJS側でフィルタ
    if (staff) rows = rows.filter(r => r.staff && r.staff.includes(staff));
    res.json(rows);
  } catch (e) { sendErr(res, e); }
});

app.get('/api/reports/:id', async (req, res) => {
  try {
    const row = await dbFindById('reports', req.params.id);
    row ? res.json(row) : res.status(404).json({ error: 'Not found' });
  } catch (e) { sendErr(res, e); }
});

app.post('/api/reports', async (req, res) => {
  try {
    const inserted = await dbInsert('reports', req.body);
    res.status(201).json({ id: inserted.id });
  } catch (e) { sendErr(res, e); }
});

app.put('/api/reports/:id', async (req, res) => {
  try {
    const old = await dbFindById('reports', req.params.id);
    if (!old) return res.status(404).json({ error: 'Not found' });
    await dbUpdate('reports', req.params.id, { ...old, ...req.body });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

app.delete('/api/reports/:id', async (req, res) => {
  try {
    await dbDelete('reports', req.params.id);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// ============================================================
//  API: キャスト台帳  /api/casts
// ============================================================
app.get('/api/casts', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('casts').select('*').order('id');
    if (error) throw error;
    res.json((data || []).map(r => flattenRow('casts', r)));
  } catch (e) { sendErr(res, e); }
});

app.post('/api/casts', async (req, res) => {
  try {
    const inserted = await dbInsert('casts', { ...req.body, active: true });
    res.status(201).json({ id: inserted.id });
  } catch (e) { sendErr(res, e); }
});

app.put('/api/casts/:id', async (req, res) => {
  try {
    const old = await dbFindById('casts', req.params.id);
    if (!old) return res.status(404).json({ error: 'Not found' });
    await dbUpdate('casts', req.params.id, { ...old, ...req.body });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

app.delete('/api/casts/:id', async (req, res) => {
  try {
    await dbDelete('casts', req.params.id);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// ============================================================
//  API: 出勤管理  /api/shifts
// ============================================================
app.get('/api/shifts', async (req, res) => {
  try {
    const { date, month } = req.query;
    let q = supabase.from('shifts').select('*');
    if (date)        q = q.eq('date', date);
    else if (month)  q = q.like('date', `${month}%`);
    const { data, error } = await q;
    if (error) throw error;
    res.json((data || []).map(r => flattenRow('shifts', r)));
  } catch (e) { sendErr(res, e); }
});

app.post('/api/shifts', async (req, res) => {
  try {
    const { date, castId, ...rest } = req.body;
    // 同じ date + castId の組み合わせがあれば更新、なければ挿入（UPSERT）
    const { error } = await supabase.from('shifts')
      .upsert(
        { date: date || '', cast_id: castId || 0, data: rest },
        { onConflict: 'date,cast_id' }
      );
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

app.delete('/api/shifts', async (req, res) => {
  try {
    const { date, castId } = req.query;
    const { error } = await supabase.from('shifts')
      .delete().eq('date', date).eq('cast_id', castId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// ============================================================
//  API: 集客データ  /api/traffic
// ============================================================
app.get('/api/traffic', async (req, res) => {
  try {
    const { month } = req.query;
    let q = supabase.from('traffic').select('*').order('date', { ascending: false });
    if (month) q = q.like('date', `${month}%`);
    const { data, error } = await q;
    if (error) throw error;
    res.json((data || []).map(r => flattenRow('traffic', r)));
  } catch (e) { sendErr(res, e); }
});

app.post('/api/traffic', async (req, res) => {
  try {
    const { date, ...rest } = req.body;
    const { error } = await supabase.from('traffic')
      .upsert({ date: date || '', data: rest }, { onConflict: 'date' });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// ============================================================
//  API: 月間目標  /api/goals
// ============================================================
app.get('/api/goals', async (req, res) => {
  try {
    res.json(await dbReadGoals(req.query.month));
  } catch (e) { sendErr(res, e); }
});

app.post('/api/goals', async (req, res) => {
  try {
    const { month, ...values } = req.body;
    if (!month) return res.status(400).json({ error: 'month required' });
    const existing = await dbReadGoals(month); // 既存データとマージ
    await dbUpsertGoal(month, { ...existing, ...values });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// ============================================================
//  API: ダッシュボード集計  /api/stats
//  reports テーブルをベースに月次KPIを集計して返す
// ============================================================
const TEL_SLOTS = ['tel_9_12','tel_12_15','tel_15_18','tel_18_21','tel_21_24','tel_24_27'];

function calcMetrics(rows, storeKey) {
  const xs           = rows.map(r => r[storeKey] || {});
  const sales        = xs.reduce((s, x) => s + (+x.sales     || 0), 0);
  const profit       = xs.reduce((s, x) => s + (+x.profit    || 0), 0);
  const count        = xs.reduce((s, x) => s + (+x.count     || 0), 0);
  const honshimei    = xs.reduce((s, x) => s + (+x.honshimei || 0), 0);
  const tel          = xs.reduce((s, x) => s + (+x.tel       || 0), 0);
  const kadouSum     = xs.reduce((s, x) => s + (+x.kadou     || 0), 0);
  const activeDates  = rows.filter(r => {
    const x = r[storeKey] || {};
    return (+x.sales || 0) + (+x.count || 0) + (+x.tel || 0) + (+x.kadou || 0) > 0;
  }).map(r => r.date);
  const eigyoDays    = new Set(activeDates).size;
  const kadouAvg     = eigyoDays > 0 ? Math.round(kadouSum  / eigyoDays * 10) / 10 : 0;
  const avgTanka     = count  > 0 ? Math.round(sales     / count  * 10)   / 10 : 0;
  const honshimeiRate= count  > 0 ? Math.round(honshimei / count  * 1000) / 10 : 0;
  const seiyakuRate  = tel    > 0 ? Math.round(count     / tel    * 1000) / 10 : 0;
  const telBySlot    = {};
  TEL_SLOTS.forEach(s => { telBySlot[s] = xs.reduce((acc, x) => acc + (+x[s] || 0), 0); });
  return { sales, profit, count, honshimei, tel, kadouSum, kadouAvg, eigyoDays,
           avgTanka, honshimeiRate, seiyakuRate, telBySlot };
}

function calcTotal(rows) {
  const merged = rows.map(r => {
    const d = r.dino || {}, a = r.ai || {}, m = {};
    ['sales','profit','count','honshimei','tel','kadou'].forEach(k => {
      m[k] = (+d[k] || 0) + (+a[k] || 0);
    });
    TEL_SLOTS.forEach(s => { m[s] = (+d[s] || 0) + (+a[s] || 0); });
    return m;
  });
  const sum = k => merged.reduce((acc, x) => acc + x[k], 0);
  const sales = sum('sales'), profit = sum('profit'), count = sum('count');
  const honshimei = sum('honshimei'), tel = sum('tel'), kadouSum = sum('kadou');
  const eigyoDays    = new Set(rows.map(r => r.date)).size;
  const kadouAvg     = eigyoDays > 0 ? Math.round(kadouSum  / eigyoDays * 10)  / 10 : 0;
  const avgTanka     = count  > 0 ? Math.round(sales     / count  * 10)    / 10 : 0;
  const honshimeiRate= count  > 0 ? Math.round(honshimei / count  * 1000)  / 10 : 0;
  const seiyakuRate  = tel    > 0 ? Math.round(count     / tel    * 1000)  / 10 : 0;
  const telBySlot    = {};
  TEL_SLOTS.forEach(s => { telBySlot[s] = merged.reduce((acc, x) => acc + (+x[s] || 0), 0); });
  return { sales, profit, count, honshimei, tel, kadouSum, kadouAvg, eigyoDays,
           avgTanka, honshimeiRate, seiyakuRate, telBySlot };
}

app.get('/api/stats', async (req, res) => {
  try {
    const { month } = req.query;
    let q = supabase.from('reports').select('*');
    if (month) q = q.like('date', `${month}%`);
    const { data, error } = await q;
    if (error) throw error;
    const reports = (data || []).map(r => flattenRow('reports', r));

    // 日別推移データを作成
    const dayMap = {};
    reports.forEach(r => {
      const d = r.dino || {}, a = r.ai || {};
      if (!dayMap[r.date]) dayMap[r.date] = {
        date: r.date,
        dino_sales: 0, dino_count: 0, dino_kadou: 0,
        ai_sales:   0, ai_count:   0, ai_kadou:   0,
      };
      dayMap[r.date].dino_sales += +d.sales || 0;
      dayMap[r.date].dino_count += +d.count || 0;
      dayMap[r.date].dino_kadou += +d.kadou || 0;
      dayMap[r.date].ai_sales   += +a.sales || 0;
      dayMap[r.date].ai_count   += +a.count || 0;
      dayMap[r.date].ai_kadou   += +a.kadou || 0;
    });
    const daily = Object.values(dayMap)
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .map(d => ({ ...d, total_sales: d.dino_sales + d.ai_sales }));

    const goals = month ? await dbReadGoals(month) : {};
    res.json({
      dino:  calcMetrics(reports, 'dino'),
      ai:    calcMetrics(reports, 'ai'),
      total: calcTotal(reports),
      daily,
      goals,
    });
  } catch (e) { sendErr(res, e); }
});

// ============================================================
//  ヘルスチェック（Renderのデプロイ確認用）
// ============================================================
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ============================================================
//  サーバー起動
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('✅ サーバーが起動しました！');
  console.log(`👉 ブラウザで開く: http://localhost:${PORT}`);
  console.log(`📡 Supabase URL : ${process.env.SUPABASE_URL}`);
  console.log('終了: Ctrl + C');
  console.log('');
});
