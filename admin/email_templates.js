/************************************************************
 * email_templates.js — Umsóknar-póstsniðmát (afrit úr core/email.js)
 * Uppruni: core/email.js í aðal-projectinu. Ef sniðmáti er breytt þar
 * þarf að spegla breytinguna hér (og öfugt).
 ************************************************************/

function emailEsc_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// â”€â”€ RafrÃ¦n InnskrÃ¡ning redirect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildRafraenRedirectHtml_(recipientName, companyName) {
  var name    = emailEsc_(recipientName || '');
  var company = emailEsc_(companyName  || '');
  var greeting = name ? 'GÃ³Ã°an dag ' + name : 'GÃ³Ã°an dag';
  var notFoundLine = company
    ? 'ViÃ° innslÃ¡tt fannst hins vegar <strong>' + company + '</strong> ekki Ã­ viÃ°skiptum hjÃ¡ StÃ³rkaup.'
    : 'ViÃ° innslÃ¡tt fannst hins vegar ekki fyrirtÃ¦ki sem er nÃº Ã¾egar Ã­ viÃ°skiptum hjÃ¡ StÃ³rkaup.';
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
    + '<img src="https://images.prismic.io/storkaup/agbVeKYofJOwHQ9Y_klavyio-storkauplogo.jpg" alt="StÃ³rkaup logo" style="height:64px;width:auto;vertical-align:middle;">'
    + '</div>'
    + '</div>'
    + '<div class="sk-body">'
    + '<p style="margin:0 0 12px;font-size:18px;font-weight:700;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Takk fyrir aÃ° skrÃ¡ upplÃ½singar fyrir innskrÃ¡ningu meÃ° rafrÃ¦num skilrÃ­kjum Ã­ vefverslun StÃ³rkaups.</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">' + notFoundLine + '</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">Til Ã¾ess aÃ° sÃ¦kja um viÃ°skipti Ã¾arf aÃ° fylla Ãºt Ã¾etta form:</p>'
    + '<a class="sk-btn" href="https://storkaup.typeform.com/umsoknvidskipti">SÃ¦kja um viÃ°skipti</a>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Ef Ã¾Ãº hefur spurningar, hafÃ°u samband viÃ° <a href="mailto:vefur@storkaup.is" style="color:#10069f;text-decoration:none;">vefur@storkaup.is</a></p>'
    + '</div>'
    + '<div class="sk-footer">'
    + '<p style="margin:0;font-size:11px;color:#888;">StÃ³rkaup ehf. | Vefverslun</p>'
    + '</div>'
    + '</div></body></html>';
}

function buildRafraenRedirectPlain_(recipientName, companyName) {
  var greeting = recipientName ? 'GÃ³Ã°an dag ' + recipientName : 'GÃ³Ã°an dag';
  var notFoundLine = companyName
    ? 'ViÃ° innslÃ¡tt fannst hins vegar ' + companyName + ' ekki Ã­ viÃ°skiptum hjÃ¡ StÃ³rkaup.'
    : 'ViÃ° innslÃ¡tt fannst hins vegar ekki fyrirtÃ¦ki sem er nÃº Ã¾egar Ã­ viÃ°skiptum hjÃ¡ StÃ³rkaup.';
  return greeting + '\n\n'
    + 'Takk fyrir aÃ° skrÃ¡ upplÃ½singar fyrir innskrÃ¡ningu meÃ° rafrÃ¦num skilrÃ­kjum Ã­ vefverslun StÃ³rkaups.\n\n'
    + notFoundLine + '\n\n'
    + 'Til Ã¾ess aÃ° sÃ¦kja um viÃ°skipti Ã¾arf aÃ° fylla Ãºt Ã¾etta form hÃ©r:\n'
    + 'https://storkaup.typeform.com/umsoknvidskipti\n\n'
    + 'KveÃ°ja,\nStÃ³rkaup';
}

// â”€â”€ RafrÃ¦n InnskrÃ¡ning â€” vantar persÃ³nulega kennitÃ¶lu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Applicant entered the company kennitala in BOTH the company field and the
// personal-kennitala field; we need their own kennitala to link them.
function buildRafraenNeedKtHtml_(recipientName) {
  var name = emailEsc_(recipientName || '');
  var greeting = name ? 'HallÃ³ ' + name + ',' : 'HallÃ³,';
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
    + '<img src="https://images.prismic.io/storkaup/agbVeKYofJOwHQ9Y_klavyio-storkauplogo.jpg" alt="StÃ³rkaup logo" style="height:64px;width:auto;vertical-align:middle;">'
    + '</div></div>'
    + '<div class="sk-body">'
    + '<p style="margin:0 0 12px;font-size:18px;font-weight:700;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">ViÃ° hÃ¶fum fengiÃ° beiÃ°ni Ã¾Ã­na um aÃ°gang Ã­ vefverslun StÃ³rkaups.</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">ViÃ° skrÃ¡ninguna virÃ°ist kennitala fyrirtÃ¦kisins hafa veriÃ° slegin inn bÃ¦Ã°i Ã­ reit fyrirtÃ¦kisins og Ã­ reitinn fyrir Ã¾Ã­na persÃ³nulegu kennitÃ¶lu. Til Ã¾ess aÃ° viÃ° getum klÃ¡raÃ° aÃ° tengja Ã¾ig viÃ° fyrirtÃ¦kiÃ° Ã¾urfum viÃ° Ã¾Ã­na eigin (persÃ³nulegu) kennitÃ¶lu.</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">Vinsamlegast sendu inn skrÃ¡ninguna aftur og settu persÃ³nulegu kennitÃ¶luna Ã¾Ã­na Ã­ rÃ©tta reitinn:</p>'
    + '<a class="sk-btn" href="https://storkaup.typeform.com/rafinnskraning">Senda inn skrÃ¡ningu aftur</a>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Ef Ã¾Ãº hefur spurningar, hafÃ°u samband viÃ° <a href="mailto:vefur@storkaup.is" style="color:#10069f;text-decoration:none;">vefur@storkaup.is</a></p>'
    + '</div>'
    + '<div class="sk-footer"><p style="margin:0;font-size:11px;color:#888;">StÃ³rkaup ehf. | Vefverslun</p></div>'
    + '</div></body></html>';
}

function buildRafraenNeedKtPlain_(recipientName) {
  var greeting = recipientName ? 'HallÃ³ ' + recipientName + ',' : 'HallÃ³,';
  return greeting + '\n\n'
    + 'ViÃ° hÃ¶fum fengiÃ° beiÃ°ni Ã¾Ã­na um aÃ°gang Ã­ vefverslun StÃ³rkaups.\n\n'
    + 'ViÃ° skrÃ¡ninguna virÃ°ist kennitala fyrirtÃ¦kisins hafa veriÃ° slegin inn bÃ¦Ã°i Ã­ reit fyrirtÃ¦kisins og Ã­ reitinn fyrir Ã¾Ã­na persÃ³nulegu kennitÃ¶lu. Til Ã¾ess aÃ° viÃ° getum klÃ¡raÃ° aÃ° tengja Ã¾ig viÃ° fyrirtÃ¦kiÃ° Ã¾urfum viÃ° Ã¾Ã­na eigin (persÃ³nulegu) kennitÃ¶lu.\n\n'
    + 'Vinsamlegast sendu inn skrÃ¡ninguna aftur og settu persÃ³nulegu kennitÃ¶luna Ã¾Ã­na Ã­ rÃ©tta reitinn:\n'
    + 'https://storkaup.typeform.com/rafinnskraning\n\n'
    + 'KveÃ°ja,\nStÃ³rkaup | Vefteymi';
}

// â”€â”€ UmsÃ³kn um viÃ°skipti â€” email templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    + '<img src="https://images.prismic.io/storkaup/agbVeKYofJOwHQ9Y_klavyio-storkauplogo.jpg" alt="StÃ³rkaup" style="height:64px;width:auto;">'
    + '</div></div>'
    + '<div class="sk-body">' + bodyHtml + '</div>'
    + '<div class="sk-footer"><p style="margin:0;font-size:11px;color:#888;">StÃ³rkaup ehf. | Vefverslun</p></div>'
    + '</div></body></html>';
}

// Template 1 â€” Einstaklingur ekki meÃ° VSK-nÃºmer
function buildUmsokn_NoVskHtml_(recipientName) {
  var greeting = emailEsc_(recipientName || '') ? 'KÃ¦ri/KÃ¦ra ' + emailEsc_(recipientName) : 'KÃ¦ri mÃ³ttakandi';
  return umsokn_wrap_(
    '<p style="margin:0 0 12px;font-size:15px;font-weight:600;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">ViÃ° vinnslu upplÃ½singa Ã¡ skrÃ¡ningu kom Ã­ ljÃ³s aÃ° kennitala Ã¡ umsÃ³kn er ekki Ã¡ fyrirtÃ¦kjaskrÃ¡ og Ã¾vÃ­ ekki meÃ° VSK-nÃºmer.</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">StÃ³rkaup ehf. selur einungis til fyrirtÃ¦kja, stofnana og einstaklinga Ã­ rekstri sem hafa VSK-nÃºmer. <strong>UmsÃ³kn um viÃ°skipti viÃ° StÃ³rkaup er Ã¾vÃ­ hafnaÃ°.</strong></p>'
    + '<p style="margin:0 0 0;line-height:1.6;">SÃ© um mistÃ¶k aÃ° rÃ¦Ã°a viÃ° innslÃ¡tt Ã¡ vefnum, biÃ°jum viÃ° Ã¾ig um aÃ° senda inn leiÃ°rÃ©tta skrÃ¡ningu Ã­ gegnum vefinn hjÃ¡ okkur.</p>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Bestu kveÃ°jur,<br>StÃ³rkaup ehf.</p>'
  );
}
function buildUmsokn_NoVskPlain_(recipientName) {
  var greeting = recipientName ? 'KÃ¦ri/KÃ¦ra ' + recipientName : 'KÃ¦ri mÃ³ttakandi';
  return greeting + '\n\n'
    + 'ViÃ° vinnslu upplÃ½singa Ã¡ skrÃ¡ningu kom Ã­ ljÃ³s aÃ° kennitala Ã¡ umsÃ³kn er ekki Ã¡ fyrirtÃ¦kjaskrÃ¡ og Ã¾vÃ­ ekki meÃ° VSK-nÃºmer.\n\n'
    + 'StÃ³rkaup ehf. selur einungis til fyrirtÃ¦kja, stofnana og einstaklinga Ã­ rekstri sem hafa VSK-nÃºmer. UmsÃ³kn um viÃ°skipti viÃ° StÃ³rkaup er Ã¾vÃ­ hafnaÃ°.\n\n'
    + 'SÃ© um mistÃ¶k aÃ° rÃ¦Ã°a viÃ° innslÃ¡tt Ã¡ vefnum, biÃ°jum viÃ° Ã¾ig um aÃ° senda inn leiÃ°rÃ©tta skrÃ¡ningu Ã­ gegnum vefinn hjÃ¡ okkur.\n\n'
    + 'Bestu kveÃ°jur,\nStÃ³rkaup ehf.';
}

// Template 2 â€” Ãžarf lÃ¡nshÃ¦fismat (einstaklingur Ã­ rekstri)
function buildUmsokn_NeedsCreditHtml_(recipientName) {
  var greeting = emailEsc_(recipientName || '') ? 'KÃ¦ri/KÃ¦ra ' + emailEsc_(recipientName) : 'KÃ¦ri mÃ³ttakandi';
  return umsokn_wrap_(
    '<p style="margin:0 0 12px;font-size:15px;font-weight:600;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Takk fyrir skrÃ¡ninguna hjÃ¡ StÃ³rkaup. Ãžar sem Ã¾Ãº ert einstaklingur Ã­ rekstri Ã¡ eigin kennitÃ¶lu hÃ¶fum viÃ° ekki aÃ°gang aÃ° lÃ¡nshÃ¦fismati Creditinfo.</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Til aÃ° geta fullunniÃ° umsÃ³knina Ã¾arft Ã¾Ãº aÃ° fara inn Ã¡ <a href="https://www.creditinfo.is" style="color:#10069f;">creditinfo.is</a>, sÃ¦kja lÃ¡nshÃ¦fismat Ã¾itt og senda Ã¡ <a href="mailto:bokhald@storkaup.is" style="color:#10069f;">bokhald@storkaup.is</a>. Ã framhaldinu er hÃ¦gt aÃ° ljÃºka viÃ° skrÃ¡ninguna.</p>'
    + '<p style="margin:0 0 0;line-height:1.6;color:#555;font-size:13px;">MikilvÃ¦gt: nafn umsÃ¦kjanda Ã¾arf aÃ° koma fram Ã¡ lÃ¡nshÃ¦fismatinu â€” skjÃ¡skot af skori nÃ¦gir ekki ef nafniÃ° er ekki sÃ½nilegt.</p>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Bestu kveÃ°jur,<br>StÃ³rkaup ehf.</p>'
  );
}
function buildUmsokn_NeedsCreditPlain_(recipientName) {
  var greeting = recipientName ? 'KÃ¦ri/KÃ¦ra ' + recipientName : 'KÃ¦ri mÃ³ttakandi';
  return greeting + '\n\n'
    + 'Takk fyrir skrÃ¡ninguna hjÃ¡ StÃ³rkaup. Ãžar sem Ã¾Ãº ert einstaklingur Ã­ rekstri Ã¡ eigin kennitÃ¶lu hÃ¶fum viÃ° ekki aÃ°gang aÃ° lÃ¡nshÃ¦fismati Creditinfo.\n\n'
    + 'Til aÃ° geta fullunniÃ° umsÃ³knina Ã¾arft Ã¾Ãº aÃ° fara inn Ã¡ https://www.creditinfo.is og sÃ¦kja lÃ¡nshÃ¦fismat Ã¾itt og senda Ã¡ bokhald@storkaup.is. Ã framhaldinu er hÃ¦gt aÃ° ljÃºka viÃ° skrÃ¡ninguna.\n\n'
    + 'MikilvÃ¦gt: nafn umsÃ¦kjanda Ã¾arf aÃ° koma fram Ã¡ lÃ¡nshÃ¦fismatinu â€” skjÃ¡skot af skori nÃ¦gir ekki ef nafniÃ° er ekki sÃ½nilegt.\n\n'
    + 'Bestu kveÃ°jur,\nStÃ³rkaup ehf.';
}

// Template 3 â€” LÃ¡nshÃ¦fismat uppfyllir ekki skilyrÃ°i (staÃ°greiÃ°sla)
function buildUmsokn_CashOnlyHtml_(recipientName) {
  var greeting = emailEsc_(recipientName || '') ? 'KÃ¦ri/KÃ¦ra ' + emailEsc_(recipientName) : 'KÃ¦ri mÃ³ttakandi';
  return umsokn_wrap_(
    '<p style="margin:0 0 12px;font-size:15px;font-weight:600;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">ViÃ° Ã¾Ã¶kkum fyrir umsÃ³kn um viÃ°skipti hjÃ¡ StÃ³rkaup. ViÃ° hÃ¶fum sÃ³tt lÃ¡nshÃ¦fismat frÃ¡ Creditinfo og Ã­ ljÃ³si niÃ°urstÃ¶Ã°u Ã¾ess getum viÃ° Ã¾vÃ­ miÃ°ur ekki opnaÃ° Ã¡ reikningsviÃ°skipti eins og Ã³skaÃ° var eftir.</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">HÃ¦gt er aÃ° notast viÃ° staÃ°greiÃ°sluferli Ã­ gegnum vefverslunina Ã¾ar sem hÃ¦gt er aÃ° greiÃ°a meÃ° korti Ã¾egar gengiÃ° er frÃ¡ kaupum.</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">AÃ°gangur Ã¾inn er virkur og getur Ã¾Ãº skrÃ¡Ã° Ã¾ig inn Ã¡ vef StÃ³rkaups meÃ° rafrÃ¦nni auÃ°kenningu.</p>'
    + '<a class="sk-btn" href="https://storkaup.is" style="display:inline-block;margin-top:10px;">Fara Ã­ vefverslun</a>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0 0 12px;color:#666;font-size:13px;line-height:1.6;">Ekki hika viÃ° aÃ° vera Ã­ sambandi viÃ° SÃ¶lu- og Ã¾jÃ³nustuver StÃ³rkaups Ã­ sÃ­ma <strong>515-1500</strong> eÃ°a meÃ° Ã¾vÃ­ aÃ° senda pÃ³st Ã¡ <a href="mailto:sala@storkaup.is" style="color:#10069f;">sala@storkaup.is</a></p>'
    + '<p style="margin:0;color:#666;font-size:13px;">Bestu kveÃ°jur,<br>StÃ³rkaup ehf.</p>'
  );
}
function buildUmsokn_CashOnlyPlain_(recipientName) {
  var greeting = recipientName ? 'KÃ¦ri/KÃ¦ra ' + recipientName : 'KÃ¦ri mÃ³ttakandi';
  return greeting + '\n\n'
    + 'ViÃ° Ã¾Ã¶kkum fyrir umsÃ³kn um viÃ°skipti hjÃ¡ StÃ³rkaup. ViÃ° hÃ¶fum sÃ³tt lÃ¡nshÃ¦fismat frÃ¡ Creditinfo og Ã­ ljÃ³si niÃ°urstÃ¶Ã°u Ã¾ess getum viÃ° Ã¾vÃ­ miÃ°ur ekki opnaÃ° Ã¡ reikningsviÃ°skipti eins og Ã³skaÃ° var eftir.\n\n'
    + 'HÃ¦gt er aÃ° notast viÃ° staÃ°greiÃ°sluferli Ã­ gegnum vefverslunina Ã¾ar sem hÃ¦gt er aÃ° greiÃ°a meÃ° korti Ã¾egar gengiÃ° er frÃ¡ kaupum.\n\n'
    + 'AÃ°gangur Ã¾inn er virkur og getur Ã¾Ãº skrÃ¡Ã° Ã¾ig inn Ã¡ vef StÃ³rkaups meÃ° rafrÃ¦nni auÃ°kenningu.\n\nhttps://storkaup.is\n\n'
    + 'Ekki hika viÃ° aÃ° vera Ã­ sambandi viÃ° SÃ¶lu- og Ã¾jÃ³nustuver StÃ³rkaups Ã­ sÃ­ma 515-1500 eÃ°a meÃ° Ã¾vÃ­ aÃ° senda pÃ³st Ã¡ sala@storkaup.is\n\n'
    + 'Bestu kveÃ°jur,\nStÃ³rkaup ehf.';
}
