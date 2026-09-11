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

  // Falli hún á ORÐALAGI fær hún eina tilraun í viðbót, með brotin nefnd.
  // AFRITUÐ og HTML geta ekki komið héðan; OF STUTT er sagt frá en ekki
  // reynt aftur — stutt svar þýðir að efnið var stutt, og þá er rétt að
  // manneskjan bæti við frekar en að líkanið teygi.
  if (h1.indexOf('ORÐALAG') >= 0) {
    var bad = pimAiOffenders_(first);
    var second = pimAiCall_(pimAiPrompt_(ctx, notes, bad));
    var h2 = pimDescHint_(second, 1);
    if (h2.indexOf('ORÐALAG') < 0) {
      return { text: second, words: pimWords_(second), hint: h2, attempts: 2 };
    }
    // Enn fallin. Við skilum henni samt — með merkinu — því manneskjan
    // ritstýrir hvort sem er og þögult brottfall væri verra en sýnilegt brot.
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

function pimAiPrompt_(ctx, notes, offenders) {
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
  if (offenders && offenders.length) {
    p.push('Fyrri tilraun þín notaði þetta orðalag, sem er bannað: ' +
           offenders.join(', ') + '. Skrifaðu upp á nýtt án þess.');
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
    'Lengd: ' + PIM_WORDS_MIN_ + '–' + PIM_WORDS_MAX_ + ' orð. Miðaðu við 60–90',
    'á flókinni vöru með tölum. Einföld vara á ekki að teygja sig.'
  ].join('\n');
}

function pimAiCall_(prompt) {
  var cfg = loadConfig_();
  var api = (cfg.API && (cfg.API.Anthropic || cfg.API.Claude)) || {};
  var key = api.API_KEY || api.KEY;
  if (!key) {
    throw new Error('Vantar API → Anthropic | API_KEY í STORKAUP_CONFIG.');
  }
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
      // Lágt hitastig: við viljum endursögn á gefnu efni, ekki tilbrigði.
      temperature: 0.2,
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
