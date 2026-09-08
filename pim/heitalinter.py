#!/usr/bin/env python3
"""
heitalinter.py - Athugar vorunofn ur Plytix-export gegn heitastandard Storkaups.

Notkun:
    python heitalinter.py export.csv
    python heitalinter.py export.csv --ut brot.csv --sku-col SKU --heiti-col "Product name"

Skilar CSV med einni linu per brot: sku, heiti, regla, alvarleiki, skilabod, tillaga.
"tillaga" er sjalfvirk uppastunga um rett heiti thar sem reglan er vel skilgreind
(einingar, pakkningasnid, bil) - hun er UPPASTUNGA, ekki nidurstada. Reglur sem
krefjast mannlegs mats (kynbeyging, markadsord, hastafir) fa enga tillogu.

Engin gervigreind, engar utanadkomandi heimildir - hrein reglurokfraedi.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------- stillingar

SKU_HEADERS = ["sku", "vorunumer", "vörunúmer", "product id", "id",
               "artikelnummer", "product sku"]
NAME_HEADERS = ["commercial name", "vöruheiti", "voruheiti", "heiti",
                "product name", "name", "title", "titill", "label"]

# Grunnheiti ur ERP. Fyrir Storkaup er thetta 'Label' - hun kemur beint ur
# Business Central og er MATCHKEYID milli BC og Plytix.
# HUN MA ALDREI BREYTAST. Verkfaerid les hana og skrifar aldrei tillogu fyrir hana;
# allar lagfaeringar fara i Commercial Name, sem er reiturinn sem verdur voruheiti.
GRUNN_HEADERS = ["label", "bc name", "original name", "erp name"]

# Einingar sem eiga ad standa rett skrifadar. Vinstri = ritad rangt, haegri = rett.
UNIT_CANON = {
    "l": "L", "ltr": "L", "litri": "L",
    "ml": "ml", "cl": "cl", "dl": "dl",
    "kg": "kg", "g": "g", "gr": "g", "mg": "mg",
    "cm": "cm", "mm": "mm", "m": "m",
    "stk": "stk", "pk": "pk", "par": "par",
    "micron": "micron",
}

# Vorumerki og skammstafanir sem MEGA vera i hastofum.
CAPS_OK = {
    "ABS", "ABENA", "ABRI", "PVC", "HDPE", "LDPE", "PET", "PP", "UV", "LED",
    "EU", "ECO", "HACCP", "CE", "IPA", "PH", "XL", "XXL", "L", "M", "S", "XS",
    "MD2", "SC500", "B", "USB", "IP", "RPM", "W", "V", "A",
}

# Ord sem eiga ekki ad vera i vorunafni - heitid er audkenni, ekki sala.
MARKETING_WORDS = {
    "hágæða", "hagaeda", "frábær", "frabaer", "einstakur", "einstakt", "einstök",
    "besti", "besta", "bestur", "ódýr", "odyr", "ótrúlegur", "otrulegur",
    "vinsælasta", "vinsaelasta", "toppgæði", "premium", "luxury", "amazing",
    "perfect", "best", "ultimate",
}

MAX_LEN = 60

# Pakkning vs. mal - thetta er munurinn sem skiptir mestu mali i ollum reglum
# her fyrir nedan. '12x 1kg' er pakkning. '364x325' og '60x40cm' eru MAL a vorunni.
# Skilyrdid er einingin: pakkning endar a magni/thyngd/fjolda, mal a lengdareiningu.
# Ef thetta er ruglad saman byr linterinn til tillogur sem skemma heitid.
PACK_UNIT = r"(?:kg|g|ml|cl|dl|[Ll]|stk|pk)"
PACK_RE = re.compile(rf"\d+\s?x\s?\d+(?:[.,]\d+)?\s?{PACK_UNIT}\b")


def has_pack(heiti: str) -> bool:
    return bool(PACK_RE.search(heiti))


@dataclass
class Finding:
    sku: str
    heiti: str
    regla: str
    alvarleiki: str      # "villa" = brot a standard, "athuga" = mannlegt mat
    skilabod: str
    tillaga: str = ""


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn").lower()


# ---------------------------------------------------------------- reglurnar

def r_litri_lagstafur(heiti: str) -> tuple[str, str] | None:
    """R1: litri a ad vera stor L. '2x 5l' -> '2x 5L'."""
    if re.search(r"(?<=\d)\s?l\b", heiti):
        fixed = re.sub(r"(?<=\d)(\s?)l\b", r"\1L", heiti)
        if fixed != heiti:
            return ("Litri skal vera stor 'L'", fixed)
    return None


def r_limdar_einingar(heiti: str) -> tuple[str, str] | None:
    """
    R2: tvaer OLIKAR einingar limdar saman. '24cl8oz' -> '24cl / 8oz'.

    Ma ALDREI taka 'NxM'-mynstur: '24x20stk' er pakkning an bils (R5), og
    '14x19cm' eru mal a vorunni. Fyrsta utgafa reglunnar bauð '14x / 19cm'
    fyrir malin a Disinfection Wipes - tillaga sem hefdi skemmt heitid.
    """
    for m in re.finditer(r"\d+\s*[a-zA-Zþæðöáíóúýþ]+\d+\s*[a-zA-Zþæðöáíóúýþ]+", heiti):
        piece = m.group(0)
        if re.search(r"\d\s*[xX×]\s*\d", piece):   # pakkning eda mal - ekki R2
            continue
        split = re.sub(r"([a-zA-Zþæðöáíóúýþ]+)(\d)", r"\1 / \2", piece, count=1)
        return (f"Tvaer einingar limdar saman: '{piece}'", heiti.replace(piece, split))
    return None


def r_einingaheiti(heiti: str) -> tuple[str, str] | None:
    """R12: einingin skal skrifast a stodludu formi. '460gr' -> '460g'."""
    for wrong, right in (("gr", "g"), ("ltr", "L"), ("Ltr", "L"), ("LTR", "L")):
        m = re.search(rf"(?<=\d)\s?{re.escape(wrong)}\b", heiti)
        if m:
            fixed = re.sub(rf"(?<=\d)(\s?){re.escape(wrong)}\b", rf"\g<1>{right}", heiti)
            return (f"Eining '{wrong}' skal vera '{right}'", fixed)
    return None


def r_bil_fyrir_einingu(heiti: str) -> tuple[str, str] | None:
    """R3: ekkert bil milli tolu og einingar. '136 kg' -> '136kg'."""
    m = re.search(r"\d+\s+(kg|g|ml|cl|dl|L|l|cm|mm|m|stk)\b", heiti)
    if m:
        fixed = re.sub(r"(\d+)\s+(kg|g|ml|cl|dl|L|l|cm|mm|m|stk)\b", r"\1\2", heiti)
        return (f"Bil milli tolu og einingar: '{m.group(0)}'", fixed)
    return None


def r_eining_of_smaa(heiti: str) -> tuple[str, str] | None:
    """R4: 1000ml+ a ad vera i litrum, 1000g+ i kilo."""
    for m in re.finditer(r"(\d+(?:[.,]\d+)?)\s?(ml|g)\b", heiti):
        val = float(m.group(1).replace(",", "."))
        unit = m.group(2)
        if unit == "ml" and val >= 1000:
            new = f"{val/1000:g}".replace(".", ",") + "L"
            return (f"{m.group(0)} aetti ad vera i litrum",
                    heiti.replace(m.group(0), new))
        if unit == "g" and val >= 1000:
            new = f"{val/1000:g}".replace(".", ",") + "kg"
            return (f"{m.group(0)} aetti ad vera i kilo",
                    heiti.replace(m.group(0), new))
    return None


def r_pakkningasnid(heiti: str) -> tuple[str, str] | None:
    """
    R5: pakkning skal skrifast 'Nx eining' med bili. '12x1kg' -> '12x 1kg'.
    Krefst einingar a eftir seinni tolunni svo mal ('364x325', '60x40cm')
    seu ekki misskilin sem pakkning.
    """
    m = re.search(rf"\b(\d+)x(\d+(?:[.,]\d+)?\s?{PACK_UNIT}\b)", heiti)
    if m:
        return (f"Vantar bil i pakkningu: '{m.group(0)}'",
                heiti[:m.start()] + f"{m.group(1)}x {m.group(2)}" + heiti[m.end():])
    return None


def r_komma_fyrir_pakkningu(heiti: str) -> tuple[str, str] | None:
    """R6: pakkning skal koma eftir kommu. 'Hrisgrjon basmati 12x 1kg'."""
    m = PACK_RE.search(heiti)
    if not m:
        return None
    before = heiti[:m.start()].rstrip()
    if not before or before.endswith(","):
        return None
    return ("Pakkning aetti ad koma eftir kommu", before + ", " + heiti[m.start():])


def r_hvitbil(heiti: str) -> tuple[str, str] | None:
    """R7: tvofalt bil, bil fyrir kommu, punktur i lokin."""
    problems = []
    fixed = heiti
    if "  " in heiti:
        problems.append("tvofalt bil")
        fixed = re.sub(r" {2,}", " ", fixed)
    if re.search(r"\s+,", heiti):
        problems.append("bil fyrir kommu")
        fixed = re.sub(r"\s+,", ",", fixed)
    if heiti.rstrip().endswith("."):
        problems.append("punktur i lokin")
        fixed = fixed.rstrip().rstrip(".")
    if heiti != heiti.strip():
        problems.append("bil i upphafi/lok")
        fixed = fixed.strip()
    if problems:
        return (", ".join(problems), fixed)
    return None


def r_lengd(heiti: str) -> tuple[str, str] | None:
    """R8: heiti yfir MAX_LEN klippist i listum."""
    if len(heiti) > MAX_LEN:
        return (f"Heiti er {len(heiti)} stafir (hamark {MAX_LEN})", "")
    return None


def r_markadsord(heiti: str) -> tuple[str, str] | None:
    """R9: markadsord eiga ekki ad vera i audkenni."""
    words = re.findall(r"[^\W\d_]+", heiti, re.UNICODE)
    hits = [w for w in words if strip_accents(w) in
            {strip_accents(m) for m in MARKETING_WORDS}]
    if hits:
        return (f"Markadsord i heiti: {', '.join(hits)}", "")
    return None


# Fyllt ut i main() ur Brand Name-reitnum i exportinu - vorumerki sem koma fyrir
# i gognunum sjalfum eru ekki innslattarvillur.
EXTRA_CAPS_OK: set[str] = set()


def r_hastafir(heiti: str) -> tuple[str, str] | None:
    """R10: ord i ollum hastofum sem er ekki thekkt vorumerki/skammstofun."""
    words = re.findall(r"\b[A-ZÁÐÉÍÓÚÝÞÆÖ][A-ZÁÐÉÍÓÚÝÞÆÖ]{2,}\b", heiti)
    odd = [w for w in words if w not in CAPS_OK and w not in EXTRA_CAPS_OK]
    if odd:
        return (f"Ord i ollum hastofum (vorumerki?): {', '.join(odd)}", "")
    return None


def r_titlecase(heiti: str) -> tuple[str, str] | None:
    """
    R14: Title Case a islenskum ordum. Islensk venja er ad adeins fyrsta ordid
    (og sernofn/vorumerki) hafi hastaf: 'Hunang fljotandi', ekki 'Hunang Fljotandi'.
    Vefurinn notar setningarhatt; Plytix-merkin eru a vixl.

    Engin tillaga - vorumerki og sernofn eru ekki greinanleg med reglu.
    """
    words = re.findall(r"[^\W\d_]{3,}", heiti, re.UNICODE)
    if len(words) < 2:
        return None
    tail = words[1:]
    caps = [w for w in tail
            if w[0].isupper() and not w.isupper()
            and w not in EXTRA_CAPS_OK and w.upper() not in EXTRA_CAPS_OK]
    if caps:
        return (f"Mogulega Title Case (sernofn/vorumerki?): {', '.join(caps)}", "")
    return None


def r_lysing_eins_og_heiti(heiti: str, lysing: str) -> tuple[str, str] | None:
    """
    R13: long lysing er afrit af heitinu - reiturinn er utfylltur en inniheldur
    engar upplysingar. Verra en tomur reitur, thvi ekkert flaggar hann sem vantandi.
    """
    if not lysing.strip():
        return ("Long lysing er tom", "")
    a = re.sub(r"\s+", " ", lysing).strip().casefold()
    b = re.sub(r"\s+", " ", heiti).strip().casefold()
    if a == b:
        return ("Long lysing er afrit af heitinu - engin lysing til", "")
    if len(lysing.split()) <= 3 and a in b:
        return ("Long lysing er brot af heitinu - engin raunveruleg lysing", "")
    return None


PLACEHOLDER_PAT = re.compile(
    r"\b(todo|tbd|xxx+|fixme|vantar|hvada|hvað|hvaða|óklárað|oklarad|test|prufa)\b",
    re.IGNORECASE)


def r_placeholder(heiti: str) -> tuple[str, str] | None:
    """
    R16: minnisatridi eda spurning skilin eftir i lifandi reit.
    Fannst i raun: Commercial Name = 'HVAÐA GRILL ER ÞETTA'.
    """
    if "?" in heiti:
        return ("Spurningarmerki i vorunafni", "")
    if PLACEHOLDER_PAT.search(heiti):
        return ("Minnisatridi/spurning i reitnum", "")
    words = [w for w in heiti.split() if len(w) > 1]
    if len(words) >= 3 and all(w.isupper() for w in words):
        return ("Allt i hastofum - minnisatridi eda innslattarvilla?", "")
    return None


def r_stok_stafur(heiti: str) -> tuple[str, str] | None:
    """R17: heiti endar a stoku staffi - oftast styfing ur BC ('...Hotelvagna N')."""
    m = re.search(r"\s([A-ZÁÐÉÍÓÚÝÞÆÖa-z])$", heiti)
    if m:
        return (f"Endar a stoku staffi '{m.group(1)}' - styfing ur BC?",
                heiti[:m.start()].rstrip())
    return None


def _magntoken(s: str) -> tuple[set[str], set[str]]:
    """Skilar (fjoldi 'Nx', magn 'Nstk') a stodludu formi."""
    mult = {m.group(1) + "x" for m in re.finditer(r"(\d+)\s?[xX×]\s?\d", s)}
    stk = {m.group(1) + "stk" for m in re.finditer(r"(\d+)\s?stk\b", s)}
    return mult, stk


def r_magn_stangast_a(heiti: str, lysing: str) -> tuple[str, str] | None:
    """
    R15: pakkningamagn i heiti og lysingu stangast a. Villa i gognunum, ekki stilvilla -
    'Butane gas, 28x 227gr' med lysingu '...24x 227gr' segir tvo olika hluti um
    hvad kaupandinn faer.

    Adeins beitt thegar lysingin er STUTT (<=8 ord), tha er hun heitislik og
    tolurnar i henni eru pakkningatolur. Raunveruleg lysing nefnir onnur mal
    (rummal, thyngd vorunnar) sem eiga ekkert ad stemma vid pakkninguna.
    """
    lysing = lysing.strip()
    if not lysing or len(lysing.split()) > 8:
        return None
    hm, hs = _magntoken(heiti)
    lm, ls = _magntoken(lysing)
    for a, b, hvad in ((hm, lm, "fjoldi i pakkningu"), (hs, ls, "stykkjatala")):
        if a and b and a != b:
            return (f"{hvad} stangast a: heiti '{'/'.join(sorted(a))}' "
                    f"vs lysing '{'/'.join(sorted(b))}'", "")
    return None


def r_pakkning_vs_sku(sku: str, heiti: str) -> tuple[str, str] | None:
    """
    R11: SKU-endingin i Plytix segir einingartypuna ('...kassi' / '...stk').
    Kassi an pakkningar i heiti er nanast alltaf gleymd pakkningastaerd.
    """
    s = sku.strip().lower()
    if s.endswith("kassi") and not has_pack(heiti):
        return ("SKU endar a 'kassi' en heiti hefur enga pakkningastaerd", "")
    if s.endswith("stk") and has_pack(heiti):
        return ("SKU endar a 'stk' en heiti hefur pakkningastaerd (Nx)", "")
    return None


NAME_RULES = [
    ("R7 hvitbil", "villa", r_hvitbil),
    ("R12 einingaheiti", "villa", r_einingaheiti),
    ("R1 litri", "villa", r_litri_lagstafur),
    ("R3 bil fyrir einingu", "villa", r_bil_fyrir_einingu),
    ("R2 limdar einingar", "villa", r_limdar_einingar),
    ("R5 pakkningasnid", "villa", r_pakkningasnid),
    ("R6 komma fyrir pakkningu", "athuga", r_komma_fyrir_pakkningu),
    ("R4 eining of smaa", "athuga", r_eining_of_smaa),
    ("R8 lengd", "athuga", r_lengd),
    ("R9 markadsord", "athuga", r_markadsord),
    ("R10 hastafir", "athuga", r_hastafir),
    ("R14 title case", "athuga", r_titlecase),
    ("R16 placeholder", "villa", r_placeholder),
    ("R17 stok stafur", "athuga", r_stok_stafur),
]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", strip_accents(s))


def afleitt_heiti(label: str, brand: str) -> tuple[str, list[str]]:
    """
    Byr til uppastungu ad Commercial Name ut fra BC-heitinu (Label) og vorumerki.

    Venjan i Plytix hja Storkaup, lesin ur their sem thegar eru fylltir:
      'Euroshopper Hunang Fljotandi, 6x 450g' + brand 'Euroshopper'
        -> 'Hunang Fljotandi, 6x 450g'
    Vorumerkid lifir i sinum eigin reit, svo thad er tekid ut ur heitinu.

    Skilar (uppastunga, listi af athugasemdum sem krefjast mannsauga).
    """
    notes: list[str] = []
    out = label.strip()
    b = brand.strip()

    if b and _norm(out).startswith(_norm(b)) and _norm(b):
        # Finna hvar vorumerkid endar i UPPRUNALEGA strengnum (stafataln er ekki eins).
        need = len(_norm(b))
        seen = 0
        cut = 0
        for i, ch in enumerate(out):
            if _norm(ch):
                seen += 1
            if seen == need:
                cut = i + 1
                break
        if cut:
            out = out[cut:].lstrip(" -,–—").strip()
    elif b and out.split():
        # Kljufa lika a bandstriki: BC skrifar 'Num-Pokafesting' fyrir Numatic.
        first = re.split(r"[-\s]", out, maxsplit=1)[0].rstrip("-,")
        nf, nb = _norm(first), _norm(b)
        if len(nf) >= 3 and nb.startswith(nf) and nf != nb:
            notes.append(f"'{first}' gaeti verid stytting a vorumerkinu '{b}'")

    fixed = build_suggestion(out)
    if fixed:
        out = fixed
    hit = r_stok_stafur(out)
    if hit:
        notes.append(hit[0])
        out = hit[1]
    if not out:
        notes.append("ekkert eftir thegar vorumerkid var tekid ut")
        out = label.strip()
    # Eftir ad vorumerkid er tekid framan af byrjar heitid oft a lagstaf
    # ('Char-broil gasgrill Pro 4' -> 'gasgrill Pro 4').
    if out and out[0].islower():
        out = out[0].upper() + out[1:]
    return out, notes

# Reglur sem gefa aherandi tillogu og ma keda saman i eitt fullnadarheiti.
# R6/R4 eru "athuga" en tillogur theirra eru vel skilgreindar, svo their fljota
# med i samsettu tillogunni - Olafur ser hana adskilda fra villunum i skranni.
CHAINABLE = {"R7 hvitbil", "R12 einingaheiti", "R1 litri", "R3 bil fyrir einingu",
             "R2 limdar einingar", "R5 pakkningasnid", "R6 komma fyrir pakkningu",
             "R4 eining of smaa"}


def build_suggestion(heiti: str) -> str:
    """
    Keyrir allar kedjanlegu reglurnar aftur og aftur thar til ekkert breytist.
    Ein tillaga per voru i stad thess ad Olafur thurfi ad raða saman
    thremur tillogum sem stangast a ('Pinguin Blomkal 10x1kg' fekk threr).
    """
    cur = heiti
    for _ in range(6):
        before = cur
        for name, _sev, fn in NAME_RULES:
            if name not in CHAINABLE:
                continue
            hit = fn(cur)
            if hit and hit[1] and hit[1] != cur:
                cur = hit[1]
        if cur == before:
            break
    return cur if cur != heiti else ""


# ---------------------------------------------------------------- innlestur

def read_rows(path: Path) -> tuple[list[str], list[dict]]:
    raw = None
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            raw = path.read_text(encoding=enc)
            break
        except UnicodeDecodeError:
            continue
    if raw is None:
        raise SystemExit(f"Gat ekki lesid {path} - ottheikkt stafasett")

    sample = raw[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";" if sample.count(";") > sample.count(",") else ","

    rdr = csv.DictReader(raw.splitlines(), dialect=dialect)
    return (rdr.fieldnames or []), list(rdr)


def pick_column(headers: list[str], candidates: list[str], label: str) -> str:
    norm = {strip_accents(h).strip(): h for h in headers}
    for c in candidates:
        key = strip_accents(c).strip()
        if key in norm:
            return norm[key]
    for h in headers:                       # hlutaleit
        hn = strip_accents(h)
        if any(strip_accents(c) in hn for c in candidates):
            return h
    raise SystemExit(
        f"Fann ekki {label}-reitinn. Reitir i skranni: {', '.join(headers)}\n"
        f"Gefdu hann handvirkt, t.d. --{label}-col \"<reitur>\""
    )


# ---------------------------------------------------------------- main

def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        description="Athugar vorunofn gegn heitastandard Storkaups")
    p.add_argument("skra", type=Path, help="CSV-export ur Plytix")
    p.add_argument("--ut", type=Path, default=None,
                   help="utskra (sjalfgefid <skra>_brot.csv)")
    p.add_argument("--sku-col", default=None)
    p.add_argument("--heiti-col", default=None)
    p.add_argument("--grunn-col", default=None,
                   help="ERP-heitid sem tillogur eru afleiddar af (t.d. \"Label\"). "
                        "Thessum reit er ALDREI breytt - hann er matchkeyid a BC.")
    p.add_argument("--lysing-col", default=None,
                   help="reitur med longu lysingu (t.d. \"Long Description\")")
    p.add_argument("--brand-col", default=None,
                   help="reitur med vorumerki (t.d. \"Brand Name\") - daemphir R10/R14")
    p.add_argument("--adeins-villur", action="store_true",
                   help="sleppa 'athuga'-linum, syna adeins skyr brot")
    o = p.parse_args(argv)

    if not o.skra.exists():
        raise SystemExit(f"Skra fannst ekki: {o.skra}")

    headers, rows = read_rows(o.skra)
    if not rows:
        raise SystemExit("Skrain er tom")

    sku_col = o.sku_col or pick_column(headers, SKU_HEADERS, "sku")
    name_col = o.heiti_col or pick_column(headers, NAME_HEADERS, "heiti")
    desc_col = o.lysing_col
    brand_col = o.brand_col
    grunn_col = o.grunn_col
    if grunn_col and grunn_col not in headers:
        raise SystemExit(f"Fann ekki grunn-reitinn '{grunn_col}'. "
                         f"Reitir: {', '.join(headers)}")
    print(f"Reitir: sku='{sku_col}'  heiti='{name_col}'"
          + (f"  grunnur='{grunn_col}' (obreyttur)" if grunn_col else "")
          + (f"  lysing='{desc_col}'" if desc_col else "")
          + (f"  vorumerki='{brand_col}'" if brand_col else "")
          + f"  ({len(rows)} linur)\n")

    # Vorumerki ur gognunum sjalfum eru ekki innslattarvillur.
    if brand_col:
        for row in rows:
            for w in re.findall(r"[^\W\d_]{2,}", row.get(brand_col) or "", re.UNICODE):
                EXTRA_CAPS_OK.add(w)
                EXTRA_CAPS_OK.add(w.upper())

    findings: list[Finding] = []
    suggestions: list[tuple[str, str, str]] = []

    for row in rows:
        sku = (row.get(sku_col) or "").strip()
        heiti = (row.get(name_col) or "").strip()

        if desc_col:
            lysing = row.get(desc_col) or ""
            # Lysingin er borin vid ERP-heitid thegar thad er til: vandamalid er
            # ad Long Description er afrit af BC-heitinu, og Commercial Name er
            # oftast tomur svo hann er ekki nothaefur til samanburdar.
            vidmid = (row.get(grunn_col) or "").strip() if grunn_col else heiti
            vidmid = vidmid or heiti
            hit = r_lysing_eins_og_heiti(vidmid, lysing)
            if hit:
                findings.append(Finding(sku, vidmid, "R13 lysing vantar",
                                        "villa", hit[0], ""))
            hit = r_magn_stangast_a(vidmid, lysing)
            if hit:
                findings.append(Finding(sku, vidmid, "R15 magn stangast a",
                                        "villa", hit[0], ""))

        if not heiti:
            # Tomt markheiti er ekki "brot" thegar verkfaerid er sjalft ad bua til
            # tillogu - thad er einfaldlega vinnan sem er ekki bunin. Skilabodin
            # eru i _commercial_name.csv sem 'nytt', ekki her.
            if not grunn_col:
                findings.append(Finding(sku, "", "R0 vantar heiti", "villa",
                                        "Vorunafn er tomt"))
            continue

        for name, sev, fn in NAME_RULES:
            hit = fn(heiti)
            if hit:
                msg, sug = hit
                findings.append(Finding(sku, heiti, name, sev, msg, sug))
        hit = r_pakkning_vs_sku(sku, heiti)
        if hit:
            findings.append(Finding(sku, heiti, "R11 pakkning vs SKU",
                                    "athuga", hit[0], hit[1]))

        sug = build_suggestion(heiti)
        if sug:
            suggestions.append((sku, heiti, sug))

    # --- tillogur ad Commercial Name, afleiddar af ERP-heitinu ---------------
    proposals: list[list[str]] = []
    if grunn_col:
        for row in rows:
            sku = (row.get(sku_col) or "").strip()
            label = (row.get(grunn_col) or "").strip()
            brand = (row.get(brand_col) or "").strip() if brand_col else ""
            nuna = (row.get(name_col) or "").strip()

            tillaga, notes = afleitt_heiti(label, brand)

            if not nuna:
                adgerd = "nytt"
            elif r_placeholder(nuna):
                adgerd = "RUSL I REITNUM"
                notes.insert(0, f"nuverandi gildi: {nuna!r}")
            elif nuna != tillaga:
                fix = build_suggestion(nuna)
                if fix:
                    tillaga, adgerd = fix, "lagfaert"
                else:
                    tillaga, adgerd = nuna, "obreytt"
            else:
                adgerd = "obreytt"

            if adgerd != "obreytt":
                proposals.append([sku, label, brand, nuna, tillaga, adgerd,
                                  "; ".join(notes)])

    if o.adeins_villur:
        findings = [f for f in findings if f.alvarleiki == "villa"]

    out = o.ut or o.skra.with_name(o.skra.stem + "_brot.csv")
    with out.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(["sku", "heiti", "regla", "alvarleiki", "skilabod", "tillaga"])
        for f in findings:
            w.writerow([f.sku, f.heiti, f.regla, f.alvarleiki, f.skilabod, f.tillaga])

    sug_out = out.with_name(out.stem.replace("_brot", "") + "_tillogur.csv")
    with sug_out.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(["sku", "heiti_nuna", "tillaga"])
        for sku, old, new in suggestions:
            w.writerow([sku, old, new])

    by_rule = Counter(f"{f.alvarleiki:7} {f.regla}" for f in findings)
    villur = sum(1 for f in findings if f.alvarleiki == "villa")
    vorur = len({f.sku for f in findings})

    print(f"{len(findings)} athugasemdir a {vorur} vorum af {len(rows)}")
    print(f"  {villur} skyr brot, {len(findings) - villur} til yfirlestrar\n")
    for rule, n in by_rule.most_common():
        print(f"  {n:5}  {rule}")
    prop_out = None
    if grunn_col:
        prop_out = out.with_name(out.stem.replace("_brot", "") + "_commercial_name.csv")
        with prop_out.open("w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh, delimiter=";")
            w.writerow(["sku", "label_ur_bc_OBREYTT", "vorumerki",
                        "commercial_name_nuna", "tillaga", "adgerd", "athuga"])
            w.writerows(proposals)
        by_act = Counter(p[5] for p in proposals)
        print(f"\n{len(proposals)} tillogur ad Commercial Name")
        for act, n in by_act.most_common():
            print(f"  {n:5}  {act}")

    print(f"\nBrot:     {out}")
    print(f"Tillogur: {sug_out}")
    if prop_out:
        print(f"Heiti:    {prop_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
