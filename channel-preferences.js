const fs = require('fs');
const path = require('path');

const STORAGE_BASE = process.env.PERSISTENT_STORAGE || __dirname;
const PREFS_FILE = path.join(STORAGE_BASE, 'channel-preferences.json');

// In-memory cache
let preferencesCache = null;
let lastModified = null;
let lastCheckTime = 0;
const CHECK_INTERVAL_MS = 5000; // Only check file modification every 5 seconds

/**
 * Load preferences from file into memory cache
 * Creates default file if it doesn't exist
 * Uses throttled modification check to automatically reload if file changes
 */
function loadPreferences() {
  const now = Date.now();

  // Only check file modification time periodically to reduce overhead
  if (now - lastCheckTime > CHECK_INTERVAL_MS) {
    lastCheckTime = now;

    try {
      if (fs.existsSync(PREFS_FILE)) {
        const stats = fs.statSync(PREFS_FILE);
        const currentModified = stats.mtime.getTime();

        // Reload if file changed or cache is empty
        if (preferencesCache === null || lastModified !== currentModified) {
          const data = fs.readFileSync(PREFS_FILE, 'utf8');
          preferencesCache = JSON.parse(data);
          lastModified = currentModified;
          console.log('[GLOBAL]: Loaded channel preferences from file');
        }
      } else {
        // Create default preferences if file doesn't exist
        preferencesCache = { channels: {} };
        savePreferences(preferencesCache);
        lastModified = Date.now();
        console.log('Created new channel preferences file');
      }
    } catch (error) {
      console.error('Error loading channel preferences:', error.message);

      // Try to create backup if file is corrupted
      if (fs.existsSync(PREFS_FILE)) {
        try {
          const backup = `${PREFS_FILE}.backup.${Date.now()}`;
          fs.copyFileSync(PREFS_FILE, backup);
          console.log(`Created backup of corrupted preferences: ${backup}`);
        } catch (backupError) {
          console.error('Failed to create backup:', backupError.message);
        }
      }

      // Start fresh with defaults if first load, otherwise keep existing cache
      if (preferencesCache === null) {
        preferencesCache = { channels: {} };
      }
    }
  }

  return preferencesCache;
}

/**
 * Save preferences to file
 */
function savePreferences(preferences) {
  try {
    const dir = path.dirname(PREFS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = JSON.stringify(preferences, null, 2);
    fs.writeFileSync(PREFS_FILE, data, 'utf8');

    // Update lastModified to match the file we just wrote
    // This prevents unnecessary reloads on next check
    const stats = fs.statSync(PREFS_FILE);
    lastModified = stats.mtime.getTime();
  } catch (error) {
    console.error('Error saving channel preferences:', error.message);
    console.error('Continuing with in-memory cache only (graceful degradation)');
  }
}

/**
 * Get channel preference object
 * Returns null if channel has no entry (no vector store configured)
 */
function getChannelPreference(channelId) {
  const prefs = loadPreferences();
  return prefs.channels[channelId] || null;
}

/**
 * Update channel preference (upsert)
 */
function updateChannelPreference(channelId, updates) {
  const prefs = loadPreferences();

  if (!prefs.channels[channelId]) {
    prefs.channels[channelId] = {};
  }

  Object.assign(prefs.channels[channelId], updates);
  prefs.channels[channelId].lastUpdated = new Date().toISOString();

  savePreferences(prefs);
  return prefs.channels[channelId];
}

/**
 * Delete channel preference
 * Returns true if entry existed
 */
function deleteChannelPreference(channelId) {
  const prefs = loadPreferences();
  const existed = channelId in prefs.channels;
  delete prefs.channels[channelId];
  savePreferences(prefs);
  return existed;
}

/**
 * Get all channel preferences
 * Returns the channels sub-object
 */
function getAllChannelPreferences() {
  const prefs = loadPreferences();
  return prefs.channels;
}

/**
 * Get vector store ID for a channel
 * Returns null if not configured
 */
function getVectorId(channelId) {
  const pref = getChannelPreference(channelId);
  return pref?.vector_id || null;
}

module.exports = {
  loadPreferences,
  getChannelPreference,
  updateChannelPreference,
  deleteChannelPreference,
  getAllChannelPreferences,
  getVectorId
};
