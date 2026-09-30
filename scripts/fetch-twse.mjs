// =====================================================================
// fetch-twse.mjs：抓臺灣證券交易所的每日行情與三大法人買賣超，更新 data/stocks.json
// 用法：node scripts/fetch-twse.mjs              每日更新（第一次會自動回補 2 個月）
//       node scripts/fetch-twse.mjs --months=3   回補較長的歷史
// 流量：每檔股票每次 1 個請求（當月），加上三大法人 1 個請求；請求之間間隔 3.5 秒
// 不需要任何金鑰。股票清單在 stocks.config.json
// =====================================================================
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = resolve(ROOT, 'stocks.config.json');
const OUT = resolve(ROOT, 'data/stocks.json');
const KEEP_DAYS = 40;
const DELAY_MS = Number(process.env.TWSE_DELAY_MS ?? 3500);
const UA = 'Mozilla/5.0 (compatible; stock-town-daily/1.0)';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// "1,234.50"、"+5.00"、"X0.00"（除權息註記）→ 數字
const num = s => {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/[,\s]/g, '').replace(/^[Xx]/, ''));
  return Number.isFinite(v) ? v : null;
};
// 民國日期 "115/09/29" → "2026-09-29"
const rocToISO = s => {
  const m = String(s).trim().match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  return m ? `${+m[1] + 1911}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};
const col = (fields, ...keys) => fields.findIndex(f => keys.some(k => String(f).includes(k)));

// 依序嘗試幾個網址（證交所新舊兩種路徑），回傳 JSON
async function getJSON(urls) {
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      try { return JSON.parse(text); }
      catch { throw new Error('回應不是 JSON（可能被擋或網址變更）：' + text.slice(0, 80).replace(/\s+/g, ' ')); }
    } catch (e) {
      lastErr = new Error(`${url} → ${e.message}`);
      await sleep(1500);
    }
  }
  throw lastErr;
}

// 個股（或 ETF）月成交資訊
function parseStockDay(j) {
  if (!j || j.stat !== 'OK' || !Array.isArray(j.data)) return [];
  const f = j.fields || [];
  const i = { date: col(f, '日期'), volume: col(f, '成交股數'), value: col(f, '成交金額'), open: col(f, '開盤'), high: col(f, '最高'), low: col(f, '最低'), close: col(f, '收盤'), change: col(f, '漲跌'), trades: col(f, '成交筆數') };
  const missing = Object.entries(i).filter(([, v]) => v < 0).map(([k]) => k);
  if (missing.length) throw new Error(`STOCK_DAY 找不到欄位 ${missing.join('、')}；目前欄位：${f.join('、')}`);
  return j.data.map(r => ({
    date: rocToISO(r[i.date]), volume: num(r[i.volume]), value: num(r[i.value]),
    open: num(r[i.open]), high: num(r[i.high]), low: num(r[i.low]), close: num(r[i.close]),
    change: num(r[i.change]) ?? 0, trades: num(r[i.trades]),
  })).filter(d => d.date && d.close != null && d.value != null);
}

// 三大法人買賣超日報：所有「買進股數」欄位加總＝買進、「賣出股數」加總＝賣出
function parseT86(j, codes) {
  if (!j || j.stat !== 'OK' || !Array.isArray(j.data)) return null;
  const f = j.fields || [], iCode = col(f, '證券代號'), iNet = col(f, '三大法人買賣超');
  const buyCols = f.map((n, k) => (String(n).includes('買進股數') ? k : -1)).filter(k => k >= 0);
  const sellCols = f.map((n, k) => (String(n).includes('賣出股數') ? k : -1)).filter(k => k >= 0);
  if (iCode < 0 || !buyCols.length || !sellCols.length) throw new Error('T86 欄位名稱改變：' + f.join('、'));
  const out = {};
  for (const r of j.data) {
    const code = String(r[iCode]).trim();
    if (!codes.includes(code)) continue;
    const buy = buyCols.reduce((s, k) => s + (num(r[k]) || 0), 0);
    const sell = sellCols.reduce((s, k) => s + (num(r[k]) || 0), 0);
    const net = iNet >= 0 ? num(r[iNet]) : buy - sell;
    if (net != null && Math.abs(buy - sell - net) > Math.max(1000, Math.abs(net) * 0.05)) console.warn(`提醒：${code} 買進減賣出（${buy - sell}）與買賣超（${net}）不一致，請檢查 T86 欄位`);
    out[code] = { buy, sell, net: net ?? buy - sell };
  }
  return out;
}

async function main() {
  const monthsArg = Number((process.argv.find(a => a.startsWith('--months=')) || '').split('=')[1]) || 0;
  const cfg = JSON.parse(await readFile(CONFIG, 'utf8'));
  let old = null;
  try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 第一次執行 */ }
  const fresh = !old || old.meta?.source !== 'TWSE';
  const nMonths = monthsArg || (fresh ? 2 : 1);
  const tw = new Date(Date.now() + 8 * 3600e3); // 台灣時間
  const months = [];
  for (let k = nMonths - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth() - k, 1));
    months.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  const errors = [], stocks = [];
  for (const s of cfg.stocks) {
    const prevStock = fresh ? null : old.stocks?.find(x => x.code === s.code);
    const byDate = new Map((prevStock?.daily || []).map(d => [d.date, d]));
    for (const m of months) {
      try {
        const j = await getJSON([
          `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${m}&stockNo=${s.code}&response=json`,
          `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${m}&stockNo=${s.code}`,
        ]);
        for (const d of parseStockDay(j)) byDate.set(d.date, d);
      } catch (e) { errors.push(`${s.code} ${m.slice(0, 6)}：${e.message}`); }
      await sleep(DELAY_MS);
    }
    const daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-KEEP_DAYS);
    stocks.push({ ...s, daily, inst: prevStock?.inst ?? null });
  }
  const lastDate = stocks.map(s => s.daily.at(-1)?.date).filter(Boolean).sort().at(-1);
  if (!lastDate) {
    console.error('沒有取得任何行情資料，保留原本的檔案。\n' + errors.join('\n'));
    process.exit(1);
  }
  // 三大法人：只抓最新交易日（收盤後約 15:00～17:00 公布）
  try {
    const d = lastDate.replace(/-/g, '');
    const j = await getJSON([
      `https://www.twse.com.tw/rwd/zh/fund/T86?date=${d}&selectType=ALL&response=json`,
      `https://www.twse.com.tw/fund/T86?response=json&date=${d}&selectType=ALL`,
    ]);
    const inst = parseT86(j, cfg.stocks.map(s => s.code));
    if (!inst) errors.push(`三大法人 ${lastDate}：尚未公布（${j?.stat ?? '無回應'}），沿用前一次的資料`);
    else for (const s of stocks) { if (inst[s.code]) s.inst = { date: lastDate, ...inst[s.code] }; }
  } catch (e) { errors.push('三大法人：' + e.message); }
  const out = {
    meta: { source: 'TWSE', as_of: lastDate, updated: new Date().toISOString(), note: '資料來源：臺灣證券交易所。每日收盤後更新，非即時。' },
    stocks,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`已更新 data/stocks.json：交易日 ${lastDate}；` + stocks.map(s => `${s.code} ${s.daily.length} 天${s.inst ? '＋法人' : ''}`).join('、'));
  if (errors.length) console.warn('警告：\n' + errors.join('\n'));
}
main().catch(e => { console.error(e); process.exit(1); });
