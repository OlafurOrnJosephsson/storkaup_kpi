/************************************************************
 * SEARCH CONFIG (V3.5 Enterprise)
 ************************************************************/
const SEARCH_DEBUG = false;            // settu false í production
const SEARCH_FUZZY_THRESHOLD = 0.45;  // 0–1 (lægra = víðari leit) — LOWERED MORE for prefix matching

function searchCustomersV3_(query, cfg) {
  if (!query) return [];
  const qRaw = String(query);
  const q = normalizeNameAdvanced_(qRaw);
  const F = STORKAUP_SCHEMA.CUSTOMERS;

  logSearch_("[SEARCH] INPUT:", qRaw);
  logSearch_("[SEARCH] NORMALIZED INPUT:", q);

  // Load customer rows + resolver (merge Magento + BC so BC-only customers are searchable)
  const resolver = buildCompanyResolver_(cfg);
  const rows = [];
  const seen = new Set();

  const getCompanyId_ = r => String(r.COMPANY_ID || r[F.COMPANY_ID] || '');
  const getCompanyName_ = r => r.COMPANY_NAME || r[F.COMPANY_NAME] || '';
  const getPersonName_ = r => r.NAME || r[F.NAME] || '';
  const getEmail_ = r => (r.REAL_EMAIL || r[F.REAL_EMAIL] || r.EMAIL || r[F.EMAIL] || '').toLowerCase();

  function addRow_(r) {
    const id = getCompanyId_(r).trim();
    const nameKey = getCompanyName_(r).toLowerCase().trim();
    const dedupeKey = id || nameKey || JSON.stringify(r);
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    rows.push(r);
  }

  const magentoRows = loadTableCached_('CUSTOMERS') || [];
  magentoRows.forEach(addRow_);

  Object.values(resolver.bcMapById || {}).forEach(entry => {
    const name = entry.companyName || '';
    const id = entry.companyId || '';
    const realEmail = entry.realEmail || '';

    const synthetic = {};
    synthetic.ID = 'BC:' + (id || name);
    synthetic.NAME = '';
    synthetic.EMAIL = realEmail;
    synthetic.REAL_EMAIL = realEmail;
    synthetic.COMPANY_NAME = name;
    synthetic.COMPANY_ID = id;
    synthetic.REGION = entry.region || '';
    synthetic.UPDATED = '';
    // Also set header-name aliases for compatibility
    synthetic[F.ID] = synthetic.ID;
    synthetic[F.NAME] = synthetic.NAME;
    synthetic[F.EMAIL] = synthetic.EMAIL;
    synthetic[F.REAL_EMAIL] = synthetic.REAL_EMAIL;
    synthetic[F.COMPANY_NAME] = synthetic.COMPANY_NAME;
    synthetic[F.COMPANY_ID] = synthetic.COMPANY_ID;
    synthetic[F.REGION] = synthetic.REGION;
    synthetic[F.UPDATED] = synthetic.UPDATED;
    addRow_(synthetic);
  });

  const scored = [];

  rows.forEach((r) => {
    const companyName = getCompanyName_(r) || "";
    const personName  = getPersonName_(r) || "";
    const email       = getEmail_(r) || "";
    const companyId   = getCompanyId_(r) || "";

    // normalized
    const nameNorm   = normalizeNameAdvanced_(companyName);
    const personNorm = normalizeNameAdvanced_(personName);

    let score = 0;
    const breakdown = {};

    // ---- Direct matches ----
    if (nameNorm.includes(q))  { score += 600; breakdown.name = 600; }
    if (personNorm.includes(q)) { score += 400; breakdown.person = 400; }
    if (email.includes(q)) { score += 300; breakdown.email = 300; }
    if (companyId.includes(qRaw)) { score += 800; breakdown.companyId = 800; }

    // Extra: first-letter match -> bonus
    if (nameNorm.startsWith(q)) {
      score += 200;
      breakdown.nameStart = 200;
      logSearch_("  DIRECT START MATCH: '" + companyName + "' (norm='" + nameNorm + "')");
    }

    // ---- Token-based matching (if query matches word start) ----
    const tokens = nameNorm.split(/\s+/);
    tokens.forEach(token => {
      if (token.startsWith(q)) {
        score += 250;
        breakdown.tokenStart = (breakdown.tokenStart || 0) + 250;
        logSearch_("  TOKEN START MATCH: '" + companyName + "' token='" + token + "'");
      }
    });

    // ---- Prefix fuzzy matching (for "vigd" -> "vigdisarholt") ----
    if (nameNorm.length > q.length) {
      const prefix = nameNorm.substring(0, q.length + 2); // allow 2 extra chars
      const prefixSimilarity = stringSimilarity_(prefix, q);
      logSearch_("  DEBUG: company='" + companyName + "', prefix='" + prefix + "', prefixSim=" + prefixSimilarity.toFixed(3));
      if (prefixSimilarity > 0.65) {
        const bonus = Math.floor(prefixSimilarity * 350);
        score += bonus;
        breakdown.prefixFuzzy = bonus;
        logSearch_("  PREFIX MATCH: '" + companyName + "' (prefix='" + prefix + "', score=" + prefixSimilarity.toFixed(3) + ")");
      }
    }

    // ---- Add full fuzzy score (utils) ----
    const fuzzyScore = stringSimilarity_(nameNorm, q);
    if (fuzzyScore > SEARCH_FUZZY_THRESHOLD) {
      const bonus = Math.floor(fuzzyScore * 500);
      score += bonus;
      breakdown.fuzzy = bonus;
      logSearch_("  FUZZY MATCH: '" + companyName + "' (score=" + fuzzyScore.toFixed(3) + ")");
    }

    if (score > 0) {
      scored.push({ row: r, score, breakdown });
      logSearch_("  SCORED: '" + companyName + "' = " + score + " points");
    }
  });

  // ---- Phase 2: Resolver fuzzy match (from utils) ----
  const resolverHit = fuzzyCompanyLookupByName_(resolver, qRaw, SEARCH_FUZZY_THRESHOLD);
  if (resolverHit && resolverHit.companyId) {
    const matchRow = rows.find(r => getCompanyId_(r) === String(resolverHit.companyId));
    if (matchRow) {
      scored.push({
        row: matchRow,
        score: 1000,
        breakdown: { resolverBoost: 1000 }
      });
    }
  }

  // ---- Sort by score ----
  scored.sort((a, b) => b.score - a.score);

  // Debug output
  logSearch_("[SEARCH] SCORED RESULTS:", scored.map(item => ({
    company: getCompanyName_(item.row),
    score: item.score,
    breakdown: item.breakdown
  })));

  // ---- Online/offline detection ----
  const web = loadTableCached_('NEWWEB');
  const bc  = loadTableCached_('BC_LINES');

  const results = scored.map(o => {
    const r = o.row;
    const id = getCompanyId_(r);
    const emailOut = r.REAL_EMAIL || r[F.REAL_EMAIL] || r.EMAIL || r[F.EMAIL] || "";

    const hasWeb = web.some(w => String(w[STORKAUP_SCHEMA.NEWWEB.COMPANY_ID]) === String(id));
    const hasBC  = bc.some(b => String(b[STORKAUP_SCHEMA.BC_LINES.COLUMNS.COMPANY_ID]) === String(id));

    return {
      id,
      name: getCompanyName_(r),
      email: emailOut,
      mode: hasWeb ? "online" : (hasBC ? "offline" : "auto"),
      score: o.score,
      breakdown: o.breakdown
    };
  });

  logSearch_("[SEARCH] FINAL RESULTS:", results);

  return results;
}

function public_searchCustomersV3(query, cfg) {
  return searchCustomersV3_(query, cfg);
}
function logSearch_(msg, obj) {
  if (!SEARCH_DEBUG) return;
  if (obj !== undefined) {
    Logger.log(msg + " " + JSON.stringify(obj, null, 2));
  } else {
    Logger.log(msg);
  }
}
