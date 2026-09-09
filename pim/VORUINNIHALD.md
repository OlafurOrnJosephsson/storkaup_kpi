# Vöruinnihald — staða og næstu skref

Uppfært 2026-09-08. Handover-skjal fyrir content-verkefnið: vöruheiti, vörulýsingar
og öryggis-/gagnablöð á öllum vörum, með starfsfólk í skrifunum.

---

## Arkitektúrinn í stuttu máli

```
Plytix CSV  ──► pim_drop/ ──► pim_sync.ps1 ──► Drive PIM_DROP ──┐
                                                                 ├─► menu_buildPimWorksheet
KPI-skjalið (STÓRKAUP_KPI_CORE) ────────────────────────────────┘            │
   PRODUCTS        (Cludo-vefskrið)  → flokkur, vefslóð, „í leitarvísi"      ▼
   VANTAR_MYND                       → myndaskilyrðið                  VINNUSHEET
   RAMMASAMNINGAR                    → forgangsröðun                  (sér Google Sheet)
```

**Plytix er hryggjarstykkið, Cludo er mælikvarði — ekki öfugt.** Ef nefnarinn kæmi
úr PRODUCTS myndu vörur sem eru í catalognum en hvergi á vefnum mælast sem
ekki-til, í stað þess að mælast sem verstu tilfellin.

⚠️ Þessi kafli sagði áður að PRODUCTS „veit bara um það sem er birt og
finnanlegt". Það var **ósatt**: hann vissi aðeins um það sem hafði **selst**.
Cludo-collectorinn sótti SKU úr þrem söluskrám og hafði enga
vörulistauppsprettu, svo 605 birtar vörur af 4.477 vantaði. Fjórða uppsprettan
(`getProductsV2`) var bætt við 2026-09-09; PRODUCTS nær því yfir birta listann
eftir að `scheduledCludoSync_v1` hefur unnið sig í gegn, um sex daga á 50 SKU
í keyrslu tvisvar á dag.

Þangað til kemur svarið um vefnærveru úr `Á vef`-kólumnunni, sem er spurð beint
og er endanleg.

**Vinnusheetið er sér skjal, ekki flipi í KPI-skjalinu.** Starfsfólk fær aðgang að því
og engu öðru. GAS afritar það sem þarf — ekki IMPORTRANGE.

---

## Staðan

| | |
|---|---|
| `pim/buildPimWorksheet.js` | **í loftinu** (main @133, 2026-09-08) |
| `core/menu.js` | valmynd „Vöruinnihald" — **í loftinu** |
| `pim_sync.ps1` + `pim_sync.bat` | virka; .bat til að tvíklikka, eins og BC |
| `gas_deploy.ps1` | nýtt — push + útgáfa á **báðum** GAS-verkefnum |
| Drive `STÓRKAUP_KPI_CORE/PIM_DROP` | full — hrái útdrátturinn kominn |
| Google Sheet `VINNUSHEET` | **byggt**, fjórir flipar |
| `STORKAUP_CONFIG` → SHEET_IDS röð 14 | `PIM \| Vinnusheet \| <id>` ✅ |
| `STORKAUP_CONFIG` → SETTINGS | `PIM_DROP_FOLDER_ID` ✅ (röð 17) |
| `PIM_CSV_DELIMITER` | **þarf ekki** — útdrátturinn er kommu-aðgreindur |
| `STORKAUP_CONFIG` → SETTINGS → `PIM_OWNERS` | ✅ 13 nöfn — dropdown á Eigandi virkur |
| `pim_drop/plytix_export.csv` | fullur útdráttur, 7.986 raðir, 18 kólumnur |
| `pim/`, `pim_sync.*`, `gas_deploy.ps1` | **ótrackuð í git** |

**Valmyndin er í SALES_SUMMARIES, ekki STÓRKAUP_KPI_CORE.** Apps Script-verkefnið
er bundið því skjali, svo `onOpen` setur hana þar. Það skiptir ekki máli fyrir
virknina — PIM-kóðinn opnar vinnusheetið eftir auðkenni og notar aldrei virka
skjalið. Þetta skjal sagði áður STÓRKAUP_KPI_CORE og það var rangt.

---

## Næstu skref

**Undirbúningur er búinn (2026-09-09).** Vinnusheetið er byggt og sannreynt,
allir sex punktar á gátlistanum neðst standast, `PIM_OWNERS` er kominn með 13
nöfn og dropdown á `Eigandi` virkur. Verkefnið sjálft er ekki hafið.

Fyrsti hópurinn er úthlutaður sem prófun: **Óli fékk `Álpappír filmur og
bakkar`, 25 vörur.** Þar af þurfa 10 lýsingu skrifaða og 15 aðeins yfirlestur.
Það er hópur nr. 52 af 213 eftir stærð, svo hann er yfir miðgildinu (14) en
ekki risi.

Það sem stendur:

1. **Hlusta á Óla.** Tvær spurningar ráða því hvort app verður byggt:
   sá hann hvað hann skrifaði (wrap er komið), og vissi hann hvað var gott?
   Ef svarið við hinu síðara er nei liggur vandinn í ritstílnum og
   leiðbeiningunum, og app leysir hvorugt. Sjá „App í stað sheets?" í Opið.

2. **Úthluta hinum tólf** þegar prófunin heldur.

   Verkbúturinn er **Undirflokkur** (Level 3): 213 hópar, miðgildi 14 vörur,
   stærsti 209. Það eru ekki 213 starfsmenn — hver tekur nokkra hópa.
   Sheetið er raðað Level 1 → 2 → 3 → heiti, svo hópar undir sama Flokki
   liggja saman og eru búnir í jafna bunka með augunum.

   **Tillaga að skiptingu (reiknuð 2026-09-08, ekki skrifuð í sheetið).**
   Skipt á VINNU, ekki vörufjölda: 1.197 vörur þurfa lýsingu skrifaða, hinar
   3.280 hafa raunverulega lýsingu og þurfa aðeins yfirlestur. 92 skrif á mann.

   | Eigandi | Vörur | Skrif | Flokkar |
   |---|---|---|---|
   | Jóhanna | 209 | 125 | Ryksugur: Fylgihlutir fyrir ryksugur |
   | Ólöf | 441 | 108 | Ræstiáhöld |
   | Bjössi | 357 | 90 | Gólfþvottavélar, Kælivara, Persónulegt hreinlæti |
   | Haddý | 389 | 89 | Léttvín, Snakk kex og sælgæti |
   | Óli | 222 | 89 | Háþrýstitæki, Kraftar og Krydd, Ryksugupokar |
   | Sigrún | 378 | 88 | Hreinsiefni, Ryk- og vatnssugur |
   | Bjartur | 309 | 88 | Dósavara, Innréttingar, Pokar og ruslafötur |
   | Atli | 271 | 88 | Hótelvörur, Rekstarvörur Eldhús, Smátæki og áhöld |
   | Þórey | 315 | 88 | Frystivara, Pappír, Skammtarar |
   | Gummi | 397 | 86 | Bjór, Drykkjarvörur, Hanskar, Lágþrýstitæki |
   | Jón | 395 | 86 | Þurrlager, Heilbrigðisbúnaður + fjórir smáir |
   | Margrét | 395 | 86 | Brauð og sætmeti, Einnota rekstrarvörur + fimm smáir |
   | Joost | 399 | 86 | Heilbrigðisrekstrarvara, Þvaglekavörur + tveir smáir |

   Aðeins **einn** Level 2 flokkur er of stór fyrir einn mann: `Ryksugur`,
   172 skrif. Hann er klofinn á Level 3. Allt annað passar heilt, svo hver
   maður fær heila flokka.

   `Fylgihlutir fyrir ryksugur` er 125 skrif í EINUM Level 3 hóp og er minnsta
   ódeilanlega eining sem til er. Annaðhvort tekur einn hann eða þú klippir
   hann eftir röðum, sem eyðileggur „einn eigandi á flokk".

   Vörufjöldinn er ójafn (209–441) og það er í lagi: Ólöf hefur 441 vöru en
   aðeins 108 skrif, því flestar hennar hafa þegar lýsingu.

   Mekanikin: síaðu á `Flokkur`, veldu `Eigandi`-kólumnuna, fylltu niður.
   39 aðgerðir, ekki 4.477.

3. **Filter view á mann,** ekki flipa og ekki sér skjöl. Data → Filter views
   → Create new, síað á `Eigandi`. Filter view er per notanda og raskar ekki
   hinum. Sjá „Flipar per Level 1" í gildrunum um hvers vegna ekki flipar.
   Athugaðu að scriptan býr til GRUNNSÍU, sem er sameiginleg — hún er ekki
   það sama og filter view.

4. **Leiðrétta þetta skjal** eftir kickoff — sérstaklega tölurnar, sem eru
   allar mældar á útdrættinum frá 2026-09-07 og eldast.

Git er ekki lengur á listanum: `pim/`, `pim_sync.*` og `gas_deploy.ps1` eru
committuð og pushuð (2026-09-09).

---

## Gildrur sem eru þegar leystar — ekki enduruppgötva

Allt hér er mælt á útdrættinum, ekki ágiskað. Tölur eru frá 2026-09-08.

- **`cfg` er ekki hnattrænt.** Hvert fall verður að kalla `loadConfig_()` sjálft.
  Að hafa `cfg.`-tilvísun inni í falli kemur í veg fyrir að hún keyri við
  hleðslu, en fallið verður samt að sækja gildið. Þetta var fyrsta villan sem
  kom þegar skriptan var keyrð: `ReferenceError: cfg is not defined`.

- **Merge-lykillinn er SKU, ALDREI Label.** Label er hvorugt af því sem lykill
  þarf að vera. Ekki einkvæmt: fimm Label eru tvítekin á vinnusettinu og
  `Kaffimál 24cl/8oz, 20x 50stk` er **fjórar ólíkar vörur**. Lyklað á Label
  læsu þær allar sömu varðveittu gögnin, svo lýsing skrifuð á eina birtist á
  hinum þrem eða hyrfi. Og ekki stöðugt: heiti lagfært í BC færir lykilinn.
  SKU er einkvæmt á öllum 4.477 og aldrei tómt. (Þetta skjal sagði áður að
  scriptan matchaði „á Label fyrst og SKU til vara" — hún gerði það ekki, og
  röksemdin sem fylgdi var í raun röksemdin *gegn* Label.)

- **SKU-formið stemmir ekki milli kerfa.** Plytix skrifar `STO_9004290`,
  PRODUCTS/Cludo skrifar `9004290`, og stundum `01015` með forleiðandi núlli.
  `normSku_` sér um öll þrjú. Án þess matchar ekkert.

- **Plytix-flokkaslóðin hefur rót.** Sniðið er
  `Stórkaup>Level1>Level2>Level3` og `Stórkaup` telur ekki sem lag. Sé henni
  ekki sleppt kemur hvert stig eitt of hátt — það gerðist á **100%** af 4.470
  röðum og gaf 5 hópa í stað 213.

- **Komman í `Categories` er tvíræð.** Hún skilur að flokka í 622 tilfellum en
  er inni í flokksheiti í 290 (`Snakk, kex og sælgæti`). Aldrei kljúfa á bera
  kommu — kljúfa á `,Stórkaup>`, því hver slóð byrjar á rótinni.

- **Kólumnubókstafir í formúlum verða að vera leiddir af `PIM_COLS_`.** Bæði
  ARRAYFORMULU-strengirnar, skilyrta sniðið og QUERY vísa á kólumnur með
  bókstaf. Voru þeir handskrifaðir hliðraði ný kólumna öllu og formúlurnar
  reiknuðu **þegjandi** úr rangri kólumnu. Þegar Level-lögunum var bætt við
  fór `descNew` úr J í L, `status` úr N í P og `done` úr S í U. Sjá
  `pimColLetter_`.

- **QUERY-kólumnubókstafir eru afstæðir við svæðið.** `QUERY(C2:U, "select C")`
  velur þriðju kólumnu SVÆÐISINS, ekki blaðkólumnu C. Svæðið er því ankrað í A
  þar sem hvortveggja er það sama. Gamla útgáfan grúppaði líklega á
  `Vörumerki (núv.)` á meðan taflan sagði „Vöruflokkur".

- **Varðveisla starfsmannagagna er lykluð á KÓLUMNUHEITI, ekki stöðu.** Sheet
  með eldri kólumnuröð myndi annars lesa gulu reitina úr rangri kólumnu og
  skrifa yfir handskrifað efni án viðvörunar. Sjá `remapPrev_`.

- **Sía á `Status`, ekki í Plytix-útdrættinum.** Fullur útdráttur er
  *nauðsynlegur* — síarðu archived út í Plytix verður `EKKI_A_VEF` tómur af
  smíði. Síunin er í kóðanum (`PIM_WORK_STATUSES_`). Vanti `Status`-kólumnan
  alveg er **ekki** síað og það er skráð í keyrsluskrá, því betra er að fá
  44% of mikið og sjá það en að fela þau þegjandi.

- **Allar innihaldstölur verða að mælast á `Completed` einum.** Á fulla
  útdrættinum sýnir linterinn 4.651 vöru með ónýta lýsingu; á Completed eru
  þær 1.203. Fjórföld skekkja, öll í archived. Sama gildir um Commercial Name:
  3.745 tillögur á öllu, 519 á Completed.

- **Ekki flipar per Level 1.** Flokkatréð er margir-til-margra, ekki skipting.
  221 vara (4,9%) tilheyrir fleiri en einum Level 1, 353 fleiri en einum
  Level 2 og 486 fleiri en einum Level 3. Með flipum færu þær ýmist í tvo
  flipa, og þá skrifa tveir starfsmenn tvö heiti á sömu vöru, eða í einn
  handahófsvalinn og þá sér hinn eigandinn hana aldrei. `Eigandi` plús filter
  view leysir það sem flipar áttu að leysa, án þess að klofna gögnin.

- **PRODUCTS getur ekki svarað „er varan á vef".** Hann er fylltur af
  Cludo-syncinu, sem sækir SKU úr `collectAllSkusFromSystems_` — og það fall
  hefur ÞRJÁR uppsprettur, allar **söluskrár**: NEWWEB, OLDWEB, BC_LINES.
  Þar er engin vörulistauppspretta. Vara sem hefur **aldrei verið keypt**
  kemst því aldrei í PRODUCTS.

  Það gaf `Ekki í leitarvísi = 605` (13,5% af 4.477) og fyllti `EKKI_A_VEF`
  af vörum sem er ekkert að. Þrjár efstu úr flipanum fundust allar á vefnum
  við handvirka prófun 2026-09-09. Skilyrta sniðið litaði þær 605 raðir
  rauðar að ósekju, svo starfsfólk sá viðvörun á heilbrigðum vörum.

  Lagfært: ný kólumna `Á vef` kemur úr `getProductsV2` (opinber, engir
  lyklar, sami listi sem vefurinn birtir) og er endanleg. `Í leitarvísi`
  segir `Já` þegar PRODUCTS-röð er til en er **tómt** annars, því fjarvist er
  ekki sönnun. `EKKI_A_VEF` er nú borinn við vörulistann sjálfan.

  Rótin er lögfærð 2026-09-09: `collectAllSkusFromSystems_` fékk vörulistann
  sem **fjórðu** uppsprettu. Það tekur um sex daga að fylla þessar 605 inn í
  PRODUCTS. Þangað til koma flokkalögin fyrir þær úr Plytix-varaleiðinni, sem
  er rétt en grynnra en brauðmylsnan.

- **`Rammasamningur` kom úr RANGRI uppsprettu.** Kólumnan las
  `RAMMASAMNINGAR`-flipann, en sá flipi geymir rammasamningsvörur **án
  verðs** — heilbrigðiseftirlit úr `storkaup_pricing.js`, lítið hlutmengi
  sem var tómt. Kólumnan sagði því 0 fyrir allar 4.477, á meðan
  Leiðbeiningar-flipinn segir starfsfólki að taka rammasamningsvörur fyrst.
  Ráðgjöfin var gagnslaus. Rétta talan er í útdrættinum sjálfum:
  `Framework Agreement Product` = True á **248** vörum, þar af þurfa 76
  lýsingu skrifaða.

- **Framvinda vantaldi ónýtar lýsingar um 2,5x.** „Lýsing = vöruheitið" bar
  aðeins við `Commercial Name` og gaf 486. Lýsingin er LÍKA oft afrit af
  `Label`, og sú tala er 1.190. Rétta talan er hvort sem er: **1.212**, plús
  7 alveg tómar. SUMPRODUCT tvítelur vöru sem stemmir við bæði, því
  samlagning er OR en 1+1=2 — `SIGN()` klemmir það.

- **„Með tóma lýsingu" var villandi merking, ekki villandi tala.** Hún taldi
  NÝJA reitinn, sem er tómur af því enginn hefur skrifað enn, en las eins og
  4.477 vörur hefðu enga lýsingu. 3.280 HAFA raunverulega lýsingu. Heitir nú
  „Ný lýsing óskrifuð" og fékk „Núv. lýsing tóm" við hliðina.

- **Linter-úttakið er líka `.csv`** og lifir í sömu möppu. Bæði `pim_sync.ps1`
  og GAS-scriptan sía `_brot`, `_commercial_name` og `_tillogur` út. Án þess
  gæti „nýjasta .csv" verið brotaskráin.

- **ARRAYFORMULA ræður ekki við `AND()`/`OR()`** — margföldun er AND,
  samlagning er OR. Ein formúla á kólumnu, ekki ein á röð; annars verður
  sheetið óbrúklega hægt.

- **`.js` í undirmöppu fer inn sem SCRIPT-skrá** og top-level kóði keyrir við
  hverja einustu keyrslu (sbr. viðvörunina um `email-preview/` í
  `.claspignore`). `pim/` er ekki í `.claspignore`, svo
  `buildPimWorksheet.js` **fer með í hvert push**. Hún er hrein Apps
  Script-skrá; bætirðu Node-kóða í `pim/*.js` drepur það alla triggera.

- **Endurkeyrsla eyðir engu.** Gráar og fjólubláar kólumnur uppfærast, gular
  haldast, vörur sem hverfa eru merktar í Athugasemd. Skriptan greinir á milli
  vöru sem er **horfin úr skránni** og vöru sem er **komin í archived**.

- **`clasp push` úr rót sendir aðeins hálfan kóðann.** `admin/**` er útilokað
  í `.claspignore`, og bæði verkefnin þurfa *nýja útgáfu*, ekki bara push.
  Notaðu `gas_deploy.ps1`.

---

## Opið

- **Öryggisblað: hálfleyst.** Útdrátturinn HEFUR kólumnuna
  `Safety Datasheet Files`, svo það er mælanlegt hvort blað sé **tengt** —
  7,9% á Completed (355 af 4.473). Það sem enn vantar er hvort blað sé
  **skylt**: hættumerkingin er hvergi í útdrættinum. Fyrsta umferð er því
  handvirk í sheetinu. Þetta skjal gerði áður ráð fyrir að viðhengja-svæðið
  vantaði alveg; það er komið.

- **Lýsingar: vandinn er afrit, ekki tómt.** 99,8% af Completed hafa
  `Long Description`, en **26,5% eru heitið aftur** (1.186 vörur).
  Raunverulegar lýsingar eru 73,3%, miðgildi 178 stafir. Linterinn nær þessu
  þegar (regla R13, 1.203 vörur á Completed).

- **Commercial Name: sama sagan.** Þetta skjal sagði að reiturinn væri „tómt á
  mörgum vörum". Á Completed er hann fylltur í **99,9%** tilfella. Vandinn er
  að **42,1% eru Label afritað staf fyrir staf** (1.884 vörur). Vefurinn
  fellur ekki aftur á neitt, reiturinn er fylltur með sama streng. Linterinn
  gefur 511 `lagfaert` og aðeins 5 `nytt` á Completed.

- **Eignarhaldsgrunnur: Level 3, ákveðið 2026-09-08.**

  | | Level 2 | Level 3 |
  |---|---|---|
  | Hópar | 38 | 213 |
  | Stærstur | 441 | 209 |
  | Miðgildi | 89 | 14 |
  | Hópar undir 10 vörum | 5 | 84 |

  Level 3 er verkbúturinn því vörur í sama Undirflokki eru nógu líkar til að
  skrifast í einni beit. Level 2 er bundlarinn. Bæði eru kólumnur í sheetinu,
  svo hvorugt þarf að velja endanlega.

- **Sheetið mælir það sem er SKRIFAÐ, ekki það sem er komið í loftið.** Þegar
  Plytix-innflutningur er kominn í gang er þess virði að sýna hvort tveggja.
  Enn opið.

- **App í stað sheets? Opið, prófað ódýrt fyrst (2026-09-08).**

  Sheetið gæti verið of mikið fyrir starfsfólk. Versta atriðið var mælanlegt og
  er lagað: `setWrap(false)` á öllum röðum þýddi að lýsing á 100 orðum birtist
  sem ein klippt lína og skrifandinn sá ekki hvað hann skrifaði. Núna er wrap
  á `Löng lýsing (ný)` og `Athugasemd`, clip á hinum.

  **Prófið:** einn maður, 20 vörur. Ef kvörtunin er „ömurlegt að skrifa í
  reit" er app rétta svarið. Ef hún er „ég veit ekki hverjar eru mínar" eða
  „ég veit ekki hvað er gott" leysir app hvorugt — það gera úthlutunin og
  ritstíllinn.

  **Ef appið verður byggt:** það skrifar í SAMA sheetið, ekki í sér „Unnið"
  skjal. Tvö skjöl fyrir sama reitinn er samstillingarvandi þar sem enginn er,
  og sheetið hefur þegar varðveisluna (lyklað á SKU), `Fullbúið` og Framvindu.
  Appið verður þá fókuseruð skrifsýn ofan á sheetið; bili það heldur sheetið
  áfram að virka. Mynstrið er til: `admin/` er HTML-app á slóð bak við
  Google-innskráningu (`access: DOMAIN` + allowlist), sjá
  `admin/listaverd_konnun.html`.

  Raunkostnaðurinn er ekki arkitektúrinn heldur þrennt: samtímaskrif (þarf
  `LockService` eða skrif per SKU), svartími (`google.script.run` er 1–3 sek
  á umferð, svo „vista og næsta" verður hægara en að tabba í sheeti nema
  vistun sé hópuð), og yfirlesturinn — að lesa 1.200 lýsingar yfir er einmitt
  það sem sheet er gott í.

- **Filter views eru handvirkar.** Scriptan búr til GRUNNSÍU (`createFilter`),
  sem er sameiginleg — einn sem síar breytir sýn hinna. Filter views eru per
  notanda en Apps Script getur ekki búið þær til (þyrfti Sheets Advanced
  Service). Fyrir próf með einum manni nægir grunnsían. Staðfesta í prófinu
  að filter views lifi endurbyggingu, því scriptan fjarlægir og býr grunnsíuna
  til aftur í hverri keyrslu.

- **Level 2 sem sér kólumna til bundlunar er til, en engin sjálfvirk bundlun.**
  Úthlutunin er handvirk í `Eigandi`. Ef 213 hópar reynast of fínt korn má
  bæta sjálfvirkri bundlun við, en það er ekki byggt.

---

## Gátlisti: sannreyna byggt sheet

Sex atriði, í þeirri röð sem þau geta verið þegjandi röng.

| Hvað | Á að vera |
|---|---|
| Toast eftir byggingu | um 4.477 raðir, um 3.496 sleppt |
| `Yfirflokkur` / `Flokkur` / `Undirflokkur` | fylltar. Séu þær tómar heldur SKU-joinið við PRODUCTS **ekki** |
| `Í leitarvísi` og `Vefslóð` | fylltar á flestum. Prófar PRODUCTS-joinið sérstaklega |
| `Orðafjöldi` | 0 í hverri röð, ekki villa. Prófar endurbyggðu formúluna |
| `Fullbúið` | NEI í hverri röð, ekki villa |
| Framvinda → „Eftir undirflokki" | um 213 raðir með flokksheitum og tölum. Sjái þú **vörumerki** þar er QUERY-svæðið skakkt |

**Sannreynt 2026-09-09:** allt sex í lagi. Taflan „Eftir undirflokki" sýnir
flokksheiti (`Fylgihlutir fyrir ryksugur` 196, `Burstar og sópar` 118 …), svo
QUERY-svæðið heldur. Tvær Framvinda-tölur voru hins vegar rangar og eru
lagfærðar — sjá `Rammasamningur` og „vantaldi ónýtar lýsingar" í gildrunum.

Fjórir flipar eiga að vera til: `Leiðbeiningar`, `Vinnusheet`, `Framvinda`,
`EKKI_A_VEF`. Gular kólumnur tómar.

---

## Tengt efni

- **Ritstíll vörukorta** (uppflettisíða fyrir starfsfólk — reglur, fyrir/eftir dæmi
  af storkaup.is, gátlisti): https://claude.ai/code/artifact/ceabafcc-d730-424f-b039-38124131204c
- **Kickoff-kynning** — `Vöruinnihald-kickoff.pptx`, 11 slæður með glósum.
  Tvennt viljandi autt: nöfn á flokkaslæðunni og ein Cludo-tala.
- **Dashboard-spec** — `claude/voruinnihald-dashboard-spec.md` í Claude-verkefninu
  „Stórkaup VEFUR KPI". Skilgreiningin á „fullbúið", gagnaflæði í Supabase, áfangaskipting.
- **`pim/heitalinter.py`** — sömu heitareglur sem keyranleg rökfræði. Ritstíllinn og
  linterinn verða að haldast í takt; R1–R5 eru skjalfestar í `pim/README.md`.
