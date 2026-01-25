const fs = require('fs');
const path = require('path');

const PREFS_FILE = path.join(__dirname, 'user-preferences.json');

// In-memory cache
let preferencesCache = null;

/**
 * Load preferences from file into memory cache
 * Creates default file if it doesn't exist
 */
function loadPreferences() {
  if (preferencesCache !== null) {
    return preferencesCache;
  }

  try {
    if (fs.existsSync(PREFS_FILE)) {
      const data = fs.readFileSync(PREFS_FILE, 'utf8');
      preferencesCache = JSON.parse(data);
      console.log('Loaded user preferences from file');
    } else {
      // Create default preferences
      preferencesCache = { users: {} };
      savePreferences(preferencesCache);
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

    // Start fresh with defaults
    preferencesCache = { users: {} };
  }

  return preferencesCache;
}

/**
 * Save preferences to file
 */
function savePreferences(preferences) {
  try {
    const data = JSON.stringify(preferences, null, 2);
    fs.writeFileSync(PREFS_FILE, data, 'utf8');
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
      silenced: false,
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
      silenced: false,
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
