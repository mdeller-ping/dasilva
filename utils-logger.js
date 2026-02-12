const util = require("util");

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const levelName = (process.env.LOG_LEVEL || "INFO").toUpperCase();
const currentLevel = LEVELS[levelName] ?? LEVELS.INFO;

const LOG_CHANNEL = process.env.LOG_CHANNEL || null;
let slackClient = null;

if (LOG_CHANNEL && process.env.SLACK_BOT_TOKEN) {
  const { WebClient } = require("@slack/web-api");
  slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
}

function forwardToSlack(level, args) {
  if (!slackClient || level === "DEBUG") return;
  const timestamp = new Date()
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");
  const prefix = level === "INFO" ? "" : `[${level}] `;
  const flat = `${prefix}${util.format(...args)}`.replace(/\s+/g, " ");
  slackClient.chat
    .postMessage({ channel: LOG_CHANNEL, text: `\`${timestamp}: ${flat}\`` })
    .catch((err) => {
      console.error(
        `[LOG_CHANNEL] Failed to post to ${LOG_CHANNEL}:`,
        err.message,
      );
    });
}

const log = {
  debug: (...args) => {
    if (currentLevel <= LEVELS.DEBUG) {
      console.debug("[DEBUG]", ...args);
      forwardToSlack("DEBUG", args);
    }
  },
  info: (...args) => {
    if (currentLevel <= LEVELS.INFO) {
      console.log("[INFO]", ...args);
      forwardToSlack("INFO", args);
    }
  },
  warn: (...args) => {
    if (currentLevel <= LEVELS.WARN) {
      console.warn("[WARN]", ...args);
      forwardToSlack("WARN", args);
    }
  },
  error: (...args) => {
    if (currentLevel <= LEVELS.ERROR) {
      console.error("[ERROR]", ...args);
      forwardToSlack("ERROR", args);
    }
  },
  isEnabled: (level) =>
    currentLevel <= (LEVELS[level.toUpperCase()] ?? LEVELS.INFO),
  level: Object.keys(LEVELS).find((k) => LEVELS[k] === currentLevel),
  LEVELS,
};

module.exports = log;
