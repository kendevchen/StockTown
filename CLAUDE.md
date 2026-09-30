# 台股小鎮（stock-town）

每檔台股或 ETF 一間店。成交金額越大，街上人潮與車流越多；門口右邊隊伍＝三大法人買進金額、左邊＝賣出金額；成交筆數越多，進店越頻繁。可暫停與 1／10／30／60 倍速播放。資料每個交易日收盤後由 GitHub Actions 從臺灣證券交易所抓取，不需要任何 API 金鑰。

## 回覆與介面
- 一律繁體中文、台灣用語。
- 紅漲綠跌。
- 招牌只放文字名稱，不放公司 logo。
- 畫面要標註資料來源（臺灣證券交易所）、資料日期，以及「僅供參考，不構成投資建議」。

## 檔案
| 檔案 | 用途 |
|---|---|
| `index.html` | 小鎮頁面，讀 `data/stocks.json`；開頭註解有開發筆記 |
| `town-kit.js` | 素材包（街景、方塊小人、店面、欄杆），來自 town-kit 專案，盡量不要在這裡改 |
| `town-sim.js` | 人流與車流模擬（排隊、進出店、路人、車子、禮讓行人），來自 town-kit 專案 |
| `stocks.config.json` | 股票清單：代號、名稱、類型、店面樣式、代表色 |
| `scripts/fetch-twse.mjs` | 抓證交所每日行情（STOCK_DAY）與三大法人（T86），更新 `data/stocks.json` |
| `data/stocks.json` | 資料。`meta.source` 為 `sample` 時是示意資料，為 `TWSE` 時是真實資料 |
| `.github/workflows/update.yml` | 排程：台灣時間週一到週五 17:30 執行，也可手動執行 |

## 本機預覽
```
python3 -m http.server 8000
```
開啟 http://localhost:8000 。

## 第一次部署（請依序執行）
前提：已安裝 GitHub CLI，並完成 `gh auth login`。

1. 初始化並提交：
   ```
   git init -b main
   git add -A
   git commit -m "台股小鎮：第一版"
   ```
2. 建立公開 repo 並推送（GitHub Pages 免費方案需要公開 repo）：
   ```
   gh repo create stock-town --public --source . --push
   ```
3. 開啟 GitHub Pages（從 main 分支根目錄發布）：
   ```
   gh api -X POST "repos/$(gh api user --jq .login)/stock-town/pages" -f "source[branch]=main" -f "source[path]=/"
   ```
4. 手動執行第一次抓資料，並等它跑完：
   ```
   gh workflow run update.yml
   sleep 10
   gh run watch "$(gh run list --workflow=update.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
   ```
5. 檢查結果：
   - 用 `gh run view --log` 看輸出，應該有「已更新 data/stocks.json：交易日 …」。
   - `git pull` 後打開 `data/stocks.json`：`meta.source` 應為 `TWSE`，四檔都有 `daily` 資料。
   - `inst`（三大法人）在收盤後大約 15:00～17:00 公布；如果太早執行會是空的，隔天排程會自動補上。
6. 網址：`https://<GitHub 帳號>.github.io/stock-town/`（Pages 第一次發布約需 1～2 分鐘）。

## 出問題時
- 腳本的錯誤訊息會列出失敗的網址與原因。
- 如果是「找不到欄位」或「欄位名稱改變」：依訊息中列出的實際欄位，修改 `parseStockDay()` 或 `parseT86()` 的欄位關鍵字，再重跑步驟 4。
- 如果是 HTTP 403、逾時，或「回應不是 JSON」：可能是證交所擋了 GitHub 的主機。改在本機執行後再推送：
  ```
  node scripts/fetch-twse.mjs
  git add data/stocks.json && git commit -m "更新台股資料" && git push
  ```
- 不要提高抓取頻率。每天只抓一次，每次請求之間間隔 3.5 秒。

## 新增或更換股票
1. 編輯 `stocks.config.json`（`style` 可用：showroom、bookshop、hangar、cafe、glass、brick、sawtooth、rotunda、tower）。
2. 手動執行一次並回補歷史：`gh workflow run update.yml -f months=2`
3. 目前版面是 2×2 共 4 間店。超過 4 檔時，要把 `index.html` 裡 `createStreet({ cols: 2, rows: 2 })` 的數量一起調整。

## 省用量
- `index.html` 用「// ==== [」搜尋區塊後再修改，不要整份讀取。
- `town-kit.js`、`town-sim.js` 很大，只有要改素材或模擬本身時才讀。
