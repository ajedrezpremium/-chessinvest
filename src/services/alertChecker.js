const yahooFinance = require('./yahooFinanceClient');
const { getSupabaseAdmin } = require('./supabase');
const logger = require('./logger');

async function checkPriceAlerts() {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return [];

    const { data: activeAlerts, error } = await admin
      .from('price_alerts')
      .select('*')
      .eq('active', 1);

    if (error) throw error;
    if (!activeAlerts || activeAlerts.length === 0) return [];

    const tickers = [...new Set(activeAlerts.map(a => a.ticker))];
    const quotes = {};

    for (const ticker of tickers) {
      try {
        const result = await yahooFinance.quote(ticker);
        quotes[ticker] = result.regularMarketPrice;
      } catch (err) {
        logger.error(`Failed to fetch price for ${ticker}: ${err.message}`);
      }
    }

    const triggered = [];

    for (const alert of activeAlerts) {
      const currentPrice = quotes[alert.ticker];
      if (currentPrice == null) continue;

      let isTriggered = false;
      if (alert.direction === 'above' && currentPrice >= alert.target_price) {
        isTriggered = true;
      } else if (alert.direction === 'below' && currentPrice <= alert.target_price) {
        isTriggered = true;
      }

      if (isTriggered) {
        triggered.push({
          alertId: alert.id,
          userId: alert.user_id,
          ticker: alert.ticker,
          targetPrice: alert.target_price,
          currentPrice,
          direction: alert.direction,
        });

        await admin.from('price_alerts').update({ active: 0 }).eq('id', alert.id);
        logger.info(`Alert triggered: ${alert.ticker} ${alert.direction} ${alert.target_price} (now ${currentPrice}) for user ${alert.user_id}`);
      }
    }

    return triggered;
  } catch (err) {
    logger.error(`Alert checker error: ${err.message}`);
    return [];
  }
}

async function getAlertsForUser(userId) {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return [];

    const { data, error } = await admin
      .from('price_alerts')
      .select('*')
      .eq('user_id', userId)
      .eq('active', 1)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    logger.error(`Get alerts for user error: ${err.message}`);
    return [];
  }
}

module.exports = { checkPriceAlerts, getAlertsForUser };