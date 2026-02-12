const logger = require("./utils-logger");
const {
  isChannelSubscribed,
  getAllChannelPreferences,
  updateChannelPreference,
  deleteChannelPreference,
} = require("./utils-preferences");

/**
 * Check if a channel exists (is subscribed)
 */
function channelExists(channelId) {
  return isChannelSubscribed(channelId);
}

/**
 * Get configuration for a specific channel
 * Returns object with channelId, or null if not subscribed
 */
function getChannel(channelId) {
  if (!channelExists(channelId)) {
    return null;
  }
  return {
    channelId: channelId,
  };
}

/**
 * Get all subscribed channels as array of [channelId, config] tuples
 */
function getAllChannels() {
  const allPrefs = getAllChannelPreferences();
  return Object.entries(allPrefs)
    .filter(([, pref]) => pref.subscribed === true)
    .map(([channelId]) => [channelId, getChannel(channelId)]);
}

/**
 * Subscribe to a channel (add to preferences)
 * Returns { success: boolean, error?: string }
 */
function subscribe(channelId) {
  // Validate channel ID format
  if (!/^C[A-Z0-9]{10}$/.test(channelId)) {
    return {
      success: false,
      error: "Invalid Slack channel ID format",
    };
  }

  if (channelExists(channelId)) {
    return {
      success: false,
      error: `Channel ${channelId} already exists`,
    };
  }

  try {
    updateChannelPreference(channelId, { subscribed: true });
    logger.info(`Subscribed to channel: ${channelId}`);
    return { success: true };
  } catch (error) {
    logger.error("Error subscribing to channel:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Leave a channel (remove from preferences)
 * Returns { success: boolean, error?: string }
 */
function leave(channelId) {
  if (!channelExists(channelId)) {
    return {
      success: false,
      error: `Channel ${channelId} not found`,
    };
  }

  try {
    deleteChannelPreference(channelId);
    logger.info(`Unsubscribed from channel: ${channelId}`);
    return { success: true };
  } catch (error) {
    logger.error("Error unsubscribing from channel:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  getChannel,
  getAllChannels,
  channelExists,
  subscribe,
  leave,
};
