const logger = require("./utils-logger");
const { getUserCooldown } = require("./utils-preferences");
const { RESPONSE_COOLDOWN_SECONDS } = require("./utils-variables");

// ============================================================================
// RATE LIMITING
// ============================================================================

// Track last response time per user per channel
const lastResponseTimes = new Map(); // key: "channelId:userId", value: timestamp

/**
 * Check if we should respond based on rate limiting
 * Considers user's custom cooldown if set, otherwise uses default
 */
function shouldRespondToUser(channelId, userId) {
  // TODO this is stored in memory and does not persist on restarts

  const key = `${channelId}:${userId}`;
  const lastTime = lastResponseTimes.get(key);

  logger.debug(
    `[${channelId}] cooldown check for user ${userId} (lastTime: ${lastTime})`,
  );

  if (!lastTime) return true;

  // Check for custom cooldown, otherwise use default
  const customCooldown = getUserCooldown(userId);
  const cooldown =
    customCooldown !== null ? customCooldown : RESPONSE_COOLDOWN_SECONDS;

  const timeSinceLastResponse = (Date.now() - lastTime) / 1000;

  logger.debug(
    `[${channelId}] cooldown timer ${userId}: ${timeSinceLastResponse >= cooldown}`,
  );
  return timeSinceLastResponse >= cooldown;
}

/**
 * Record that we responded to a user
 * Updates the timestamp for rate limiting checks
 */
function recordResponse(channelId, userId) {
  const key = `${channelId}:${userId}`;
  lastResponseTimes.set(key, Date.now());
}

module.exports = {
  shouldRespondToUser,
  recordResponse,
};
