const fs = require("fs");
const path = require("path");
const logger = require("./utils-logger");

// ============================================================================
// PREFERENCE MANAGER CLASS
// ============================================================================

/**
 * Generic preference file manager with caching and auto-reload
 * Eliminates duplication between user-preferences and channel-preferences
 */
class PreferenceManager {
  constructor(filename, defaultStructure, logName) {
    const STORAGE_BASE = process.env.PERSISTENT_STORAGE || __dirname;
    this.prefsFile = path.join(STORAGE_BASE, filename);
    this.defaultStructure = defaultStructure;
    this.logName = logName;

    // In-memory cache
    this.cache = null;
    this.lastModified = null;
    this.lastCheckTime = 0;
    this.CHECK_INTERVAL_MS = 5000; // Only check file modification every 5 seconds
  }

  /**
   * Load preferences from file into memory cache
   * Creates default file if it doesn't exist
   * Uses throttled modification check to automatically reload if file changes
   */
  load() {
    const now = Date.now();

    // Only check file modification time periodically to reduce overhead
    if (now - this.lastCheckTime > this.CHECK_INTERVAL_MS) {
      this.lastCheckTime = now;

      try {
        if (fs.existsSync(this.prefsFile)) {
          const stats = fs.statSync(this.prefsFile);
          const currentModified = stats.mtime.getTime();

          // Reload if file changed or cache is empty
          if (this.cache === null || this.lastModified !== currentModified) {
            const data = fs.readFileSync(this.prefsFile, "utf8");
            this.cache = JSON.parse(data);
            this.lastModified = currentModified;
            logger.info(`loaded ${this.logName} from file`);
          }
        } else {
          // Create default preferences if file doesn't exist
          this.cache = { ...this.defaultStructure };
          this.save(this.cache);
          this.lastModified = Date.now();
          logger.info(`created new ${this.logName} file`);
        }
      } catch (error) {
        logger.error(`error loading ${this.logName}:`, error.message);

        // Try to create backup if file is corrupted
        if (fs.existsSync(this.prefsFile)) {
          try {
            const backup = `${this.prefsFile}.backup.${Date.now()}`;
            fs.copyFileSync(this.prefsFile, backup);
            logger.info(`Created backup of corrupted preferences: ${backup}`);
          } catch (backupError) {
            logger.error("Failed to create backup:", backupError.message);
          }
        }

        // Start fresh with defaults if first load, otherwise keep existing cache
        if (this.cache === null) {
          this.cache = { ...this.defaultStructure };
        }
      }
    }

    return this.cache;
  }

  /**
   * Save preferences to file
   */
  save(preferences) {
    try {
      const dir = path.dirname(this.prefsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify(preferences, null, 2);
      fs.writeFileSync(this.prefsFile, data, "utf8");

      // Update lastModified to match the file we just wrote
      // This prevents unnecessary reloads on next check
      const stats = fs.statSync(this.prefsFile);
      this.lastModified = stats.mtime.getTime();
    } catch (error) {
      logger.error(`Error saving ${this.logName}:`, error.message);
      logger.error(
        "Continuing with in-memory cache only (graceful degradation)",
      );
    }
  }
}

// ============================================================================
// USER PREFERENCES
// ============================================================================

const AMBIENT_MODE = process.env.AMBIENT_MODE === "true";

// Initialize user preference manager
const userManager = new PreferenceManager(
  "user-preferences.json",
  { users: {} },
  "user preferences",
);

// Default user preference object
const DEFAULT_USER_PREF = {
  silenced: !AMBIENT_MODE,
  customCooldown: null,
  channelResponseTimes: {}, // Track last response time per channel
  lastUpdated: new Date().toISOString(),
};

/**
 * Load user preferences from file
 */
function loadUserPreferences() {
  return userManager.load();
}

/**
 * Get user preference object
 * Returns default preferences if user not found
 */
function getUserPreference(userId) {
  const prefs = loadUserPreferences();

  if (!prefs.users[userId]) {
    prefs.users[userId] = {
      ...DEFAULT_USER_PREF,
      lastUpdated: new Date().toISOString(),
    };
  }

  return prefs.users[userId];
}

/**
 * Update user preference
 */
function updateUserPreference(userId, updates) {
  const prefs = loadUserPreferences();

  if (!prefs.users[userId]) {
    prefs.users[userId] = {
      ...DEFAULT_USER_PREF,
      lastUpdated: new Date().toISOString(),
    };
  }

  // Merge updates
  Object.assign(prefs.users[userId], updates);
  prefs.users[userId].lastUpdated = new Date().toISOString();

  // Save to file
  userManager.save(prefs);

  return prefs.users[userId];
}

/**
 * Check if user is silenced
 */
function isUserSilenced(userId) {
  const userPref = getUserPreference(userId);
  return userPref.silenced === true;
}

/**
 * Get user's custom cooldown in seconds
 * Returns null if not set (use default)
 */
function getUserCooldown(userId) {
  const userPref = getUserPreference(userId);
  return userPref.customCooldown;
}

/**
 * Get the last response time for a user in a specific channel
 * Returns null if no previous response
 */
function getLastResponseTime(userId, channelId) {
  const userPref = getUserPreference(userId);
  return userPref.channelResponseTimes?.[channelId] || null;
}

/**
 * Record that we responded to a user in a specific channel
 * Persists the timestamp to disk
 */
function recordLastResponseTime(userId, channelId, timestamp = Date.now()) {
  const prefs = loadUserPreferences();

  if (!prefs.users[userId]) {
    prefs.users[userId] = {
      ...DEFAULT_USER_PREF,
      lastUpdated: new Date().toISOString(),
    };
  }

  if (!prefs.users[userId].channelResponseTimes) {
    prefs.users[userId].channelResponseTimes = {};
  }

  prefs.users[userId].channelResponseTimes[channelId] = timestamp;
  prefs.users[userId].lastUpdated = new Date().toISOString();

  userManager.save(prefs);
}

// ============================================================================
// CHANNEL PREFERENCES
// ============================================================================

// Initialize channel preference manager
const channelManager = new PreferenceManager(
  "channel-preferences.json",
  { channels: {} },
  "channel preferences",
);

/**
 * Load channel preferences from file
 */
function loadChannelPreferences() {
  return channelManager.load();
}

/**
 * Get channel preference object
 * Returns null if channel has no entry
 */
function getChannelPreference(channelId) {
  const prefs = loadChannelPreferences();
  return prefs.channels[channelId] || null;
}

/**
 * Check if channel is subscribed
 */
function isChannelSubscribed(channelId) {
  const pref = getChannelPreference(channelId);
  return pref?.subscribed === true;
}

/**
 * Update channel preference (upsert)
 */
function updateChannelPreference(channelId, updates) {
  const prefs = loadChannelPreferences();

  if (!prefs.channels[channelId]) {
    prefs.channels[channelId] = {};
  }

  Object.assign(prefs.channels[channelId], updates);
  prefs.channels[channelId].lastUpdated = new Date().toISOString();

  channelManager.save(prefs);
  return prefs.channels[channelId];
}

/**
 * Delete channel preference
 * Returns true if entry existed
 */
function deleteChannelPreference(channelId) {
  const prefs = loadChannelPreferences();
  const existed = channelId in prefs.channels;
  delete prefs.channels[channelId];
  channelManager.save(prefs);
  return existed;
}

/**
 * Get all channel preferences
 * Returns the channels sub-object
 */
function getAllChannelPreferences() {
  const prefs = loadChannelPreferences();
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

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Class (if needed for extensions)
  PreferenceManager,

  // User preferences
  loadUserPreferences,
  getUserPreference,
  updateUserPreference,
  isUserSilenced,
  getUserCooldown,
  getLastResponseTime,
  recordLastResponseTime,

  // Channel preferences
  loadChannelPreferences,
  getChannelPreference,
  updateChannelPreference,
  deleteChannelPreference,
  getAllChannelPreferences,
  getVectorId,
  isChannelSubscribed,
};
