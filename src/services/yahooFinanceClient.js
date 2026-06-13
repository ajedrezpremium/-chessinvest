const YahooFinance = require('yahoo-finance2').default;
const logger = require('./logger');

process.env.YF_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const client = new YahooFinance({
  queue: { concurrency: 1 },
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
});

module.exports = client;
