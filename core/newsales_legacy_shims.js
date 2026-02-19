/*
 * Legacy NEWWEB entry points kept as thin shims.
 * Safe to remove after confirming nobody manually runs these names.
 */

function pollMagentoNewOrders() {
  if (typeof pollMagentoOrders_v2 !== 'function') {
    throw new Error('pollMagentoOrders_v2() not found. Ensure core/newsales_v2.js is deployed.');
  }
  return pollMagentoOrders_v2();
}

function safePoll() {
  if (typeof safePoll_v2 !== 'function') {
    throw new Error('safePoll_v2() not found. Ensure core/newsales_v2.js is deployed.');
  }
  return safePoll_v2();
}

function pollOnce() {
  return pollMagentoNewOrders();
}
