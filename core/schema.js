/************************************************************
 * STORKAUP_SCHEMA - central header mapping (v1)
 ************************************************************/
const STORKAUP_SCHEMA = {
/**********************
 * NEWWEB (Magento)
 **********************/
NEWWEB: {
  FILE: 'WEBSALES',        // vísar í CONFIG.SHEETS.WEBSALES
  PK:   'ID',
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
  PK:   'ID',
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

  // NEWWEB style lists (comma separated)
  SKU_LIST: 'SKU',
  NAME_LIST: 'Product Name',
  QTY_LIST: 'Qty',

  // Legacy full block with "×" multipliers
  ITEMS_BLOCK: 'Items'
},

/**********************
 * BC: Viðskiptamenn
 **********************/
BC_CUSTOMERS: {
  FILE: 'BC_CUSTOMERS',
  SHEET: 'Viðskiptamenn',
  PK: 'Nr.',
  COLUMNS: {
    COMPANY_ID:   'Nr.',
    COMPANY_NAME: 'Heiti',
    CREDIT_LIMIT: 'Hámarksskuld (SGM)',
    PHONE:        'Sími',
    BALANCE:      'Hreyfing (SGM)',
    PAYMENTS:     'Greiðslur (SGM)',
    SALES:        'Sala (SGM)',
    MODIFIED_DATE:'Síðast breytt, dags.'
  }
},

/**********************
 * BC: Bókaðir Sölureikningar
 **********************/
BC_INVOICES: {
  FILE: 'BC_INVOICES',
  SHEET: 'Bókaðir sölureikningar',
  PK: 'Nr.',
  COLUMNS: {
    DOCUMENT_NO:      'Nr.',
    COMPANY_ID:       'Númer viðskiptamanns',
    EXTERNAL_DOC_NO:  'Númer utanaðk. skjals',
    COMPANY_NAME:     'Nafn viðskiptamanns',
    ORDER_NO:         'Pöntunarnr.',
    CURRENCY:         'Gjaldmiðilskóti',
    DUE_DATE:         'Gjalddagi',
    BOOKING_DATE:     'Bókunardags.',
    DOCUMENT_DATE:    'Dags. fylgiskjals',
    EMAIL:            'Netfang',
    AMOUNT_EXCL:      'Upphæð',
    AMOUNT_INCL:      'Upphæð með VSK',
    ORDER_DATE:       'Pöntunardags.',
    SALESPERSON_CODE: 'Kóti sölumanns',
    REMAINING:        'Eftirstöðvar',
    LOCATION_CODE:    'Kóti birgðageymslu',
    PRINTED:          'Prentað',
    CLOSED:           'Lokað',
    CANCELED:         'Hætt við',
    CORRECTIVE:       'Leiðréttandi',
    RSM_PROVIDER:     'RSM þjónustuaðili',
    RSM_DATE:         'Dags RSM sent'
  }
},

/**********************
 * BC: Bókaðir Sölukreditreikningar
 **********************/
BC_CREDIT_INVOICES: {
  FILE: 'BC_INVOICES',
  SHEET: 'Bókaðir sölukreditreikningar',
  PK: 'Nr.',
  COLUMNS: {
    DOCUMENT_NO:      'Nr.',
    COMPANY_ID:       'Selt-til - Viðskm.nr.',
    SALESPERSON_CODE: 'Kóti sölumanns',
    COMPANY_NAME:     'Nafn viðskiptamanns',
    CURRENCY:         'Gjaldmiðilskóti',
    DUE_DATE:         'Gjalddagi',
    BOOKING_DATE:     'Bókunardags.',
    DOCUMENT_DATE:    'Dags. fylgiskjals',
    AMOUNT_EXCL:      'Upphæð',
    AMOUNT_INCL:      'Upphæð með VSK',
    REMAINING:        'Eftirstöðvar',
    PAID:             'Greitt',
    CANCELED:         'Hætt við',
    CORRECTIVE:       'Leiðréttandi',
    LOCATION_CODE:    'Kóti birgðageymslu',
    PRINTED:          'Prentað',
    RSM_PROVIDER:     'RSM Þjónusta',
    RSM_DATE:         'Dags RSM sent'
  }
},

/**********************
 * BC: Sölureikningslínur
 **********************/
BC_LINES: {
  FILE: 'BC_LINES',
  PK: 'Númer fylgiskjals',
  SHEET: 'Bókaðar sölureikningslínur',
  
  COLUMNS: {
    DOCUMENT_NO:    'Númer fylgiskjals',
    COMPANY_ID:     'Selt-til - Viðskm.nr.',
    TYPE:           'Tegund',
    SKU:            'Nr.',
    PRODUCT_NAME:   'Lýsing',
    QTY:            'Magn',
    UOM:            'Mælieiningarkóði',
    UNIT_PRICE_EXCL:'Ein.verð án VSK',
    AMOUNT_EXCL:    'Upphæð',
    DISCOUNT:       'Línuafsl.%'
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
  UPDATED: 'Updated At'
},

/**********************
 * PRODUCTS
 **********************/
PRODUCTS: {
  FILE: 'PRODUCTS',
  PK:   'SKU',
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
    WEBSHOP_SHARE_LIFETIME: 'Webshop Share — Lifetime (%)',
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
    CAT_REKSTRARVORUR: 'Category % Rekstrarvörur',
    CAT_HEILBRIGDISVORUR: 'Category % Heilbrigðisvörur',
    CAT_MATVORUR: 'Category % Matvörur',
    CAT_VELAR_TAEKI: 'Category % Vélar og tæki',
    CAT_AFENGI: 'Category % Áfengi',
    PRIMARY_CATEGORY: 'Primary Category'
  }
},





};
