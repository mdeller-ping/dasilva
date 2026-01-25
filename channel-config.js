const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'docs', 'channel-config.json');

// In-memory cache
let configCache = null;
let lastModified = null;
let lastCheckTime = 0;
const CHECK_INTERVAL_MS = 5000; // Only check file modification every 5 seconds

/**
 * Load channel configuration from file into memory cache
 * Creates default file if it doesn't exist
 * Uses throttled modification check to automatically reload if file changes
 */
function loadChannelConfig() {
  const now = Date.now();

  // Only check file modification time periodically to reduce overhead
  if (now - lastCheckTime > CHECK_INTERVAL_MS) {
    lastCheckTime = now;

    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const stats = fs.statSync(CONFIG_FILE);
        const currentModified = stats.mtime.getTime();

        // Reload if file changed or cache is empty
        if (configCache === null || lastModified !== currentModified) {
          const data = fs.readFileSync(CONFIG_FILE, 'utf8');
          configCache = JSON.parse(data);
          lastModified = currentModified;
          console.log('Loaded channel configuration from file');
        }
      } else {
        // Create default configuration if file doesn't exist
        configCache = { channels: {} };
        saveChannelConfig(configCache);
        lastModified = Date.now();
        console.log('Created new channel configuration file');
      }
    } catch (error) {
      console.error('Error loading channel configuration:', error.message);

      // Try to create backup if file is corrupted
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const backup = `${CONFIG_FILE}.backup.${Date.now()}`;
          fs.copyFileSync(CONFIG_FILE, backup);
          console.log(`Created backup of corrupted config: ${backup}`);
        } catch (backupError) {
          console.error('Failed to create backup:', backupError.message);
        }
      }

      // Start fresh with defaults if first load, otherwise keep existing cache
      if (configCache === null) {
        configCache = { channels: {} };
      }
    }
  }

  return configCache;
}

/**
 * Save channel configuration to file
 */
function saveChannelConfig(config) {
  try {
    const data = JSON.stringify(config, null, 2);
    fs.writeFileSync(CONFIG_FILE, data, 'utf8');

    // Update lastModified to match the file we just wrote
    // This prevents unnecessary reloads on next check
    const stats = fs.statSync(CONFIG_FILE);
    lastModified = stats.mtime.getTime();
  } catch (error) {
    console.error('Error saving channel configuration:', error.message);
    console.error('Continuing with in-memory cache only (graceful degradation)');
  }
}

/**
 * Get configuration for a specific channel
 * Returns null if channel not found
 */
function getChannel(channelId) {
  const config = loadChannelConfig();
  return config.channels[channelId] || null;
}

/**
 * Get all channels as array of [channelId, config] tuples
 */
function getAllChannels() {
  const config = loadChannelConfig();
  return Object.entries(config.channels);
}

/**
 * Check if a channel exists in the configuration
 */
function channelExists(channelId) {
  const config = loadChannelConfig();
  return config.channels.hasOwnProperty(channelId);
}

/**
 * Add a new channel configuration
 * Returns { success: boolean, error?: string, channel?: object }
 */
function addChannel(channelId, channelConfig) {
  const config = loadChannelConfig();

  // Check if channel already exists
  if (config.channels[channelId]) {
    return {
      success: false,
      error: `Channel ${channelId} already exists. Use updateChannel to modify it.`
    };
  }

  // Validate configuration
  const validation = validateChannelConfig({ channelId, ...channelConfig }, true);
  if (!validation.isValid) {
    return {
      success: false,
      error: 'Validation failed',
      errors: validation.errors
    };
  }

  // Add channel
  config.channels[channelId] = {
    name: channelConfig.name,
    docsFolder: channelConfig.docsFolder,
    instructionsFile: channelConfig.instructionsFile
  };

  // Save to file
  saveChannelConfig(config);

  console.log(`Added channel configuration: ${channelConfig.name} (${channelId})`);

  return {
    success: true,
    channel: config.channels[channelId]
  };
}

/**
 * Update an existing channel configuration
 * Returns { success: boolean, error?: string, channel?: object }
 */
function updateChannel(channelId, channelConfig) {
  const config = loadChannelConfig();

  // Check if channel exists
  if (!config.channels[channelId]) {
    return {
      success: false,
      error: `Channel ${channelId} not found. Use addChannel to create it.`
    };
  }

  // Validate configuration
  const validation = validateChannelConfig({ channelId, ...channelConfig }, false);
  if (!validation.isValid) {
    return {
      success: false,
      error: 'Validation failed',
      errors: validation.errors
    };
  }

  // Update channel
  config.channels[channelId] = {
    name: channelConfig.name,
    docsFolder: channelConfig.docsFolder,
    instructionsFile: channelConfig.instructionsFile
  };

  // Save to file
  saveChannelConfig(config);

  console.log(`Updated channel configuration: ${channelConfig.name} (${channelId})`);

  return {
    success: true,
    channel: config.channels[channelId]
  };
}

/**
 * Delete a channel configuration
 * Returns { success: boolean, error?: string }
 */
function deleteChannel(channelId) {
  const config = loadChannelConfig();

  // Check if channel exists
  if (!config.channels[channelId]) {
    return {
      success: false,
      error: `Channel ${channelId} not found.`
    };
  }

  const channelName = config.channels[channelId].name;

  // Delete channel
  delete config.channels[channelId];

  // Save to file
  saveChannelConfig(config);

  console.log(`Deleted channel configuration: ${channelName} (${channelId})`);

  return {
    success: true
  };
}

/**
 * Validate channel configuration
 * Returns { isValid: boolean, errors: {} }
 */
function validateChannelConfig(config, isNew = false) {
  const errors = {};

  // Channel ID validation
  if (!config.channelId || !/^C[A-Z0-9]{10}$/.test(config.channelId)) {
    errors.channel_id = 'Invalid Slack channel ID format (must start with C followed by 10 alphanumeric characters)';
  }

  // Check if channel ID already exists (for add operation)
  if (isNew && config.channelId && channelExists(config.channelId)) {
    errors.channel_id = 'Channel ID already configured';
  }

  // Channel name validation
  if (!config.name || config.name.trim().length === 0) {
    errors.channel_name = 'Channel name is required';
  }

  // Docs folder validation
  if (!config.docsFolder || config.docsFolder.trim().length === 0) {
    errors.docs_folder = 'Docs folder is required';
  } else {
    const docsPath = path.join(__dirname, 'docs', config.docsFolder);
    if (!fs.existsSync(docsPath)) {
      errors.docs_folder = `Folder does not exist: docs/${config.docsFolder}. Create it using: mkdir -p docs/${config.docsFolder}`;
    }
  }

  // Instructions file validation
  if (!config.instructionsFile || config.instructionsFile.trim().length === 0) {
    errors.instructions_file = 'Instructions file is required';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

module.exports = {
  loadChannelConfig,
  saveChannelConfig,
  getChannel,
  getAllChannels,
  channelExists,
  addChannel,
  updateChannel,
  deleteChannel,
  validateChannelConfig
};
