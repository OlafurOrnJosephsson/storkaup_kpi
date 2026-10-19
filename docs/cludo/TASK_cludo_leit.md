# Verkefni: Tvítekningar í Cludo-leit + hreinsun leitarstrengs

> Verklýsing fyrir Claude Code í storkaup.is-framendanum (Next.js App Router á Vercel).
> Lestu alla lýsinguna fyrst, kannaðu kóðann og komdu með **plan áður en þú breytir nokkru**.
>
> Upprunnin í KPI-repoinu (`docs/cludo/TASK_cludo_leit.md`, 2026-10-19). Staðreyndirnar
> um vísinn koma úr mælingum þar (`core/cludo.js`, september 2026) og úr prófunum á
> lifandi leitinni og sitemapinu 2026-10-19.

## Bakgrunnur

Leitin á storkaup.is notar Cludo. Framendinn kallar á eigin route, `POST /api/search`, sem sendir leitina áfram til Cludo. Crawler Cludo les vörusíðurnar (`/vara/...`) og byggir leitarstuðulinn (index) úr þeim.

Upphaflega var verkið um þrjú einkenni. Tvö af þeim eru þegar horfin (sjá „Staðan 2026-10-19“):

1. **Sama vara birtist tvisvar í leitinni.** Viðskiptavinur kvartaði í sept. yfir „sama varan 2x 113258 á vef“. Það er **lagað í dag**, en lagfæringin byggir á handgerðum regex-listum í Cludo og hreinsun úr KPI-kerfinu. Hvort tveggja þarf viðhald.
2. **Inn-límd vöruheiti skila engu.** Fólk afritar heil vöruheiti, t.d. úr flipaheiti eða Google, og fær 0 niðurstöður. Það á **enn við** þegar `| Merki | Stórkaup`-halinn fylgir með.
3. **`te & kaffi` skilaði 0.** Það er **lagað í dag**, því villuleiðrétting Cludo breytir `&` í `og`.

## Staðan 2026-10-19 (prófað á `POST /api/search`)

| Fyrirspurn | Niðurstöður | Athugasemd |
|---|---|---|
| `113258` | 1 | aðeins kanóníska slóðin. Kvörtunin frá í sept. á ekki lengur við |
| `ryksugupokar buddy` | 7, engin tvítekning | |
| `Ryksugupokar Buddy II, 4stk` | 1 | komman truflar ekki |
| `Ryksugupokar Buddy II, 4stk \| Nilfisk \| Stórkaup` | **0** | **halinn eyðileggur leitina** |
| `Ryksugupokar Buddy II 4stk Nilfisk` | 1 | vörumerkið truflar ekki |
| `Ryksugupokar Buddy II 4stk \|` | **0** | **stafurinn `\|` einn og sér gefur 0** |
| `Paprika Flögur, 18x 175gr \| Lays \| Stórkaup` | **0** | villuleiðrétting breytti `175gr` í `125g` |
| `Paprika Flögur 18x 175gr` | 1 | |
| `hanskar stórkaup` | 89 | eins og `hanskar`. Cludo hunsar orðið „stórkaup“ eitt og sér |
| `nesquik kakómalt, 12x 700g stórkaup` | 1 | var 0 í upphaflegu lýsingunni, virkar núna |
| `te & kaffi` | 25 | `FixedQuery` = `te og kaffi`. Cludo leysir þetta sjálft |
| `draumur fylltur lakkrís, 25x 45g freyja stórkaup` | 0 | **varan er ekki á vefnum**, sjá neðar |
| `glerhreinsir 0,75l` | 0 | villuleiðrétting breytti `0,75l` í `0275` |

**Draumur:** Það er engin vara „Draumur fylltur lakkrís 25x 45g“ í sitemapinu. Á vefnum eru aðeins `drauma-bitar-30x-250g-9004790` og `smadraumur-14x-180g-9004789`. `draumur` eitt og sér finnur Drauma bita, en `draumur fylltur` gefur 0 af því að ekkert skjal ber bæði orðin. Engin hreinsun á leitarstrengnum getur látið þetta dæmi skila „Draumi“. Það þyrfti varaleið þegar niðurstöður eru 0, sjá hluta B.

## Staðreyndir sem þegar liggja fyrir

### Tvær orsakir tvítekninga (mælt 2026-09-16 og 2026-09-28)

Routerinn undir `/vara/` les **aðeins vörunúmerið aftast** í slóðinni og hunsar textann á undan. Hvaða slug sem er með réttu númeri svarar því HTTP 200, og hver síða canonical-ar á sjálfa sig. Ekkert segir crawlernum hver rétta slóðin er.

| Orsök | Dæmi | Umfang |
|---|---|---|
| **Einingasíður**: varan er líka til sem `<slóð>kassi`, `<slóð>stk`, `<slóð>bretti` | `/vara/ryksugupokar-buddy-ii-4stk-113258kassi` | 703 vörur, 709 afrit í vísinum |
| **Gömul heiti**: varan var endurnefnd, gamla slóðin svarar enn 200 | gamalt slug + sama vörunúmer | ~650 afrit |

Page Inventory í Cludo sýndi 5.858 `/vara/`-skjöl á móti ~4.477 raunverulegum vörum. Eftir hreinsun eru um 4.450 skjöl eftir. Afrit bætast samt aftur við, um 30 á tveggja vikna fresti.

### Kanóníska slóðin: sitemapið

`https://www.storkaup.is/sitemap.xml` er sitemap-index með undirskrám undir `/sitemaps/products/1..9`. Hreinsunin í KPI-kerfinu notar þennan lista sem sannleik: allt í vísinum sem er ekki í sitemapinu er afrit.

Sitemapið 2026-10-19 hefur 4.484 `/vara/`-slóðir. **Flestar kanónískar slóðir ENDA á einingu:**

| Ending á kanónískri slóð | Fjöldi |
|---|---|
| `kassi` | 2.290 |
| `stk` | 1.308 |
| engin | 780 |
| `bretti` | 6 |
| `kg` | 1 |

Regla eins og „slóð með einingarendingu er aukaeining“ væri því **röng fyrir ~80% varanna**. Aukaeining er síða sem er ekki í sitemapinu, óháð endingu.

Í sitemapinu eru líka:
- **99 slóðir án slugs**, t.d. `/vara/104885kassi` (Glerhreinsir Clear, 750ml). Varan hefur nafn, en slóðin fær það ekki.
- **3 vörunúmer tvisvar**: 116355, 134081 og 9004599. Það er sama slóðin tvítekin, ekki tvær ólíkar.

### Regex-listarnir í Cludo í dag

Í Crawler → URL regex eru **9 langar línur** á forminu
`^https://www\.storkaup\.is/vara/.*-(02669|02672|...|104886|...|113258|...)(kassi|stk|bretti)$`
og **4 stakar slóðir**: `...137352kassi`, `...137353kassi`, `pepsi-24x-330ml-9001215kassi`, `pepsi-4x-2l-9001328kassi`.

Athugað 2026-10-19 út frá skjáskoti (línurnar eru styttar þar, svo aðeins sýnilegu númerin, 113 talsins):
- **Ekkert þeirra hefur kanóníska slóð með endingu.** Listarnir útiloka því aðeins aukaeiningar og fela enga vöru alveg. Þeir eru réttir, bara handgerðir.
- 3 númer eru ekki lengur í sitemapinu (100388, 104557, 105563), þ.e. dauðar færslur.
- Vörurnar í 4 stöku slóðunum eru ekki í sitemapinu, svo þær færslur gera ekkert lengur.
- Regex-reglan stöðvar aðeins **framtíðarskrið**. Hún eyðir ekki skjölum sem eru þegar inni í vísinum.
- **Hættan við listana:** vara sem fær aukaeiningu eftir að listinn var gerður birtist tvisvar þar til einhver bætir henni við. Ef einhver bætir við vöru sem hefur kanóníska slóð með endingu hverfur hún úr leitinni án þess að neitt bendi til þess.

### Hvað síðurnar gefa crawlernum (curl, 2026-10-19)

| Slóð | HTTP | canonical / og:url / JSON-LD `url` | JSON-LD `sku` | Breadcrumb |
|---|---|---|---|---|
| `/vara/ryksugupokar-buddy-ii-4stk-113258` (í sitemap) | 200 | sjálfa sig | `113258` | já |
| `/vara/ryksugupokar-buddy-ii-4stk-113258kassi` | 200 | sjálfa sig | `113258` | já |
| `/vara/eitthvad-allt-annad-113258` (tilbúið slug) | 200 | sjálfa sig | **engin Product JSON-LD** | **nei** |

- Einingasíðan er eins og aðalsíðan í öllu sem crawlerinn les: sami titill, sama `sku` og canonical á sjálfa sig. **Enginn núverandi reitur getur greint þær í sundur.**
- Slóð með röngu slugi fær réttan titil en hvorki Product JSON-LD né breadcrumb. Í Cludo verða `StorkaupSKU` og `ProductCategory` því líklega tóm á gömlum heitum. Þetta var aðeins prófað á tilbúnu slugi. Kannaðu hvers vegna það gerist, því það bendir til að síðan fari aðra leið þegar slug passar ekki.

### Úr kóðanum (staðbundið afrit af `hagar-ecommerce`, síðasti commit 2025-11-10)

Afritið er ársgamalt og ekki tengt remote, svo lifandi kóðinn getur verið annar. Kannaðu þessi atriði í núverandi kóða:
- **Sitemapið** (`apps/storkaup-frontend/src/lib/sitemap-utils.ts`) býr til `/vara/${product.url_key}` úr Magento GraphQL `products(search: "")`. Kanóníska slóðin er því **`url_key` vörunnar í Magento**, og einingarendingin og slóðir án slugs (`104885kassi`) koma þaðan.
- **Vörusíðan** (`app/(root)/(pages)/vara/[id]/page.tsx`) sótti í afritinu vöruna með `filter: { url_key: { eq: $id } }`, og `generateMetadata` setti canonical sem `/vara/${params.id}`. Með þeim kóða ætti rangt slug að gefa 404, en lifandi vefurinn svarar 200. Leitin að vörunni hefur því breyst síðan, líklega yfir í vörunúmerið aftast.
- Fyrir hluta A þýðir þetta: síðan er kanónísk ef `params.id` (lágstafað) er jafnt `url_key` vörunnar sem fannst. Það kostar enga aukabeiðni, því `url_key` er þegar í `getProduct`.
- `/api/search` (`app/(root)/api/search/route.ts`) sendir `query` óbreytt til Cludo v3. Þar á `normalizeQuery` heima.

### Crawler-reitir í Cludo (Page Fields Sources)

- `Title` ← XPath `//meta[@property='og:title']/@content` (+1 varaleið). Gildið er „Vara | Merki | Stórkaup“.
- `Description` ← structured data `$.description`
- `StorkaupSKU` ← `$.sku`, `ManufacturerSKU` ← `$.mpn`
- `ProductCategory` ← XPath `(//ol[@data-slot='breadcrumb-list']/li[@data-slot='breadcrumb-item'])[last()-1]/a`, þ.e. **næstsíðasti** liður (sá síðasti er varan sjálf)
- `Product Brand name` ← `$.brand.name`
- `Product stock` ← `$.availability`, `Product link` ← `$.url`
- `Product availability` ← XPath sem sker `availability` úr JSON-LD textanum (sömu gögn og `Product stock`)
- `Product Sheets` / `Product Files Name` ← XPath á `div` með klösunum `flex` + `gap-4` og `a[href*='.pdf']`
- `Category availability` ← XPath á `div` með klasanum `bg-[#FCAD17]` sem inniheldur „Væntanlegt“
- Þrír síðustu reitirnir hanga á Tailwind-klösum og brotna þegjandi ef útlitinu er breytt. Sjá „Utan verksviðs“.

### Annað

- Snið slóða: `https://www.storkaup.is/vara/{slug}-{vörunúmer}{ending}` eða `/vara/{vörunúmer}{ending}` þegar slug vantar.
- Cludo Engine er með **„Pre-filter search results“**: vélin skilar þá aðeins síðum sem hafa tiltekinn reit með tilteknu gildi. *(Óstaðfest hvort sían ræður við „≠“ og hvernig hún fer með skjöl sem vantar reitinn. Prófa í stjórnborðinu.)*
- Beiðnin sem framendinn sendir á `/api/search`:
  ```json
  {"query":"hanskar","pageNumber":1,"pageSize":50,"responseType":"full","facets":{"Category":[""]}}
  ```
  Svarið frá Cludo er með `TotalDocument`, `FixedQuery` (sjálfvirka villuleiðréttingu) og `Synonyms`.

## Forgangsröðun

**Hluti B er brýnni.** Hann lagar villu sem notendur rekast á í dag. Hluti A lagar ekki sýnilega villu lengur. Hann leysir af hólmi handgerða lista og KPI-hreinsunina, sem halda leitinni hreinni núna en þurfa viðhald. Gerið B fyrst. A má bíða, eða sameinast 301-verkinu (sjá „Utan verksviðs“) ef það er á dagskrá fljótlega.

## Hluti B: Hreinsa leitarstrenginn í `/api/search`

**Markmið:** Inn-límd flipaheiti („Vara | Merki | Stórkaup“) skili vörunni.

Bæta við litlu falli, t.d. `normalizeQuery(q)`, sem keyrir áður en strengurinn fer til Cludo:

- **Aðalatriðið:** fjarlægja ` | ...`-hala, þ.e. allt frá fyrsta `|`. Prófin sýna að stafurinn `|` einn og sér gefur 0, líklega af því að Cludo les hann sem virkja. Lágmarkslausnin er því ein lína, `q.replace(/\|/g, ' ')`. Að skera halann af er betra, því þá fer „Merki“ og „Stórkaup“ líka.
- Fjarlægja orðið `stórkaup` / `storkaup` (óháð há- og lágstöfum), sem heilt orð. Cludo hunsar það í dag, svo þetta er varúðarráðstöfun, ekki lagfæring.
- Skipta kommum út fyrir bil, **nema komma milli tveggja tölustafa**. Tugakomma er notuð í vöruheitum (`5,5kg`, `1,5L`). Kommur trufla Cludo ekki í dag, svo þetta má líka sleppa.
- **Ekki** breyta `&`. Cludo breytir `te & kaffi` sjálft í `te og kaffi`, og ef framendinn gerir það líka hverfur `FixedQuery`-upplýsingin.
- Þjappa mörgum bilum í eitt og trimma.
- **Ekki** breyta tölum eða einingum eins og `25x`, `45g`, `5L` eða `5,5kg`.
- Ef ekkert er eftir (fyrirspurnin var bara `stórkaup` eða byrjaði á `|`): senda upprunalega strenginn.

Bæta við einingaprófum (unit tests) með þessum dæmum:

| Inn | Út |
|---|---|
| `Paprika Flögur, 18x 175gr \| Lays \| Stórkaup` | `Paprika Flögur 18x 175gr` |
| `a\|b` | `a b` (`\|` hvar sem er) |
| `Ryksugupokar Buddy II, 4stk \| Nilfisk \| Stórkaup` | `Ryksugupokar Buddy II 4stk` |
| `nesquik kakómalt, 12x 700g stórkaup` | `nesquik kakómalt 12x 700g` |
| `hanskar` | `hanskar` (óbreytt) |
| `  nitril   hanskar ` | `nitril hanskar` |
| `brúsi 5,5kg` | `brúsi 5,5kg` (tugakomma óbreytt) |
| `sápa, 1,5L` | `sápa 1,5L` |
| `te & kaffi` | `te & kaffi` (óbreytt, Cludo sér um þetta) |
| `Stórkaup` | `Stórkaup` (óbreytt, annars yrði strengurinn tómur) |

**Valfrjálst, spyrðu mig fyrst:** varaleið þegar Cludo skilar `TotalDocument = 0`. Þá væri hægt að reyna aftur með fyrstu tveimur til þremur orðunum, eða án talna og eininga. Það myndi láta `draumur fylltur lakkrís, 25x 45g freyja` skila Drauma bitum í stað engu. Þetta kostar aðra Cludo-beiðni á hverja tóma leit, og niðurstöðusíðan þyrfti að segja „engar niðurstöður fyrir X, sýnum Y“. Komdu með tillögu, en ekki smíða þetta án samþykkis.

Ef Cludo-APIið leyfir að slökkva á sjálfvirkri villuleiðréttingu í beiðninni, segðu mér frá því en **ekki kveikja á því/slökkva án samráðs**. Hún hjálpar (`te & kaffi`, „hanska“ → „hanskar“) en skemmir líka (`175gr` → `125g`, `0,75l` → `0275`).

## Hluti A: Merkja síður sem eru ekki kanónískar svo Cludo geti síað þær út

**Markmið:** Hver vara birtist einu sinni í leitinni **án handgerðra lista og án KPI-hreinsunar**. Reglan á að ná **báðum** orsökunum, einingasíðum og gömlum heitum.

**Reglan:** Síðan fær `cludo-exclude=true` ef slóðin sem var beðið um er **ekki** slóð vörunnar í sitemapinu. Annars fær hún `false`. Endingin skiptir engu máli (sjá töfluna yfir endingar).

1. **Kanna fyrst** og segja mér frá:
   - Hvar vörusíðan (`/vara/[...]`) er í kóðanum og hvaðan vörugögnin koma (Elasticsearch-millilagið?).
   - **Hvar sitemapið er búið til** og hvaða fall/gögn ákveða þá einu slóð sem hver vara fær. Vörusíðan á að nota *sama* fall og búa til kanónísku slóðina úr vörugögnunum. Hún á ekki að búa til nýja reglu eða sækja sitemapið við hverja birtingu.
   - Hvers vegna 99 vörur fá slóð án slugs og 3 vörunúmer koma tvisvar í sitemapinu. Bara segja frá, ekki laga í þessu verki.
   - Hvernig slóðin sem var beðið um berst í `generateMetadata` (params/slug), og hvort samanburðurinn þarf að hunsa há- og lágstafi, `/` í lokin og query string.
   - **Spyrðu mig** ef sitemapið og vörusíðan nota ólíkar gagnalindir. Þá þarf að ákveða hvor ræður.
2. **Bæta við merki** í `<head>` á **öllum** vörusíðum, með `generateMetadata` / `metadata.other` í App Router:
   ```html
   <meta name="cludo-exclude" content="true">   <!-- ekki kanónísk slóð -->
   <meta name="cludo-exclude" content="false">  <!-- kanónísk slóð -->
   ```
   Merkið á alltaf að vera til staðar, líka með `false`. Þá getur Pre-filter síað hvort sem er á `≠ true` eða `= false`, og með `curl` sést strax ef merkið vantar.
3. **Ekki** setja `noindex`, breyta canonical eða bæta við redirect í þessu verki. Það hefur áhrif á Google og á heima í sér verki (sjá „Utan verksviðs“).
4. Bæta við einföldu prófi eða skriftu sem sannreynir merkið á þessum slóðum:
   - `/vara/ryksugupokar-buddy-ii-4stk-113258` (kanónísk, án endingar) → `false`
   - `/vara/ryksugupokar-buddy-ii-4stk-113258kassi` (aukaeining) → `true`
   - `/vara/paprika-flogur-18x-175gr-9002877kassi` (kanónísk **með** endingu) → `false`
   - `/vara/lambabogur-urbeinadur-15-25-kg-9003652kg` (kanónísk með `kg`) → `false`
   - `/vara/104885kassi` (kanónísk án slugs) → `false`
   - `/vara/eitthvad-allt-annad-113258` (gamalt/rangt heiti) → `true`

**Handvirk skref í Cludo eftir deploy (ég geri þau, ekki Claude Code). Röðin skiptir máli:**
1. Deploy, svo athuga með `curl` að merkið sé komið á slóðirnar í lið 4, bæði `true` og `false`.
2. Cludo → Crawlers → *Add custom field*: `ExcludeFromSearch` ← XPath `//meta[@name='cludo-exclude']/@content`
3. Prófa með *Test Crawler* á kanónískri síðu, einingasíðu og gömlu heiti.
4. Cludo → *Update content* (endurskríða).
5. Engines → *Pre-filter*: **byrja á `ExcludeFromSearch` ≠ `true`**. Sú sía felur ekkert sem vantar reitinn, svo hún getur ekki tæmt leitina ef útdráttur bregst. Skipta yfir í `= false` þegar staðfest er að allar síður hafi reitinn. `= false` felur líka gömul afrit sem hafa ekki verið endurskriðin.
6. Prófa leitina, m.a. `113258`, `ryksugupokar buddy` og `glerhreinsir clear`. **Aðeins þegar allt virkar** á að eyða gömlu regex-línunum.

**Eftir að regex-línunum er eytt:** Cludo skríður einingasíðurnar aftur. Pre-filter felur þær, en KPI-hreinsunin (`cludoHreinsaVaraDocs_v1`) eyðir þeim úr vísinum og Cludo skríður þær svo aftur. Það gerir ekkert til. Þegar staðfest er að merkið nái báðum orsökunum má hætta að keyra hreinsunina.

## Samþykktarviðmið

Hluti B:
- [ ] `Paprika Flögur, 18x 175gr | Lays | Stórkaup` skilar Lays paprikuflögunum
- [ ] `Ryksugupokar Buddy II, 4stk | Nilfisk | Stórkaup` skilar 113258
- [ ] `te & kaffi` skilar áfram 25 niðurstöðum (afturför-próf)
- [ ] `hanskar` og `nesquik kakómalt, 12x 700g stórkaup` skila sama og áður (afturför-próf)
- [ ] Einingapróf fyrir `normalizeQuery` keyra græn

Hluti A:
- [ ] `113258` skilar áfram **einni** niðurstöðu, líka eftir að regex-línunum er eytt
- [ ] Aukaeining og rangt heiti fá `cludo-exclude=true`. Kanónískar slóðir, með og án endingar og án slugs, fá `false`
- [ ] Engar breytingar á Google-tengdum metadata (canonical/robots)

Báðir:
- [ ] Engar breytingar á útliti leitarniðurstaðna

## Utan verksviðs (seinni verk)

- **Rótarlagfæringin:** 301 frá öllum slóðum sem eru ekki kanónískar yfir á kanónísku slóðina, og alvöru 404 fyrir vörunúmer sem eru ekki til. Þegar það er komið hverfa bæði afritin og þörfin fyrir merkið, regex-listana og KPI-hreinsunina. Merkið í hluta A er brú, ekki lokalausn.
- Canonical/noindex fyrir aukaeiningar vegna Google (fellur líklega inn í 301-verkið).
- **99 vöruslóðir án slugs** (`/vara/104885kassi`). Ef þær fá slug seinna verður gamla slóðin að „gömlu heiti“, svo það ætti að gerast samhliða 301-verkinu.
- Breyta `Title`-uppruna í Cludo úr `og:title` í `$.name`, svo „| Merki | Stórkaup“ hverfi úr titlum í stuðlinum. Krefst þess að athuga hvort niðurstöðusíðan notar þann reit.
- Tugabrot í leit: `glerhreinsir 0,75l` gefur 0 af því að villuleiðréttingin breytir því í `0275`. Líklega samheiti eða stilling í Cludo.
- Röðun (Boostings) og samheiti, sem eru gerð í Cludo-stjórnborðinu.
- Stöðugir krókar fyrir crawlerinn: setja `data-cludo="product-files"` og `data-cludo="coming-soon"` (eða sambærilegt) á PDF-listann og „Væntanlegt“-merkið, eins og `data-slot` á breadcrumb. Þá geta XPath-reitirnir hætt að treysta á `flex gap-4` og `bg-[#FCAD17]`.
