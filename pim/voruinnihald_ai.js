'use strict';

/************************************************************
 * voruinnihald_ai.js — AI-drög að vörulýsingu
 *
 * HVERS VEGNA ÞETTA ER BYGGT EINS OG ÞAÐ ER BYGGT
 *
 * Þann 2026-09-11 mældum við Plytix-útdráttinn: af 3.258 raunverulegum
 * lýsingum bera 2.242 merki um vélritaðan eða afritaðan texta. 785 eru
 * orðrétt eins og önnur vara — `Santa Maria krydd eru þekkt fyrir frábær
 * gæði` stendur á 35 vörum. Verkefnið sem þetta app þjónar er að hreinsa
 * nákvæmlega þann texta upp.
 *
 * Að bæta svo við hnappi sem lætur mállíkan skrifa lýsingar er þversögn —
 * NEMA munurinn sé skilinn. Gagnslausi AI-textinn varð ekki til af því
 * líkanið er lélegt. Hann varð til af því líkanið fékk EKKERT NEMA
 * VÖRUHEITIÐ. Þá er ekkert satt til að segja og það fyllir upp í með
 * lofsyrðum. Sama líkan með `22 kPa`, `32 L/s` og `56 dB(A)` í höndunum
 * skrifar allt annan texta.
 *
 * Þess vegna gildir hér EIN REGLA, og hún er ófrávíkjanleg:
 *
 *     LÍKANIÐ ORÐAR ÞAÐ SEM MAÐUR SAGÐI ÞVÍ. ÞAÐ FINNUR EKKERT UPP.
 *
 * Starfsmaðurinn opnar gagnablaðið (tengillinn er í appinu), skrifar
 * tölurnar og notkunina í punktum, og ýtir á hnappinn. Líkanið setur það
 * í húsreglurnar. Sé ekkert efni gefið er beiðninni HAFNAÐ — það er eina
 * leiðin til að hnappurinn framleiði ekki sama ruslið og við erum að þrífa.
 *
 * Þrjár varnir að auki:
 *   1. Drögin vistast ALDREI sjálf. Þau fara í textareitinn; manneskja les,
 *      lagar og ýtir á vista. Sá sem vistar ber ábyrgðina.
 *   2. `pimDescHint_` — sami greinir og mældi safnið — dæmir útkomuna áður
 *      en hún birtist. Falli hún á orðalagi fær líkanið eina tilraun í
 *      viðbót þar sem brotin eru nefnd. Mælingin frá í gær er prófið á
 *      það sem við framleiðum á morgun.
 *   3. `Uppruni` skráist á röðina. Uppruni slær greiningu út: eftir á er
 *      ágiskun, við upptökin er staðreynd.
 *
 * Keyrir í AÐAL-projectinu því Anthropic-lykillinn býr þar
 * (`API.Anthropic.API_KEY`). Admin-appið kallar gegnum `admin/delegate.js`.
 ************************************************************/

/** Lágmarksefni frá manneskju. Undir þessu er ekkert að orða. */
var PIM_AI_MIN_NOTES_ = 12;

/** Hámark sem sent er á líkanið, svo ein löng líming sprengi ekki kallið. */
var PIM_AI_MAX_INPUT_ = 4000;

/**
 * Semur drög úr því sem starfsmaðurinn gaf.
 *
 * @param {Object} ctx  {sku, label, name, brand, cat1, cat2, cat3,
 *                       notes, descOld, hasDatasheet}
 * @return {Object} {text, words, hint, attempts, refused}
 */
function pimDraftDescription_(ctx) {
  ctx = ctx || {};

  // --- 1. Er nokkuð að orða? ------------------------------------------
  var notes = String(ctx.notes || '').trim().slice(0, PIM_AI_MAX_INPUT_);
  var words = pimWords_(notes);

  if (words < PIM_AI_MIN_NOTES_) {
    // HAFNAÐ, EKKI GISKAÐ. Þetta er allur varnarmúrinn: án efnis myndi
    // líkanið framleiða nákvæmlega þann texta sem verkefnið er að fjarlægja.
    return {
      refused: true,
      text: '',
      message: 'Skrifaðu fyrst í reitinn hvað varan er og hvaða tölur eiga við — ' +
               'minnst ' + PIM_AI_MIN_NOTES_ + ' orð, punktar duga. ' +
               (ctx.hasDatasheet
                 ? 'Gagnablaðið er tengt hér fyrir ofan; tölurnar eru þar.'
                 : 'Þessi vara hefur ekkert gagnablað í Plytix, svo efnið þarf að koma frá þér.') +
               ' Hnappurinn orðar það sem þú segir honum — hann veit ekkert um vöruna sjálfur.'
    };
  }

  // --- 2. Semja -------------------------------------------------------
  var first = pimAiCall_(pimAiPrompt_(ctx, notes, null));
  var h1 = pimDescHint_(first, 1);

  // Tvennt kallar á aðra tilraun, og hvort tveggja er hlutlægt:
  //
  //   ORÐALAG — bannlistinn. Brotin eru nefnd í seinni beiðninni.
  //   OF LANGT — yfir PIM_WORDS_MAX_. Mælt á fyrstu raunverulegu drögunum
  //              2026-09-11: 167 orð þar sem markið er 150. Líkanið hlýðir
  //              lengdarmarki verr en bannlista, svo það þarf að fá töluna
  //              sem kröfu en ekki sem leiðbeiningu.
  //
  // AFRITUÐ og HTML geta ekki komið héðan. OF STUTT er sagt frá en ekki reynt
  // aftur — stutt svar þýðir að efnið var stutt, og þá á manneskjan að bæta
  // við frekar en að líkanið teygi sig.
  var needsRetry = h1.indexOf('ORÐALAG') >= 0 || h1.indexOf('OF LANGT') >= 0;
  if (needsRetry) {
    var second = pimAiCall_(pimAiPrompt_(ctx, notes, {
      words: pimAiOffenders_(first),
      tooLong: h1.indexOf('OF LANGT') >= 0 ? pimWords_(first) : 0
    }));
    var h2 = pimDescHint_(second, 1);
    // Skilum seinni tilrauninni hvort sem hún stóðst eða ekki — með merkinu.
    // Manneskjan ritstýrir hvort sem er, og þögult brottfall væri verra en
    // sýnilegt brot.
    return { text: second, words: pimWords_(second), hint: h2, attempts: 2 };
  }

  return { text: first, words: pimWords_(first), hint: h1, attempts: 1 };
}

/** Hvaða bönnuðu orð/orðasambönd eru í textanum. Notað í seinni tilraun. */
function pimAiOffenders_(t) {
  var low = String(t || '').toLowerCase();
  var out = [];
  PIM_BANNED_.forEach(function (b) { if (low.indexOf(b) !== -1) out.push(b); });
  PIM_TELLS_.forEach(function (rx) {
    var m = low.match(rx);
    if (m) out.push(m[0]);
  });
  return out;
}

function pimAiPrompt_(ctx, notes, fix) {
  var path = [ctx.cat1, ctx.cat2, ctx.cat3].filter(Boolean).join(' › ');
  var p = [];

  p.push('Varan:');
  p.push('  Vörumerki: ' + (ctx.brand || '(ótilgreint)'));
  p.push('  Heiti: ' + (ctx.name || ctx.label || ''));
  p.push('  Flokkur: ' + (path || '(ótilgreindur)'));
  if (ctx.descOld) p.push('  Núverandi lýsing (má nota sem hráefni): ' + ctx.descOld);
  p.push('');
  p.push('Efnið frá starfsmanni Stórkaups — ÞETTA ER ALLT SEM ÞÚ VEIST:');
  p.push(notes);
  p.push('');
  if (fix && fix.words && fix.words.length) {
    p.push('Fyrri tilraun þín notaði þetta orðalag, sem er bannað: ' +
           fix.words.join(', ') + '. Skrifaðu upp á nýtt án þess.');
    p.push('');
  }
  if (fix && fix.tooLong) {
    p.push('Fyrri tilraun þín var ' + fix.tooLong + ' orð. HÁMARKIÐ ER ' +
           PIM_WORDS_MAX_ + ' ORÐ og það er krafa, ekki viðmið. Styttu með því ' +
           'að fella burt setningar sem draga saman eða endurorða það sem ' +
           'þegar er sagt — ALDREI með því að henda tölu eða staðreynd.');
    p.push('');
  }
  p.push('Skrifaðu langa lýsingu fyrir vörukortið. Skilaðu EINGÖNGU ' +
         'lýsingunni sjálfri, engum fyrirsögnum og engum skýringum.');
  return p.join('\n');
}

function pimAiSystem_() {
  return [
    'Þú ert starfsmaður Stórkaups, heildsölu sem selur íslenskum fyrirtækjum.',
    'Þú skrifar vörulýsingar á íslensku fyrir innkaupafólk sem er að leysa',
    'vandamál á vinnutíma.',
    '',
    'ÓFRÁVÍKJANLEG REGLA: þú mátt EKKERT segja sem kemur ekki fram í efninu',
    'sem þér er gefið. Enga eiginleika, engar tölur, enga notkun, engin efni',
    'sem þú giskar á út frá vöruheitinu. Sé efnið rýrt skrifarðu stutta lýsingu.',
    'Stutt og satt er rétt; langt og ágiskað er rangt.',
    '',
    'Bygging:',
    '1. Fyrsta setningin segir hvað varan er og fyrir hvern. Hún verður að',
    '   standa sjálfstæð, því hún birtist ein í leitarniðurstöðum.',
    '2. Síðan hvernig hún er notuð, í raunverulegu umhverfi.',
    '3. Tölur, efni og skilyrði sem starfsmaðurinn gaf.',
    '',
    'Tölur koma í stað lýsingarorða. Ekki "öflug" heldur "22 kPa sogkraftur".',
    'Ekki "hljóðlát" heldur "56 dB(A)".',
    '',
    'BANNAÐ: ' + PIM_BANNED_.join(', ') + '.',
    'Líka bannað: "hvort sem", "býður upp á", "tryggir", "sameinar X og Y",',
    '"notendavæn", "hámarks/lágmarks", "þökk sé", "fullkomin lausn",',
    '"tilvalin fyrir", "í senn", "einfaldleiki".',
    'Aldrei verð, tilboð, lagerstöðu, afhendingartíma eða nöfn samkeppnisaðila.',
    'Aldrei endurtaka vöruheitið sem alla lýsinguna.',
    '',
    'LENGD: ' + PIM_WORDS_MIN_ + '–' + PIM_WORDS_MAX_ + ' orð. ' + PIM_WORDS_MAX_ +
    ' er ÞAK sem má ekki fara yfir. Miðaðu við 60–90 orð á flókinni vöru',
    'með tölum; einföld vara á ekki að teygja sig.',
    'Ekki skrifa lokasetningu sem dregur saman það sem á undan kom — hún',
    'bætir engu við og étur plássið.'
  ].join('\n');
}

/**
 * Sækir lykilinn og SEGIR HVAÐ ER TIL ef hann finnst ekki.
 *
 * Villuboð sem segja bara „vantar lykil" láta mann leita í blindni. Röðin
 * er líklega til en heitir ekki alveg það sem kóðinn leitar að — það er
 * nákvæmlega sama villa og `umsjon@` gegn `umsokn@` var, og hún kostaði
 * heilan hring. Því telur þetta upp þau Service-heiti sem eru raunverulega
 * í API-flipanum og lætur manneskjuna bera saman.
 */
function pimAiKey_(cfg) {
  var api = (cfg.API && (cfg.API.Anthropic || cfg.API.Claude)) || {};
  var key = api.API_KEY || api.KEY;
  if (key) return key;

  var names = Object.keys((cfg && cfg.API) || {}).sort();
  throw new Error(
    'Fann engan Anthropic-lykil. Kóðinn leitar að Service = "Anthropic" ' +
    '(eða "Claude") með Key = "API_KEY" í STORKAUP_CONFIG → API. ' +
    'Service-heitin sem eru í flipanum núna: ' + (names.join(', ') || '(engin)') +
    '. Stafi þau ekki nákvæmlega eins er það stafsetningin, ekki lykillinn. ' +
    'ATH: loadConfig_ geymir config í 5 mínútur — keyrðu clearConfigCache ' +
    'ef þú varst að bæta röðinni við.');
}

/**
 * Sjálfspróf, keyrt handvirkt úr Apps Script-ritlinum.
 *
 * Staðfestir alla leiðina í einu: að lykillinn finnist, að Anthropic svari,
 * að hreinsunin virki og að greinirinn dæmi útkomuna. Skrifar í keyrsluskrá.
 * Betra en að prófa gegnum appið, því hér sést hvar keðjan slitnar.
 */
function pimAiSelfTest_v1() {
  clearConfigCache();                 // ný config-röð sést strax
  var cfg = loadConfig_();

  var names = Object.keys((cfg && cfg.API) || {}).sort();
  Logger.log('[PIM][AI] Service-heiti i API-flipanum: ' + names.join(', '));

  var key = pimAiKey_(cfg);           // kastar með gagnlegum texta ef vantar
  Logger.log('[PIM][AI] Lykill fannst. Lengd ' + String(key).length +
             ', byrjar a "' + String(key).slice(0, 12) + '…"');

  var model = ((cfg.API && (cfg.API.Anthropic || cfg.API.Claude)) || {}).MODEL ||
    (cfg.SETTINGS && cfg.SETTINGS.SEO_CLAUDE_MODEL) || 'claude-sonnet-5';
  Logger.log('[PIM][AI] Modelid sem verdur notad: ' + model);

  var r = pimDraftDescription_({
    sku: '9003293', label: 'Ryksuga VP400', name: 'Ryksuga, VP400 HEPA XT',
    brand: 'Nilfisk', cat1: 'Vélar og tæki', cat2: 'Ryksugur',
    hasDatasheet: true,
    notes: '22 kPa sogkraftur, 32 L/s loftflæði, 700 W, 56 dB(A), ' +
           'tankur 10 L, snúra 15 m, þyngd 5,5 kg, HEPA-sía, ' +
           'fyrir skóla hótel og heilbrigðisstofnanir, dagleg ræsting'
  });

  if (r.refused) {
    Logger.log('[PIM][AI] HAFNAD (a ekki ad gerast her): ' + r.message);
    return r;
  }
  Logger.log('[PIM][AI] Tilraunir: ' + r.attempts + ', ord: ' + r.words);
  Logger.log('[PIM][AI] Visbending: ' + (r.hint || '(engin — hreint)'));
  Logger.log('[PIM][AI] Drogin:');
  Logger.log(r.text);
  return r;
}

function pimAiCall_(prompt) {
  var cfg = loadConfig_();
  var key = pimAiKey_(cfg);
  var api = (cfg.API && (cfg.API.Anthropic || cfg.API.Claude)) || {};
  var model = api.MODEL ||
    (cfg.SETTINGS && cfg.SETTINGS.SEO_CLAUDE_MODEL) ||
    'claude-sonnet-5';

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      Accept: 'application/json'
    },
    payload: JSON.stringify({
      model: model,
      max_tokens: 700,
      // ENGIN `temperature`. Anthropic svaraði 400 á claude-sonnet-5:
      // "`temperature` is deprecated for this model" (mælt 2026-09-11).
      // Nýrri módel stýra þessu sjálf. Það sem heldur textanum í skefjum er
      // hvort sem er ekki hitastigið heldur tvennt annað: kerfisleiðbeiningin
      // bannar að finna nokkuð upp, og `pimDescHint_` dæmir útkomuna.
      system: pimAiSystem_(),
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Anthropic svaraði ' + code + ': ' + String(body).slice(0, 300));
  }
  var parsed = safeJsonParse_(body) || {};
  var text = extractClaudeMessageContent_(parsed);
  return pimAiClean_(text);
}

/** Hreinsar það sem líkön bæta stundum við þrátt fyrir fyrirmæli. */
function pimAiClean_(t) {
  var s = String(t == null ? '' : t).trim();
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
  // Fyrirsögn á fyrstu línu ("Löng lýsing:") — burt.
  s = s.replace(/^(löng\s+)?lýsing\s*:\s*/i, '');
  s = s.replace(/^här\s*:\s*/i, '');
  return s.trim();
}
