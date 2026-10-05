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

/** GAGNABLADID (2026-10-02). Se blad tengt les likanid thad lika, og tha
 *  dugar ad starfsmadurinn segi fyrir hverja og til hvers -- eda ekkert.
 *  Tolurnar eru i bladinu. Sama regla gildir: ekkert sem kemur hvorki fra
 *  manneskjunni ne ur bladinu. */
var PIM_AI_MIN_NOTES_DOC_ = 0;
/** Staerra en thetta er sjaldnast gagnablad heldur vorulisti heillar linu. */
var PIM_AI_MAX_DOC_BYTES_ = 15 * 1024 * 1024;

/**
 * Semur drög úr því sem starfsmaðurinn gaf.
 *
 * @param {Object} ctx  {sku, label, name, brand, cat1, cat2, cat3,
 *                       notes, descOld, hasDatasheet}
 * @return {Object} {text, words, hint, attempts, refused}
 */
function pimDraftDescription_(ctx, opts) {
  ctx = ctx || {};
  // opts.model: adeins samanburdurinn (pimAiCompareModels_v1) notar thad.
  var model = (opts && opts.model) || pimAiModel_();

  // --- 1. Er nokkuð að orða? ------------------------------------------
  var notes = String(ctx.notes || '').trim().slice(0, PIM_AI_MAX_INPUT_);
  var words = pimWords_(notes);

  // Slodin kemur fra admin/delegate.js, sem las hana ur vinnusheetinu.
  var doc = ctx.docUrl ? pimAiFetchDoc_(ctx.docUrl) : { ok: false, why: '' };

  if (words < (doc.ok ? PIM_AI_MIN_NOTES_DOC_ : PIM_AI_MIN_NOTES_)) {
    // HAFNAÐ, EKKI GISKAÐ. Þetta er allur varnarmúrinn: án efnis myndi
    // líkanið framleiða nákvæmlega þann texta sem verkefnið er að fjarlægja.
    return {
      refused: true,
      text: '',
      message: 'Skrifaðu fyrst í reitinn hvað varan er og hvaða tölur eiga við — ' +
               'minnst ' + PIM_AI_MIN_NOTES_ + ' orð, punktar duga. ' +
               (ctx.docUrl
                 ? 'Gagnablaðið náðist ekki (' + doc.why + '), svo efnið þarf að koma frá þér.'
                 : 'Þessi vara hefur ekkert gagnablað, svo efnið þarf að koma frá þér.') +
               ' Hnappurinn orðar það sem þú segir honum — hann veit ekkert um vöruna sjálfur.'
    };
  }

  // --- 2. Semja -------------------------------------------------------
  var docB64 = doc.ok ? doc.b64 : null;
  var docMsg = doc.ok ? 'Gagnablaðið var lesið.'
    : ctx.docUrl ? 'Gagnablaðið náðist ekki (' + doc.why + '); aðeins punktarnir þínir voru notaðir.'
    : '';
  var first = pimAiCall_(pimAiPrompt_(ctx, notes, null, !!docB64), docB64, model);
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
    }, !!docB64), docB64, model);
    var h2 = pimDescHint_(second, 1);
    // Skilum seinni tilrauninni hvort sem hún stóðst eða ekki — með merkinu.
    // Manneskjan ritstýrir hvort sem er, og þögult brottfall væri verra en
    // sýnilegt brot.
    return { text: second, words: pimWords_(second), hint: h2, attempts: 2,
             docUsed: !!docB64, docMsg: docMsg };
  }

  return { text: first, words: pimWords_(first), hint: h1, attempts: 1,
           docUsed: !!docB64, docMsg: docMsg };
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

function pimAiPrompt_(ctx, notes, fix, hasDoc) {
  var path = [ctx.cat1, ctx.cat2, ctx.cat3].filter(Boolean).join(' › ');
  var p = [];

  p.push('VARAN');
  p.push('Vörumerki: ' + (ctx.brand || '(ótilgreint)'));
  p.push('Heiti: ' + (ctx.name || ctx.label || ''));
  p.push('Flokkur: ' + (path || '(ótilgreindur)'));
  // Vottanir koma ur Plytix gegnum admin/delegate.js, ekki ur vafranum.
  if (ctx.labels) p.push('Staðfestar vottanir (má nefna): ' + ctx.labels);
  p.push('');

  p.push('HEIMILDIR, í forgangsröð — þar sem þær stangast á gildir sú efri');
  var n = 1;
  p.push(n++ + '. Punktar starfsmanns:');
  p.push('   ' + (notes || (hasDoc ? '(engir — skrifaðu úr gagnablaðinu)' : '(engir)')));
  if (hasDoc) {
    p.push(n++ + '. Gagnablað: fylgir sem PDF. Notaðu aðeins gildi sem eiga við þessa');
    p.push('   gerð; gagnablöð ná oft yfir heila línu. Engar vottanir úr blaðinu');
    p.push('   nema þær sem eru staðfestar hér að ofan.');
  }
  if (ctx.descOld) {
    p.push(n++ + '. Núverandi lýsing (aðeins staðreyndir, ekki orðalag)' +
           (ctx.hint ? '\n   [Appið hefur merkt hana: ' + ctx.hint + ']' : '') + ':');
    p.push('   ' + String(ctx.descOld).slice(0, PIM_AI_MAX_INPUT_));
  }
  p.push('');

  if (fix && fix.words && fix.words.length) {
    p.push('Í fyrri útgáfu voru orðin ' + fix.words.join(', ') + ', sem segja ' +
           'kaupandanum ekkert. Skrifaðu hana aftur án þeirra og segðu frekar ' +
           'hvað varan gerir.');
    p.push('');
  }
  if (fix && fix.tooLong) {
    p.push('Fyrri útgáfa var ' + fix.tooLong + ' orð, en hámarkið er ' + PIM_WORDS_MAX_ +
           '. Styttu hana með því að fella burt endurtekningar og samantektir; ' +
           'haltu öllum tölum og staðreyndum.');
    p.push('');
  }
  p.push('Skrifaðu lýsinguna.');
  return p.join('\n');
}

/**
 * Kerfisleidbeiningin. Samthykkt af markadsstjora 2026-10-05; frumtextinn
 * er i docs/voruinnihald/ai-leidbeiningar-tillaga.md. Breyttu honum THAR
 * fyrst og svo her, svo skjalid og kodinn segi thad sama.
 */
function pimAiSystem_() {
  return [
    'Þú skrifar vörulýsingar fyrir Stórkaup, heildsölu sem selur íslenskum',
    'fyrirtækjum, stofnunum og veitingastöðum. Lesandinn er innkaupamaður eða',
    'rekstrarstjóri sem þarf að ákveða hvort varan leysi verkefnið hans. Hann',
    'les fyrstu setninguna og lítur yfir tölurnar. Google og AI-leitarvélar',
    'lesa líka fyrstu setninguna og hætta oft þar.',
    '',
    'HEIMILDIR',
    'Þú skrifar aðeins það sem stendur í heimildunum sem fylgja: punktum',
    'starfsmannsins, gagnablaðinu ef það fylgir, staðfestum vottunum og',
    'staðreyndum úr núverandi lýsingu. Kaupandinn pantar eftir lýsingunni, og',
    'röng tala er verri en engin tala. Ef heimildirnar segja lítið verður',
    'lýsingin stutt. Það er rétt niðurstaða, ekki mistök.',
    '',
    'BYGGING',
    '1. Fyrsta setningin: vörumerki, hvað varan er og fyrir hvern eða hvar.',
    '   Hún verður að skiljast ein og sér.',
    '2. Til hvers hún er notuð, í raunverulegu umhverfi: leikskólar,',
    '   hótelgangar, mötuneyti, fiskvinnsla.',
    '3. Hagnýtt atriði sem kaupandinn þarf að vita, ef heimildirnar nefna',
    '   það: hvað fylgir ekki, hvað er pantað sér, hvað ber að varast.',
    '4. Tölulegar upplýsingar í punktalista á eftir textanum (sjá ÚTKOMA).',
    'Ein til þrjár stuttar málsgreinar. Engin lokasetning sem dregur saman.',
    '',
    'EFTIR VÖRUFLOKKI. Taktu það með sem heimildirnar segja; slepptu því sem',
    'þær segja ekki.',
    '- Matvörur: hvað varan er og hvernig hún er notuð eða framreidd,',
    '  ofnæmisvaldar, geymsla (kælir, frystir, þurrvara), uppruni, pakkning.',
    '- Hreinsiefni: til hvers það er, tilbúið til notkunar eða þynnt (og',
    '  hlutfall), á hvaða fleti það má nota og á hvaða fleti EKKI, hvernig',
    '  það er borið á.',
    '- Vélar og tæki: til hvers og hvar, svo tölurnar: afl, sogkraftur,',
    '  rúmmál, hljóðstig, vinnslubreidd, þyngd, lengd snúru, rafhlaða.',
    '  Hvaða fylgihlutir eða rekstrarvörur eiga við.',
    '- Ræstiáhöld, pokar, pappír og einnota vörur: efni, stærð, þykkt eða',
    '  styrkur, litur, hvað varan passar við (t.d. skammtara eða grind).',
    '- Heilbrigðisvörur: notkun, stærðir, efni (t.d. nítríl, latexfrítt,',
    '  púðurlaust), hvort hún er einnota eða sæfð. Staðlar aðeins ef þeir',
    '  eru nefndir.',
    '- Áfengi og nikótín: eingöngu staðreyndir: tegund, styrkleiki, rúmmál,',
    '  uppruni, framleiðandi. Ekkert lof, engar lýsingar á upplifun eða',
    '  bragðgæðum.',
    '',
    'MÁLFAR',
    'Skrifaðu eins og fróður starfsmaður talar við viðskiptavin: venjuleg',
    'íslenska, ekki þýðing. Íslensk heiti á efnum og flötum (ryðfrítt stál,',
    'ekki „stainless“). Tölur með íslenskri kommu og ekkert bil á undan',
    'einingu: 5,5kg, 10L, 700W, 12x 200g.',
    'Forðastu orð sem segja ekkert og allir aðrir nota: ' + PIM_BANNED_.join(', ') + '.',
    'Sama gildir um sölumál eins og „tryggir“, „býður upp á“, „hvort sem“ og',
    '„tilvalin fyrir“. Segðu í staðinn hvað varan gerir, úr hverju hún er og',
    'hvar hún er notuð.',
    '',
    'VÖRUNÚMER',
    'Ekki telja upp vörunúmer annarra vara í lýsingunni. Tengdar vörur eru',
    'sýndar sér á vörusíðunni. Segðu frekar í orðum hvað varan passar við,',
    't.d. „passar á 24cl kaffimál“.',
    '',
    'NÚVERANDI LÝSING',
    'Hún er oft límd af síðu birgja eða sama textinn og á öðrum vörum. Taktu',
    'úr henni staðreyndir sem eiga við þessa vöru, en aldrei orðalagið.',
    '',
    'ÚTKOMA',
    'Skilaðu aðeins lýsingunni. Engar fyrirsagnir, engar skýringar, ekkert HTML.',
    'Texti í málsgreinum, auð lína á milli.',
    'Tölulegar upplýsingar (mál, afl, rúmmál, þyngd, styrkleiki, pakkning,',
    'geymsluhiti o.s.frv.) fara í punktalista á eftir textanum: hver lína',
    'byrjar á „- “ og er á forminu „Heiti: gildi“, t.d. „- Sogkraftur: 22kPa“.',
    'Tala sem er í punktalistanum er ekki endurtekin í textanum. Vara án',
    'tölulegra upplýsinga fær engan punktalista.',
    PIM_WORDS_MIN_ + '–' + PIM_WORDS_MAX_ + ' orð; ' + PIM_WORDS_MIN_ + '–90 orð á vöru ' +
    'með tölum, styttra á einfaldri vöru. Vara sem skýrir sig sjálf í',
    'vöruheitinu, eins og margar matvörur, þarf aðeins stutta lýsingu.',
    '',
    'FYRIRMYNDIR — sýna form og tón. Afritaðu aldrei setningar úr þeim.',
    '',
    '[Vél]',
    'Nilfisk VP400 HEPA XT er atvinnuryksuga fyrir daglega ræstingu. Hún er',
    'nógu hljóðlát til að ræsta á opnu svæði á vinnutíma, og HEPA-sían heldur',
    'fínryki eftir. Ryksugupokar eru pantaðir sér.',
    '',
    '- Sogkraftur: 22kPa',
    '- Loftflæði: 32L/s',
    '- Afl: 700W',
    '- Hljóðstig: 56dB(A)',
    '- Tankur: 10L',
    '- Snúra: 15m',
    '- Þyngd: 5,5kg',
    '',
    '[Matvara]',
    'Halloumi er hálfharður ostur úr kúa- og kindamjólk sem heldur formi sínu',
    'við háan hita og er ætlaður til steikingar og grillunar. Hann er skorinn',
    'í sneiðar og steiktur í 1–2 mínútur á hverri hlið. Inniheldur mjólk.',
    '',
    '- Pakkning: 12x 200g, lofttæmdar umbúðir',
    '- Geymsla: í kæli við 2–4°C',
    '',
    '[Hreinsiefni]',
    'Evans Mystrol er alhreinsir fyrir fitu og erfið óhreinindi, tilbúinn til',
    'notkunar án þynningar. Hann er ætlaður í daglega ræstingu.',
    '',
    'Má nota á plast, vinyl, trefjagler og ryðfrítt stál. Ekki á óvarið tré,',
    'ál eða náttúrustein. Úðað á flötinn og þurrkað af með klút.'
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

/**
 * Saekir gagnabladid sem PDF og skilar base64. Hafnar ollu sem er ekki PDF:
 * hlekkur hja birgja getur verid vorusida, ekki skjal, og thad a ekki ad
 * fara a likanid. Plytix-slodir bera stundum bil og hornklofa, sem eru
 * kodud eins og appid gerir (sja safeUrl i voruinnihald_app.html).
 */
function pimAiFetchDoc_(url) {
  var u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, why: 'ógild slóð' };
  if (!/%[0-9A-Fa-f]{2}/.test(u)) u = encodeURI(u);
  try {
    var res = UrlFetchApp.fetch(u, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return { ok: false, why: 'HTTP ' + res.getResponseCode() };
    var bytes = res.getBlob().getBytes();
    if (bytes.length > PIM_AI_MAX_DOC_BYTES_) return { ok: false, why: 'of stórt' };
    // %PDF i fyrstu baetunum -- Content-Type er ekki alltaf rettur hja birgjum.
    var head = String.fromCharCode.apply(null, bytes.slice(0, 5).map(function (b) { return b & 0xff; }));
    if (head.indexOf('%PDF') !== 0) return { ok: false, why: 'ekki PDF-skjal' };
    return { ok: true, b64: Utilities.base64Encode(bytes) };
  } catch (e) {
    return { ok: false, why: 'náðist ekki' };
  }
}

/**
 * Likanid. SETTINGS.PIM_AI_MODEL radur (2026-10-05), svo SEO-flaedid og
 * voruinnihaldid geti notad sitt hvort likan. Thar a eftir eldri stillingar.
 */
function pimAiModel_() {
  var cfg = loadConfig_();
  var api = (cfg.API && (cfg.API.Anthropic || cfg.API.Claude)) || {};
  var sets = cfg.SETTINGS || {};
  return String(sets.PIM_AI_MODEL || api.MODEL || sets.SEO_CLAUDE_MODEL || 'claude-opus-5-5').trim();
}

/** Likon sem taka vid `fallbacks: "default"` og effort a Claude API. */
var PIM_AI_NEW_MODELS_ = { 'claude-opus-5-5': 1, 'claude-opus-5': 1,
                           'claude-sonnet-5-5': 1, 'claude-fable-5-1': 1 };

function pimAiBody_(isNew, body) {
  if (isNew) {
    body.fallbacks = 'default';
    // Opus 5.5 hefur `medium` sem sjalfgefid; sett skyrt svo thad breytist
    // ekki thegjandi med nyju likani.
    body.output_config = { effort: 'medium' };
  }
  return body;
}

function pimAiCall_(prompt, docB64, modelArg) {
  var cfg = loadConfig_();
  var key = pimAiKey_(cfg);
  var model = modelArg || pimAiModel_();
  var isNew = !!PIM_AI_NEW_MODELS_[model];

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: (function () {
      var h = { 'x-api-key': key, 'anthropic-version': '2023-06-01', Accept: 'application/json' };
      // Hafni likanid beidni er hun keyrd aftur a ödru likani hja Anthropic,
      // i stad thess ad starfsmadurinn fai synjun.
      if (isNew) h['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      return h;
    })(),
    payload: JSON.stringify(pimAiBody_(isNew, {
      model: model,
      // Hugsun telst med i max_tokens. 700 klippti lysingar a flokinni voru.
      max_tokens: docB64 ? 8000 : 4000,
      // ENGIN `temperature`. Anthropic svaraði 400 á claude-sonnet-5:
      // "`temperature` is deprecated for this model" (mælt 2026-09-11).
      // Nýrri módel stýra þessu sjálf. Það sem heldur textanum í skefjum er
      // hvort sem er ekki hitastigið heldur tvennt annað: kerfisleiðbeiningin
      // bannar að finna nokkuð upp, og `pimDescHint_` dæmir útkomuna.
      system: pimAiSystem_(),
      // Skjalid a undan textanum. cache_control: seinni tilraunin (ORÐALAG /
      // OF LANGT) sendir sama skjalid aftur innan fimm minutna.
      messages: [{ role: 'user', content: docB64 ? [
        { type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: docB64 },
          cache_control: { type: 'ephemeral' } },
        { type: 'text', text: prompt }
      ] : prompt }]
    })),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Anthropic svaraði ' + code + ': ' + String(body).slice(0, 300));
  }
  var parsed = safeJsonParse_(body) || {};
  if (parsed.stop_reason === 'refusal') {
    throw new Error('Líkanið hafnaði beiðninni. Skrifaðu lýsinguna sjálf/ur eða reyndu aðra punkta.');
  }
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


/************************************************************
 * ⚖️ pimAiCompareModels_v1 — tvö líkön, sama vara, blindur samanburður
 *
 * Til ad velja PIM_AI_MODEL ur raunverulegum drogum, ekki ur agiskun.
 * Flipinn AI_PROF i SALES_SUMMARIES: thu skrifar SKU og punkta (punktar
 * mega vera tomir ef gagnablad er tengt), keyrir fallid, og fyrir hverja
 * rod koma tvaer utgafur, A og B, i HANDAHOFSRÖÐ. Hvort likanid skrifadi
 * hvora stendur i Lykill-dalkinum lengst til haegri: skodadu hann ekki
 * fyrr en thu hefur valid.
 *
 * Keyrir thar til ~4,5 minutur eru lidnar og haettir; keyrdu aftur til ad
 * klara. Rodum sem hafa utgafu A er sleppt.
 ************************************************************/
var PIM_AI_COMPARE_SHEET_ = 'AI_PROF';
var PIM_AI_COMPARE_MODELS_ = ['claude-opus-5-5', 'claude-sonnet-5-5'];

function pimAiCompareModels_v1() {
  var cfg = loadConfig_();
  var ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  var head = ['SKU', 'Punktar', 'Vara', 'Útgáfa A', 'Útgáfa B', 'Betri (A / B / jafnt)',
              'Athugasemd', 'Lykill — ekki kíkja fyrr en þú hefur valið'];
  var sh = ss.getSheetByName(PIM_AI_COMPARE_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(PIM_AI_COMPARE_SHEET_);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(2, 220); sh.setColumnWidth(3, 220);
    sh.setColumnWidth(4, 420); sh.setColumnWidth(5, 420); sh.setColumnWidth(7, 220);
    sh.getRange('B:E').setWrap(true);
    Logger.log('[AI] Flipinn ' + PIM_AI_COMPARE_SHEET_ + ' búinn til. Skrifaðu SKU og punkta og keyrðu aftur.');
    return { created: true };
  }

  var last = sh.getLastRow();
  if (last < 2) { Logger.log('[AI] Engar raðir í ' + PIM_AI_COMPARE_SHEET_ + '.'); return { done: 0 }; }
  var rows = sh.getRange(2, 1, last - 1, head.length).getValues();
  var pim = pimAiSheetIndex_(cfg);
  var t0 = Date.now(), done = 0, left = 0;

  for (var i = 0; i < rows.length; i++) {
    var sku = String(rows[i][0] || '').trim();
    if (!sku || String(rows[i][3] || '').trim()) continue;
    if (Date.now() - t0 > 270000) { left++; continue; }

    var ctx = pim[sku] || pim[sku.replace(/^STO_/i, '')];
    if (!ctx) {
      sh.getRange(i + 2, 3).setValue('Fannst ekki í vinnusheetinu');
      continue;
    }
    ctx = JSON.parse(JSON.stringify(ctx));
    ctx.notes = String(rows[i][1] || '').trim();

    // Handahofsrod: Opus er ekki alltaf A.
    var order = Math.random() < 0.5 ? [0, 1] : [1, 0];
    var out = order.map(function (k) {
      var m = PIM_AI_COMPARE_MODELS_[k];
      try {
        var r = pimDraftDescription_(JSON.parse(JSON.stringify(ctx)), { model: m });
        if (r.refused) return r.message;
        return r.text + (r.hint ? '\n\n[Greinir: ' + r.hint + ']' : '') +
               (r.docMsg ? '\n[' + r.docMsg + ']' : '');
      } catch (e) {
        return 'VILLA: ' + e.message;
      }
    });
    sh.getRange(i + 2, 3, 1, 3).setValues([[ctx.name || ctx.label, out[0], out[1]]]);
    sh.getRange(i + 2, 8).setValue('A = ' + PIM_AI_COMPARE_MODELS_[order[0]] +
                                   ' · B = ' + PIM_AI_COMPARE_MODELS_[order[1]]);
    SpreadsheetApp.flush();
    done++;
  }
  Logger.log('[AI] Samanburður: ' + done + ' raðir skrifaðar' +
             (left ? ', ' + left + ' eftir — keyrðu aftur' : ''));
  return { done: done, left: left };
}

/** Vorurnar ur vinnusheetinu, lykladar a SKU, i somu mynd og admin/delegate.js
 *  sendir. Kolumnur lesnar eftir HEITI, eins og i voruinnihald.js. */
function pimAiSheetIndex_(cfg) {
  var sh = SpreadsheetApp.openById(cfg.SHEETS.PIM.ID).getSheetByName('Vinnusheet');
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x || '').trim(); });
  var c = function (name) { return h.indexOf(name); };
  var col = {
    sku: c('SKU'), label: c('Label (BC)'), name: c('Vöruheiti (núv.)'), brand: c('Vörumerki (núv.)'),
    cat1: c('Yfirflokkur'), cat2: c('Flokkur'), cat3: c('Undirflokkur'),
    descOld: c('Löng lýsing (núv.)'), hint: c('Vísbending'), labels: c('Vottanir'),
    dsFile: c('Gagnablað (skrá)'), dsUrl: c('Gagnablað (hlekkur)')
  };
  var get = function (row, k) { return col[k] < 0 ? '' : String(row[col[k]] || '').trim(); };
  var out = {};
  for (var r = 1; r < vals.length; r++) {
    var sku = get(vals[r], 'sku');
    if (!sku) continue;
    out[sku] = {
      sku: sku, label: get(vals[r], 'label'), name: get(vals[r], 'name'), brand: get(vals[r], 'brand'),
      cat1: get(vals[r], 'cat1'), cat2: get(vals[r], 'cat2'), cat3: get(vals[r], 'cat3'),
      descOld: get(vals[r], 'descOld'), hint: get(vals[r], 'hint'), labels: get(vals[r], 'labels'),
      docUrl: (get(vals[r], 'dsFile').split(/,(?=\s*https?:)/)[0] || get(vals[r], 'dsUrl')).trim()
    };
  }
  return out;
}
