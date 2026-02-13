const redis = require("redis");
const logger = require("./utils-logger");
const { REDIS_URL, REDIS_KEY_PREFIX } = require("./utils-variables");

// ============================================================================
// REDIS CLIENT INITIALIZATION
// ============================================================================

let client = null;
let isConnected = false;

/**
 * Initialize Redis client with error handling and reconnection logic
 */
async function initializeRedis() {
  try {
    client = redis.createClient({
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error("Redis: Max reconnection attempts reached. Giving up.");
            return new Error("Max reconnection attempts reached");
          }
          const delay = Math.min(retries * 100, 3000); // Exponential backoff, max 3s
          logger.info(`Redis: Reconnecting in ${delay}ms (attempt ${retries})`);
          return delay;
        },
      },
    });

    // Event handlers
    client.on("error", (err) => {
      logger.error("Redis client error:", err.message);
      isConnected = false;
    });

    client.on("connect", () => {
      logger.info("Redis: Connected to server");
      isConnected = true;
    });

    client.on("reconnecting", () => {
      logger.warn("Redis: Reconnecting...");
      isConnected = false;
    });

    client.on("ready", () => {
      logger.info("Redis: Ready to accept commands");
      isConnected = true;
    });

    // Connect
    await client.connect();
    logger.info(`Redis: Initialized successfully (${REDIS_URL})`);
    return client;
  } catch (error) {
    logger.error("Redis: Failed to initialize:", error.message);
    throw error;
  }
}

/**
 * Get Redis client instance
 * Returns null if not connected (for graceful degradation)
 */
function getRedisClient() {
  if (!client || !isConnected) {
    logger.warn("Redis: Client not available");
    return null;
  }
  return client;
}

/**
 * Check if Redis is connected and ready
 */
function isRedisConnected() {
  return isConnected;
}

/**
 * Build a namespaced Redis key
 * Example: buildKey("thread", "C123", "1234567.890") => "dasilva:thread:C123:1234567.890"
 */
function buildKey(...parts) {
  return REDIS_KEY_PREFIX + parts.join(":");
}

/**
 * Gracefully close Redis connection
 */
async function closeRedis() {
  if (client) {
    try {
      await client.quit();
      logger.info("Redis: Connection closed gracefully");
    } catch (error) {
      logger.error("Redis: Error closing connection:", error.message);
    }
  }
}

module.exports = {
  initializeRedis,
  getRedisClient,
  isRedisConnected,
  buildKey,
  closeRedis,
};
