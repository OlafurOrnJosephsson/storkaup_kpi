/************************************************************
 * STORKAUP KPI CORE — PUBLIC API TEST SUITE
 ************************************************************/

function test_search_basic() {
  // Fyrst: athuga hvort gögn eru til staðar
  const rows = loadTableBySchema_('CUSTOMERS');
  Logger.log("📊 CUSTOMERS rows count: " + rows.length);
  
  if (rows.length > 0) {
    Logger.log("📊 First customer: " + JSON.stringify(rows[0], null, 2));
    Logger.log("📊 Sample company names:");
    rows.slice(0, 10).forEach((r, i) => {
      Logger.log(i + ": " + r.COMPANY_NAME);
    });
  }

  // Síðan: Leita
  Logger.log("\n🔍 SEARCHING for: 'gullnesti'");
  const res = searchCustomers("gullnesti", true);
  Logger.log("🔍 Results: " + JSON.stringify(res, null, 2));
}

function test_profile_online() {
  const res = Core.buildShoppingList("6509140740", "online");
  Logger.log("LIST BUILT: " + res);
}

function test_fuzzy() {
  const score = Core.similarityPublic("storkaup", "stórkaup");
  Logger.log("Score: " + score);
}

function test_resolver() {
  const match = Core.resolveCompanyPublic("", "Hlemmavideo ehf", "", "");
  Logger.log(JSON.stringify(match, null, 2));
}

function test_table() {
  const rows = loadTableBySchema_('CUSTOMERS');
  Logger.log("✅ Loaded CUSTOMERS rows: " + rows.length);
  if (rows.length > 0) {
    Logger.log("✅ First row keys: " + Object.keys(rows[0]));
    Logger.log("✅ First row: " + JSON.stringify(rows[0], null, 2));
  }
}

function test_normalize() {
  const queries = ["vigd", "Vígðir", "VIGD", "vigur"];
  Logger.log("\n🔤 NORMALIZE TEST:");
  queries.forEach(q => {
    const norm = normalizeNameAdvanced_(q);
    Logger.log("  '" + q + "' → '" + norm + "'");
  });
}

function test_search_debug() {
  Logger.log("\n🔍 FULL DEBUG SEARCH TEST:");
  
  const query = "gullnesti";
  const cfg = loadConfig_();
  
  // Manual step-by-step
  const qRaw = String(query);
  const q = normalizeNameAdvanced_(qRaw);
  
  Logger.log("1. Query normalized: '" + q + "'");
  
  // Load rows
  const rows = loadTableBySchema_('CUSTOMERS');
  Logger.log("2. Loaded " + rows.length + " customer rows");
  
  // Look for vigdísarholt
  const vigdRow = rows.find(r => (r.COMPANY_NAME || "").includes("Vigdísarholt"));
  if (vigdRow) {
    Logger.log("3. Found Vigdísarholt row!");
    Logger.log("   - COMPANY_NAME: " + vigdRow.COMPANY_NAME);
    Logger.log("   - COMPANY_ID: " + vigdRow.COMPANY_ID);
    
    // Test normalization
    const nameNorm = normalizeNameAdvanced_(vigdRow.COMPANY_NAME);
    Logger.log("4. Normalized: '" + nameNorm + "'");
    
    // Test startsWith
    Logger.log("5. nameNorm.startsWith('vigd'): " + nameNorm.startsWith("vigd"));
    
    // Test substring
    if (nameNorm.length > q.length) {
      const prefix = nameNorm.substring(0, q.length + 2);
      Logger.log("6. Prefix: '" + prefix + "'");
      const prefixSim = stringSimilarity_(prefix, q);
      Logger.log("7. Prefix similarity: " + prefixSim.toFixed(3));
    }
  } else {
    Logger.log("3. ❌ Vigdísarholt NOT FOUND!");
    Logger.log("   Looking through all names for 'vigdi':");
    rows.slice(0, 100).forEach(r => {
      if ((r.COMPANY_NAME || "").toLowerCase().includes("vigdi")) {
        Logger.log("   - " + r.COMPANY_NAME);
      }
    });
  }
  
  // Now call the real search
  Logger.log("\n8. Calling searchCustomers('vigd')...");
  const res = searchCustomers(query, true);
  Logger.log("9. Results: " + JSON.stringify(res, null, 2));
}

