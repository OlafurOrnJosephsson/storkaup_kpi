/************************************************************
 * STORKAUP_SCHEMA - central header mapping (v1)
 ************************************************************/
const STORKAUP_SCHEMA = {
/**********************
 * NEWWEB (Magento)
 **********************/
NEWWEB: {
  FILE: 'WEBSALES',        // vÃ­sar Ã­ CONFIG.SHEETS.WEBSALES
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

  // Legacy full block with "Ã—" multipliers
  ITEMS_BLOCK: 'Items'
},

/**********************
 * BC: ViÃ°skiptamenn
 **********************/
BC_CUSTOMERS: {
  FILE: 'BC_CUSTOMERS',
  SHEET: 'ViÃ°skiptamenn',
  PK: 'Nr.',
  COLUMNS: {
    COMPANY_ID:   'Nr.',
    COMPANY_NAME: 'Heiti',
    CREDIT_LIMIT: 'HÃ¡marksskuld (SGM)',
    PHONE:        'SÃ­mi',
    BALANCE:      'Hreyfing (SGM)',
    PAYMENTS:     'GreiÃ°slur (SGM)',
    SALES:        'Sala (SGM)',
    MODIFIED_DATE:'SÃ­Ã°ast breytt, dags.'
  }
},

/**********************
 * BC: BÃ³kaÃ°ir SÃ¶lureikningar
 **********************/
BC_INVOICES: {
  FILE: 'BC_INVOICES',
  SHEET: 'BÃ³kaÃ°ir sÃ¶lureikningar',
  PK: 'Nr.',
  COLUMNS: {
    DOCUMENT_NO:      'Nr.',
    COMPANY_ID:       'NÃºmer viÃ°skiptamanns',
    EXTERNAL_DOC_NO:  'NÃºmer utanaÃ°k. skjals',
    COMPANY_NAME:     'Nafn viÃ°skiptamanns',
    ORDER_NO:         'PÃ¶ntunarnr.',
    CURRENCY:         'GjaldmiÃ°ilskÃ³ti',
    DUE_DATE:         'Gjalddagi',
    BOOKING_DATE:     'BÃ³kunardags.',
    DOCUMENT_DATE:    'Dags. fylgiskjals',
    EMAIL:            'Netfang',
    AMOUNT_EXCL:      'UpphÃ¦Ã°',
    AMOUNT_INCL:      'UpphÃ¦Ã° meÃ° VSK',
    ORDER_DATE:       'PÃ¶ntunardags.',
    SALESPERSON_CODE: 'KÃ³ti sÃ¶lumanns',
    REMAINING:        'EftirstÃ¶Ã°var',
    LOCATION_CODE:    'KÃ³ti birgÃ°ageymslu',
    PRINTED:          'PrentaÃ°',
    CLOSED:           'LokaÃ°',
    CANCELED:         'HÃ¦tt viÃ°',
    CORRECTIVE:       'LeiÃ°rÃ©ttandi',
    RSM_PROVIDER:     'RSM Ã¾jÃ³nustuaÃ°ili',
    RSM_DATE:         'Dags RSM sent'
  }
},

/**********************
 * BC: BÃ³kaÃ°ir SÃ¶lukreditreikningar
 **********************/
BC_CREDIT_INVOICES: {
  FILE: 'BC_INVOICES',
  SHEET: 'Bokadir solukreditreikningar',
  PK: 'Nr.',
  COLUMNS: {
    DOCUMENT_NO:      'Nr.',
    COMPANY_ID:       'Selt-til - Vidskm.nr.',
    SALESPERSON_CODE: 'Koti solumanns',
    COMPANY_NAME:     'Nafn vidskiptamanns',
    CURRENCY:         'Gjaldmidilskoti',
    DUE_DATE:         'Gjalddagi',
    BOOKING_DATE:     'Bokunardags.',
    DOCUMENT_DATE:    'Dags. fylgiskjals',
    AMOUNT_EXCL:      'Upphaed',
    AMOUNT_INCL:      'Upphaed med VSK',
    REMAINING:        'Eftirstodvar',
    PAID:             'Greitt',
    CANCELED:         'Haett vid',
    CORRECTIVE:       'Leidrettandi',
    LOCATION_CODE:    'Koti birgdageymslu',
    PRINTED:          'Prentad',
    RSM_PROVIDER:     'RSM Thjonusta',
    RSM_DATE:         'Dags RSM sent'
  }
},

/**********************
 * BC: Solureikningslinur
 **********************/
BC_LINES: {
  FILE: 'BC_LINES',
  PK: 'NÃºmer fylgiskjals',
  SHEET: 'BÃ³kaÃ°ar sÃ¶lureikningslÃ­nur',
  
  COLUMNS: {
    DOCUMENT_NO:    'NÃºmer fylgiskjals',
    COMPANY_ID:     'Selt-til - ViÃ°skm.nr.',
    TYPE:           'Tegund',
    SKU:            'Nr.',
    PRODUCT_NAME:   'LÃ½sing',
    QTY:            'Magn',
    UOM:            'MÃ¦lieiningarkÃ³Ã°i',
    UNIT_PRICE_EXCL:'Ein.verÃ° Ã¡n VSK',
    AMOUNT_EXCL:    'UpphÃ¦Ã°',
    DISCOUNT:       'LÃ­nuafsl.%'
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
    WEBSHOP_SHARE_LIFETIME: 'Webshop Share â€” Lifetime (%)',
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
    CAT_REKSTRARVORUR: 'Category % RekstrarvÃ¶rur',
    CAT_HEILBRIGDISVORUR: 'Category % HeilbrigÃ°isvÃ¶rur',
    CAT_MATVORUR: 'Category % MatvÃ¶rur',
    CAT_VELAR_TAEKI: 'Category % VÃ©lar og tÃ¦ki',
    CAT_AFENGI: 'Category % Ãfengi',
    PRIMARY_CATEGORY: 'Primary Category'
  }
},





};
