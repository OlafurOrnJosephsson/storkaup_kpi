# Verkefni: Tvítekningar í Cludo-leit + hreinsun leitarstrengs

> Verklýsing fyrir Claude Code í storkaup.is-framendanum (Next.js App Router á Vercel).
> Lestu alla lýsinguna fyrst, kannaðu kóðann og komdu með **plan áður en þú breytir nokkru**.
>
> Upprunnin í KPI-repoinu (`docs/cludo/TASK_cludo_leit.md`, 2026-10-19). Staðreyndirnar
> um vísinn koma úr mælingum þar (`core/cludo.js`, september 2026).

## Bakgrunnur

Leitin á storkaup.is notar Cludo. Framendinn kallar á eigin route, `POST /api/search`, sem sendir leitina áfram til Cludo. Crawler Cludo les vörusíðurnar (`/vara/...`) og byggir leitarstuðulinn (index) úr þeim.

Þetta eru tvö vandamál sem á að leysa:

1. **Sama vara birtist tvisvar í leitinni.** Það eru tvær orsakir, sjá „Staðreyndir“. Í dag er reynt að fela afritin með löngum, handgerðum regex-listum af vörunúmerum í crawler-stillingum Cludo, auk hreinsunar úr KPI-kerfinu sem eyðir afritum úr vísinum eftir á. Allt sem vantar á listana birtist tvisvar. Dæmi: viðskiptavinur kvartaði í sept. yfir „sama varan 2x 113258 á vef“.
2. **Leitarstrengir sem fólk límir inn skila engu.** Fólk afritar heil vöruheiti, t.d. úr Google eða flipaheiti, og fær 0 niðurstöður:
   - `draumur fylltur lakkrís, 25x 45g freyja stórkaup` → 0. Villuleiðrétting Cludo breytir þessu í „drauma fellur…“.
   - `nesquik kakómalt, 12x 700g stórkaup` → 0
   - `te & kaffi` → 0, en `te og kaffi` → 25 niðurstöður

## Staðreyndir sem þegar liggja fyrir

### Tvær orsakir tvítekninga (mælt 2026-09-16 og 2026-09-28)

Routerinn undir `/vara/` les **aðeins vörunúmerið aftast** í slóðinni og hunsar textann á undan. Hvaða slug sem er með réttu númeri svarar því HTTP 200, og hver síða canonical-ar á sjálfa sig. Ekkert segir crawlernum hver rétta slóðin er.

| Orsök | Dæmi | Umfang |
|---|---|---|
| **Einingasíður**: varan er líka til sem `<slóð>kassi`, `<slóð>stk`, `<slóð>bretti` | `/vara/glerhreinsir-clear-2x-5l-104886kassi` | 703 vörur, 709 afrit í vísinum |
| **Gömul heiti**: varan var endurnefnd, gamla slóðin svarar enn 200 | gamalt slug + sama vörunúmer | ~650 afrit |

Page Inventory í Cludo sýndi 5.858 `/vara/`-skjöl á móti ~4.477 raunverulegum vörum. Eftir hreinsun eru um 4.450 skjöl eftir. Afrit bætast samt aftur við, um 30 á tveggja vikna fresti.

### Kanóníska slóðin er þegar til: sitemapið

`https://www.storkaup.is/sitemap.xml` er sitemap-index með undirskrám undir `/sitemaps/products/1..9`. Þar er **nákvæmlega ein slóð á hverja vöru**. Hreinsunin í KPI-kerfinu notar þennan lista sem sannleik: allt í vísinum sem er ekki í sitemapinu er afrit.

Athugið: kanóníska slóðin er **ekki alltaf hreint vörunúmer**. Sumar vörur eru í sitemapinu með endingu, t.d. 9003652 sem `...-9003652kg`. Regla eins og „slóð með einingarendingu er aukaeining“ væri því röng.

### Hvað síðurnar gefa crawlernum í dag (curl, 2026-10-19)

| Slóð | HTTP | canonical / og:url / JSON-LD `url` | JSON-LD `sku` | Breadcrumb |
|---|---|---|---|---|
| `/vara/ryksugupokar-buddy-ii-4stk-113258` (í sitemap) | 200 | sjálfa sig | `113258` | já |
| `/vara/ryksugupokar-buddy-ii-4stk-113258kassi` | 200 | sjálfa sig | `113258` | já |
| `/vara/eitthvad-allt-annad-113258` (tilbúið slug) | 200 | sjálfa sig | **engin Product JSON-LD** | **nei** |

- Einingasíðan er eins og aðalsíðan í öllu sem crawlerinn les: sami titill, sama `sku` og canonical á sjálfa sig. **Enginn núverandi reitur getur greint þær í sundur.** Þess vegna þarf merkið í hluta A.
- Slóð með röngu slugi fær réttan titil en hvorki Product JSON-LD né breadcrumb. Í Cludo verða `StorkaupSKU` og `ProductCategory` því líklega tóm á gömlum heitum. Þetta var aðeins prófað á tilbúnu slugi, ekki raunverulegu gömlu heiti. Kannaðu hvers vegna það gerist, því það bendir til að síðan fari aðra leið þegar slug passar ekki.

### Annað

- Snið slóða: `https://www.storkaup.is/vara/{slug}-{vörunúmer}{ending}`, þar sem ending er t.d. `kassi`, `stk`, `bretti`, `kg` eða engin.
- Núverandi regex í Cludo crawler (URL regex), stytt dæmi:
  `^https://www\.storkaup\.is/vara/.*-(104557|104560|104607|...)(kassi|stk|bretti)$`
  Regex-reglan stöðvar aðeins **framtíðarskrið**. Hún eyðir ekki skjölum sem eru þegar inni í vísinum.
- Crawler-reitir í Cludo (Page Fields Sources):
  - `Title` ← XPath `//meta[@property='og:title']/@content` (+1 varaleið)
  - `Description` ← structured data `$.description`
  - `StorkaupSKU` ← `$.sku`, `ManufacturerSKU` ← `$.mpn`
  - `ProductCategory` ← XPath `(//ol[@data-slot='breadcrumb-list']/li[@data-slot='breadcrumb-item'])[last()-1]/a`, þ.e. **næstsíðasti** liður (sá síðasti er varan sjálf)
  - `Product Brand name` ← `$.brand.name`
  - `Product stock` ← `$.availability`, `Product link` ← `$.url`
  - `Product availability` ← XPath sem sker `availability` úr JSON-LD textanum (sömu gögn og `Product stock`)
  - `Product Sheets` / `Product Files Name` ← XPath á `div` með klösunum `flex` + `gap-4` og `a[href*='.pdf']`
  - `Category availability` ← XPath á `div` með klasanum `bg-[#FCAD17]` sem inniheldur „Væntanlegt“
  - Þrír síðustu reitirnir hanga á Tailwind-klösum og brotna þegjandi ef útlitinu er breytt. Sjá „Utan verksviðs“.
- Cludo Engine er með **„Pre-filter search results“**: vélin skilar þá aðeins síðum sem hafa tiltekinn reit með tilteknu gildi. *(Óstaðfest hvort sían ræður við „≠“ og hvernig hún fer með skjöl sem vantar reitinn. Prófa í stjórnborðinu.)*
- Beiðnin sem framendinn sendir á `/api/search`:
  ```json
  {"query":"hanskar","pageNumber":1,"pageSize":50,"responseType":"full","facets":{"Category":[""]}}
  ```
  Svarið frá Cludo er með `FixedQuery` (sjálfvirka villuleiðréttingu) og `Synonyms`.

## Hluti A: Merkja síður sem eru ekki kanónískar svo Cludo geti síað þær út

**Markmið:** Hver vara birtist einu sinni í leitinni, án handgerðra lista. Reglan á að ná **báðum** orsökunum, einingasíðum og gömlum heitum.

**Reglan:** Síðan fær `cludo-exclude=true` ef slóðin sem var beðið um er **ekki** slóð vörunnar í sitemapinu. Annars fær hún `false`.

1. **Kanna fyrst** og segja mér frá:
   - Hvar vörusíðan (`/vara/[...]`) er í kóðanum og hvaðan vörugögnin koma (Elasticsearch-millilagið?).
   - **Hvar sitemapið er búið til** og hvaða fall/gögn ákveða þá einu slóð sem hver vara fær. Vörusíðan á að nota *sama* fall og búa til kanónísku slóðina úr vörugögnunum. Hún á ekki að búa til nýja reglu eða sækja sitemapið við hverja birtingu.
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
   - kanónísk slóð 113258 → `false`
   - einingasíða 113258 (sú sem er ekki í sitemapinu) → `true`
   - vara sem er bara til í einni einingu → `false`
   - vara með endingu í sitemapinu, 9003652 (`...-9003652kg`) → `false`
   - **gamalt heiti**: kanónísk slóð með breyttu slugi en sama vörunúmeri, t.d. `/vara/eitthvad-allt-annad-113258` → `true`

**Handvirk skref í Cludo eftir deploy (ég geri þau, ekki Claude Code). Röðin skiptir máli:**
1. Deploy, svo athuga með `curl` að merkið sé komið á slóðirnar í lið 4, bæði `true` og `false`.
2. Cludo → Crawlers → *Add custom field*: `ExcludeFromSearch` ← XPath `//meta[@name='cludo-exclude']/@content`
3. Prófa með *Test Crawler* á kanónískri síðu, einingasíðu og gömlu heiti.
4. Cludo → *Update content* (endurskríða).
5. Engines → *Pre-filter*: **byrja á `ExcludeFromSearch` ≠ `true`**. Sú sía felur ekkert sem vantar reitinn, svo hún getur ekki tæmt leitina ef útdráttur bregst. Skipta yfir í `= false` þegar staðfest er að allar síður hafi reitinn. `= false` felur líka gömul afrit sem hafa ekki verið endurskriðin.
6. Prófa leitina. **Aðeins þegar allt virkar** á að eyða gömlu regex-línunum.

**Eftir að regex-línunum er eytt:** Cludo skríður einingasíðurnar aftur. Pre-filter felur þær, en KPI-hreinsunin (`cludoHreinsaVaraDocs_v1`) eyðir þeim úr vísinum og Cludo skríður þær svo aftur. Það gerir ekkert til. Þegar staðfest er að merkið nái báðum orsökunum má hætta að keyra hreinsunina.

## Hluti B: Hreinsa leitarstrenginn í `/api/search`

**Markmið:** Inn-límd vöruheiti og „&“ skili réttum vörum.

**Áður en smíðað er:** sláið hreinsuðu strengina úr töflunni hér að neðan inn í leitina á vefnum eins og hún er í dag. Ef `draumur fylltur lakkrís 25x 45g freyja` skilar enn 0 dugar hreinsunin ekki ein og sér. Þá er vandinn líklega að tókar eins og `25x`/`45g` passa ekki við stuðulinn (t.d. `45gr` eða `25x45g`). Segðu mér frá því, því þá þarf að breyta samþykktarviðmiðinu eða bæta við skrefi.

Bæta við litlu falli, t.d. `normalizeQuery(q)`, sem keyrir áður en strengurinn fer til Cludo:

- Fjarlægja ` | ...`-hala, sem kemur ef fólk afritar flipaheitið („Vara | Merki | Stórkaup“).
- Fjarlægja orðið `stórkaup` / `storkaup` (óháð há- og lágstöfum), sem heilt orð.
- Skipta kommum út fyrir bil, **nema komma milli tveggja tölustafa**. Tugakomma er notuð í vöruheitum (`5,5kg`, `1,5L`).
- ` & ` (með bili báðum megin) → ` og `. `&` án bila, t.d. `H&M` eða `P&G`, helst óbreytt.
- Þjappa mörgum bilum í eitt og trimma.
- **Ekki** breyta tölum eða einingum eins og `25x`, `45g`, `5L` eða `5,5kg`.
- Ef ekkert er eftir (fyrirspurnin var bara `stórkaup`): senda upprunalega strenginn.

Bæta við einingaprófum (unit tests) með þessum dæmum:

| Inn | Út |
|---|---|
| `draumur fylltur lakkrís, 25x 45g freyja stórkaup` | `draumur fylltur lakkrís 25x 45g freyja` |
| `Paprika Flögur, 18x 175gr \| Lays \| Stórkaup` | `Paprika Flögur 18x 175gr` |
| `te & kaffi` | `te og kaffi` |
| `hanskar` | `hanskar` (óbreytt) |
| `  nitril   hanskar ` | `nitril hanskar` |
| `brúsi 5,5kg` | `brúsi 5,5kg` (tugakomma óbreytt) |
| `sápa, 1,5L` | `sápa 1,5L` |
| `H&M` | `H&M` (óbreytt) |
| `Stórkaup` | `Stórkaup` (óbreytt, annars yrði strengurinn tómur) |

Ef Cludo-APIið leyfir að slökkva á sjálfvirkri villuleiðréttingu í beiðninni (gefur `FixedQuery`), segðu mér frá því en **ekki kveikja á því/slökkva án samráðs**. Hún hjálpar líka, t.d. „hanska“ → „hanskar“.

## Samþykktarviðmið

- [ ] Leit að `113258` / vöruheiti hennar skilar vörunni **einu sinni**
- [ ] `paprika flögur` skilar hvorri Lays-vöru einu sinni
- [ ] Slóð með gömlu heiti (rangt slug, rétt vörunúmer) fær `cludo-exclude=true`
- [ ] `draumur fylltur lakkrís, 25x 45g freyja stórkaup` skilar Draumi *(sjá „Áður en smíðað er“ í hluta B)*
- [ ] `te & kaffi` skilar sömu niðurstöðum og `te og kaffi`
- [ ] Engar breytingar á útliti leitarniðurstaðna eða á Google-tengdum metadata (canonical/robots)
- [ ] Einingapróf fyrir `normalizeQuery` og próf fyrir merkið keyra græn

## Utan verksviðs (seinni verk)

- **Rótarlagfæringin:** 301 frá öllum slóðum sem eru ekki kanónískar yfir á kanónísku slóðina, og alvöru 404 fyrir vörunúmer sem eru ekki til. Þegar það er komið hverfa bæði afritin og þörfin fyrir merkið og KPI-hreinsunina. Merkið í hluta A er brú, ekki lokalausn.
- Canonical/noindex fyrir aukaeiningar vegna Google (fellur líklega inn í 301-verkið).
- Breyta `Title`-uppruna í Cludo úr `og:title` í `$.name`, svo „| Merki | Stórkaup“ hverfi úr titlum í stuðlinum. Krefst þess að athuga hvort niðurstöðusíðan notar þann reit.
- Röðun (Boostings) og samheiti, sem eru gerð í Cludo-stjórnborðinu.
- Stöðugir krókar fyrir crawlerinn: setja `data-cludo="product-files"` og `data-cludo="coming-soon"` (eða sambærilegt) á PDF-listann og „Væntanlegt“-merkið, eins og `data-slot` á breadcrumb. Þá geta XPath-reitirnir hætt að treysta á `flex gap-4` og `bg-[#FCAD17]`.
