/************************************************************
 * email_templates.js  Ums�knar-p�stsni�m�t (afrit �r core/email.js)
 * Uppruni: core/email.js � a�al-projectinu. Ef sni�m�ti er breytt �ar
 * �arf a� spegla breytinguna h�r (og �fugt).
 ************************************************************/

function emailEsc_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ���� Rafræn Innskráning redirect ����������������������������������������������������������������������������������������������

function buildRafraenRedirectHtml_(recipientName, companyName) {
  var name    = emailEsc_(recipientName || '');
  var company = emailEsc_(companyName  || '');
  var greeting = name ? 'Góðan dag ' + name : 'Góðan dag';
  var notFoundLine = company
    ? 'Við innslátt fannst hins vegar <strong>' + company + '</strong> ekki í viðskiptum hjá Stórkaup.'
    : 'Við innslátt fannst hins vegar ekki fyrirtæki sem er nú þegar í viðskiptum hjá Stórkaup.';
  var CSS = '<style>'
    + '.sk-email{max-width:600px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#282828}'
    + '.sk-header{background:#fff;border:1px solid #e9e9e9;border-bottom:none;padding:28px 32px;border-radius:8px 8px 0 0}'
    + '.sk-body{background:#fff;border:1px solid #e9e9e9;border-top:none;padding:28px 32px}'
    + '.sk-footer{background:#f5f5f5;border:1px solid #e9e9e9;border-top:none;padding:16px 32px;border-radius:0 0 8px 8px}'
    + '.sk-divider{border:none;border-top:1px solid #e9e9e9;margin:24px 0}'
    + '.sk-btn{display:inline-block;background:#10069f;color:#fff!important;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none}'
    + '</style>';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' + CSS + '</head><body>'
    + '<div class="sk-email">'
    + '<div class="sk-header">'
    + '<div style="display:flex;align-items:center;">'
    + '<img src="https://images.prismic.io/storkaup/agbVeKYofJOwHQ9Y_klavyio-storkauplogo.jpg" alt="Stórkaup logo" style="height:64px;width:auto;vertical-align:middle;">'
    + '</div>'
    + '</div>'
    + '<div class="sk-body">'
    + '<p style="margin:0 0 12px;font-size:18px;font-weight:700;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Takk fyrir að skrá upplýsingar fyrir innskráningu með rafrænum skilríkjum í vefverslun Stórkaups.</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">' + notFoundLine + '</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">Til þess að sækja um viðskipti þarf að fylla út þetta form:</p>'
    + '<a class="sk-btn" href="https://storkaup.typeform.com/umsoknvidskipti">Sækja um viðskipti</a>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Ef þú hefur spurningar, hafðu samband við <a href="mailto:vefur@storkaup.is" style="color:#10069f;text-decoration:none;">vefur@storkaup.is</a></p>'
    + '</div>'
    + '<div class="sk-footer">'
    + '<p style="margin:0;font-size:11px;color:#888;">Stórkaup ehf. | Vefverslun</p>'
    + '</div>'
    + '</div></body></html>';
}

function buildRafraenRedirectPlain_(recipientName, companyName) {
  var greeting = recipientName ? 'Góðan dag ' + recipientName : 'Góðan dag';
  var notFoundLine = companyName
    ? 'Við innslátt fannst hins vegar ' + companyName + ' ekki í viðskiptum hjá Stórkaup.'
    : 'Við innslátt fannst hins vegar ekki fyrirtæki sem er nú þegar í viðskiptum hjá Stórkaup.';
  return greeting + '\n\n'
    + 'Takk fyrir að skrá upplýsingar fyrir innskráningu með rafrænum skilríkjum í vefverslun Stórkaups.\n\n'
    + notFoundLine + '\n\n'
    + 'Til þess að sækja um viðskipti þarf að fylla út þetta form hér:\n'
    + 'https://storkaup.typeform.com/umsoknvidskipti\n\n'
    + 'Kveðja,\nStórkaup';
}

// ���� Rafræn Innskráning � vantar persónulega kennitölu ��������������������������������������������������
// Applicant entered the company kennitala in BOTH the company field and the
// personal-kennitala field; we need their own kennitala to link them.
function buildRafraenNeedKtHtml_(recipientName) {
  var name = emailEsc_(recipientName || '');
  var greeting = name ? 'Halló ' + name + ',' : 'Halló,';
  var CSS = '<style>'
    + '.sk-email{max-width:600px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#282828}'
    + '.sk-header{background:#fff;border:1px solid #e9e9e9;border-bottom:none;padding:28px 32px;border-radius:8px 8px 0 0}'
    + '.sk-body{background:#fff;border:1px solid #e9e9e9;border-top:none;padding:28px 32px}'
    + '.sk-footer{background:#f5f5f5;border:1px solid #e9e9e9;border-top:none;padding:16px 32px;border-radius:0 0 8px 8px}'
    + '.sk-divider{border:none;border-top:1px solid #e9e9e9;margin:24px 0}'
    + '.sk-btn{display:inline-block;background:#10069f;color:#fff!important;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none}'
    + '</style>';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' + CSS + '</head><body>'
    + '<div class="sk-email">'
    + '<div class="sk-header"><div style="display:flex;align-items:center;">'
    + '<img src="https://images.prismic.io/storkaup/agbVeKYofJOwHQ9Y_klavyio-storkauplogo.jpg" alt="Stórkaup logo" style="height:64px;width:auto;vertical-align:middle;">'
    + '</div></div>'
    + '<div class="sk-body">'
    + '<p style="margin:0 0 12px;font-size:18px;font-weight:700;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Við höfum fengið beiðni þína um aðgang í vefverslun Stórkaups.</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Við skráninguna virðist kennitala fyrirtækisins hafa verið slegin inn bæði í reit fyrirtækisins og í reitinn fyrir þína persónulegu kennitölu. Til þess að við getum klárað að tengja þig við fyrirtækið þurfum við þína eigin (persónulegu) kennitölu.</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">Vinsamlegast sendu inn skráninguna aftur og settu persónulegu kennitöluna þína í rétta reitinn:</p>'
    + '<a class="sk-btn" href="https://storkaup.typeform.com/rafinnskraning">Senda inn skráningu aftur</a>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Ef þú hefur spurningar, hafðu samband við <a href="mailto:vefur@storkaup.is" style="color:#10069f;text-decoration:none;">vefur@storkaup.is</a></p>'
    + '</div>'
    + '<div class="sk-footer"><p style="margin:0;font-size:11px;color:#888;">Stórkaup ehf. | Vefverslun</p></div>'
    + '</div></body></html>';
}

function buildRafraenNeedKtPlain_(recipientName) {
  var greeting = recipientName ? 'Halló ' + recipientName + ',' : 'Halló,';
  return greeting + '\n\n'
    + 'Við höfum fengið beiðni þína um aðgang í vefverslun Stórkaups.\n\n'
    + 'Við skráninguna virðist kennitala fyrirtækisins hafa verið slegin inn bæði í reit fyrirtækisins og í reitinn fyrir þína persónulegu kennitölu. Til þess að við getum klárað að tengja þig við fyrirtækið þurfum við þína eigin (persónulegu) kennitölu.\n\n'
    + 'Vinsamlegast sendu inn skráninguna aftur og settu persónulegu kennitöluna þína í rétta reitinn:\n'
    + 'https://storkaup.typeform.com/rafinnskraning\n\n'
    + 'Kveðja,\nStórkaup | Vefteymi';
}

// ���� Umsókn um viðskipti � email templates ������������������������������������������������������������������������

function umsokn_CSS_() {
  return '<style>'
    + '.sk-email{max-width:600px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#282828}'
    + '.sk-header{background:#fff;border:1px solid #e9e9e9;border-bottom:none;padding:28px 32px;border-radius:8px 8px 0 0}'
    + '.sk-body{background:#fff;border:1px solid #e9e9e9;border-top:none;padding:28px 32px}'
    + '.sk-footer{background:#f5f5f5;border:1px solid #e9e9e9;border-top:none;padding:16px 32px;border-radius:0 0 8px 8px}'
    + '.sk-divider{border:none;border-top:1px solid #e9e9e9;margin:24px 0}'
    + '.sk-btn{display:inline-block;background:#10069f;color:#fff!important;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none}'
    + '</style>';
}

function umsokn_wrap_(bodyHtml) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' + umsokn_CSS_() + '</head><body>'
    + '<div class="sk-email">'
    + '<div class="sk-header"><div style="display:flex;align-items:center;">'
    + '<img src="https://images.prismic.io/storkaup/agbVeKYofJOwHQ9Y_klavyio-storkauplogo.jpg" alt="Stórkaup" style="height:64px;width:auto;">'
    + '</div></div>'
    + '<div class="sk-body">' + bodyHtml + '</div>'
    + '<div class="sk-footer"><p style="margin:0;font-size:11px;color:#888;">Stórkaup ehf. | Vefverslun</p></div>'
    + '</div></body></html>';
}

// Template 1 � Einstaklingur ekki með VSK-númer
function buildUmsokn_NoVskHtml_(recipientName) {
  var greeting = emailEsc_(recipientName || '') ? 'Kæri/Kæra ' + emailEsc_(recipientName) : 'Kæri móttakandi';
  return umsokn_wrap_(
    '<p style="margin:0 0 12px;font-size:15px;font-weight:600;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Við vinnslu upplýsinga á skráningu kom í ljós að kennitala á umsókn er ekki á fyrirtækjaskrá og því ekki með VSK-númer.</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Stórkaup ehf. selur einungis til fyrirtækja, stofnana og einstaklinga í rekstri sem hafa VSK-númer. <strong>Umsókn um viðskipti við Stórkaup er því hafnað.</strong></p>'
    + '<p style="margin:0 0 0;line-height:1.6;">Sé um mistök að ræða við innslátt á vefnum, biðjum við þig um að senda inn leiðrétta skráningu í gegnum vefinn hjá okkur.</p>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Bestu kveðjur,<br>Stórkaup ehf.</p>'
  );
}
function buildUmsokn_NoVskPlain_(recipientName) {
  var greeting = recipientName ? 'Kæri/Kæra ' + recipientName : 'Kæri móttakandi';
  return greeting + '\n\n'
    + 'Við vinnslu upplýsinga á skráningu kom í ljós að kennitala á umsókn er ekki á fyrirtækjaskrá og því ekki með VSK-númer.\n\n'
    + 'Stórkaup ehf. selur einungis til fyrirtækja, stofnana og einstaklinga í rekstri sem hafa VSK-númer. Umsókn um viðskipti við Stórkaup er því hafnað.\n\n'
    + 'Sé um mistök að ræða við innslátt á vefnum, biðjum við þig um að senda inn leiðrétta skráningu í gegnum vefinn hjá okkur.\n\n'
    + 'Bestu kveðjur,\nStórkaup ehf.';
}

// Template 2 � �~arf lánshæfismat (einstaklingur í rekstri)
function buildUmsokn_NeedsCreditHtml_(recipientName) {
  var greeting = emailEsc_(recipientName || '') ? 'Kæri/Kæra ' + emailEsc_(recipientName) : 'Kæri móttakandi';
  return umsokn_wrap_(
    '<p style="margin:0 0 12px;font-size:15px;font-weight:600;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Takk fyrir skráninguna hjá Stórkaup. �~ar sem þú ert einstaklingur í rekstri á eigin kennitölu höfum við ekki aðgang að lánshæfismati Creditinfo.</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Til að geta fullunnið umsóknina þarft þú að fara inn á <a href="https://www.creditinfo.is" style="color:#10069f;">creditinfo.is</a>, sækja lánshæfismat þitt og senda á <a href="mailto:bokhald@storkaup.is" style="color:#10069f;">bokhald@storkaup.is</a>. Í framhaldinu er hægt að ljúka við skráninguna.</p>'
    + '<p style="margin:0 0 0;line-height:1.6;color:#555;font-size:13px;">Mikilvægt: nafn umsækjanda þarf að koma fram á lánshæfismatinu � skjáskot af skori nægir ekki ef nafnið er ekki sýnilegt.</p>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Bestu kveðjur,<br>Stórkaup ehf.</p>'
  );
}
function buildUmsokn_NeedsCreditPlain_(recipientName) {
  var greeting = recipientName ? 'Kæri/Kæra ' + recipientName : 'Kæri móttakandi';
  return greeting + '\n\n'
    + 'Takk fyrir skráninguna hjá Stórkaup. �~ar sem þú ert einstaklingur í rekstri á eigin kennitölu höfum við ekki aðgang að lánshæfismati Creditinfo.\n\n'
    + 'Til að geta fullunnið umsóknina þarft þú að fara inn á https://www.creditinfo.is og sækja lánshæfismat þitt og senda á bokhald@storkaup.is. Í framhaldinu er hægt að ljúka við skráninguna.\n\n'
    + 'Mikilvægt: nafn umsækjanda þarf að koma fram á lánshæfismatinu � skjáskot af skori nægir ekki ef nafnið er ekki sýnilegt.\n\n'
    + 'Bestu kveðjur,\nStórkaup ehf.';
}

// Template 3 � Lánshæfismat uppfyllir ekki skilyrði (staðgreiðsla)
function buildUmsokn_CashOnlyHtml_(recipientName) {
  var greeting = emailEsc_(recipientName || '') ? 'Kæri/Kæra ' + emailEsc_(recipientName) : 'Kæri móttakandi';
  return umsokn_wrap_(
    '<p style="margin:0 0 12px;font-size:15px;font-weight:600;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Við þökkum fyrir umsókn um viðskipti hjá Stórkaup. Við höfum sótt lánshæfismat frá Creditinfo og í ljósi niðurstöðu þess getum við því miður ekki opnað á reikningsviðskipti eins og óskað var eftir.</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">Hægt er að notast við staðgreiðsluferli í gegnum vefverslunina þar sem hægt er að greiða með korti þegar gengið er frá kaupum.</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">Aðgangur þinn er virkur og getur þú skráð þig inn á vef Stórkaups með rafrænni auðkenningu.</p>'
    + '<a class="sk-btn" href="https://storkaup.is" style="display:inline-block;margin-top:10px;">Fara í vefverslun</a>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0 0 12px;color:#666;font-size:13px;line-height:1.6;">Ekki hika við að vera í sambandi við Sölu- og þjónustuver Stórkaups í síma <strong>515-1500</strong> eða með því að senda póst á <a href="mailto:sala@storkaup.is" style="color:#10069f;">sala@storkaup.is</a></p>'
    + '<p style="margin:0;color:#666;font-size:13px;">Bestu kveðjur,<br>Stórkaup ehf.</p>'
  );
}
function buildUmsokn_CashOnlyPlain_(recipientName) {
  var greeting = recipientName ? 'Kæri/Kæra ' + recipientName : 'Kæri móttakandi';
  return greeting + '\n\n'
    + 'Við þökkum fyrir umsókn um viðskipti hjá Stórkaup. Við höfum sótt lánshæfismat frá Creditinfo og í ljósi niðurstöðu þess getum við því miður ekki opnað á reikningsviðskipti eins og óskað var eftir.\n\n'
    + 'Hægt er að notast við staðgreiðsluferli í gegnum vefverslunina þar sem hægt er að greiða með korti þegar gengið er frá kaupum.\n\n'
    + 'Aðgangur þinn er virkur og getur þú skráð þig inn á vef Stórkaups með rafrænni auðkenningu.\n\nhttps://storkaup.is\n\n'
    + 'Ekki hika við að vera í sambandi við Sölu- og þjónustuver Stórkaups í síma 515-1500 eða með því að senda póst á sala@storkaup.is\n\n'
    + 'Bestu kveðjur,\nStórkaup ehf.';
}
