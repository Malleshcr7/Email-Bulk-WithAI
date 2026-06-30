function ts() {
  return new Date().toISOString().slice(11, 19);
}

function log(msg, ...args) {
  console.log(`[${ts()}] [NicheSearch] ${msg}`, ...args);
}

function warn(msg, ...args) {
  console.warn(`[${ts()}] [NicheSearch] WARN ${msg}`, ...args);
}

function error(msg, ...args) {
  console.error(`[${ts()}] [NicheSearch] ERROR ${msg}`, ...args);
}

module.exports = { log, warn, error };
