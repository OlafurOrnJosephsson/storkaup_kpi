/************************************************************
 * STORKAUP_SCHEMA - central header mapping (v1)
 ************************************************************/
const STORKAUP_SCHEMA = {
/**********************
 * NEWWEB (Magento)
 **********************/
NEWWEB: {
  FILE: 'WEBSALES', // visar i CONFIG.SHEETS.WEBSALES
  PK: 'ID',
  SHEET: 'NEWWEB',
  ID: 'ID',
  DATE: 'Purchase Date',
  CUSTOMER_NAME: 'Customer Name',
  COMPANY_NAME: 'Company Name',
  COMPANY_ID: 'Company ID',
  REAL_EMAIL: 'Real Email',
  REGION: 'Region',
  NATIONAL_ID: 'National ID',
  SUBTOTAL_EXCL: 'Subtotal (Excl Tax)',
  SUBTOTAL_INCL: 'Subtotal (Incl Tax)',
  TAX: 'Tax Amount',
  GRAND_TOTAL: 'Grand Total (Purchased)',
  SKU: 'SKU',
  SKU_NORMALIZED: 'SKU (Normalized)',
  PRODUCT_NAME: 'Product Name',
  QTY: 'Qty',
  STATUS: 'Status'
},

/**********************
 * OLDWEB (legacy Magento 1 export)
 **********************/
OLDWEB: {
  FILE: 'OLDWEB',
  PK: 'ID',
  SHEET: 'OLDWEB',
  ID: 'ID',
  DATE: 'Purchase Date',

  CUSTOMER_NAME: 'Customer Name',
  BILL_TO: 'Bill-to Name',
  SHIP_TO: 'Ship-to Name',
  COMPANY_NAME: 'Company Name',

  COMPANY_ID: 'Company ID',
  CUSTOMER_EMAIL: 'Customer Email',
  SUBTOTAL_EXCL: 'Subtotal',
  SUBTOTAL_INCL: 'Grand Total (Purchased)',
  SUBTOTAL_BASE: 'Grand Total (Base)',
  SHIPPING: 'Shipping and Handling',
  LS_ORDER_ID: 'LS Central Order ID',

  SKU_LIST: 'SKU',
  NAME_LIST: 'Product Name',
  QTY_LIST: 'Qty',

  // Legacy full block with "x" multipliers
  ITEMS_BLOCK: 'Items'
},

/**********************
 * BC: Vidskiptamenn
 **********************/
BC_CUSTOMERS: {
  FILE: 'BC_CUSTOMERS',
  PK: 'Nr.',
  COLUMNS: {
    COMPANY_ID: 'Nr.',
    COMPANY_NAME: 'Heiti',
    CREDIT_LIMIT: 'Hamarksskuld (SGM)',  // hvarf úr SaaS-exportinu 2026-08 → null
    PHONE: 'Simi',
    BALANCE: 'Hreyfing (SGM)',
    PAYMENTS: 'Greidslur (SGM)',
    SALES: 'Sala (SGM)',
    MODIFIED_DATE: 'Sidast breytt, dags.',

    // Nýir dálkar í SaaS-exportinu, teknir í notkun 2026-08-07.
    // ATH: exportið hefur líka dálk sem heitir einfaldlega 'Hreyfing' (án SGM).
    // Hann er VILJANDI ekki mappaður — BALANCE er 'Hreyfing (SGM)' og tveir
    // dálkar með nánast sama nafni og ólíka merkingu er uppskrift að því að
    // einhver mappi rangan síðar.
    ARREARS: 'Upphæð vanskila (SGM)',  // vanskil — staðreynd úr eigin bókhaldi,
                                       // nýtist í lánshæfismati á umsóknum
    STATUS_SGM: 'Staða (SGM)',         // staða viðskiptamanns, parast við vanskil
    CONTACT: 'Tengiliður'              // sýnir hvort BC-tengiliður er þegar
                                       // skráður — skrefið í "Klárað"-flæðinu
  }
},

/**********************
 * BC: Bokadir Solureikningar
 **********************/
BC_INVOICES: {
  FILE: 'BC_INVOICES',
  PK: 'Nr.',
  COLUMNS: {
    DOCUMENT_NO: 'Nr.',
    COMPANY_ID: 'Numer vidskiptamanns',      // normalize → numervidskiptamanns ✓
    EXTERNAL_DOC_NO: 'Numer utanadk. skjals', // normalize ✓
    COMPANY_NAME: 'Nafn vidskiptamanns',      // normalize ✓
    ORDER_NO: 'Pontunarnr.',                  // gone in SaaS — will be ''
    CURRENCY: 'Gjaldmiðilskóði',             // SaaS: kodi (was koti — no normalize match)
    DUE_DATE: 'Eindagi',                      // SaaS rename: was Gjalddagi
    BOOKING_DATE: 'Bokunardags.',             // normalize ✓
    DOCUMENT_DATE: 'Dags. fylgiskjals',       // gone in SaaS — will be ''
    EMAIL: 'Netfang',                         // gone in SaaS — will be ''
    AMOUNT_EXCL: 'Upphaed',                   // normalize ✓
    AMOUNT_INCL: 'Upphaed med VSK',           // normalize ✓
    ORDER_DATE: 'Pontunardags.',              // gone in SaaS — will be ''
    SALESPERSON_CODE: 'Kóði sölumanns',       // SaaS: kodi (was koti — no normalize match)
    WEB_ORDER_NO: 'Vefpöntunarnr.',          // new in SaaS (links to Magento web orders)
    REMAINING: 'Eftirstodvar',               // normalize ✓
    LOCATION_CODE: 'Kóði birgðageymslu',    // SaaS: kodi (was koti — no normalize match)
    PRINTED: 'Prentad',                       // normalize ✓
    CLOSED: 'Lokad',                          // normalize ✓
    CANCELED: 'Haett vid',                    // normalize ✓
    CORRECTIVE: 'Leidrettandi',               // normalize ✓
    RSM_PROVIDER: 'RSM þjónustuaðili',       // SaaS: adili (was aadili — no normalize match)
    RSM_DATE: 'Dags RSM sent'
  }
},

/**********************
 * BC: Bokadir Solukreditreikningar
 **********************/
BC_CREDIT_INVOICES: {
  FILE: 'BC_CREDIT_INVOICES',
  SHEET: 'Bokadir solukreditreikningar',
  PK: 'Nr.',
  COLUMNS: {
    DOCUMENT_NO: 'Nr.',
    COMPANY_ID: 'Selt-til - Vidskm.nr.',     // normalize ✓
    SALESPERSON_CODE: 'Kóði sölumanns',       // SaaS: kodi (was koti — no normalize match)
    COMPANY_NAME: 'Nafn vidskiptamanns',      // normalize ✓
    CURRENCY: 'Gjaldmiðilskóði',             // SaaS: kodi (was koti — no normalize match)
    DUE_DATE: 'Eindagi',                      // SaaS rename: was Gjalddagi
    BOOKING_DATE: 'Bokunardags.',             // gone in SaaS — will be ''
    DOCUMENT_DATE: 'Dags. fylgiskjals',       // gone in SaaS — will be ''
    ORDER_DATE: 'Pontunardags.',              // gone in SaaS — will be ''
    AMOUNT_EXCL: 'Upphaed',                   // normalize ✓
    AMOUNT_INCL: 'Upphaed med VSK',           // normalize ✓
    REMAINING: 'Eftirstodvar',               // normalize ✓
    PAID: 'Greitt',
    CANCELED: 'Haett vid',                    // normalize ✓
    CORRECTIVE: 'Leidrettandi',               // normalize ✓
    LOCATION_CODE: 'Kóði birgðageymslu',    // SaaS: kodi (was koti — no normalize match)
    PRINTED: 'Prentad',                       // normalize ✓
    RSM_PROVIDER: 'RSM Þjónusta',            // normalize ✓ (þ→th matches Thjonusta)
    RSM_DATE: 'Dags RSM sent'
  }
},

/**********************
 * BC: Solureikningslinur
 **********************/
BC_LINES: {
  FILE: 'BC_LINES',
  PK: 'Numer fylgiskjals',

  COLUMNS: {
    DOCUMENT_NO: 'Numer fylgiskjals',
    COMPANY_ID: 'Selt-til - Vidskm.nr.',
    TYPE: 'Tegund',
    SKU: 'Nr.',
    PRODUCT_NAME: 'Lysing',
    QTY: 'Magn',
    UOM: 'Maelieiningarkodi',
    UNIT_PRICE_EXCL: 'Ein.verd an VSK',
    AMOUNT_EXCL: 'Upphaed',
    DISCOUNT: 'Linuafsl.%',

    // Nýir dálkar í SaaS-exportinu, teknir í notkun 2026-08-07:
    ORDER_NO: 'Pöntunarnr.',        // hvarf úr BC_INVOICES og birtist hér —
                                    // endurheimtir sp_no í api.search_orders
    LINE_DISCOUNT: 'Afsl.upphæð línu' // afsláttarupphæð línu. Það er þessi
                                    // dálkur sem greinir í sundur tvær annars
                                    // eins línur; án hans falla ~2% af línum
                                    // saman í on_conflict lyklinum.
  }
},

/**********************
 * CUSTOMERS
 **********************/
CUSTOMERS: {
  FILE: 'CUSTOMERS',
  PK: 'ID',
  SHEET: 'MAGENTO_CUSTOMERS',
  ID: 'ID',
  NAME: 'Name',
  EMAIL: 'Email',
  REAL_EMAIL: 'Real Email',
  ROLE: 'Role',
  COMPANY_NAME: 'Company Name',
  COMPANY_ID: 'Company ID',
  REGION: 'Region',
  CREATED: 'Created At',
  UPDATED: 'Updated At'
},

/**********************
 * PRODUCTS
 **********************/
PRODUCTS: {
  FILE: 'PRODUCTS',
  PK: 'SKU',
  SHEET: 'PRODUCTS',
  SKU: 'SKU',
  NAME: 'Product Name',
  URL: 'Product URL',
  CATEGORY_PATH: 'Category Path',
  LEVEL1: 'Level 1',
  LEVEL2: 'Level 2',
  LEVEL3: 'Level 3',
  TIMESTAMP: 'Timestamp'
},

/**********************
 * CUSTOMER ANALYSIS (pre-aggregated summary)
 **********************/
CUSTOMER_ANALYSIS: {
  FILE: 'SALES_SUMMARIES',
  SHEET: 'Customer Analysis',
  PK: 'Customer ID',
  COLUMNS: {
    CUSTOMER_ID: 'Customer ID',
    CUSTOMER_NAME: 'Customer Name',
    WEBSHOP_ACTIVE: 'Webshop Active',
    WEBSHOP_ADDED_DATE: 'Webshop Added Date',
    PHONE: 'Phone',
    CREDIT_LIMIT: 'Credit Limit',
    PRIMARY_EMAIL: 'Primary Email',
    LIFETIME_BC_SALES: 'Lifetime BC Sales',
    TOTAL_BC_ORDERS: 'Total BC Orders',
    AVG_BC_ORDER_VALUE: 'Average BC Order Value',
    LAST_BC_ORDER_DATE: 'Last BC Order Date',
    ORDERS_BC_90D: 'Orders BC (last 90d)',
    ORDERS_BC_365D: 'Orders BC (last 365d)',
    WEBSHOP_ORDERS: 'Webshop Orders',
    WEBSHOP_SALES: 'Webshop Sales',
    WEBSHOP_AOV: 'Webshop AOV',
    WEBSHOP_LAST_ORDER: 'Webshop Last Order',
    WEBSHOP_SHARE_LIFETIME: 'Webshop Share - Lifetime (%)',
    TOTAL_VALUE: 'Total Value',
    TOTAL_ORDERS: 'Total Orders',
    FREQUENCY_SCORE: 'Frequency Score',
    RECENCY_SCORE: 'Recency Score',
    PRODUCT_FIT_SCORE: 'Product Fit Score',
    VALUE_SCORE: 'Value Score',
    READINESS_SCORE: 'Readiness Score',
    CATEGORY_FIT_SCORE: 'Category Fit Score',
    POTENTIAL_SCORE: 'Potential Score (0-100)',
    LOW_HANGING_FRUIT_SCORE: 'Low Hanging Fruit Score',
    RECOMMENDED_ACTION: 'Recommended Action',
    TOTAL_SKU_COUNT: 'Total SKU Count',
    TOP_PRODUCTS: 'Top 15 Products',
    CAT_REKSTRARVORUR: 'Category % Rekstrarvorur',
    CAT_HEILBRIGDISVORUR: 'Category % Heilbrigdhisvorur',
    CAT_MATVORUR: 'Category % Matvorur',
    CAT_VELAR_TAEKI: 'Category % Velar og taeki',
    CAT_AFENGI: 'Category % Afengi',
    PRIMARY_CATEGORY: 'Primary Category'
  }
}
};
