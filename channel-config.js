const fs = require('fs');
const path = require('path');

const STORAGE_BASE = process.env.PERSISTENT_STORAGE || __dirname;
const CHANNELS_DIR = path.join(STORAGE_BASE, 'channels');

/**
 * Check if a channel exists (has a directory)
 */
function channelExists(channelId) {
  const channelPath = path.join(CHANNELS_DIR, channelId);
  return fs.existsSync(channelPath) && fs.statSync(channelPath).isDirectory();
}

/**
 * Get configuration for a specific channel
 * Returns object with channelId and channelPath, or null if not found
 */
function getChannel(channelId) {
  if (!channelExists(channelId)) {
    return null;
  }
  return {
    channelId: channelId,
    channelPath: path.join(CHANNELS_DIR, channelId)
  };
}

/**
 * Get all channels as array of [channelId, config] tuples
 */
function getAllChannels() {
  if (!fs.existsSync(CHANNELS_DIR)) {
    return [];
  }

  return fs.readdirSync(CHANNELS_DIR)
    .filter(entry => {
      const entryPath = path.join(CHANNELS_DIR, entry);
      return fs.statSync(entryPath).isDirectory() && entry.startsWith('C');
    })
    .map(channelId => [channelId, getChannel(channelId)]);
}

/**
 * Subscribe to a channel (create directory)
 * Returns { success: boolean, error?: string }
 */
function subscribe(channelId) {
  // Validate channel ID format
  if (!/^C[A-Z0-9]{10}$/.test(channelId)) {
    return {
      success: false,
      error: 'Invalid Slack channel ID format'
    };
  }

  if (channelExists(channelId)) {
    return {
      success: false,
      error: `Channel ${channelId} already exists`
    };
  }

  const channelPath = path.join(CHANNELS_DIR, channelId);

  try {
    fs.mkdirSync(channelPath, { recursive: true });
    console.log(`Created channel directory: ${channelPath}`);
    return { success: true };
  } catch (error) {
    console.error('Error creating channel directory:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Leave a channel (delete directory and contents)
 * Returns { success: boolean, error?: string }
 */
function leave(channelId) {
  if (!channelExists(channelId)) {
    return {
      success: false,
      error: `Channel ${channelId} not found`
    };
  }

  const channelPath = path.join(CHANNELS_DIR, channelId);

  try {
    fs.rmSync(channelPath, { recursive: true, force: true });
    console.log(`Deleted channel directory: ${channelPath}`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting channel directory:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  getChannel,
  getAllChannels,
  channelExists,
  subscribe,
  leave,
  CHANNELS_DIR
};
