const YahooFinance = require('yahoo-finance2').default;
const logger = require('./logger');

const client = new YahooFinance({
  queue: { concurrency: 2 },
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
});

module.exports = client;
