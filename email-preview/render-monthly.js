// Regenerate the monthly-digest preview:  node email-preview/render-monthly.js
//
// Writes email-preview/monthly-digest-rendered.html from the ACTUAL builders in
// core/email.js, so the file in the browser is the email Gmail would send, not a
// hand-kept mirror that drifts. monthly-digest.html next to it is the opposite
// thing: a CSS-token design mockup, edited by hand.
//
// The payload below is MOCK data shaped like monthly_digest_stats +
// web_records_v1. It is not a report of any real month.
// No GAS services are touched: the builders only use string helpers defined
// inside email.js.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'core/email.js'), 'utf8');

// GAS globals referenced (only inside functions we do not call, but keep the
// evaluation safe anyway).
const Logger = { log: () => {} };
const SpreadsheetApp = {};
const GmailApp = {};
const PropertiesService = {};

eval(src + '\n;globalThis.__build = { html: buildMonthlyDigestHtml_, plain: buildMonthlyDigestPlain_ };');

// ── Mock payload — shapes copied from monthly_digest.sql / web_records_v1.sql ──
const stats = {
  month_start: '2026-08-01',
  month: '2026-08',
  prev_month: '2026-07',
  web_orders: 1284,
  web_revenue_excl: 214830000,
  prev_web_orders: 1142,
  prev_web_revenue_excl: 191400000,
  new_customers: 38,
  prev_new_customers: 29,
  new_customers_list: [
    { name: 'Kaffihúsið Mokka ehf.', revenue: 412300 },
    { name: 'Bakarí Norðurljós', revenue: 288100 },
    { name: 'Hótel Vík', revenue: 254000 }
  ],
  top_customers: [
    { name: 'Veitingafélagið Sæta Svínið', orders: 41, revenue_excl: 8420000 },
    { name: 'Hótel Saga', orders: 33, revenue_excl: 6110000 },
    { name: 'Kaffitár', orders: 28, revenue_excl: 5240000 }
  ],
  top_products: [
    { name: 'Kaffibaunir Arabica 1kg', sku: '10021', orders: 214, revenue_excl: 4210000 },
    { name: 'Pappírsþurrkur 2-laga', sku: '30144', orders: 188, revenue_excl: 2870000 },
    { name: 'Einnota hanskar M', sku: '41002', orders: 165, revenue_excl: 1940000 }
  ],
  runrate: {
    days_elapsed: 0, days_in_month: 30,
    mtd_orders: 0, mtd_revenue_excl: 0,
    projected_orders: null, projected_revenue_excl: null
  },
  // ── The new block ──────────────────────────────────────────────────────────
  records: {
    month: '2026-08',
    history_start: '2022-04',
    months_compared: 52,
    month_orders: 1284,
    month_revenue_incl: 262000000,
    rank_orders: 1,
    rank_revenue: 1,
    is_record_orders: true,
    is_record_revenue: true,
    prev_best_orders:  { month: '2026-05', orders: 1201 },
    prev_best_revenue: { month: '2026-05', revenue_incl: 249100000 },
    yoy_orders: 958,
    yoy_revenue_incl: 198400000,
    best_day: {
      date: '2026-08-31', orders: 87, revenue_incl: 14200000,
      rank_orders: 1, is_record_orders: true, is_record_revenue: false
    },
    prev_best_day: { date: '2026-05-12', orders: 79 },
    milestone: { nth: 42000, date: '2026-08-19' },
    orders_all_time: 42611
  }
};

const outDir = path.join(ROOT, 'email-preview');
fs.writeFileSync(path.join(outDir, 'monthly-digest-rendered.html'), globalThis.__build.html(stats), 'utf8');

console.log('── PLAIN TEXT ─────────────────────────────────────────────');
console.log(globalThis.__build.plain(stats));

// Second render: RPC failed -> section must vanish, email must still build.
const degraded = Object.assign({}, stats, { records: null });
const degradedHtml = globalThis.__build.html(degraded);
console.log('\n── DEGRADED (records: null) ───────────────────────────────');
console.log('contains "Met og áfangar":', degradedHtml.includes('Met og áfangar'));
console.log('still renders Vefsala   :', degradedHtml.includes('Vefsala'));
console.log('plain-text line count   :', globalThis.__build.plain(degraded).split('\n').length);
