#!/usr/bin/env node
/**
 * tools/check-webflow-pins.js
 *
 * Ber pinnatöfluna í CLAUDE.md saman við það sem er RAUNVERULEGA á
 * Webflow-síðunni. Keyrt með:  node tools/check-webflow-pins.js
 *
 * ── AF HVERJU ÞETTA ER TIL ──────────────────────────────────────────
 * Pinnataflan er handskrifuð og lýsir kerfi sem er uppfært annars
 * staðar. Slík tafla er rétt daginn sem hún er skrifuð og eftir það er
 * hún ágiskun. CLAUDE.md skrásetur sjálf að þetta hafi þegar gerst:
 * gildin stóðu röng frá 2026-07-14 til 08-11 og enginn tók eftir.
 *
 * Það endurtók sig 2026-09-21, sama dag og taflan var „leiðrétt":
 * hún sagði 4131408 á meðan síðan bar 5368032. Enginn texti lagar
 * þetta — aðeins samanburður við lifandi síðu.
 *
 * ── HVERS VEGNA ÞARF ENGIN LYKILORÐ ─────────────────────────────────
 * /kpi/* er á bak við lykilorðahlið Webflow og skilar HTTP 401. En
 * Webflow birtir SITE-WIDE head-kóða á hliðarsíðunni sjálfri, og
 * bootstrap-taggarnir tveir eru þar. Þess vegna les þessi athugun
 * pinnana úr 401-svarinu og þarf engin leyndarmál.
 *
 * Sama eiginleika og gerir þetta mögulegt er ástæðan fyrir því að
 * `gasKey` og `STORKAUP_BC_MANUAL` MEGA ALDREI vera site-wide. Athugunin
 * staðfestir það líka: hún fellur ef þau birtast á hliðarsíðunni.
 *
 * ── HVAÐ HÚN SÉR EKKI ───────────────────────────────────────────────
 * Aðeins það sem er í site-wide head-kóða. Beri einhver síða SITT EIGIÐ
 * `data-storkaup-rev` page-scoped getur það gildi verið annað og sést
 * ekki hér. Og `lookup.js` er pinnaður inni í Embed í síðubolnum, sem
 * er á bak við hliðina — hann er merktur „óathugaður", ekki „í lagi".
 * Athugun sem þegir um það sem hún sér ekki er verri en engin.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PAGE = process.env.STORKAUP_PIN_PAGE ||
             'https://storkaup.webflow.io/kpi/top-products';
const CLAUDE_MD = path.join(__dirname, '..', 'CLAUDE.md');

// Lykilorðahliðin má ALDREI bera þetta. Sjá hausinn.
const NEVER_ON_GATE = ['gasKey', 'supabaseUrl', 'publishableKey',
                       'STORKAUP_BC_MANUAL', 'EXEC_URL'];

function parseExpected(md) {
  // Pinnatöflurnar eru í kaflanum "Current production pins". Leitað er að
  // töflulínum með sjö-stafa hex í bakktikkum; merkimiðinn ræður hvaða
  // pinni þetta er. Vísvitandi laust: taflan má fá dálka eða orðalag án
  // þess að athugunin brotni þegjandi — hún segir frekar "fann ekki".
  const out = {};
  const section = md.split('## Current production pins')[1] || '';
  const stop = section.indexOf('\n## ');
  const body = stop === -1 ? section : section.slice(0, stop);

  body.split('\n').forEach(function (line) {
    if (!line.startsWith('|')) return;
    const sha = (line.match(/`([0-9a-f]{7,40})`/) || [])[1];
    if (!sha) return;
    // FYRSTA TREFF VINNUR. Kaflinn ber TVAER toflur: lifandi pinna og
    // "Hardcoded fallbacks" nedar. Ann parser sem tekur sidasta treffid
    // les fallbakkana sem lifandi gildi og tilkynnir rek sem er ekki til.
    // Thad gerdi hann i fyrstu keyrslu.
    const set = function (k, v) { if (!out[k]) out[k] = v; };
    if (/data-storkaup-rev/.test(line)) set('rev', sha);
    else if (/website-dashboard-bootstrap\.js/.test(line)) set('websiteBootstrap', sha);
    else if (/dashboard-bootstrap\.js/.test(line)) set('dashboardBootstrap', sha);
    else if (/lookup\.js/.test(line)) set('lookup', sha);
  });
  return out;
}

function parseLive(html) {
  const uniq = function (a) { return Array.from(new Set(a)); };
  const revs = uniq((html.match(/data-storkaup-rev="([0-9a-f]{7,40})"/g) || [])
    .map(function (m) { return m.match(/"([0-9a-f]+)"/)[1]; }));
  const srcs = {};
  (html.match(/storkaup_kpi@([0-9a-f]{7,40})\/Webflow\/([A-Za-z0-9._-]+)/g) || [])
    .forEach(function (m) {
      const p = m.match(/storkaup_kpi@([0-9a-f]+)\/Webflow\/(.+)/);
      srcs[p[2]] = p[1];
    });
  return { revs: revs, srcs: srcs };
}

/**
 * FERSKLEIKAPRÓFIÐ — það eina sem prófar RÉTTMÆTI en ekki bara samræmi.
 *
 * Samanburður við CLAUDE.md segir aðeins hvort taflan og síðan séu
 * sammála. Þær geta verið sammála og báðar rangar: 2026-09-21 var
 * pinnanum á síðunni breytt ÚR 5368032 Í 4131408 til að passa við
 * stöðnuðu töfluna, og við það hvarf drawer-lagfæringin af
 * /kpi/top-products. Samræmisprófið hefði sagt „í lagi".
 *
 * Þetta próf spyr annarrar spurningar: ber lifandi pinninn nýjasta
 * commit sem snerti skrárnar sem hann stýrir? Barnaskrárnar eru lesnar
 * úr bootstrappinu sjálfu, svo listinn getur ekki staðnað hér.
 */
function freshness(liveRev) {
  const boots = ['Webflow/dashboard-bootstrap.js', 'Webflow/website-dashboard-bootstrap.js'];
  const children = new Set();
  boots.forEach(function (b) {
    const src = fs.readFileSync(path.join(__dirname, '..', b), 'utf8');
    (src.match(/base \+ "([A-Za-z0-9._-]+)"/g) || []).forEach(function (m) {
      children.add('Webflow/' + m.match(/"([^"]+)"/)[1]);
    });
  });
  if (!children.size) return { ok: null, why: 'fann engar barnaskrár í bootstrappinu' };

  const list = Array.from(children);
  const newest = execSync('git log -1 --format=%H -- ' + list.join(' '),
                          { encoding: 'utf8' }).trim();
  if (!newest) return { ok: null, why: 'fann engan commit á barnaskrárnar' };

  // %x20 er bil i git-format. Bert bil her brotnar i skelinni og git
  // les "%s" sem revision — sem thad gerdi i fyrstu keyrslu.
  const subject = execSync('git log -1 --format=%h%x20%s ' + newest,
                           { encoding: 'utf8' }).trim();
  if (!liveRev) return { ok: null, why: 'las engan lifandi pinna', newest: subject };

  let contains = false;
  try {
    execSync('git merge-base --is-ancestor ' + newest + ' ' + liveRev, { stdio: 'ignore' });
    contains = true;
  } catch (e) { contains = false; }

  return { ok: contains, newest: subject, children: list.length };
}

/**
 * LOOKUP-PINNINN — thrihlida, en adeins tvaer hlidar naest i.
 *
 * `Webflow/lookup.js` er pinnadur inni i Embed a /kpi/voruuppfletting,
 * i sidubolnum og thvi a bak vid lykilordahlidina. Hann sest ekki i
 * 401-svarinu (maelt 2026-09-21), svo lifandi gildid er ekki lesanlegt
 * hedan og er merkt OATHUGADUR — aldrei "i lagi".
 *
 * Hitt tvennt er hins vegar athuganlegt, og thad er einmitt thad sem
 * bilar i raun:
 *   1. Ber pinninn i Webflow/lookup-embed.html sama gildi og CLAUDE.md?
 *      Skrain er thad sem a ad limast inn; reki hun fra toflunni er
 *      annad hvort rangt adur en nokkur snertir Webflow.
 *   2. Ber sa pinni nyjustu breytinguna a Webflow/lookup.js? Ad breyta
 *      skranni og gleyma ad faera pinnann i embedinu skilar sér sem
 *      "ekkert breyttist" — sama thogla einkenni og annars stadar her.
 */
function lookupPin(expectedFromMd) {
  const embedPath = path.join(__dirname, '..', 'Webflow', 'lookup-embed.html');
  if (!fs.existsSync(embedPath)) return { ok: null, why: 'fann ekki lookup-embed.html' };
  const embed = fs.readFileSync(embedPath, 'utf8');
  const pin = (embed.match(/storkaup_kpi@([0-9a-f]{7,40})\/Webflow\/lookup\.js/) || [])[1];
  if (!pin) return { ok: null, why: 'fann engan pinna i lookup-embed.html' };

  const newest = execSync('git log -1 --format=%H -- Webflow/lookup.js',
                          { encoding: 'utf8' }).trim();
  let fresh = null, subject = '';
  if (newest) {
    subject = execSync('git log -1 --format=%h%x20%s ' + newest,
                       { encoding: 'utf8' }).trim();
    try {
      execSync('git merge-base --is-ancestor ' + newest + ' ' + pin, { stdio: 'ignore' });
      fresh = true;
    } catch (e) { fresh = false; }
  }
  return { ok: true, pin: pin, matchesMd: pin === expectedFromMd, fresh: fresh, newest: subject };
}

function row(name, expected, live, note) {
  let state;
  if (live === null || live === undefined) state = note ? 'ÓATHUGAÐUR' : 'FANNST EKKI';
  else if (!expected) state = 'EKKI Í TÖFLU';
  else if (expected === live) state = 'í lagi';
  else state = 'REK';
  return { name: name, claude: expected || '—', live: live || '—',
           state: state, note: note || '' };
}

async function main() {
  const md = fs.readFileSync(CLAUDE_MD, 'utf8');
  const expected = parseExpected(md);

  // 401 er VÆNT SVAR, ekki villa — sjá hausinn.
  const res = await fetch(PAGE, { redirect: 'follow' });
  const html = await res.text();
  if (res.status !== 401 && res.status !== 200) {
    console.error('Óvænt svar frá ' + PAGE + ': HTTP ' + res.status);
    process.exit(2);
  }

  const live = parseLive(html);
  const liveRev = live.revs.length === 1 ? live.revs[0] : null;

  const rows = [
    row('data-storkaup-rev', expected.rev, liveRev,
        live.revs.length > 1 ? 'FLEIRI EN EITT GILDI: ' + live.revs.join(', ') : ''),
    row('dashboard-bootstrap.js', expected.dashboardBootstrap,
        live.srcs['dashboard-bootstrap.js']),
    row('website-dashboard-bootstrap.js', expected.websiteBootstrap,
        live.srcs['website-dashboard-bootstrap.js']),
    row('lookup.js', expected.lookup, live.srcs['lookup.js'] || null,
        'í Embed á bak við lykilorð — ekki lesanlegt héðan')
  ];

  const w = Math.max.apply(null, rows.map(function (r) { return r.name.length; }));
  console.log('\nPinnar — CLAUDE.md gegn ' + PAGE + ' (HTTP ' + res.status + ')\n');
  console.log('  ' + 'Skrá'.padEnd(w) + '  CLAUDE.md  Lifandi    Staða');
  console.log('  ' + '-'.repeat(w) + '  ---------  ---------  -----');
  rows.forEach(function (r) {
    console.log('  ' + r.name.padEnd(w) + '  ' + String(r.claude).padEnd(9) +
                '  ' + String(r.live).padEnd(9) + '  ' + r.state +
                (r.note ? '  — ' + r.note : ''));
  });

  const leaks = NEVER_ON_GATE.filter(function (k) { return html.indexOf(k) !== -1; });
  console.log('');
  if (leaks.length) {
    console.log('  ⚠️  LEYNDARMÁL Á LYKILORÐASKJÁNUM: ' + leaks.join(', '));
    console.log('     Þau eru í site-wide custom code og eiga að vera page-scoped.');
  } else {
    console.log('  ✓ Ekkert leyndarmál á lykilorðaskjánum (' +
                NEVER_ON_GATE.join(', ') + ').');
  }

  const fresh = freshness(liveRev);
  if (fresh.ok === true) {
    console.log('  ✓ Lifandi pinni ber nýjustu breytinguna á barnaskránum (' +
                fresh.children + ' skrár): ' + fresh.newest);
  } else if (fresh.ok === false) {
    console.log('  ✗ ÚRELTUR PINNI: lifandi rev ber EKKI nýjustu breytinguna á');
    console.log('     barnaskránum — ' + fresh.newest);
    console.log('     Sú lagfæring er ekki í loftinu. Þetta er ekki ósamræmi');
    console.log('     við töfluna heldur vara sem er ekki komin út.');
  } else {
    console.log('  ? Ferskleikapróf slapp: ' + fresh.why);
  }

  const lk = lookupPin(expected.lookup);
  console.log('');
  if (lk.ok === null) {
    console.log('  ? lookup.js: ' + lk.why);
  } else {
    if (!lk.matchesMd) {
      console.log('  ✗ lookup.js: embedid pinnar ' + lk.pin + ' en CLAUDE.md segir ' +
                  (expected.lookup || '—') + '. Annad hvort er rangt adur en Webflow kemur vid sogu.');
    } else {
      console.log('  ✓ lookup.js: embedid og CLAUDE.md sammala (' + lk.pin + ').');
    }
    if (lk.fresh === false) {
      console.log('  ✗ lookup.js: pinninn ber EKKI nyjustu breytinguna — ' + lk.newest);
    } else if (lk.fresh === true) {
      console.log('  ✓ lookup.js: pinninn ber nyjustu breytinguna a skranni.');
    }
  }

  const drift = rows.filter(function (r) { return r.state === 'REK'; });
  const unknown = rows.filter(function (r) { return r.state === 'FANNST EKKI'; });
  console.log('');
  if (drift.length) {
    console.log('  ✗ ' + drift.length + ' pinni/pinnar reka frá CLAUDE.md. ' +
                'Uppfærðu töfluna eða síðuna — hvort sem er rétt, en ekki bæði.');
  } else {
    console.log('  ✓ Engin rek milli CLAUDE.md og síðunnar.');
  }
  if (unknown.length) {
    console.log('  ? ' + unknown.map(function (r) { return r.name; }).join(', ') +
                ' fannst ekki á síðunni.');
  }
  console.log('');
  const lkBad = (lk.ok && (!lk.matchesMd || lk.fresh === false));
  process.exit((drift.length || leaks.length || fresh.ok === false || lkBad) ? 1 : 0);
}

main().catch(function (err) {
  console.error('check-webflow-pins: ' + (err && err.message || err));
  process.exit(2);
});
