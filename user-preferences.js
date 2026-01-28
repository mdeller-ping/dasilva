const fs = require('fs');
const path = require('path');
const AMBIENT_MODE = process.env.AMBIENT_MODE === 'true';

const STORAGE_BASE = process.env.PERSISTENT_STORAGE || __dirname;
const PREFS_FILE = path.join(STORAGE_BASE, 'user-preferences.json');

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
          console.log('Loaded user preferences from file');
        }
      } else {
        // Create default preferences if file doesn't exist
        preferencesCache = { users: {} };
        savePreferences(preferencesCache);
        lastModified = Date.now();
        console.log('Created new user preferences file');
      }
    } catch (error) {
      console.error('Error loading user preferences:', error.message);

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
        preferencesCache = { users: {} };
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
    console.error('Error saving user preferences:', error.message);
    console.error('Continuing with in-memory cache only (graceful degradation)');
  }
}

/**
 * Get user preference object
 * Returns default preferences if user not found
 */
function getUserPreference(userId) {
  const prefs = loadPreferences();

  if (!prefs.users[userId]) {
    prefs.users[userId] = {
      silenced: !AMBIENT_MODE,
      customCooldown: null,
      lastUpdated: new Date().toISOString()
    };
  }

  return prefs.users[userId];
}

/**
 * Update user preference
 */
function updateUserPreference(userId, updates) {
  const prefs = loadPreferences();

  if (!prefs.users[userId]) {
    prefs.users[userId] = {
      silenced: !AMBIENT_MODE,
      customCooldown: null,
      lastUpdated: new Date().toISOString()
    };
  }

  // Merge updates
  Object.assign(prefs.users[userId], updates);
  prefs.users[userId].lastUpdated = new Date().toISOString();

  // Save to file
  savePreferences(prefs);

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

module.exports = {
  loadPreferences,
  getUserPreference,
  updateUserPreference,
  isUserSilenced,
  getUserCooldown
};
