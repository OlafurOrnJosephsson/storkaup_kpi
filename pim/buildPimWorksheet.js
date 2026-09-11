/**
 * pim/buildPimWorksheet.js
 *
 * Byggir og endurbyggir vinnusheetið fyrir vöruinnihaldsverkefnið.
 *
 * Hönnun:
 *   Plytix CSV  = hryggjarstykkið (Label er lykillinn, tengingin við BC)
 *   KPI-skjalið = auðgun, joinað á SKU:
 *                   PRODUCTS        -> vefslóð, flokkatré, „er í leitarvísi"
 *                   VANTAR_MYND     -> myndaskilyrðið, sjálfvirkt
 *                   RAMMASAMNINGAR  -> forgangsröðun
 *
 * Keyrsla nr. 2 og áfram MÁ EKKI eyða því sem starfsfólk hefur skrifað.
 * Matchað er á Label: gráu og bláu kólumnurnar uppfærast, gulu haldast.
 * Vörur sem hverfa úr Plytix eru merktar, ekki eytt.
 *
 * Uppsetning í STORKAUP_CONFIG:
 *   SETTINGS.PIM_DROP_FOLDER_ID  Drive-mappa þar sem Plytix CSV-ið lendir (sbr. BC_DROP_FOLDER_ID)
 *   SHEETS.PIM.ID                Vinnusheetið (sér skjal, ekki KPI-skjalið)
 *   SETTINGS.PIM_CSV_DELIMITER   valfrjálst, sjálfgefið ","
 *
 * SHEETS.PRODUCTS.ID og SHEETS.PRODUCTS.NAME eru þegar til (core/cludo.js) og
 * eru endurnýtt hér — engin ný config-röð fyrir KPI-skjalið.
 *
 * Sjá einnig pim/heitalinter.py: sömu heitareglur, keyrðar á útdráttinn.
 * Reglurnar tvær verða að haldast í takt.
 */

// ---------------------------------------------------------------------------
// LAGAÐU ÞETTA að raunverulegum dálkaheitum í Plytix-útdrættinum.
// Borið saman án hástafa, bila og bandstrika, svo minniháttar munur skiptir ekki máli.
// ---------------------------------------------------------------------------
// Staðfest gegn pim_drop/plytix_export.csv (2026-09-02).
const PIM_HEADER_MAP_ = {
  label:       ['Label', 'Product Label'],
  sku:         ['SKU', 'Vörunúmer', 'Product Number'],
  brand:       ['Brand Name', 'Brand', 'Vörumerki'],
  name:        ['Commercial Name', 'Product Name', 'Vöruheiti'],
  description: ['Long Description', 'Löng lýsing', 'Description'],
  categories:  ['Categories', 'Category', 'Vöruflokkur'],
  thumbnail:   ['Thumbnail', 'Main image', 'Aðalmynd'],
  plytixStatus: ['Status', 'Staða í Plytix'],
  framework:   ['Framework Agreement Product']
};

// Hvaða Plytix-Status telst innihaldsverk. Mælt á útdrættinum 2026-09-08,
// 7.986 vörur:
//   Completed  4.473 (56%)  — jafngildir nánast vörunum í birtingu (4.467)
//   Archived   3.509 (44%)  — ekki til sölu; textavinna á þeim er fyrir gýg
//   Draft          4        — í undirbúningi, verk á þeim nýtist
//
// Þetta skiptir öllu fyrir tölurnar. Linterinn á öllum útdrættinum sýnir
// 4.651 vöru með ónýta lýsingu; á Completed einum eru þær 1.203. Fjórföld
// skekkja, öll í archived.
const PIM_WORK_STATUSES_ = ['Completed', 'Draft'];

// Hvaða lag í flokkatrénu ræður verkbútum. Þetta gildi gerir TVENNT:
//   1. Nafn kólumnunnar sem er lesin af PRODUCTS ('Level 1'|'Level 2'|'Level 3').
//   2. Dýptin sem plytixCategory_ tekur úr Plytix-slóðinni (varaleiðin).
// Bæði verða að vísa á sama lag, annars stangast varaleiðin á við PRODUCTS.
//
// Level 3 valið 2026-09-08: verkbútur er sá hópur sem er nógu líkur til að
// skrifast í einni beit. Mælt á 4.473 Completed-vörum:
//   Level 2 → 38 hópar,  miðgildi 89, stærsti 441   (of stórt á mann)
//   Level 3 → 217 hópar, miðgildi 13, stærsti 209
// 217 hópar eru EKKI 217 starfsmenn — hver tekur nokkra hópa. Búið í bunka
// undir ~200 vörum gefur um 25 bunka.
const PIM_OWNER_LEVEL_ = 'Level 3';

// Rótin sem Plytix skrifar fremst í hverja flokkaslóð. Hún telur ekki sem lag.
const PIM_CATEGORY_ROOT_ = 'Stórkaup';

const PIM_SHEET_   = 'Vinnusheet';
const PIM_GUIDE_   = 'Leiðbeiningar';
const PIM_STATS_   = 'Framvinda';
const PIM_ORPHAN_  = 'EKKI_A_VEF';

// kind: lock = úr Plytix, join = úr KPI-skjalinu, edit = starfsfólk, calc = formúla
const PIM_COLS_ = [
  { key: 'label',     head: 'Label (BC)',              w: 120, kind: 'lock' },
  { key: 'sku',       head: 'SKU',                     w:  90, kind: 'lock' },
  { key: 'cat1',      head: 'Yfirflokkur',             w: 150, kind: 'join' },
  { key: 'cat2',      head: 'Flokkur',                 w: 170, kind: 'join' },
  { key: 'cat3',      head: 'Undirflokkur',            w: 180, kind: 'join' },
  { key: 'owner',     head: 'Eigandi',                 w: 110, kind: 'edit' },
  { key: 'brandOld',  head: 'Vörumerki (núv.)',        w: 130, kind: 'lock' },
  { key: 'brandNew',  head: 'Vörumerki (nýtt)',        w: 130, kind: 'edit' },
  { key: 'nameOld',   head: 'Vöruheiti (núv.)',        w: 250, kind: 'lock' },
  { key: 'nameNew',   head: 'Vöruheiti (nýtt)',        w: 250, kind: 'edit' },
  { key: 'descOld',   head: 'Löng lýsing (núv.)',      w: 260, kind: 'lock' },
  { key: 'hint',      head: 'Vísbending',              w: 170, kind: 'join' },
  { key: 'descNew',   head: 'Löng lýsing (ný)',        w: 460, kind: 'edit', wrap: true },
  { key: 'words',     head: 'Orðafjöldi',              w:  85, kind: 'calc' },
  { key: 'datasheet', head: 'Gagnablað',               w: 105, kind: 'edit' },
  { key: 'sds',       head: 'Öryggisblað',             w: 105, kind: 'edit' },
  { key: 'status',    head: 'Staða',                   w: 125, kind: 'edit' },
  { key: 'note',      head: 'Athugasemd',              w: 260, kind: 'edit', wrap: true },
  { key: 'image',     head: 'Mynd í lagi',             w: 100, kind: 'join' },
  { key: 'onWeb',     head: 'Á vef',                   w:  85, kind: 'join' },
  { key: 'indexed',   head: 'Í leitarvísi',            w: 100, kind: 'join' },
  { key: 'framework', head: 'Rammasamningur',          w: 120, kind: 'join' },
  { key: 'done',      head: 'Fullbúið',                w:  85, kind: 'calc' },
  { key: 'url',       head: 'Vefslóð',                 w: 220, kind: 'join' }
];

// Ordafjoldamark a longu lysingu. EIN stilling, notud i threm stodum:
// Fullbuid-formulunni, skilyrta snidinu a Ordafjolda, og leidbeiningunum.
//
// Lækkað úr 60 í 20 þann 2026-09-10, eftir raunprófun. Höfundur ritstílsins
// skrifaði þrjár lýsingar á kókosmjólk og lenti á 40, 29 og 24 orðum. 400 ml
// dós af kókosmjólk hefur ekki 60 orð af sönnu innihaldi, og ritstíllinn
// bannar markaðsorð — svo 60 kallaði á fylliorð eða á að `Fullbúið` yrði
// aldrei sönn. Efra markið er óbreytt.
//
// Þetta gildi VERÐUR að vera það sama og MIN_W/MAX_W í skrifsýninni.
const PIM_WORDS_MIN_ = 20;
const PIM_WORDS_MAX_ = 150;

// 'Óbreytt' baettist vid 2026-09-11: varan var SKODUD og tharf enga
// breytingu. Án hennar gat rod sem tharfnast einskis aldrei talist
// fullbuin, svo flokkur naedhi aldrei 100% og folk var rekid til ad
// skrifa fylliefni til ad hreinsa teljarann.
const PIM_STATUSES_ = ['Ekki byrjað', 'Í vinnslu', 'Til yfirlesturs', 'Spurning',
                       'Óbreytt', 'Samþykkt', 'Flutt inn'];
const PIM_YESNO_    = ['Já', 'Nei', 'Á ekki við'];

const PIM_FILL_ = { lock: '#d9d9de', join: '#e8e6f5', edit: '#fff3c4', calc: '#e4e7f5' };

// ---------------------------------------------------------------------------
// Visbending: hvers vegna lysing sem ER til dugar samt ekki
// ---------------------------------------------------------------------------
//
// MAELT I UTDRAETTINUM 2026-09-11 (4.477 vorur, 3.258 med raunverulega lysingu):
//   785 (24%) deila lysingu ORDRETT med annarri voru — 216 olikir textar.
//             Santa Maria a 35, Abena 21, Noi Sirius 16, Goa 14, Pukka 14.
//             Thetta eru VORUMERKJATEXTAR, ekki vorulysingar.
//   555 (17%) innihalda hraa HTML-merkingu limda af vefsidum birgja.
//   243       kveikja a tveimur eda fleiri merkjum ur bannlista ritstilsins.
//   Samengi: 1.264 af 3.258.
//
// AN THESSARAR KOLUMNU ER THETTA OSYNILEGT. `w` (lysingar ad skrifa) telur
// adeins tomar lysingar og thaer sem eru = voruheitid, svo vara med 35-faldan
// vorumerkjatexta telst AFGREIDD. Starfsmadur sem opnar hana ser fullan
// textareit og heldur ad hun se i lagi.
//
// KOLUMNAN BREYTIR EKKI `w`. Hun gerir astaeduna synilega; hvort thetta
// teljist vinna er akvordun sem folk tekur, ekki eg.

const PIM_BANNED_ = ['hágæða', 'vandað', 'vandaður', 'vönduð', 'frábær',
  'einstakt', 'einstakur', 'einstök', 'byltingarkennt', 'markaðsleiðandi',
  'gæðavara', 'fjölhæf', 'faglegt', 'faglegur', 'breitt úrval',
  'allt sem þú þarft', 'fyrir öll tilefni'];

// Ordasambond sem malmodel endurtaka i islensku. Hvert um sig er saklaust —
// `sem hentar` er venjulegt mal — svo markid er TVO eda fleiri.
const PIM_TELLS_ = [
  /hvort sem/, /sem gerir (?:það|hana|hann|þau) að/,
  /fullkomi\S* (?:lausn|val|kostur)/, /tilvali\S* (?:fyrir|í)/,
  /sameinar \S+ og \S+/, /býður upp á/, /tryggir /, /notendavæn/,
  /hámarks[^.]{0,20}lágmarks/, /ekki (?:aðeins|einungis)[^.]{0,60}heldur/,
  /þökk sé/, /hentar (?:fullkomlega|einstaklega)/, /í senn/,
  /hi[ðn]{1,2} fullkomn/, /sem hentar/, /einfaldleik/, /þarf(?:ir|a) þín/
];

function pimWords_(t) {
  const m = String(t == null ? '' : t).trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Lykill fyrir "sama lysing": bil jofnud, hastafir felldir. */
function pimDescKey_(t) {
  return String(t == null ? '' : t).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Visbending fyrir EINA rodh. `dupCount` er hve margar vorur bera sama texta.
 * Skilar tomum streng thegar ekkert er ad — tomt er godu frettirnar.
 */
function pimDescHint_(desc, dupCount) {
  const t = String(desc == null ? '' : desc).trim();
  if (!t) return '';
  const out = [];

  if (dupCount > 1) out.push('AFRITUÐ (' + dupCount + ')');

  if (/<(p|div|ul|ol|li|br|strong|span|table|img|a)\b/i.test(t) ||
      /&(nbsp|aacute|eacute|oacute|uacute|yacute|thorn|eth|amp|quot);/i.test(t)) {
    out.push('HTML');
  }

  const low = t.toLowerCase();
  let hits = 0;
  for (let i = 0; i < PIM_BANNED_.length; i++) {
    if (low.indexOf(PIM_BANNED_[i]) !== -1) hits++;
  }
  for (let i = 0; i < PIM_TELLS_.length; i++) {
    if (PIM_TELLS_[i].test(low)) hits++;
  }
  if (hits >= 2) out.push('ORÐALAG (' + hits + ')');

  // Of stutt er adeins visbending thegar lysingin er RAUNVERULEG. Tom lysing
  // og lysing sem er bara voruheitid teljast nu thegar i `w`, og tvitalning
  // thar vaeri villandi — kallandinn sleppir theim.
  if (pimWords_(t) < PIM_WORDS_MIN_) out.push('OF STUTT (' + pimWords_(t) + ')');

  return out.join(' · ');
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
function menu_buildPimWorksheet() {
  const r = buildPimWorksheet_();
  let msg = 'Vinnusheet: ' + r.total + ' raðir — ' + r.added + ' nýjar, ' +
            r.updated + ' uppfærðar, ' + r.skipped + ' sleppt (ekki í birtingu), ' +
            r.gone + ' horfnar, ' + r.orphans + ' ekki á vef. ' +
            r.assigned + ' úthlutaðar.';
  if (r.unknownOwners) {
    msg += ' ⚠️ ' + r.unknownOwners + ' nöfn ekki í PIM_OWNERS — sjá keyrsluskrá.';
  }

  // Í KEYRSLUSKRÁNA LÍKA, EKKI BARA Í TOASTIÐ.
  //
  // Toast stendur i ~5 sekundur og er hvergi geymt. Thessar tolur eru samt
  // eina merkid um ad samruninn hafi tekist: se `nyjar` stort og `uppfaerdar`
  // litid hittust SKU-lyklarnir ekki og hver skrifud lysing kom ut tom.
  // Sa sem litur undan i fimm sekundur hafdi enga leid til ad na theim aftur.
  Logger.log('[PIM][BYGGING] ' + msg);
  if (r.added > 0 && r.updated === 0 && r.total > r.added / 2) {
    Logger.log('[PIM][VARUD] Engin rodh fann fyrirrennara sinn. Hafi sheetid ' +
               'innihaldid skrifadar lysingar eru their reitir nu tomir — ' +
               'berdu saman vid afrit adur en nokkur skrifar meira.');
  }
  toast_(msg);
}

// ---------------------------------------------------------------------------
// Aðalaðgerð
// ---------------------------------------------------------------------------
function buildPimWorksheet_() {
  const cfg = loadConfig_();
  const products = parsePlytixCsv_(readLatestPlytixCsv_());
  if (!products.length) throw new Error('Enginn nothæfur Plytix-útdráttur fannst.');

  const enrich = readKpiEnrichment_();

  const ss = SpreadsheetApp.openById(cfg.SHEETS.PIM.ID);
  let sh = ss.getSheetByName(PIM_SHEET_);
  const isNew = !sh;
  if (isNew) sh = ss.insertSheet(PIM_SHEET_);

  const idx = {};
  PIM_COLS_.forEach(function (c, i) { idx[c.key] = i; });

  // --- það sem er þegar í sheetinu, lyklað á Label ---
  //
  // Lesið eftir KÓLUMNUHEITI, ekki stöðu. Sheetið á disknum getur verið með
  // eldri kólumnuröð (Level-lögin voru bætt við 2026-09-08), og þá myndi
  // lestur eftir stöðu draga gulu reitina úr rangri kólumnu og skrifa yfir
  // vinnu starfsfólks ÞEGJANDI. Það er það eina sem má aldrei gerast hér.
  const existing = {};
  let prevIdx = null;
  if (!isNew && sh.getLastRow() > 1) {
    const grid = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    const head = grid[0].map(normHeader_);
    prevIdx = {};
    PIM_COLS_.forEach(function (c) {
      const j = head.indexOf(normHeader_(c.head));
      if (j !== -1) prevIdx[c.key] = j;
    });
    // STOPP, EKKI VIDVORUN.
    //
    // Finnist SKU-kolumnan ekki er `existing` tomt, og tha skrifar
    // byggingin ut 4.477 radir med TOMUM KEEP-reitum ofan i sheet sem er
    // fullt af handskrifudum lysingum. `sh.clear()` er buid ad eyda thvi
    // gamla adur en nokkur ser toastid. Adur var thetta Logger.log og
    // keyrslan hélt afram -- thad breytir "eg finn ekki lykilinn" i
    // "eg thurrkadi ut vinnu threttan manna", thegjandi.
    //
    // Tho hausinn hafi aldrei brugdist er kostnadurinn vid mistokin
    // osamhverfur: stodvud bygging kostar eina keyrslu, hin kostar vikur.
    if (prevIdx.sku === undefined) {
      throw new Error(
        'SKU-kólumna fannst ekki á ' + PIM_SHEET_ + '. Bygging STOPPUÐ án ' +
        'þess að snerta sheetið — héðan af myndi hver skrifuð lýsing týnast. ' +
        'Hausar sem fundust: ' + grid[0].join(' | '));
    } else {
      for (let i = 1; i < grid.length; i++) {
        const k = normSku_(grid[i][prevIdx.sku]);
        if (k) existing[k] = grid[i];
      }
    }
  }

  /** Þýðir röð úr kólumnuröð sheetsins yfir í núverandi PIM_COLS_-röð. */
  const remapPrev_ = function (oldRow) {
    const r = new Array(PIM_COLS_.length).fill('');
    if (!prevIdx || !oldRow) return r;
    PIM_COLS_.forEach(function (c) {
      const j = prevIdx[c.key];
      if (j !== undefined && j < oldRow.length) r[idx[c.key]] = oldRow[j];
    });
    return r;
  };

  // Forkeyrsla: hve margar vorur bera NAKVAEMLEGA somu lysingu. Verdur ad
  // reiknast a ollu settinu adur en rodhunum er flett — tvitekning sest ekki
  // a einni rodh.
  const descCount = {};
  products.forEach(function (q) {
    const d = String(q.description || '').trim();
    if (!d) return;
    if (d === String(q.label || '').trim() || d === String(q.name || '').trim()) return;
    const k = pimDescKey_(d);
    descCount[k] = (descCount[k] || 0) + 1;
  });

  const KEEP = ['owner', 'brandNew', 'nameNew', 'descNew', 'datasheet', 'sds', 'status', 'note'];
  const out = [];
  const orphans = [];
  const seen = {};        // Label sem fer INN i sheetid
  const inFile = {};      // Label sem er i skranni, hvad sem stodunni lidur
  let updated = 0, added = 0, skipped = 0;

  products.forEach(function (p) {
    const label = String(p.label || '').trim();
    if (!label) return;                   // engin Label = engin tenging við BC

    // MERGE-LYKILLINN ER SKU, EKKI LABEL.
    // Label er vöruheiti og hvorugt af því sem lykill þarf að vera:
    //   ekki einkvæmt — mælt 2026-09-08: 5 Label eru tvítekin á vinnusettinu,
    //     'Kaffimál 24cl/8oz, 20x 50stk' er FJÓRAR ólíkar vörur. Lyklað á
    //     Label læsu þær allar sömu varðveittu gögnin, svo lýsing skrifuð á
    //     eina birtist á hinum þrem eða hyrfi. Þögult, á handskrifuðu efni.
    //   ekki stöðugt — heiti sem er lagfært í BC færir lykilinn og gerir
    //     skrifaðan texta munaðarlausan.
    // SKU er einkvæmt á öllum 4.477 og aldrei tómt.
    const key = p.sku;
    if (!key) return;
    inFile[key] = p.plytixStatus || '';

    // Birtingarstaða: archived vörur eru ekki innihaldsverk. Sjá
    // PIM_WORK_STATUSES_. Tómt gildi sleppur inn viljandi.
    if (p.statusKnown && p.plytixStatus &&
        PIM_WORK_STATUSES_.indexOf(p.plytixStatus) === -1) {
      skipped++;
      return;
    }

    seen[key] = true;

    const prev = existing[key];
    const web  = enrich.bySku[p.sku] || null;
    const row  = new Array(PIM_COLS_.length).fill('');

    // úr Plytix
    row[idx.label]    = label;
    row[idx.sku]      = p.sku;
    row[idx.brandOld] = p.brand;
    row[idx.nameOld]  = p.name;
    row[idx.descOld]  = p.description;

    // Visbending: adeins thegar lysingin er RAUNVERULEG. Se hun tom eda
    // jofn heitinu er rodhin thegar i `w` og visbending baetir engu vid.
    const dTrim = String(p.description || '').trim();
    const isReal = dTrim && dTrim !== label && dTrim !== String(p.name || '').trim();
    row[idx.hint] = isReal ? pimDescHint_(dTrim, descCount[pimDescKey_(dTrim)] || 1) : '';

    // úr KPI-skjalinu
    row[idx.cat1]      = (web && web.cat1) ? web.cat1 : plytixCategory_(p.categories, 1);
    row[idx.cat2]      = (web && web.cat2) ? web.cat2 : plytixCategory_(p.categories, 2);
    row[idx.cat3]      = (web && web.cat3) ? web.cat3 : plytixCategory_(p.categories, 3);
    row[idx.url]       = web ? web.url : '';
    // A vef: endanlegt ur birta vorulistanum. Tomt = vid nadum ekki i listann.
    row[idx.onWeb]     = enrich.onWeb ? (enrich.onWeb[p.sku] ? 'Já' : 'Nei') : '';
    // I leitarvisi: PRODUCTS-rodh er sonnun fyrir JA, en FJARVIST er ekki
    // sonnun fyrir NEI — sja athugasemdina i readKpiEnrichment_. Tomt = othekkt.
    row[idx.indexed]   = web ? 'Já' : '';
    row[idx.image]     = enrich.missingImage[p.sku] ? 'Nei' : (p.thumbnail ? 'Já' : 'Nei');
    // Rammasamningur kemur UR PLYTIX, ekki ur RAMMASAMNINGAR-flipanum.
    // Sa flipi geymir rammasamningsvorur AN VERDS (heilbrigdiseftirlit i
    // storkaup_pricing.js, sja athugasemd vid frameworkRows). Hann er thvi
    // litid hlutmengi og var TOMUR, svo kolumnan sagdi 0 fyrir allar 4.477.
    // Leidbeiningarnar segja starfsfolki ad taka rammasamningsvorur fyrst,
    // svo su radgjof var gagnslaus. Rett tala ur utdraettinum er 248.
    row[idx.framework] = (p.framework || enrich.framework[p.sku]) ? 'Já' : '';

    // frá starfsfólki — varðveitt (úr endurkortlagðri röð, sjá remapPrev_)
    const prevRow = prev ? remapPrev_(prev) : null;
    KEEP.forEach(function (k) { row[idx[k]] = prevRow ? prevRow[idx[k]] : ''; });
    if (!prev) { row[idx.status] = 'Ekki byrjað'; added++; } else { updated++; }

    out.push(row);
    // EKKI_A_VEF er nu THAD sem nafnid segir: i Plytix i birtingu en EKKI i
    // birta vorulistanum. Adur var thad "engin PRODUCTS-rodh", sem er allt
    // annad og gaf 605 falskar. Naum vid ekki i listann er flipinn tomur i
    // theirri keyrslu i stad thess ad vera fullur af tilviljun.
    if (enrich.onWeb && !enrich.onWeb[p.sku]) {
      orphans.push([label, p.sku, p.name, p.brand]);
    }
  });

  // --- horfið úr Plytix: halda, merkja, ekki eyða ---
  let gone = 0;
  Object.keys(existing).forEach(function (key) {
    if (seen[key]) return;
    const row = remapPrev_(existing[key]);
    const note = String(row[idx.note] || '');
    // Tvennt ólíkt: varan getur verið HORFIN úr skránni, eða enn í henni
    // en komin í archived. Sama merking á báðu væri ósatt.
    const inf = inFile[key];
    const mark = (inf === undefined)
      ? 'EKKI Í PLYTIX'
      : (inf ? 'PLYTIX-STAÐA: ' + inf : 'EKKI Í BIRTINGU');
    if (note.indexOf(mark) === -1) {
      row[idx.note] = (mark + ' (' + todayIso_() + '). ' + note).trim();
    }
    out.push(row);
    gone++;
  });

  // Level 1 → 2 → 3 → heiti. Starfsfólk vinnur í samfelldum bút, og
  // Level 3-hópar undir sama Flokki liggja saman — þannig eru þeir búnir
  // í jafna bunka á mann.
  const order = ['cat1', 'cat2', 'cat3', 'nameOld'].map(function (k) { return idx[k]; });
  out.sort(function (a, b) {
    for (let i = 0; i < order.length; i++) {
      const c = String(a[order[i]]).localeCompare(String(b[order[i]]), 'is');
      if (c) return c;
    }
    return 0;
  });

  // Eigendaeftirlit. Nofn voru slegin inn ADUR en dropdown kom, svo their
  // sem stemma ekki vid PIM_OWNERS eru raunveruleg haetta: sia starfsmanns
  // finnur tha ekkert og hann heldur ad han hafi engar vorur. Betra ad
  // byggingin segi fra en ad thad se raudur thrihyrningur sem enginn les.
  const ownerList = pimOwners_();
  const ownerCount = {};
  out.forEach(function (r) {
    const o = String(r[idx.owner] || '').trim();
    if (o) ownerCount[o] = (ownerCount[o] || 0) + 1;
  });
  const assigned = Object.keys(ownerCount).reduce(function (n, k) { return n + ownerCount[k]; }, 0);
  const unknown = Object.keys(ownerCount).filter(function (o) {
    return ownerList.length && ownerList.indexOf(o) === -1;
  });
  Logger.log('👤 Eigendur: ' + assigned + ' vörur úthlutaðar á ' +
             Object.keys(ownerCount).length + ' nöfn — ' +
             Object.keys(ownerCount).sort().map(function (k) {
               return k + ' (' + ownerCount[k] + ')';
             }).join(', '));
  if (unknown.length) {
    Logger.log('⚠️ Nöfn í sheetinu sem eru EKKI í PIM_OWNERS: ' + unknown.join(', ') +
               '. Sía á þau nöfn virkar, en dropdown-ið býður þau ekki og ' +
               'gagnaprófunin merkir þau. Lagaðu PIM_OWNERS eða nöfnin.');
  }

  writePimSheet_(sh, out);
  writeOrphanTab_(ss, orphans);
  buildPimStats_(ss, out.length);
  buildPimGuide_(ss);

  return { updated: updated, added: added, gone: gone, skipped: skipped,
           orphans: orphans.length, total: out.length,
           assigned: assigned, unknownOwners: unknown.length };
}

// ---------------------------------------------------------------------------
// Auðgun úr KPI-skjalinu
// ---------------------------------------------------------------------------
function readKpiEnrichment_() {
  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PRODUCTS.ID);
  const bySku = {}, missingImage = {}, framework = {};

  const prod = ss.getSheetByName(cfg.SHEETS.PRODUCTS.NAME || 'PRODUCTS');
  if (prod && prod.getLastRow() > 1) {
    const vals = prod.getDataRange().getValues();
    const h = vals[0].map(normHeader_);
    const cSku = h.indexOf(normHeader_('SKU'));
    const cUrl = h.indexOf(normHeader_('Product URL'));
    // Öll þrjú lögin. PRODUCTS fær þau úr brauðmylsnu vefsins, sem er
    // áreiðanlegasta uppsprettan; Plytix-slóðin er varaleið per lag.
    const cLv = [
      h.indexOf(normHeader_('Level 1')),
      h.indexOf(normHeader_('Level 2')),
      h.indexOf(normHeader_('Level 3'))
    ];
    if (cSku === -1) throw new Error('Fann ekki SKU-kólumnu á PRODUCTS.');
    const cell = function (row, c) { return c === -1 ? '' : String(row[c] || '').trim(); };
    for (let i = 1; i < vals.length; i++) {
      const sku = normSku_(vals[i][cSku]);
      if (!sku) continue;
      bySku[sku] = {
        url:  cell(vals[i], cUrl),
        cat1: cell(vals[i], cLv[0]),
        cat2: cell(vals[i], cLv[1]),
        cat3: cell(vals[i], cLv[2])
      };
    }
  }

  collectSkus_(ss, 'VANTAR_MYND', missingImage);
  collectSkus_(ss, 'RAMMASAMNINGAR', framework);

  // Birti vorulistinn — ENDANLEGT svar um hvort vara se a vef.
  //
  // PRODUCTS getur ekki svarad thessu. Hann er fylltur af Cludo-syncinu, sem
  // saekir SKU ur collectAllSkusFromSystems_ — og thad fall hefur THRJAR
  // uppsprettur, allar SOLUSKRAR (NEWWEB, OLDWEB, BC_LINES). Vara sem hefur
  // aldrei verid keypt kemst thvi aldrei i PRODUCTS, og sagdi thar med
  // "Ekki i leitarvisi" thott hun se bædi a vef og finnanleg. Thad voru 605
  // vorur af 4.477 (13,5%), og thrjar efstu ur EKKI_A_VEF fundust allar a
  // vefnum vid handvirka profun 2026-09-09.
  //
  // getProductsV2 er opinber, tharf enga lykla og er sami listi sem vefurinn
  // birtir. Bilar hann er onWeb null = OTHEKKT, ekki "Nei".
  var onWeb = null;
  try {
    onWeb = {};
    fetchActiveProducts_().forEach(function (a) {
      if (a && a.parent) onWeb[normSku_(a.parent)] = true;
    });
    Logger.log('🌐 Birti vorulistinn: ' + Object.keys(onWeb).length + ' parent-SKU');
  } catch (e) {
    onWeb = null;
    Logger.log('⚠️ Nadi ekki i birta vorulistann — "A vef" verdur OTHEKKT: ' + e.message);
  }

  return { bySku: bySku, missingImage: missingImage, framework: framework, onWeb: onWeb };
}

/** Les SKU-kólumnu af undantekningaflipa yfir í mengi. Flipi sem vantar er ekki villa. */
function collectSkus_(ss, tabName, into) {
  const sh = ss.getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 2) return;
  const vals = sh.getDataRange().getValues();
  const c = vals[0].map(normHeader_).indexOf(normHeader_('SKU'));
  if (c === -1) { Logger.log('SKU-kólumna fannst ekki á ' + tabName); return; }
  for (let i = 1; i < vals.length; i++) {
    const sku = normSku_(vals[i][c]);
    if (sku) into[sku] = true;
  }
}

// ---------------------------------------------------------------------------
// Skrifa vinnusheetið — fá köll, ekkert styling inni í lykkju
// ---------------------------------------------------------------------------
function writePimSheet_(sh, rows) {
  const nCols = PIM_COLS_.length;
  const lastRow = Math.max(rows.length + 1, 2);

  sh.clear();
  sh.clearConditionalFormatRules();
  clearProtections_(sh);
  const f = sh.getFilter(); if (f) f.remove();

  sh.getRange(1, 1, 1, nCols)
    .setValues([PIM_COLS_.map(function (c) { return c.head; })])
    .setBackground('#10069f').setFontColor('#ffffff').setFontWeight('bold')
    .setFontFamily('Arial').setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(1, 38);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);

  if (rows.length) {
    sh.getRange(2, 1, rows.length, nCols)
      .setValues(rows).setFontFamily('Arial').setFontSize(10)
      .setVerticalAlignment('top');
  }

  // Wrap AÐEINS á reitina sem starfsfólk skrifar prósa í (wrap: true).
  //
  // Hér var áður setWrap(false) á allt, sem er OVERFLOW: lýsing á 100 orðum
  // birtist sem EIN KLIPPT LÍNA og skrifandinn sér ekki hvað hann skrifaði.
  // Það var versta atriðið við sheetið.
  //
  // Hinar kólumnurnar fá CLIP, ekki wrap: `Löng lýsing (núv.)` er löng
  // tilvísun og myndi gera hverja röð risastóra, sem eyðileggur skönnun.
  // Raðhæð er ekki fest á gagnaröðum, svo wrap-raðir vaxa sjálfar — og gera
  // það aðeins þegar eitthvað hefur verið skrifað.
  const WRAP = SpreadsheetApp.WrapStrategy.WRAP;
  const CLIP = SpreadsheetApp.WrapStrategy.CLIP;
  PIM_COLS_.forEach(function (c, i) {
    sh.setColumnWidth(i + 1, c.w);
    sh.getRange(2, i + 1, lastRow - 1, 1)
      .setBackground(PIM_FILL_[c.kind])
      .setWrapStrategy(c.wrap ? WRAP : CLIP);
  });

  // Kólumnubókstafir LEIDDIR af PIM_COLS_, aldrei handskrifaðir. Sjá
  // pimColLetter_ — handskrifaðir bókstafir gerðu formúlurnar þegjandi
  // rangar um leið og kólumnu var bætt við.
  const L = {};
  ['label', 'brandNew', 'nameNew', 'descNew', 'words', 'datasheet', 'sds',
   'status', 'image', 'onWeb', 'indexed', 'done'].forEach(function (k) { L[k] = pimColLetter_(k); });
  const R = function (k) { return L[k] + '2:' + L[k]; };

  // ARRAYFORMULA: ein formúla á kólumnu í stað einnar á röð.
  // Skiptir öllu fyrir hraða þegar raðirnar eru þúsundir.
  sh.getRange(L.words + '2').setFormula(
    '=ARRAYFORMULA(IF(' + R('label') + '="","",' +
    'IF(TRIM(' + R('descNew') + ')="",0,' +
    'LEN(TRIM(' + R('descNew') + '))-' +
    'LEN(SUBSTITUTE(TRIM(' + R('descNew') + ')," ",""))+1)))'
  );
  // ARRAYFORMULA ræður ekki við AND()/OR(): margföldun = AND, samlagning = OR.
  sh.getRange(L.done + '2').setFormula(
    '=ARRAYFORMULA(IF(' + R('label') + '="","",' +
    // 'Óbreytt' er stuttleid AD THVI GEFNU ad engin ny lysing hafi verid
    // skrifud. Se buid ad skrifa gildir ordamarkid eins og adur — annars
    // gaeti half-skrifud rod talist fullbuin af thvi hun var eitt sinn
    // merkt obreytt.
    'IF((' + R('status') + '="Óbreytt")*(' + R('words') + '=0),"JÁ",IF(' +
    '(' + R('brandNew') + '<>"")*(' + R('nameNew') + '<>"")*' +
    '(' + R('words') + '>=' + PIM_WORDS_MIN_ + ')*(' +
    R('words') + '<=' + PIM_WORDS_MAX_ + ')*(' + R('image') + '="Já")*' +
    '((' + R('datasheet') + '="Já")+(' + R('datasheet') + '="Á ekki við"))*' +
    '((' + R('sds') + '="Já")+(' + R('sds') + '="Á ekki við"))*' +
    '((' + R('status') + '="Samþykkt")+(' + R('status') + '="Flutt inn"))' +
    ',"JÁ","NEI"))))'
  );

  // Stada og vidhengin eru afram STRONG: their listar eru fastir i kodanum og
  // geta ekki glidnad fra config, og reitirnir eru handvaldir i sheetinu.
  const dvStatus = SpreadsheetApp.newDataValidation()
    .requireValueInList(PIM_STATUSES_, true).setAllowInvalid(false).build();
  const dvYesNo = SpreadsheetApp.newDataValidation()
    .requireValueInList(PIM_YESNO_, true).setAllowInvalid(false).build();
  const owners = pimOwners_();
  if (owners.length) {
    // setAllowInvalid(TRUE): vidvorun, ekki hofnun. Skipt ur false 2026-09-10.
    //
    // HVERS VEGNA: gagnaprofunin er ljosmynd af config-rodhinni tekin VID
    // BYGGINGU. Leidrettirdu rodhina en byggir ekki (eda byggir innan fimm
    // minutna medan loadConfig_ cache-ar ennþa gamla gildid) heldur sheetid
    // gamla listann. Tha hafnar thad thvi sem appid skrifar og skraning
    // brotnar med skilabodum sem nefna gamla listann — sem las eins og
    // config-rodhin vaeri enn rong.
    //
    // Strong hofnun var til ad verja handinnslatt. Nu skrifar APPID thennan
    // reit og gildid kemur ur adminGuard_, svo thad getur ekki verid
    // innslattarvilla. Handinnslattur faer enn appelsinugulan thrihyrning.
    // Vidvorun laetur gliðnun milli config og sheets kosta merki, ekki
    // utfall.
    const dvOwner = SpreadsheetApp.newDataValidation()
      .requireValueInList(owners, true).setAllowInvalid(true).build();
    sh.getRange(2, pimColNum_('owner'), lastRow - 1, 1).setDataValidation(dvOwner);
  } else {
    Logger.log('ℹ️ PIM_OWNERS vantar í STORKAUP_CONFIG → SETTINGS. Eigandi-kólumnan ' +
               'er frjáls texti. Bættu við röð: SETTINGS | PIM_OWNERS | Nafn1, Nafn2, ...');
  }

  sh.getRange(2, pimColNum_('status'), lastRow - 1, 1).setDataValidation(dvStatus);
  // Sitt hvort kallið — ekki gengið út frá því að viðhengin séu samliggjandi.
  sh.getRange(2, pimColNum_('datasheet'), lastRow - 1, 1).setDataValidation(dvYesNo);
  sh.getRange(2, pimColNum_('sds'), lastRow - 1, 1).setDataValidation(dvYesNo);

  const all   = sh.getRange(2, 1, lastRow - 1, nCols);
  const words = sh.getRange(2, pimColNum_('words'), lastRow - 1, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + L.done + '2="JÁ"')
      .setBackground('#dff3e7').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + L.status + '2="Spurning"')
      .setBackground('#fdf7ec').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + L.onWeb + '2="Nei"')
      .setFontColor('#9e2438').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($' + L.descNew + '2<>"",OR($' + L.words + '2<' +
                            PIM_WORDS_MIN_ + ',$' + L.words + '2>' + PIM_WORDS_MAX_ + '))')
      .setFontColor('#9e2438').setBold(true).setRanges([words]).build()
  ]);

  sh.getRange(1, 1, lastRow, nCols).createFilter();

  // Vernd: allt nema gulu kólumnurnar. Label er tengingin við BC og má aldrei breytast.
  const me = Session.getEffectiveUser();
  PIM_COLS_.forEach(function (c, i) {
    if (c.kind === 'edit') return;
    const p = sh.getRange(1, i + 1, lastRow, 1).protect()
      .setDescription(c.head + ' — uppfærist sjálfkrafa, ekki breyta');
    p.removeEditors(p.getEditors());
    p.addEditor(me);
  });
}

function clearProtections_(sh) {
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .forEach(function (p) { if (p.canEdit()) p.remove(); });
}

// ---------------------------------------------------------------------------
// Vörur í Plytix sem leitarvísirinn hefur aldrei séð
// ---------------------------------------------------------------------------
function writeOrphanTab_(ss, rows) {
  let sh = ss.getSheetByName(PIM_ORPHAN_);
  if (!sh) sh = ss.insertSheet(PIM_ORPHAN_);
  sh.clear();

  sh.getRange(1, 1, 1, 4)
    .setValues([['Label', 'SKU', 'Vöruheiti', 'Vörumerki']])
    .setBackground('#10069f').setFontColor('#ffffff').setFontWeight('bold').setFontFamily('Arial');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 4).setValues(rows).setFontFamily('Arial').setFontSize(10);
  }
  sh.getRange(rows.length + 3, 1).setValue(
    'Vörur sem eru Í BIRTINGU í Plytix (Completed) en eru EKKI í birta vörulistanum á ' +
    'storkaup.is. Archived vörur eru ekki hér. Þetta er ósamræmi milli kerfa og textavinna ' +
    'lagar það ekki — sér verkefni. ATH: þessi flipi mældi áður fjarvist PRODUCTS-raðar og ' +
    'gaf 605 falskar vörur, því PRODUCTS er fyllt úr SÖLUSKRÁM og vara sem hefur aldrei ' +
    'verið keypt kemst ekki þangað. Hann er nú borinn við vörulistann sjálfan.'
  ).setFontFamily('Arial').setFontStyle('italic').setFontColor('#5c5c63');
  sh.setColumnWidth(1, 120); sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 300); sh.setColumnWidth(4, 140);
  sh.setFrozenRows(1);
}

// ---------------------------------------------------------------------------
// Framvinda
// ---------------------------------------------------------------------------
function buildPimStats_(ss, nRows) {
  let sh = ss.getSheetByName(PIM_STATS_);
  if (!sh) sh = ss.insertSheet(PIM_STATS_);
  sh.clear();

  const V = "'" + PIM_SHEET_ + "'!";
  const last = nRows + 1;

  // Allir kólumnubókstafir leiddir af PIM_COLS_ — sjá pimColLetter_.
  const C = function (k) { const l = pimColLetter_(k); return V + '$' + l + '$2:$' + l; };
  const Cn = function (k) { const l = pimColLetter_(k); return V + '$' + l + '$2:$' + l + '$' + last; };

  const body = [
    ['Framvinda', ''],
    ['Reiknast af ' + PIM_SHEET_ + '. Þetta er talan sem fer á dashboardið.', ''],
    ['', ''],
    ['Vörur alls',        '=COUNTA(' + C('label') + ')'],
    ['Fullbúnar',         '=COUNTIF(' + C('done') + ',"JÁ")'],
    ['Hlutfall fullbúið', '=IFERROR(B5/B4,0)'],
    // Hét áður "Með tóma lýsingu", sem las eins og 4.477 vörur hefðu enga
    // lýsingu. Talan er rétt en merkingin var röng: hún telur NÝJA reitinn,
    // sem er tómur af því enginn hefur skrifað enn. 3.280 vörur HAFA
    // raunverulega lýsingu.
    ['Ný lýsing óskrifuð', '=SUMPRODUCT((' + Cn('label') + '<>"")*(TRIM(' + Cn('descNew') + ')=""))'],
    // Núverandi lýsing sem er bara heitið aftur. Bar áður aðeins við
    // Vöruheiti (núv.) = Commercial Name og gaf 486. Lýsingin er LÍKA oft
    // afrit af Label, og sú tala er 1.190. Rétta talan er hvort sem er:
    // 1.212 vörur. SIGN klemmir samlagninguna, annars tvítelst vara sem
    // stemmir við bæði (samlagning = OR í SUMPRODUCT, en 1+1=2).
    ['Núv. lýsing = heitið', '=SUMPRODUCT((' + Cn('label') + '<>"")*(TRIM(' + Cn('descOld') +
                            ')<>"")*SIGN((TRIM(' + Cn('descOld') + ')=TRIM(' + Cn('nameOld') +
                            '))+(TRIM(' + Cn('descOld') + ')=TRIM(' + Cn('label') + '))))'],
    ['Núv. lýsing tóm',    '=SUMPRODUCT((' + Cn('label') + '<>"")*(TRIM(' + Cn('descOld') + ')=""))'],
    // Adur: COUNTIF(indexed,"Nei") = 605, sem var fjarvist PRODUCTS-radar og
    // ekki leitarvisir. Nu er "A vef" endanlegt og "I leitarvisi" tomt thegar
    // vid vitum ekki — sja readKpiEnrichment_.
    ['Ekki á vef',         '=COUNTIF(' + C('onWeb') + ',"Nei")'],
    ['Leitarvísir óþekktur', '=SUMPRODUCT((' + Cn('label') + '<>"")*(' + Cn('indexed') + '=""))'],
    ['Í rammasamningi',    '=COUNTIF(' + C('framework') + ',"Já")'],
    ['', '']
  ];
  PIM_STATUSES_.forEach(function (s) {
    body.push([s, '=COUNTIF(' + C('status') + ',"' + s + '")']);
  });

  sh.getRange(1, 1, body.length, 2).setValues(body).setFontFamily('Arial');
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold').setFontColor('#10069f');
  sh.getRange(6, 2).setNumberFormat('0.0%');
  sh.setColumnWidth(1, 220);
  sh.setColumnWidth(2, 120);

  // Flokkatafla með QUERY — fylgir sjálfkrafa þeim flokkum sem eru til.
  // Grúppað á Undirflokk (Level 3) því það er verkbúturinn: 217 hópar,
  // miðgildi 13 vörur. Gert er ráð fyrir 300 röðum hér að neðan.
  //
  // Svæðið er ANKRAÐ Í A viljandi. QUERY-kólumnubókstafir eru afstæðir við
  // svæðið, svo 'C2:U' með "select C" hefði valið þriðju kólumnu SVÆÐISINS
  // (blaðkólumnu E), ekki C. Byrji svæðið í A eru bókstafirnir þeir sömu
  // hvernig sem á það er litið.
  const grp = pimColLetter_('cat' + pimOwnerLevelNum_());
  const r = body.length + 2;
  sh.getRange(r, 1).setValue('Eftir undirflokki').setFontWeight('bold').setFontFamily('Arial');
  sh.getRange(r + 1, 1).setFormula(
    '=QUERY(' + V + 'A2:' + pimColLetter_('done') + ', "select ' + grp +
    ', count(' + grp + ') where ' + grp + ' is not null and ' + grp + ' != \'\' ' +
    'group by ' + grp + ' order by count(' + grp + ') desc ' +
    'label ' + grp + ' \'Undirflokkur\', count(' + grp + ') \'Alls\'", 0)'
  );
  sh.getRange(r + 1, 3).setValue('Fullbúnar').setFontWeight('bold').setFontFamily('Arial');
  sh.getRange(r + 1, 4).setValue('Hlutfall').setFontWeight('bold').setFontFamily('Arial');
  sh.getRange(r + 2, 3).setFormula(
    '=ARRAYFORMULA(IF(A' + (r + 2) + ':A="","",COUNTIFS(' +
    C('cat' + pimOwnerLevelNum_()) + ',A' + (r + 2) + ':A,' + C('done') + ',"JÁ")))'
  );
  sh.getRange(r + 2, 4).setFormula(
    '=ARRAYFORMULA(IF(A' + (r + 2) + ':A="","",IFERROR(C' + (r + 2) + ':C/B' + (r + 2) + ':B,0)))'
  );
  sh.getRange(r + 2, 4, 300, 1).setNumberFormat('0.0%');
}

// ---------------------------------------------------------------------------
// Leiðbeiningar — skrifað einu sinni, ekki yfirskrifað
// ---------------------------------------------------------------------------
function buildPimGuide_(ss) {
  // ENDURSKRIFAST I HVERRI BYGGINGU.
  //
  // Adur stod her `if (ss.getSheetByName(PIM_GUIDE_)) return;` — flipinn var
  // skrifadur EINU SINNI og aldrei aftur. Hann sagdi thvi enn "Data → Filter
  // views" longu eftir ad appid tok vid, og thekkti hvorki `Óbreytt` ne
  // `Vísbending`. Leidbeiningar sem uppfaerast ekki verda ad rangfaerslum.
  let sh = ss.getSheetByName(PIM_GUIDE_);
  if (sh) sh.clear(); else sh = ss.insertSheet(PIM_GUIDE_, 0);
  const rows = [
    ['Vöruinnihald 2026', ''],
    ['', ''],
    ['Vinnan fer fram í APPINU', 'Ekki í þessu skjali og ekki í Plytix. Appið skrifar hingað; hér er yfirlesturinn og framvindan.'],
    ['1.  Veldu þér flokk', 'Í appinu: browse-aðu tréð (Yfirflokkur → Flokkur → Undirflokkur) og taktu flokk. Hann verður þinn og aðrir sjá það.'],
    ['2.  Skrifaðu', 'Vöruheiti og löng lýsing, og merktu hvort gagnablað og öryggisblað séu til. Vara telst ekki fullbúin fyrr en viðhengin tvö eru merkt.'],
    ['3.  Veldu hnapp', '„Vista og næsta" → Til yfirlesturs.  „Engin breyting" → Óbreytt, þegar varan er í lagi eins og hún er.  „Merkja spurningu" → Spurning, og skrifaðu hvað vantar.'],
    ['4.  Lestu vísbendinguna', 'Sum lýsing lítur út fyrir að vera til en er það ekki: AFRITUÐ = sami vörumerkjatexti á mörgum vörum. HTML = límt af vefsíðu birgja. ORÐALAG = bannlistinn. OF STUTT = undir orðamarki.'],
    ['5.  Ekki fara í Plytix', 'Innflutningurinn er ein samræmd keyrsla.'],
    ['', ''],
    ['Gult', 'Þú fyllir þetta út.'],
    ['Grátt', 'Kemur úr Plytix og Business Central. Læst — Label er tengingin milli kerfanna.'],
    ['Fjólublátt', 'Kemur úr öðrum kerfum: flokkalögin þrjú, vefslóð, mynd, hvort varan sé á vef, rammasamningur.'],
    ['Ljósblátt', 'Reiknast sjálfkrafa.'],
    ['', ''],
    ['Vöruheiti', 'Vörutegund, týpa, afbrigði, stærð  —  t.d.  Ryksuga, VP400 HEPA XT, 700W'],
    ['Löng lýsing', PIM_WORDS_MIN_ + '–' + PIM_WORDS_MAX_ + ' orð. Fyrsta setningin segir hvað varan er og fyrir hvern, og verður að standa sjálfstæð. Einfaldar vörur ná ekki mörgum orðum og eiga ekki að teygja sig.'],
    ['Ritstíllinn', 'Fullar reglur, bannlisti og gátlisti eru í uppflettisíðunni „Ritstíll vörukorta" (docs/voruinnihald/ritstill.html).'],
    ['Vísbending', 'Reiknast við byggingu úr núverandi lýsingu. Mælt 2026-09-11: 2.242 af 3.258 raunverulegum lýsingum bera merki — 785 eru orðrétt eins og önnur vara, 556 innihalda HTML.'],
    ['', ''],
    ['Rammasamningur = Já', 'Þessar vörur kaupa stórir viðskiptavinir reglulega. Taktu þær fyrst.']
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows).setFontFamily('Arial');
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold').setFontColor('#10069f');
  // Litalykillinn er FUNDINN, ekki talinn.
  //
  // Adur stod her getRange(8..11) — fost raðnumer i lista sem er ritstyrdur.
  // Tvaer nyjar linur efst faerdu litina nidur a "Ekki fara i Plytix" og
  // tomma linu, og enginn hefdi tekid eftir. Sama villa og hardskrifudu
  // kolumnubokstafirnir voru (sja pimColLetter_).
  const guideRow_ = function (label) {
    for (let i = 0; i < rows.length; i++) if (rows[i][0] === label) return i + 1;
    return 0;
  };
  [['Gult', 'edit'], ['Grátt', 'lock'], ['Fjólublátt', 'join'], ['Ljósblátt', 'calc']]
    .forEach(function (pair) {
      const r = guideRow_(pair[0]);
      if (r) sh.getRange(r, 1).setBackground(PIM_FILL_[pair[1]]);
    });
  sh.setColumnWidth(1, 200);
  sh.setColumnWidth(2, 660);
  sh.setHiddenGridlines(true);
}

// ---------------------------------------------------------------------------
// Plytix CSV
// ---------------------------------------------------------------------------
function pimDropFolderId_() {
  const cfg = loadConfig_();
  const id = String((cfg.SETTINGS || {}).PIM_DROP_FOLDER_ID || '').trim();
  if (!id) {
    throw new Error('PIM_DROP_FOLDER_ID vantar. Bættu við línu í STORKAUP_CONFIG → SETTINGS:\n' +
                    '  Key = PIM_DROP_FOLDER_ID\n  Value = <folder ID úr Drive URL>');
  }
  return id;
}

// Úttaksskrár heitalinterans lifa í sömu möppu og hráa útdrættinum.
// Þær eru líka .csv, svo án þessa gæti nýjasta skráin verið _brot.csv.
const PIM_IGNORE_SUFFIX_ = /_(brot|commercial_name|tillogur)\.csv$/i;

function readLatestPlytixCsv_() {
  const it = DriveApp.getFolderById(pimDropFolderId_()).getFiles();
  let newest = null;
  const skipped = [];
  while (it.hasNext()) {
    const f = it.next();
    const name = f.getName();
    if (!/\.csv$/i.test(name)) continue;
    if (PIM_IGNORE_SUFFIX_.test(name)) { skipped.push(name); continue; }
    if (!newest || f.getDateCreated() > newest.getDateCreated()) newest = f;
  }
  if (skipped.length) Logger.log('Sleppti linter-úttaki: ' + skipped.join(', '));
  if (!newest) {
    throw new Error('Ekkert hrátt Plytix-CSV í drop-möppunni.' +
      (skipped.length ? ' Aðeins linter-úttak fannst: ' + skipped.join(', ') : ''));
  }
  Logger.log('Les ' + newest.getName() + ' (' + newest.getDateCreated() + ')');

  const text = newest.getBlob().getDataAsString('UTF-8');
  // Fljótleg skynsemisathugun: hrái útdrátturinn hefur Label, linter-úttakið ekki.
  const head = text.slice(0, 2000).toLowerCase();
  if (head.indexOf('label') === -1) {
    throw new Error('Skráin ' + newest.getName() + ' lítur ekki út eins og Plytix-útdráttur ' +
                    '(engin Label-kólumna). Er rétt skrá í drop-möppunni?');
  }
  return text;
}

function parsePlytixCsv_(text) {
  const cfg = loadConfig_();
  const delim = (cfg.SETTINGS && cfg.SETTINGS.PIM_CSV_DELIMITER) || ',';
  const grid = Utilities.parseCsv(text, delim);
  if (grid.length < 2) return [];

  const heads = grid[0].map(normHeader_);
  const col = {};
  Object.keys(PIM_HEADER_MAP_).forEach(function (key) {
    const wanted = PIM_HEADER_MAP_[key].map(normHeader_);
    for (let i = 0; i < heads.length; i++) {
      if (wanted.indexOf(heads[i]) !== -1) { col[key] = i; return; }
    }
  });
  ['label', 'sku', 'name'].forEach(function (k) {
    if (col[k] === undefined) {
      throw new Error('Fann ekki "' + k + '" í útdrættinum. Lagaðu PIM_HEADER_MAP_ efst í skránni. ' +
                      'Hausar sem fundust: ' + grid[0].join(' | '));
    }
  });

  // Vantar Status-kólumnan? Þá er EKKI síað — betra að fá allt með og sjá það
  // en að fela 44% af listanum þegjandi ef Plytix endurskírir kólumnuna.
  if (col.plytixStatus === undefined) {
    Logger.log('⚠️ Status-kólumna fannst ekki í útdrættinum — engin síun á ' +
               'birtingarstöðu. Archived vörur fara því með í vinnusheetið. ' +
               'Hausar: ' + grid[0].join(' | '));
  }

  const pick = function (r, k) { return col[k] === undefined ? '' : String(r[col[k]] || '').trim(); };

  return grid.slice(1).map(function (r) {
    return {
      label:       pick(r, 'label'),
      sku:         normSku_(pick(r, 'sku')),
      brand:       pick(r, 'brand'),
      name:        pick(r, 'name'),
      description: pick(r, 'description'),
      categories:  pick(r, 'categories'),
      thumbnail:   pick(r, 'thumbnail') !== '',
      plytixStatus: pick(r, 'plytixStatus'),
      statusKnown: col.plytixStatus !== undefined,
      framework:   /^(true|1|já|ja|yes)$/i.test(pick(r, 'framework'))
    };
  }).filter(function (p) { return p.label; });
}

// ---------------------------------------------------------------------------
// Hjálparföll
// ---------------------------------------------------------------------------
/** Plytix Categories, raunverulegt snið:
 *    "Stórkaup>Rekstrarvörur>Ræstiáhöld>Skaft og festingar"
 *
 *  Tvennt sem sniðið krefst, bæði mælt á útdrættinum 2026-09-08:
 *
 *  1. Rótin "Stórkaup" er MEÐ í slóðinni og telur ekki sem lag. Sé henni ekki
 *     sleppt skilar 'Level 2' Level 1 — það gerðist á 100% af 4.470 röðum.
 *
 *  2. Vara getur verið í mörgum flokkum, skilið að með kommu. En komma er
 *     LÍKA inni í flokksheitum ("Snakk, kex og sælgæti"), svo það má aldrei
 *     kljúfa á bera kommu. Klofið er á ",<rót>>" því hver slóð byrjar á
 *     rótinni. Mælt: 622 raðir með marga flokka, 290 með kommu inni í heiti.
 *
 *  Fyrsta slóðin ræður. 99,7% Completed-vara hafa nákvæmlega þrjú lög, svo
 *  varaleiðin á dýpsta lag kviknar sjaldan. */
function plytixCategory_(path, level) {
  if (!path) return '';
  const first = String(path).split(new RegExp(',(?=' + PIM_CATEGORY_ROOT_ + '>)'))[0];
  let parts = first.split(/\s*[>\/|]\s*/).filter(String);
  if (parts.length && parts[0] === PIM_CATEGORY_ROOT_) parts = parts.slice(1);
  const want = level || pimOwnerLevelNum_();
  // Nákvæmt lag, engin varaleið á dýpsta lag: þrjár samsíða kólumnur
  // verða að segja það sem tréð segir. Tómt Level 3 er raunveruleg
  // staða (8 vörur af 4.473) og á að vera sýnileg, ekki fyllt.
  return parts[want - 1] || '';
}

/** Eigendalistinn fyrir dropdown a Eigandi-kolumnunni.
 *  STORKAUP_CONFIG -> SETTINGS -> VORUINNIHALD_APP_EMAILS, kommu-adskilin
 *  NETFONG. Sama rodh sem adminGuard_ notar fyrir adgang — ein rodh, ekki
 *  tvaer sem verda ad stemma. Vanti stillingin er EKKI sett gagnaprofun — reiturinn
 *  verdur frjals texti. Tomt val med setAllowInvalid(false) myndi gera
 *  kolumnuna onothaefa, og thad er verri utkoma en enginn dropdown.
 *  Ad breyta listanum krefst ekki push, adeins radar i STORKAUP_CONFIG. */
function pimOwners_() {
  const cfg = loadConfig_();
  const sets = cfg.SETTINGS || {};
  // EIN RÖÐ, EKKI TVÆR. `VORUINNIHALD_APP_EMAILS` er þegar til: hún segir
  // hverjir mega opna vöruinnihalds-appið (sjá `adminGuard_`). Þeir sömu eru
  // þeir sem eiga að geta stimplað sig á flokk, svo fellilistinn les hana í
  // stað þess að hafa sinn eigin lista sem verður að stemma. Tvær raðir sem
  // eiga að vera eins gliðna alltaf í sundur að lokum.
  //
  // NETFÖNG, ekki nöfn: appið stimplar innskráðan notanda í kólumnuna og
  // `adminGuard_` skilar netfangi, svo nafn hér þýddi að gagnaprófunin
  // hafnaði því sem appið skrifar.
  //
  // `PIM_OWNERS` er lesin til vara fyrir sheet sem var byggt áður en appið
  // varð til. Sé hvorug til er ENGIN gagnaprófun sett — sjá kallstaðinn.
  const raw = String(sets.VORUINNIHALD_APP_EMAILS || sets.PIM_OWNERS || '');
  return raw.split(',').map(function (x) { return String(x).trim(); }).filter(Boolean);
}

/** Lagtalan sem PIM_OWNER_LEVEL_ segir til um ('Level 3' -> 3).
 *  Þessi stilling ræður tvennu og verður að ráða báðu, annars er hún
 *  skreyting sem gerir ekkert þegar henni er breytt:
 *    1. varaleiðar-lagið í plytixCategory_
 *    2. hvaða kólumnu Framvinda grúppar á */
function pimOwnerLevelNum_() {
  return parseInt(String(PIM_OWNER_LEVEL_).replace(/\D/g, ''), 10) || 3;
}

/** Kólumnunúmer (1-basað) fyrir lykil í PIM_COLS_. Kastar ef lykill er óþekktur
 *  — betra en að skrifa þegjandi í ranga kólumnu. */
function pimColNum_(key) {
  for (let i = 0; i < PIM_COLS_.length; i++) {
    if (PIM_COLS_[i].key === key) return i + 1;
  }
  throw new Error('pimColNum_: óþekktur kólumnulykill "' + key + '"');
}

/** A1-bókstafur fyrir lykil í PIM_COLS_.
 *
 *  ÞETTA ER ÁSTÆÐAN: bæði ARRAYFORMULU-strengirnar og skilyrta sniðið vísa á
 *  kólumnur með bókstaf. Áður voru þeir handskrifaðir ('J2:J', '$S2'), svo ný
 *  kólumna hliðraði öllu og formúlurnar reiknuðu ÞEGJANDI úr rangri kólumnu.
 *  Nú er hver bókstafur leiddur af PIM_COLS_, svo röðin má breytast. */
function pimColLetter_(key) {
  let n = pimColNum_(key), out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = (n - 1 - r) / 26;
  }
  return out;
}

function normHeader_(s) {
  return String(s || '').toLowerCase().replace(/[\s_\-]/g, '');
}

/**
 * Plytix og Cludo skrifa sama SKU á tvo vegu:
 *   Plytix          STO_9004290
 *   PRODUCTS/Cludo  9004290  —  og stundum 01015 með forleiðandi núlli
 * Án þessa matchar ekkert og allar vörur lenda í EKKI_A_VEF.
 */
function normSku_(v) {
  let s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return '';
  s = s.replace(/^[A-Za-zÁÉÍÓÚÝÐÞÆÖ]+[_\-\s]+/, '');   // STO_9004290 -> 9004290
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s.toUpperCase();
}

function todayIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Utgafumerki: 2026-09-11, Visbending.
