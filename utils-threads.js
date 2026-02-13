const logger = require("./utils-logger");
const { getRedisClient, buildKey } = require("./utils-redis");
const { ACTIVE_THREAD_TTL_SECONDS } = require("./utils-variables");

// ============================================================================
// ACTIVE THREAD TRACKING (Redis-backed)
// ============================================================================

/**
 * Check if a thread is currently active (bot is participating)
 * Returns true if thread exists in Redis (within TTL)
 */
async function isThreadActive(channelId, threadTs) {
  const redis = getRedisClient();

  // Graceful degradation: if Redis unavailable, assume not active
  if (!redis) {
    logger.warn(
      `[${channelId}] Redis unavailable, treating thread ${threadTs} as inactive`,
    );
    return false;
  }

  try {
    const key = buildKey("thread", channelId, threadTs);
    const exists = await redis.exists(key);

    logger.debug(
      `[${channelId}] isThreadActive(${threadTs}): ${exists === 1}`,
    );

    return exists === 1;
  } catch (error) {
    logger.error(
      `[${channelId}] Error checking thread ${threadTs}:`,
      error.message,
    );
    return false; // Fail closed - don't respond if we can't verify
  }
}

/**
 * Mark a thread as active (bot is participating)
 * Sets key in Redis with TTL (auto-expires after ACTIVE_THREAD_TTL_SECONDS)
 */
async function markThreadActive(channelId, threadTs) {
  const redis = getRedisClient();

  // Graceful degradation: if Redis unavailable, log and continue
  if (!redis) {
    logger.warn(
      `[${channelId}] Redis unavailable, cannot mark thread ${threadTs} as active`,
    );
    return false;
  }

  try {
    const key = buildKey("thread", channelId, threadTs);
    const timestamp = Date.now();

    // SETEX: Set with expiration in one atomic operation
    // Value is timestamp (useful for debugging/analytics)
    await redis.setEx(key, ACTIVE_THREAD_TTL_SECONDS, timestamp.toString());

    logger.debug(
      `[${channelId}] Marked thread ${threadTs} as active (TTL: ${ACTIVE_THREAD_TTL_SECONDS}s)`,
    );

    return true;
  } catch (error) {
    logger.error(
      `[${channelId}] Error marking thread ${threadTs} as active:`,
      error.message,
    );
    return false; // Don't throw - let app continue even if Redis write fails
  }
}

module.exports = {
  isThreadActive,
  markThreadActive,
};
