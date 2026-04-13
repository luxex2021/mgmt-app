# 店舗管理システム

終業報告・キャスト管理・売上管理・集客管理を一元化したWebアプリです。

**Node.js だけあれば動きます。PythonもDBも不要です。**

---

## ファイル構成

```
store-mgmt/
├── server.js        ← バックエンド（Express）
├── package.json     ← パッケージ定義
├── public/
│   └── index.html   ← フロントエンド
├── data/            ← 自動作成
│   ├── reports.json ← 終業報告（1レコード=1日・2店舗まとめ）
│   ├── casts.json
│   ├── shifts.json
│   ├── traffic.json
│   └── goals.json
└── README.md
```

---

## 起動手順

### 1. Node.js インストール（初回のみ）
https://nodejs.org/ → LTS版をダウンロード・インストール

### 2. パッケージインストール（初回のみ）
```
npm install
```

### 3. 起動
```
npm start
```

ブラウザで http://localhost:3000 を開く

### 終了
Ctrl + C

---

## 終業報告のデータ構造

1回の入力で1日分・2店舗まとめて保存します。

```json
{
  "id": 1,
  "date": "2024-04-08",
  "staff": "田中",
  "dino": {
    "sales": 500000,
    "profit": 200000,
    "count": 10,
    "honshimei": 3,
    "kadou": 5,
    "tel": 40,
    "tel_9_12": 5,
    "tel_12_15": 8,
    "tel_15_18": 10,
    "tel_18_21": 10,
    "tel_21_24": 5,
    "tel_24_27": 2
  },
  "ai": { ... 同じ構造 ... }
}
```

---

## ダッシュボード表示項目

各店舗・合計ともに以下9指標を表示します。

| 指標 | 計算方法 |
|------|---------|
| 売上 | 合計 |
| 粗利 | 合計 |
| 本数 | 合計 |
| 本指名 | 合計 |
| 稼働 (AV) | 稼働合計 ÷ 営業日数 |
| TEL総件数 | 合計 |
| 平均単価 | 売上 ÷ 本数 |
| 本指名率 | 本指名 ÷ 本数 × 100 |
| 成約率 | 本数 ÷ TEL総件数 × 100 |

**稼働AVの営業日数**: そのstoreのデータが1件以上存在する日数  
（2店舗合計の場合は報告レコードが存在する日数）

---

## API一覧

| メソッド | URL | 内容 |
|---------|-----|------|
| GET | `/api/reports` | 一覧（?month=YYYY-MM, ?staff=名前） |
| GET | `/api/reports/:id` | 1件取得 |
| POST | `/api/reports` | 新規作成 |
| PUT | `/api/reports/:id` | 更新 |
| DELETE | `/api/reports/:id` | 削除 |
| GET | `/api/stats` | 月間集計（?month=YYYY-MM）|
| GET | `/api/casts` | キャスト一覧 |
| POST/PUT/DELETE | `/api/casts(/:id)` | キャスト操作 |
| GET/POST/DELETE | `/api/shifts` | 出勤管理 |
| GET/POST | `/api/traffic` | 集客データ |
| GET/POST | `/api/goals` | 月間目標 |

---

## よくあるエラー

| 症状 | 対処 |
|------|------|
| `node は内部コマンドではありません` | Node.js をインストール |
| `Cannot find module 'express'` | `npm install` を実行 |
| `EADDRINUSE` | 別ウィンドウで起動中 → Ctrl+C で止める |
| 画面が真っ白 | `http://localhost:3000` か確認 |

---

## オーダー機能（v5 以降）

### オーダー入力ページ
接客1件ごとにリアルタイムで入力。ページ上部の集計カードは保存・編集・削除のたびに即時更新されます。

### 集計カードの表示項目
| 項目 | 内容 |
|------|------|
| 総売 | オーダーの sales 合計 |
| 給料 | キャスト給料（castPay）合計 |
| 粗利 | profit 合計 |
| 本数 | オーダー件数 |
| 本指名 | isHonshimei=true の件数 |

3区分（ディーノ石巻 / 愛して人妻 / 2店舗合計）を並べて表示。

### 終業報告への自動反映
- 終業報告フォームを開く際、今日の日付のオーダー集計を自動取得
- 売上・粗利・本数・本指名を各店舗の入力欄に自動セット
- 日付を変更すると再取得・再反映
- 手動で数値を変更することも可能
- 🔄「再反映」ボタンでいつでも再セット可能
- TEL件数・稼働人数・引継ぎ・ミス・改善は手入力のまま

### APIレスポンスの変化（v6）
POST /api/orders レスポンス: `{ id, summary: { dino:{...}, ai:{...} } }`
PUT  /api/orders/:id レスポンス: `{ ok, summaries: { "YYYY-MM-DD": {...}, ... } }`
DELETE /api/orders/:id レスポンス: `{ ok, summary:{...}, date:"YYYY-MM-DD" }`
