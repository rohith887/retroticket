// Dependency-free file logger. Writes JSON lines (pino-style numeric levels) to LOG_FILE, which the admin Logs page
// reads through GET /api/v1/data/logs. The location is fixed (apps/api/logs) regardless of the working directory.
const fs = require("fs");
const path = require("path");
const util = require("util");

const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, "../../logs");
const LOG_FILE = path.join(LOG_DIR, "logs.log");
const MAX_BYTES = 5 * 1024 * 1024; // rotate to logs.old.log past this size
const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

let writes = 0;

function rotateIfNeeded() {
  try {
    if (fs.statSync(LOG_FILE).size > MAX_BYTES) fs.renameSync(LOG_FILE, path.join(LOG_DIR, "logs.old.log"));
  } catch {
    /* no file yet */
  }
}

function write(level, args) {
  const msg = util.format(...args);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (++writes % 200 === 0) rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, JSON.stringify({ time: new Date().toISOString(), level: LEVELS[level], msg }) + "\n");
  } catch {
    /* logging must never take the server down */
  }
}

const logger = {
  LOG_FILE,
  trace: (...a) => write("trace", a),
  debug: (...a) => write("debug", a),
  info: (...a) => {
    console.log(...a);
  },
  warn: (...a) => {
    console.warn(...a);
  },
  error: (...a) => {
    console.error(...a);
  },
  /** Mirror console.log/info/warn/error into the log file so everything the server prints shows up on the Logs page. */
  captureConsole() {
    const map = { log: "info", info: "info", warn: "warn", error: "error", debug: "debug" };
    for (const [method, level] of Object.entries(map)) {
      const original = console[method].bind(console);
      console[method] = (...args) => {
        original(...args);
        write(level, args);
      };
    }
  },
};

module.exports = logger;
