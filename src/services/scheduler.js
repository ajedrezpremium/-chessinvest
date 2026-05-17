const logger = require('./logger');
const { cache } = require('./cache');

const jobs = [];

function startJob(name, fn, intervalMs) {
  logger.info(`Scheduler: starting "${name}" every ${intervalMs / 1000}s`);

  const run = async () => {
    try {
      logger.info(`Scheduler: running "${name}"`);
      await fn();
    } catch (err) {
      logger.error(`Scheduler: "${name}" failed: ${err.message}`);
    }
  };

  run();
  const id = setInterval(run, intervalMs);
  jobs.push({ name, id, intervalMs });
  return id;
}

function stopAll() {
  for (const job of jobs) {
    clearInterval(job.id);
    logger.info(`Scheduler: stopped "${job.name}"`);
  }
  jobs.length = 0;
}

function status() {
  return jobs.map((j) => ({
    name: j.name,
    intervalMs: j.intervalMs,
    running: true,
  }));
}

module.exports = { startJob, stopAll, status };
