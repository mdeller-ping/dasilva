const logger = require("./utils-logger");
const {
  getUserCooldown,
  getLastResponseTime,
  recordLastResponseTime,
} = require("./utils-preferences");
const { RESPONSE_COOLDOWN_SECONDS } = require("./utils-variables");

// ============================================================================
// RATE LIMITING
// ============================================================================

/**
 * Check if we should respond based on rate limiting
 * Considers user's custom cooldown if set, otherwise uses default
 * Reads last response time from disk-backed user preferences
 */
function shouldRespondToUser(channelId, userId) {
  const lastTime = getLastResponseTime(userId, channelId);

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
 * Persists the timestamp to disk via user preferences
 */
function recordResponse(channelId, userId) {
  recordLastResponseTime(userId, channelId, Date.now());
}

module.exports = {
  shouldRespondToUser,
  recordResponse,
};
