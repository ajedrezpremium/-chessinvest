const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ queue: { concurrency: 2 }, suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const { all, run } = require('./database');
const logger = require('./logger');

async function checkPriceAlerts() {
  try {
    const activeAlerts = await all("SELECT * FROM price_alerts WHERE active = 1");
    if (activeAlerts.length === 0) return;

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

      let triggered = false;
      if (alert.direction === 'above' && currentPrice >= alert.target_price) {
        triggered = true;
      } else if (alert.direction === 'below' && currentPrice <= alert.target_price) {
        triggered = true;
      }

      if (triggered) {
        triggered.push({
          alertId: alert.id,
          userId: alert.user_id,
          ticker: alert.ticker,
          targetPrice: alert.target_price,
          currentPrice,
          direction: alert.direction,
        });

        await run('UPDATE price_alerts SET active = 0 WHERE id = ?', [alert.id]);
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
  return all("SELECT * FROM price_alerts WHERE user_id = ? AND active = 1 ORDER BY created_at DESC", [userId]);
}

module.exports = { checkPriceAlerts, getAlertsForUser };
