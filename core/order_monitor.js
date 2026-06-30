/************************************************************
 * 🧾 ORDER MONITOR — Magento pantanir í bið (pending)
 * ----------------------------------------------------------
 * Pantanir sem standa í status "pending" hafa ekki flætt áfram
 * (pending → processing → paid → complete) og rata oft ekki í BC.
 * Þessi vöktun listar þær, elstu fyrst, með aldri — svo strand
 * sjáist strax.
 *
 * Notar fyrirliggjandi Magento-auth:
 *   getMagentoApiBaseUrl_(), magentoHeaders_()  (auth.js)
 *   fetchMagentoWithRetry_()                    (customers.js)
 *
 * Opinbert fall fyrir dashboard: getPendingOrdersForUi()
 ************************************************************/

function fetchPendingMagentoOrders_() {
  const base = getMagentoApiBaseUrl_();
  if (!base) throw new Error('CONFIG ERROR: vantar ENDPOINTS.Magento.BASE_URL');

  const pageSize = 250;
  const url =
    base + '/orders' +
    '?searchCriteria[filter_groups][0][filters][0][field]=status' +
    '&searchCriteria[filter_groups][0][filters][0][value]=pending' +
    '&searchCriteria[filter_groups][0][filters][0][condition_type]=eq' +
    '&searchCriteria[sortOrders][0][field]=created_at' +
    '&searchCriteria[sortOrders][0][direction]=ASC' +
    '&searchCriteria[pageSize]=' + pageSize +
    '&searchCriteria[currentPage]=1' +
    '&fields=' + encodeURIComponent(
      'total_count,items[increment_id,created_at,status,grand_total,customer_email,customer_firstname,customer_lastname]'
    );

  const res = fetchMagentoWithRetry_(url, {
    method: 'get',
    headers: magentoHeaders_(),
    contentType: 'application/json',
    muteHttpExceptions: true
  });

  const body = res.getContentText();
  const data = JSON.parse(body);
  if (!data || !Array.isArray(data.items)) {
    throw new Error('Óvænt Magento svar (items vantar): ' + String(body).slice(0, 200));
  }
  return data;
}

/************************************************************
 * 📤 getPendingOrdersForUi — opinbert (google.script.run)
 *   Skilar { status, total, stuck48, orders:[{...}] }
 *   ageHours = klukkustundir í bið. stuck48 = fjöldi >48 klst.
 ************************************************************/
function getPendingOrdersForUi() {
  try {
    const data = fetchPendingMagentoOrders_();
    const items = data.items || [];
    const now = Date.now();

    let stuck48 = 0;
    const orders = items.map(function (o) {
      const iso = o.created_at ? String(o.created_at).replace(' ', 'T') + 'Z' : null;
      const t = iso ? Date.parse(iso) : NaN;
      const ageHours = isNaN(t) ? null : Math.floor((now - t) / 3600000);
      if (ageHours != null && ageHours >= 48) stuck48++;
      const name = ((o.customer_firstname || '') + ' ' + (o.customer_lastname || '')).trim() ||
                   o.customer_email || '';
      return {
        incrementId: o.increment_id || '',
        createdAt: o.created_at || '',
        ageHours: ageHours,
        total: (o.grand_total != null ? Number(o.grand_total) : null),
        customer: name
      };
    });

    return {
      status: 'ok',
      total: (data.total_count != null ? data.total_count : orders.length),
      stuck48: stuck48,
      orders: orders.slice(0, 50)
    };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}
