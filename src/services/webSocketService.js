const { WebSocketServer } = require('ws');
const logger = require('./logger');
const { getFuturesData } = require('./futuresDataService');

function startWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    logger.info('WebSocket client connected');

    // Send initial data
    sendFuturesData(ws);

    ws.on('close', () => {
      logger.info('WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      logger.warn(`WebSocket error: ${err.message}`);
    });
  });

  // Broadcast futures data every 5 seconds
  const broadcastInterval = setInterval(async () => {
    try {
      const futures = await getFuturesData();
      const payload = JSON.stringify({ type: 'futures', data: futures });
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(payload);
        }
      });
    } catch (err) {
      logger.warn(`WebSocket broadcast error: ${err.message}`);
    }
  }, 5000);

  wss.on('close', () => {
    clearInterval(broadcastInterval);
  });

  logger.info('WebSocket server started');
  return wss;
}

async function sendFuturesData(ws) {
  try {
    const futures = await getFuturesData();
    ws.send(JSON.stringify({ type: 'futures', data: futures }));
  } catch (err) {
    logger.warn(`WebSocket send error: ${err.message}`);
  }
}

module.exports = { startWebSocket };
