"""Prófun Snjallákvörðunar Creditinfo — útflutningur og innlestur svars.

Vinnuskjalið (docs/creditinfo/Snjallakvordun_uppsetning_og_profunarlisti.xlsx)
er EKKI í git: það ber kennitölur og innra mat. Þetta tól er í git; gögnin ekki.

  python tools/creditinfo_profun.py undirbua
      Bætir við vinnuskjalið (einu sinni, óhætt að endurtaka):
      - Prófunarlisti 20: fellilisti Samþykkja / Til skoðunar / Hafna í G og H,
        formúla í „Samræmi?“, dálkar K–M fyrir svar Creditinfo.
      - Úttektarheimild: dálkurinn „Hver framfylgir“ við reglur 1–5.
      - Spurningar til CI: nr. 9 um uppflettingar.

  python tools/creditinfo_profun.py flytja-ut [--leyfa-drog]
      Býr til docs/creditinfo/Til_Creditinfo_<dags>.xlsx: Lesið fyrst, reglurnar,
      núverandi framkvæmd, prófunarlistinn (Nr, kennitala, heiti — ekkert annað),
      svarblað og spurningarnar. Neitar ef reglurnar eru enn drög (blátt letur)
      eða ef eigið mat (G) vantar á einhvern af 20. Vistar dagsett afrit af
      vinnuskjalinu sem sönnun þess að matið var skráð fyrir sendingu.

  python tools/creditinfo_profun.py lesa-inn <svarskrá.xlsx>
      Les blaðið „Svar Creditinfo“ og skrifar niðurstöðuna í H og K–M á
      Prófunarlisti 20, parað á kennitölu.
"""
import datetime
import os
import re
import shutil
import sys
from copy import copy

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.workbook.properties import CalcProperties
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.environ.get('CI_MASTER') or os.path.join(ROOT, 'docs', 'creditinfo',
                                                     'Snjallakvordun_uppsetning_og_profunarlisti.xlsx')
DIR = os.path.dirname(MASTER)

TEAL, BLUE, YELLOW = 'FF0B5563', 'FF0000FF', 'FFFFF2CC'
NIDURSTODUR = ['Samþykkja', 'Til skoðunar', 'Hafna']
DATA_ROWS = range(6, 26)   # Prófunarlisti 20: Nr 1–20 (röð 5 er dæmið)
thin = Side(style='thin', color='FFC9D3D6')
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)


def say(msg):
    sys.stdout.buffer.write((msg + '\n').encode('utf8'))


def die(msg):
    say(msg)
    sys.exit(1)


def kt_digits(v):
    return re.sub(r'[^0-9]', '', str(v or ''))


def load(path):
    if not os.path.exists(path):
        die('Finn ekki ' + path)
    return openpyxl.load_workbook(path)


def save(wb, path):
    wb.calculation = CalcProperties(fullCalcOnLoad=True)
    try:
        wb.save(path)
    except PermissionError:
        die('Get ekki vistað ' + os.path.basename(path) + ' — er skjalið opið í Excel? Lokaðu því og reyndu aftur.')


def header_cell(c, text):
    c.value = text
    c.font = Font(name='Arial', size=11, bold=True, color='FFFFFFFF')
    c.fill = PatternFill('solid', fgColor=TEAL)
    c.alignment = Alignment(wrap_text=True, vertical='center')
    c.border = BOX


def body_cell(c, value=None, fill=None, fmt=None, blue=False):
    if value is not None:
        c.value = value
    c.font = Font(name='Arial', size=10, color=BLUE if blue else None)
    c.alignment = Alignment(wrap_text=True, vertical='top')
    c.border = BOX
    if fill:
        c.fill = PatternFill('solid', fgColor=fill)
    if fmt:
        c.number_format = fmt


def add_validation(ws, ref):
    for dv in ws.data_validations.dataValidation:
        if str(dv.sqref) == ref:
            return
    dv = DataValidation(type='list', formula1='"' + ','.join(NIDURSTODUR) + '"', allow_blank=True)
    dv.error = 'Veldu Samþykkja, Til skoðunar eða Hafna — sama orðalag og Creditinfo skilar.'
    dv.showErrorMessage = True
    ws.add_data_validation(dv)
    dv.add(ref)


# ── undirbua ────────────────────────────────────────────────────────────────
def undirbua():
    wb = load(MASTER)
    shutil.copy(MASTER, MASTER.replace('.xlsx', '_fyrir_undirbuning.xlsx'))

    p = wb['Prófunarlisti 20']
    add_validation(p, 'G6:G25')
    add_validation(p, 'H6:H25')
    for r in DATA_ROWS:
        p.cell(r, 9).value = '=IF(OR(G{0}="",H{0}=""),"",IF(G{0}=H{0},"Já","Nei"))'.format(r)
    for col, text, width in [(11, 'Útreiknuð heimild (CI)', 16), (12, 'Lánshæfisflokkur (CI)', 14),
                             (13, 'Viðmið sem brugðust (CI)', 22)]:
        header_cell(p.cell(4, col), text)
        p.column_dimensions[openpyxl.utils.get_column_letter(col)].width = width
        for r in DATA_ROWS:
            body_cell(p.cell(r, col), fmt='#,##0" kr."' if col == 11 else None)
    p['B29'] = 'Samræmi'
    p['D29'] = '=COUNTIF(I6:I25,"Já")'
    p['E29'] = '=" af "&COUNTIF(I6:I25,"?*")&" sem báðir hafa metið"'
    for ref in ('B29', 'D29', 'E29'):
        p[ref].font = copy(p['B28'].font)

    # Hver framfylgir hverri reglu: Snjallákvörðun metur einu sinni við stofnun.
    # Það sem gerist eftir það (lækkun fyrstu mánuðina) er BC-megin hjá okkur.
    u = wb['Úttektarheimild']
    header_cell(u['D12'], 'Hver framfylgir — tillaga')
    u.column_dimensions['D'].width = max(u.column_dimensions['D'].width or 0, 34)
    who = {13: 'Creditinfo — ef reiknilíkanið hefur eigið fé (spyrja)',
           14: 'Creditinfo — fylgir viðmiði 5',
           15: 'Stórkaup — sett í BC, hækkað eftir 3 mán. (Endurmat)',
           16: 'Creditinfo — fylgir viðmiði 9',
           17: 'Creditinfo — fylgir viðmiði 4'}
    for r, text in who.items():
        body_cell(u.cell(r, 4), text, fill=YELLOW, blue=True)

    q = wb['Spurningar til CI']
    if not any(q.cell(r, 1).value == 9 for r in range(1, q.max_row + 1)):
        last = max(r for r in range(1, q.max_row + 1) if q.cell(r, 1).value is not None)
        new = last + 1
        for col in range(1, 5):
            q.cell(new, col)._style = copy(q.cell(last, col)._style)
        q.cell(new, 1).value = 9
        q.cell(new, 2).value = ('Skráist prófunarkeyrslan sem uppfletting sem fyrirtækin sjá, og á hvaða grundvelli '
                                'megum við keyra núverandi viðskiptavini sem hafa ekki sótt um?')
        q.cell(new, 3).value = ('Okkar regla er að fletta aldrei upp nema umsókn liggi fyrir, því fyrirtæki fá '
                                'upplýsingar um uppflettingar. 15 af 20 í prófuninni hafa ekki sótt um neitt.')
        q.row_dimensions[new].height = q.row_dimensions[last].height

    save(wb, MASTER)
    say('Vinnuskjal undirbúið. Afrit fyrir breytingu: ' + os.path.basename(MASTER.replace('.xlsx', '_fyrir_undirbuning.xlsx')))


# ── flytja-ut ───────────────────────────────────────────────────────────────
def drafts(wb):
    out = []
    for name in ('Ákvörðunarreglur', 'Úttektarheimild'):
        ws = wb[name]
        for row in ws.iter_rows():
            for c in row:
                if c.value is not None and c.font is not None and c.font.color is not None \
                        and c.font.color.rgb == BLUE:
                    out.append(name + '!' + c.coordinate)
    return out


def flytja_ut(leyfa_drog):
    wb = load(MASTER)
    p = wb['Prófunarlisti 20']
    rows = []
    for r in DATA_ROWS:
        kt = kt_digits(p.cell(r, 4).value)
        if not kt:
            continue
        rows.append({'nr': p.cell(r, 1).value, 'kt': kt, 'heiti': p.cell(r, 3).value or '',
                     'mat': p.cell(r, 7).value, 'hopur': p.cell(r, 2).value or ''})

    problems = []
    if len(rows) != 20:
        problems.append('%d kennitölur á Prófunarlisti 20, ekki 20.' % len(rows))
    bad = [x['nr'] for x in rows if len(x['kt']) != 10]
    if bad:
        problems.append('Kennitala ekki 10 stafir í Nr ' + ', '.join(map(str, bad)) + '.')
    no_mat = [x['nr'] for x in rows if x['mat'] not in NIDURSTODUR]
    if no_mat:
        problems.append('Eigið mat (G) vantar eða er ekki Samþykkja/Til skoðunar/Hafna í Nr ' +
                        ', '.join(map(str, no_mat)) + '. Það verður að liggja fyrir ÁÐUR en listinn fer út.')
    dupes = sorted({x['kt'] for x in rows if sum(1 for y in rows if y['kt'] == x['kt']) > 1})
    if dupes:
        problems.append('Sama kennitala tvisvar: ' + ', '.join(dupes) + '.')
    if problems:
        die('Ekki flutt út:\n  - ' + '\n  - '.join(problems))

    d = drafts(wb)
    if d and not leyfa_drog:
        die('Ekki flutt út: %d gildi í reglunum eru enn blá (tillaga, ekki ákveðið), t.d. %s.\n'
                 'Staðfestu gildin og breyttu letrinu í svart — eða keyrðu með --leyfa-drog og skráin '
                 'verður merkt DRÖG.' % (len(d), ', '.join(d[:4])))

    today = datetime.date.today().isoformat()
    snapshot = MASTER.replace('.xlsx', '_sent_%s.xlsx' % today)
    shutil.copy(MASTER, snapshot)

    out = load(MASTER)
    for name in ('Yfirlit', 'Endurmat', 'Prófunarlisti 20', 'Valviðmið úrtaks'):
        if name in out.sheetnames:
            del out[name]
    # Innra mat okkar á muninum er ekki fyrir Creditinfo — taflan sjálf er það.
    if 'Núverandi reglur' in out.sheetnames:
        nr = out['Núverandi reglur']
        cut = next((r for r in range(1, nr.max_row + 1) if nr.cell(r, 1).value == 'Hvað munurinn segir'), None)
        if cut:
            for m in [m for m in nr.merged_cells.ranges if m.min_row >= cut]:
                nr.unmerge_cells(str(m))
            nr.delete_rows(cut, nr.max_row - cut + 1)

    # Lesið fyrst
    lf = out.create_sheet('Lesið fyrst', 0)
    lf.sheet_view.showGridLines = False
    lf.column_dimensions['A'].width = 26
    lf.column_dimensions['B'].width = 90
    lf['A1'] = 'Stórkaup — prófun Snjallákvörðunar' + (' (DRÖG)' if d else '')
    lf['A1'].font = Font(name='Arial', size=15, bold=True, color='FF12191C')
    lf['A2'] = 'Sent ' + today + '. Tengiliður: Ólafur, oj@storkaup.is.'
    lf['A2'].font = Font(name='Arial', size=9, color='FF6B7A7E')
    header_cell(lf['A4'], 'Blað')
    header_cell(lf['B4'], 'Hvað er þar')
    lines = [
        ('Ákvörðunarreglur', 'Viðmiðin tíu í „Reikningsviðskipti – ítarlegt“ og gildin sem við viljum á hvert þeirra.'),
        ('Úttektarheimild', 'Hámarksheimild eftir lánshæfisflokki og eiginfjárhlutfalli, og reglur sem gilda ofan á töfluna. '
                            'Dálkurinn „Hver framfylgir“ sýnir hvað við teljum ykkar megin og hvað okkar.'),
        ('Núverandi reglur', 'Hvernig umsóknir eru afgreiddar handvirkt í dag — til samanburðar.'),
        ('Prófunarlisti', '20 kennitölur til að keyra gegn reglunum.'),
        ('Svar Creditinfo', 'Vinsamlegast skilið niðurstöðunni hér, einni línu á hverja kennitölu.'),
        ('Spurningar til CI', 'Það sem við þurfum svar við áður en reglurnar eru frystar. Dálkurinn „Svar Creditinfo“ er ykkar.'),
    ]
    for k, (a, b) in enumerate(lines, start=5):
        body_cell(lf.cell(k, 1), a)
        lf.cell(k, 1).font = Font(name='Arial', size=10, bold=True)
        body_cell(lf.cell(k, 2), b)
    if d:
        lf['A12'] = 'DRÖG: %d gildi í reglunum eru tillaga sem ekki hefur verið staðfest (blátt letur).' % len(d)
        lf['A12'].font = Font(name='Arial', size=10, bold=True, color='FF963628')

    pl = out.create_sheet('Prófunarlisti', 4)
    sv = out.create_sheet('Svar Creditinfo', 5)
    for ws in (pl, sv):
        ws.sheet_view.showGridLines = False
    for col, (text, width) in enumerate([('Nr', 6), ('Kennitala', 14), ('Heiti', 40)], start=1):
        header_cell(pl.cell(1, col), text)
        pl.column_dimensions[openpyxl.utils.get_column_letter(col)].width = width
    sv_head = [('Nr', 6), ('Kennitala', 14), ('Niðurstaða', 16), ('Útreiknuð heimild', 18),
               ('Lánshæfisflokkur', 16), ('Viðmið sem brugðust (nr. 1–10)', 26), ('Athugasemd', 40)]
    for col, (text, width) in enumerate(sv_head, start=1):
        header_cell(sv.cell(1, col), text)
        sv.column_dimensions[openpyxl.utils.get_column_letter(col)].width = width
    for k, x in enumerate(sorted(rows, key=lambda x: x['nr']), start=2):
        for ws in (pl, sv):
            body_cell(ws.cell(k, 1), x['nr'])
            body_cell(ws.cell(k, 2), x['kt'], fmt='@')
        body_cell(pl.cell(k, 3), x['heiti'])
        for col in range(3, 8):
            body_cell(sv.cell(k, col), fill=YELLOW, fmt='#,##0" kr."' if col == 4 else None)
    add_validation(sv, 'C2:C21')
    order = ['Lesið fyrst', 'Ákvörðunarreglur', 'Úttektarheimild', 'Núverandi reglur',
             'Prófunarlisti', 'Svar Creditinfo', 'Spurningar til CI']
    out._sheets.sort(key=lambda ws: order.index(ws.title) if ws.title in order else len(order))
    out.active = 0

    path = os.path.join(DIR, 'Til_Creditinfo_%s.xlsx' % today)
    save(out, path)

    indiv = [x for x in rows if int(x['kt'][:2]) <= 31]
    say('Búið til: ' + path)
    say('Afrit af vinnuskjalinu eins og það var við sendingu: ' + os.path.basename(snapshot))
    if indiv:
        say('ATH: %d kennitölur eru einstaklingar (Nr %s) — skrifleg heimild verður að liggja fyrir.'
            % (len(indiv), ', '.join(str(x['nr']) for x in indiv)))
    if d:
        say('ATH: merkt DRÖG — %d gildi í reglunum eru enn tillaga.' % len(d))


# ── lesa-inn ────────────────────────────────────────────────────────────────
def lesa_inn(path):
    ans = load(path)
    if 'Svar Creditinfo' not in ans.sheetnames:
        die('Blaðið „Svar Creditinfo“ finnst ekki í ' + os.path.basename(path))
    s = ans['Svar Creditinfo']
    answers = {}
    for r in range(2, s.max_row + 1):
        kt = kt_digits(s.cell(r, 2).value)
        if kt:
            answers[kt] = [s.cell(r, c).value for c in range(3, 7)]

    shutil.copy(MASTER, MASTER.replace('.xlsx', '_fyrir_svar.xlsx'))
    wb = load(MASTER)
    p = wb['Prófunarlisti 20']
    hit, agree, odd = 0, 0, []
    for r in DATA_ROWS:
        kt = kt_digits(p.cell(r, 4).value)
        if kt not in answers:
            continue
        nidurstada, heimild, flokkur, vidmid = answers.pop(kt)
        if nidurstada not in NIDURSTODUR:
            odd.append('Nr %s: „%s“' % (p.cell(r, 1).value, nidurstada))
        p.cell(r, 8).value = nidurstada
        p.cell(r, 11).value = heimild
        p.cell(r, 12).value = flokkur
        p.cell(r, 13).value = vidmid
        hit += 1
        agree += 1 if nidurstada == p.cell(r, 7).value else 0
    save(wb, MASTER)

    say('Lesið inn: %d af 20. Samræmi við okkar mat: %d af %d.' % (hit, agree, hit))
    if answers:
        say('Kennitölur í svarinu sem eru ekki á listanum: ' + ', '.join(answers))
    if odd:
        say('Niðurstaða ekki á forminu Samþykkja/Til skoðunar/Hafna — „Samræmi?“ verður Nei: ' + '; '.join(odd))


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == 'undirbua':
        undirbua()
    elif args[0] == 'flytja-ut':
        flytja_ut('--leyfa-drog' in args)
    elif args[0] == 'lesa-inn' and len(args) > 1:
        lesa_inn(args[1])
    else:
        sys.exit(__doc__)
