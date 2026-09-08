# PIM-tól — vörumyndir og vöruheiti

Python-tól sem styðja vinnu í Plytix: myndavinnsla fyrir vöruspjöld og
staðlaeftirlit og heitagerð á vörugögnum. Þau eru **ekki** hluti af Apps
Script-verkefninu — `clasp` sendir aðeins `.js`/`.gs`/`.html`, svo `.py` fer aldrei
með í push. Engin `.claspignore`-regla þarf.

## Gagnamódelið — les þetta fyrst

```
Business Central  ──►  Label            (MATCHKEY — má ALDREI breytast)
                       Brand Name       (vörumerki, sinn eigin reitur)
Ólafur skrifar    ──►  Commercial Name  (verður vöruheitið á vefnum)
                       Long Description (verður vörulýsingin)
```

`Label` kemur beint úr BC og er það sem tengir vöruna milli BC og Plytix.
**Verkfærið les hana og skrifar aldrei tillögu fyrir hana.** Öll lagfæring á stíl
fer í `Commercial Name`.

Venjan í `Commercial Name`, lesin úr þeim sem þegar voru fylltir:

```
Label 'Euroshopper Hunang Fljótandi, 6x 450g' + Brand 'Euroshopper'
  →  Commercial Name 'Hunang Fljótandi, 6x 450g'
```

Vörumerkið lifir í sínum reit, svo það er tekið framan af heitinu.

## `heitalinter.py`

```bash
python pim/heitalinter.py pim_drop/plytix_export.csv \
  --grunn-col "Label" --lysing-col "Long Description" --brand-col "Brand Name"
```

Hrein reglurökfræði — engin gervigreind, engar utanaðkomandi heimildir.
Skilar þremur skrám:

| Skrá | Innihald |
|---|---|
| `*_commercial_name.csv` | tillögur að vöruheiti: `sku; label_ur_bc_OBREYTT; vorumerki; commercial_name_nuna; tillaga; adgerd; athuga` |
| `*_brot.csv` | ein lína per brot: `sku; heiti; regla; alvarleiki; skilabod; tillaga` |
| `*_tillogur.csv` | samsett heitatillaga þar sem margar reglur eiga við |

`adgerd` í heitaskránni: `nytt` (reiturinn var tómur), `lagfaert` (stíllagfæring á
því sem var), `RUSL I REITNUM` (minnisatriði eða spurning í lifandi reit).

`alvarleiki` í brotaskránni: **villa** = skýrt brot, tillagan nánast alltaf rétt.
**athuga** = krefst mannsauga, oftast engin tillaga.

### Reglurnar

| Regla | Alvarleiki | Dæmi |
|---|---|---|
| R1 lítri | villa | `12x 1l` → `12x 1L` |
| R2 límdar einingar | villa | `24cl8oz` → `24cl / 8oz` |
| R3 bil fyrir einingu | villa | `136 kg` → `136kg`, `5 stk` → `5stk` |
| R4 eining of smá | athuga | `1000ml` → `1L`, `1400g` → `1,4kg` |
| R5 pakkningasnið | villa | `24x20stk` → `24x 20stk` |
| R6 komma fyrir pakkningu | athuga | `Blómkál 10x 1kg` → `Blómkál, 10x 1kg` |
| R7 hvítbil | villa | tvöfalt bil, bil fyrir kommu, punktur í lokin |
| R8 lengd | athuga | yfir 60 stafi klippist í listum |
| R9 markaðsorð | athuga | „hágæða", „frábær" |
| R10 hástafir | athuga | `TOPAZ` — dempað af `--brand-col` |
| R11 pakkning vs SKU | athuga | SKU endar á `kassi` en heiti hefur enga `Nx` |
| R12 einingaheiti | villa | `460gr` → `460g`, `2ltr` → `2L` |
| R13 lýsing vantar | villa | Long Description er afrit af BC-heitinu |
| R14 title case | athuga | `Hunang Fljótandi` vs `Hunang fljótandi` |
| R15 magn stangast á | **villa** | heiti `28x` en lýsing `24x` — gagnavilla |
| R16 placeholder | villa | `HVAÐA GRILL ER ÞETTA` í lifandi reit |
| R17 stök stafur | athuga | `...Hótelvagna N` — stýfing úr BC |

### R15 er sú sem finnur raunverulegar villur

R15 ber pakkningamagn í heiti við magnið í lýsingunni. Í fyrsta exportinu (41
vörur) fann hún tvær sem stangast á:

```
STO_9004180  Butane gas, 28x 227gr        lýsing segir 24x
STO_9004172  Char-Broil grilláhöld, 6stk  lýsing segir 12stk
```

Það eru ekki stílvillur — varan segir tvo ólíka hluti um hvað kaupandinn fær.
Reglan er aðeins beitt þegar lýsingin er stutt (≤8 orð); raunveruleg lýsing nefnir
önnur mál sem eiga ekkert að stemma við pakkninguna.

### Pakkning vs. mál — það sem má ekki rugla saman

`12x 1kg` og `24x 20stk` eru **pakkning**. `364x325` og `14x19cm` eru **mál á
vörunni**. Reglurnar greina þau í sundur á einingunni: pakkning endar á
magni/þyngd/fjölda (`kg g ml cl dl L stk pk`), mál á lengdareiningu.

Þetta er ekki smáatriði. Tvær útgáfur af linternum í röð buðu tillögur sem hefðu
skemmt heiti:

- v1 vildi breyta málinu `364x325` í pakkninguna `364x 325`
- v2 vildi breyta málinu `14x19cm` á Disinfection Wipes í `14x / 19cm`

Ef nýrri reglu er bætt við sem les `Nx`-mynstur: notið `has_pack()` / `PACK_RE`,
aldrei hrátt `\d+x\d`.

### Það sem linterinn getur ekki

- **Kynbeygingu.** `Kasjúhnetur saltaðar ristaðar` er rétt, `saltadar ristadir`
  ekki. Reglurökfræði greinir það ekki áreiðanlega á íslensku.
- **Hvort erlent heiti eigi að þýðast.** `Rep, Sæt Stempel` (danska),
  `Battery VU200`, `Disinfection Wipes For Skin` — verkfærið skilar þeim óbreyttum.
- **Hvort vörumerkið megi taka út.** `Antiche Terre Vino Rosso` → `Vino Rosso`
  er mekanískt rétt en gagnslaust heiti á íslenskum vef. Þessi tilfelli þurfa mann.
- **Setningarhátt.** Þeir fimm Commercial Name sem voru fylltir eru á víxl
  (`Hunang Fljótandi` vs `Pokafesting á hótelvagna`). R14 flaggar en giskar ekki.

## `vorumynd.py` — vörumyndir í 1000x1000 jpg

```bash
python pim/vorumynd.py <inn> <ut> --flytja
```

`--flytja` færir frummyndina í `unnid/AAAA-MM/` eftir vinnslu — **frummyndum er
aldrei eytt**, þær eru eina raunverulega gagnið í ferlinu. Gæðamat lendir í
`ut/vinnsluskra.csv`; `stokkun` yfir 4x þýðir of léleg frummynd.

Í daglegri notkun er `Pictures\Vorumyndir\Laga-myndir.bat` tvíklikkuð; hún kallar
á þessa skriptu og setur upp Python-pakkana í fyrsta skipti.

Aðferðafræðin: sjá `vinnufladi-vorumyndir.md` í Claude-projectinu.

### Betri upplausn fyrir litlar myndir

Lanczos-stækkun getur ekki endurheimt smáatriði sem vantar í frummynd. Í síðasta
raunsetti þurftu **20 af 32 frummyndum stækkun**, og eftir snyrtingu að vörunni
voru stækkunarstuðlarnir langt yfir því sem upplausnin gaf til kynna — 150×150px
vara í 920px flöt er 6,1×. Þess vegna notar tólið staðbundið Real-ESRGAN
**sjálfgefið** þegar það er uppsett. Myndir fara aldrei af tölvunni.

Sæktu Windows-útgáfuna frá [opinberu Real-ESRGAN útgáfunni](https://github.com/xinntao/Real-ESRGAN/releases)
og afþjappaðu henni hvar sem er undir `pim/.tools/`; bæði `realesrgan-ncnn-vulkan.exe`
og `models/` verða að fylgja saman. Mappan er gitignored. Finnist forritið ekki
fellur vinnslan þegjandi á Lanczos og skrifar það í `vinnsluskra.csv`.

```bash
python pim/vorumynd.py <inn> <ut>                    # AI notud ef hun er uppsett
python pim/vorumynd.py <inn> <ut> --upscaler lanczos # slaer AI af
```

#### Modelin virka aðeins á sínum eigin skala

`realesrgan-x4plus` er eitt 4×-model. Sé beðið um `-s 2` eða `-s 3` skilar
ncnn-útgáfan **skemmdri mynd** með sjáanlegum flísasamskeytum: hún villar ekki,
skilar réttum málum og lítur rétt út í skráarlistanum. Á `salling-rye-flour`
varð textinn „salling / RUGMEL" að „sang / AF GÐD." með endurteknum blokk í
neðra hægra horni.

Þetta var raunveruleg villa í tólinu: það reiknaði `scale = ceil(stækkun)`, svo
**hver mynd með stækkun undir 3× kom skemmd út** um leið og AI var valin. Núna er
alltaf beðið um skala sem modelið styður og Lanczos látið um síðasta bilið.

Til viðbótar er hver AI-umferð sannreynd (`image_fidelity`): útkoman er sköluð
niður í upprunastærð og borin við frummyndina. Rétt uppskölun heldur ~0,99;
flísasamsetningarvilla fellur í 0,4–0,6. Fari samsvörunin undir 0,97 er útkomunni
hafnað, Lanczos notuð í staðinn og ástæðan skrifuð í `vinnsluskra.csv`.

#### Tvær umferðir fyrir smáar vörur

Ein 4×-umferð nær ekki 920px flöt fyrir vöru undir 230px. Þá tók Lanczos síðasta
bilið og myndin mjúknaði aftur. `--ai-passes` (sjálfgefið 2) keyrir aðra umferð
og skalar niður, sem er skarpara. Önnur umferð er sleppt ef minna en
`--ai-min-scale` er eftir.

#### Skerping og skerpumæling

AI-útkoma er þegar skörp, svo skerpingin er dempuð þegar AI var notuð (40–70% við
radius 0,7 í stað allt að 150% við 1,6). Gamla stillingin gaf dökka kanta um
texta.

`vinnsluskra.csv` hefur nýjan `skerpa`-reit — breytileika Laplace-svörunar
**innan snyrtikassans**, ekki á heilli mynd. Sá greinarmunur skiptir máli: bláa
fatan `9002845` mælist 191 á heilli mynd en 1605 á vörunni sjálfri, því stór
hvítur flötur dregur heildarmælinguna niður.

Reiturinn er **önnur breyta en upplausn**. Nilfisk-batteríið er 1200×1200 en
mælist 9, og engin uppskölun bjargar því — þar vantar betri frummynd. Undir 80
er það flaggað, en varfærnislega: einkennalaus vara (hvítur svampur mælist 78)
hefur lágt gildi af eðlilegum ástæðum, svo flaggið er vísbending sem þarf
mannsauga.

AI-stækkun má samt ekki treysta sem staðreynd fyrir smáan texta,
innihaldslýsingu eða strikamerki; hún getur breytt eða fjarlægt stafi. `gaedi`
flaggar allar AI-myndir til handvirkrar yfirferðar.

## ⚠️ Repoið er opinbert

`origin` er `github.com/OlafurOrnJosephsson/storkaup_kpi` og er opinbert (jsDelivr
þarf það). **Plytix-export má ekki committa** — hann inniheldur `Original Vendor
Item No` og innri attribute-reiti sem eru ekki á vefnum. Notið `pim_drop/`
(gitignored), sama mynstur og `bc_drop/` fyrir BC-export.

Myndir fara ekki í git heldur. Droppmappan er `C:\Users\olafur\Pictures\Vorumyndir`.

## Uppsetning

```bash
pip install pillow numpy opencv-python-headless pillow-avif-plugin
```

`heitalinter.py` þarf enga pakka utan standard library.

## Staða

- `vorumynd.py` — í notkun, prófuð á raunmyndum
- `heitalinter.py` — keyrð á raunverulegt Plytix-export (41 vörur). 17 reglur.
- Lýsingagenerator — ekki byrjaður. Þegar stíllinn er fastur er rétti staðurinn
  líklega `core/pim_content.js` sem endurnýtir `SEO_PROVIDER`/`SEO_CLAUDE_MODEL`
  úr STORKAUP_CONFIG — ekki sérstök Python-pípa.
