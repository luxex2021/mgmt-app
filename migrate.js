// ============================================================
//  migrate.js  ― 既存JSONファイルをSupabaseに移行するスクリプト
//
//  【使い方】
//  ① .env に SUPABASE_URL と SUPABASE_KEY を設定する
//  ② node migrate.js を実行する
//  ③ 移行完了のメッセージが出たら、Render に新しいserver.jsをデプロイする
//
//  【注意】
//  ・このスクリプトは1回だけ実行する
//  ・2回実行しても同じIDのデータはスキップされる（upsertのため安全）
//  ・data/ フォルダが存在しない場合はそのテーブルをスキップする
// ============================================================

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ローカルの .env を読み込む
try { require('dotenv').config(); } catch (e) {}

// 環境変数チェック
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL または SUPABASE_KEY が設定されていません');
  console.error('   .env ファイルに設定してから再実行してください');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const DATA_DIR = path.join(__dirname, 'data');

// JSONファイルを読み込む（存在しなければ空配列 or 空オブジェクトを返す）
function readJson(filename, asArray = true) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.log(`  ⚠️  ${filename} が見つかりません（スキップ）`);
    return asArray ? [] : {};
  }
  try {
    const content = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return content;
  } catch (e) {
    console.error(`  ❌ ${filename} の読み込みに失敗: ${e.message}`);
    return asArray ? [] : {};
  }
}

async function main() {
  console.log('');
  console.log('🚀 Supabase へのデータ移行を開始します...');
  console.log(`   URL: ${process.env.SUPABASE_URL}`);
  console.log('');

  // ──────────────────────────────────────────────────────────
  //  orders.json → orders テーブル
  //  { id, date, store, createdAt, castName, sales, ... }
  //  → DB: { id, date, store, data:{castName,sales,...}, created_at }
  // ──────────────────────────────────────────────────────────
  console.log('📦 orders を移行中...');
  const orders = readJson('orders.json');
  if (orders.length > 0) {
    const rows = orders.map(o => {
      const { id, date, store, createdAt, ...rest } = o;
      return {
        id,
        date:       date    || '',
        store:      store   || '',
        data:       rest,                                    // 残りのフィールドをJSONBに
        created_at: createdAt || new Date().toISOString(),
      };
    });
    // onConflict:'id' → 同じIDが既にあればスキップ（2回実行しても安全）
    const { error } = await supabase.from('orders').upsert(rows, { onConflict: 'id' });
    if (error) console.error('  ❌ ordersエラー:', error.message);
    else       console.log(`  ✅ ${rows.length} 件を移行しました`);
  }

  // ──────────────────────────────────────────────────────────
  //  customers.json → customers テーブル
  //  { id, phone, name, firstVisit, lastVisit, ... }
  //  → DB: { id, phone, data:{name,firstVisit,...} }
  // ──────────────────────────────────────────────────────────
  console.log('📦 customers を移行中...');
  const customers = readJson('customers.json');
  if (customers.length > 0) {
    const rows = customers.map(c => {
      const { id, phone, createdAt, ...rest } = c;
      return {
        id,
        phone:      (phone || '').replace(/[^\d]/g, ''),    // 電話番号を数字のみに正規化
        data:       rest,
        updated_at: createdAt || new Date().toISOString(),
      };
    });
    const { error } = await supabase.from('customers').upsert(rows, { onConflict: 'id' });
    if (error) console.error('  ❌ customersエラー:', error.message);
    else       console.log(`  ✅ ${rows.length} 件を移行しました`);
  }

  // ──────────────────────────────────────────────────────────
  //  reports.json → reports テーブル
  //  { id, date, staff, dino:{...}, ai:{...}, miss, ... }
  //  → DB: { id, date, data:{staff,dino,ai,miss,...} }
  // ──────────────────────────────────────────────────────────
  console.log('📦 reports を移行中...');
  const reports = readJson('reports.json');
  if (reports.length > 0) {
    const rows = reports.map(r => {
      const { id, date, createdAt, ...rest } = r;
      return {
        id,
        date:       date    || '',
        data:       rest,
        created_at: createdAt || new Date().toISOString(),
      };
    });
    const { error } = await supabase.from('reports').upsert(rows, { onConflict: 'id' });
    if (error) console.error('  ❌ reportsエラー:', error.message);
    else       console.log(`  ✅ ${rows.length} 件を移行しました`);
  }

  // ──────────────────────────────────────────────────────────
  //  casts.json → casts テーブル
  //  { id, name, status, period, note, createdAt }
  //  → DB: { id, data:{name,status,...} }
  // ──────────────────────────────────────────────────────────
  console.log('📦 casts を移行中...');
  const casts = readJson('casts.json');
  if (casts.length > 0) {
    const rows = casts.map(c => {
      const { id, createdAt, ...rest } = c;
      return {
        id,
        data:       rest,
        created_at: createdAt || new Date().toISOString(),
      };
    });
    const { error } = await supabase.from('casts').upsert(rows, { onConflict: 'id' });
    if (error) console.error('  ❌ castsエラー:', error.message);
    else       console.log(`  ✅ ${rows.length} 件を移行しました`);
  }

  // ──────────────────────────────────────────────────────────
  //  shifts.json → shifts テーブル
  //  { id, date, castId, status }
  //  → DB: { id, date, cast_id, data:{status} }
  // ──────────────────────────────────────────────────────────
  console.log('📦 shifts を移行中...');
  const shifts = readJson('shifts.json');
  if (shifts.length > 0) {
    const rows = shifts.map(s => {
      const { id, date, castId, ...rest } = s;
      return {
        id,
        date:    date   || '',
        cast_id: castId || 0,
        data:    rest,
      };
    });
    const { error } = await supabase.from('shifts').upsert(rows, { onConflict: 'id' });
    if (error) console.error('  ❌ shiftsエラー:', error.message);
    else       console.log(`  ✅ ${rows.length} 件を移行しました`);
  }

  // ──────────────────────────────────────────────────────────
  //  traffic.json → traffic テーブル
  //  { id, date, blog, review, access, note }
  //  → DB: { id, date, data:{blog,review,...} }
  // ──────────────────────────────────────────────────────────
  console.log('📦 traffic を移行中...');
  const traffic = readJson('traffic.json');
  if (traffic.length > 0) {
    const rows = traffic.map(t => {
      const { id, date, ...rest } = t;
      return { id, date: date || '', data: rest };
    });
    const { error } = await supabase.from('traffic').upsert(rows, { onConflict: 'id' });
    if (error) console.error('  ❌ trafficエラー:', error.message);
    else       console.log(`  ✅ ${rows.length} 件を移行しました`);
  }

  // ──────────────────────────────────────────────────────────
  //  goals.json → goals テーブル
  //  { "2024-04": {sales:x,...}, ... }（オブジェクト形式）
  //  → DB: { month:"2024-04", data:{sales:x,...} }
  // ──────────────────────────────────────────────────────────
  console.log('📦 goals を移行中...');
  const goals = readJson('goals.json', false);   // オブジェクト形式
  const goalEntries = Object.entries(goals);
  if (goalEntries.length > 0) {
    const rows = goalEntries.map(([month, data]) => ({ month, data }));
    const { error } = await supabase.from('goals').upsert(rows, { onConflict: 'month' });
    if (error) console.error('  ❌ goalsエラー:', error.message);
    else       console.log(`  ✅ ${rows.length} 件を移行しました`);
  }

  console.log('');
  console.log('🎉 移行完了！');
  console.log('   次のステップ:');
  console.log('   1. Render の Environment に SUPABASE_URL / SUPABASE_KEY を設定');
  console.log('   2. git push してデプロイ');
  console.log('');
}

main().catch(e => {
  console.error('❌ 予期しないエラーが発生しました:', e.message);
  process.exit(1);
});
