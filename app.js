require('dotenv').config();
const express = require('express');
const { WebClient } = require('@slack/web-api');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('@xenova/transformers');
const userPrefs = require('./user-preferences');
const channelConfigModule = require('./channel-config');
const modalDefs = require('./modal-definitions');

const app = express();
const port = process.env.PORT || 3000;

// Configuration
const MAX_COMPLETION_TOKENS = parseInt(process.env.MAX_COMPLETION_TOKENS) || 4000; // Higher default for reasoning models
const RESPONSE_COOLDOWN_SECONDS = parseInt(process.env.RESPONSE_COOLDOWN_SECONDS) || 300; // 5 minutes default
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
const MODEL = process.env.MODEL || 'gpt-5-mini'; // OpenAI model to use
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE) || 2000; // Characters per chunk
const MAX_CHUNKS = parseInt(process.env.MAX_CHUNKS) || 5; // Number of chunks to include
const HELP_FOOTER = '\n\n_Type `/dasilva help` for more information_';
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(id => id.trim()).filter(Boolean);

// Helper for debug logging
function debug(...args) {
  if (DEBUG_MODE) {
    console.log('[DEBUG]', ...args);
  }
}

// Helper to check if user is admin
function isAdmin(userId) {
  return ADMIN_USERS.includes(userId);
}

// Rate limiting: Track last response time per user per channel
const lastResponseTimes = new Map(); // key: "channelId:userId", value: timestamp

// Embedder will be initialized asynchronously
let embedder = null;
let isInitialized = false;

// Initialize clients
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
  maxRetries: 2   // Retry twice on failure
});

// Load channel configurations and documentation
const channelConfig = channelConfigModule.loadChannelConfig();

// This will be populated asynchronously
const channelDocs = {};
const channelInstructions = {}; // Always-included instructions per channel

// Initialize embedder and load documentation
async function initializeDocumentation() {
  console.log('Initializing embedding model...');
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Embedding model loaded!');

  console.log('Loading and embedding documentation...');
  
  for (const [channelId, config] of Object.entries(channelConfig.channels)) {
    const docsPath = path.join(__dirname, 'docs', config.docsFolder);
    
    if (!fs.existsSync(docsPath)) {
      console.warn(`Warning: Docs folder not found for channel ${config.name}: ${docsPath}`);
      continue;
    }

    // Load instructions file (always included, not chunked)
    if (config.instructionsFile) {
      const instructionsPath = path.join(docsPath, config.instructionsFile);
      if (fs.existsSync(instructionsPath)) {
        channelInstructions[channelId] = fs.readFileSync(instructionsPath, 'utf-8');
        console.log(`Loaded instructions for ${config.name}`);
      } else {
        console.warn(`Warning: Instructions file not found: ${instructionsPath}`);
        channelInstructions[channelId] = 'Answer questions based only on the provided documentation.';
      }
    } else {
      channelInstructions[channelId] = 'Answer questions based only on the provided documentation.';
    }

    // Load all other markdown files (excluding instructions file)
    const files = fs.readdirSync(docsPath)
      .filter(f => f.endsWith('.md') && f !== config.instructionsFile);
    
    console.log(`Found ${files.length} markdown files in ${docsPath}:`, files);
    
    const chunks = [];
    
    // Load and chunk files
    for (const file of files) {
      const filePath = path.join(docsPath, file);
      console.log(`Reading file: ${filePath}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      console.log(`  File length: ${content.length} characters`);
      const fileChunks = chunkText(content, CHUNK_SIZE);
      console.log(`  Created ${fileChunks.length} chunks`);
      
      fileChunks.forEach((chunk, index) => {
        chunks.push({
          text: chunk,
          source: file,
          chunkIndex: index
        });
      });
    }
    
    console.log(`Total chunks to embed: ${chunks.length}`);
    
    // Generate embeddings for all chunks
    console.log(`Embedding ${chunks.length} chunks for ${config.name}...`);
    for (const chunk of chunks) {
      const output = await embedder(chunk.text, { pooling: 'mean', normalize: true });
      chunk.embedding = Array.from(output.data);
    }

    channelDocs[channelId] = chunks;
    console.log(`✓ Loaded ${chunks.length} chunks from ${files.length} documents for ${config.name} (${channelId})`);
  }

  console.log('Documentation loading complete!');
  isInitialized = true;
}

// Helper: Split text into chunks
function chunkText(text, chunkSize) {
  const chunks = [];
  const paragraphs = text.split('\n\n');
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Helper: Find most relevant chunks using semantic similarity
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function findRelevantChunks(chunks, query, maxChunks) {
  if (!embedder) {
    console.error('Embedder not initialized yet');
    return [];
  }
  
  // Generate embedding for the query
  const queryEmbedding = await embedder(query, { pooling: 'mean', normalize: true });
  const queryVector = Array.from(queryEmbedding.data);
  
  // Score all chunks by semantic similarity
  const scoredChunks = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(queryVector, chunk.embedding)
  }));
  
  // Return top matches
  return scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks);
}

// Helper: Check if message looks like a question that needs answering
function looksLikeQuestion(text) {
  const lowerText = text.toLowerCase().trim();
  
  // Ends with question mark
  if (lowerText.endsWith('?')) return true;
  
  // Starts with question words
  const questionStarters = ['what', 'when', 'where', 'who', 'why', 'how', 'which', 'can', 'could', 'would', 'should', 'is', 'are', 'does', 'do'];
  const firstWord = lowerText.split(' ')[0];
  if (questionStarters.includes(firstWord)) return true;
  
  // Contains help/explain/tell keywords
  const helpKeywords = ['help', 'explain', 'tell me', 'show me', 'how do', 'what is', 'where can'];
  if (helpKeywords.some(keyword => lowerText.includes(keyword))) return true;
  
  return false;
}

// Helper: Check if we should respond based on rate limiting
function shouldRespondToUser(channelId, userId) {
  const key = `${channelId}:${userId}`;
  const lastTime = lastResponseTimes.get(key);

  if (!lastTime) return true;

  // Check for custom cooldown, otherwise use default
  const customCooldown = userPrefs.getUserCooldown(userId);
  const cooldown = customCooldown !== null ? customCooldown : RESPONSE_COOLDOWN_SECONDS;

  const timeSinceLastResponse = (Date.now() - lastTime) / 1000;
  return timeSinceLastResponse >= cooldown;
}

// Helper: Record that we responded to a user
function recordResponse(channelId, userId) {
  const key = `${channelId}:${userId}`;
  lastResponseTimes.set(key, Date.now());
}

// Middleware to parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.send('dasilva is alive! 🤖');
});

// Slack slash command endpoint
app.post('/slack/commands', async (req, res) => {
  // Set a safety timeout to respond within 2.5 seconds no matter what
  const safetyTimeout = setTimeout(() => {
    if (!res.headersSent) {
      console.warn('Slash command took too long - sending fallback response');
      res.json({
        response_type: 'ephemeral',
        text: '⏳ Request is taking longer than expected. Please try again.'
      });
    }
  }, 2500);

  try {
    const { command, text, user_id, trigger_id } = req.body;

    // Verify it's our command
    if (command !== '/dasilva') {
      clearTimeout(safetyTimeout);
      return res.status(404).send('Unknown command');
    }

    // Check if bot is ready (within first 100ms to ensure fast response)
    if (!isInitialized) {
      clearTimeout(safetyTimeout);
      return res.json({
        response_type: 'ephemeral',
        text: '⏳ Bot is still initializing. Please wait a moment and try again.'
      });
    }

    // Parse the subcommand
    const args = text.trim().toLowerCase();

    let responseText = '';

    // Handle different subcommands
    if (args === 'help' || args === 'about' || args === '') {
      const userPref = userPrefs.getUserPreference(user_id);
      const silencedStatus = userPref.silenced ? 'Yes' : 'No';
      const cooldownStatus = userPref.customCooldown !== null
        ? `${userPref.customCooldown / 60} minutes`
        : `Default (${RESPONSE_COOLDOWN_SECONDS / 60} minutes)`;

      responseText = `

I monitor specific channels and help answer questions.

*How I responsd:*
• *@mention me* - I reply *publicly* in the channel
• *Ask a question in the channel* - I may reply *privately* (DM) to avoid channel spam and not discourage participation

#What do I know:*
• I’m trained on internal and external documentation relevant to this channel’s topics

*Slash Commands:*
• \`/dasilva help\` - Show this message
• \`/dasilva silence\` - Pause private (ambient) responses
• \`/dasilva unsilence\` - Resume private responses
• \`/dasilva cooldown <minutes>\` - Set cooldown (0-1440 minutes)

*Your current settings:*
• Silenced: ${silencedStatus}
• Cooldown: ${cooldownStatus}`;

      // Add admin commands to help if user is admin
      if (isAdmin(user_id)) {
        responseText += `

*Admin Commands:*
• \`/dasilva addchannel\` - Add new channel configuration
• \`/dasilva editchannel <channel_id>\` - Edit existing channel
• \`/dasilva deletechannel <channel_id>\` - Remove channel configuration
• \`/dasilva listchannels\` - List all configured channels`;
      }
    } else if (args === 'silence') {
      userPrefs.updateUserPreference(user_id, { silenced: true });
      responseText = "✓ You've been silenced. You won't receive ambient responses. Use `/dasilva unsilence` to resume. (@mentions still work!)";
      console.log(`User ${user_id} enabled silence mode via slash command`);
    } else if (args === 'unsilence') {
      userPrefs.updateUserPreference(user_id, { silenced: false });
      responseText = "✓ Welcome back! You'll now receive ambient responses when you ask questions.";
      console.log(`User ${user_id} disabled silence mode via slash command`);
    } else if (args.startsWith('cooldown ')) {
      const minutesMatch = args.match(/^cooldown\s+(\d+)$/);
      if (!minutesMatch) {
        responseText = "❌ Invalid cooldown format. Use a number like: `/dasilva cooldown 10` (for 10 minutes).";
      } else {
        const minutes = parseInt(minutesMatch[1], 10);
        if (minutes < 0 || minutes > 1440) {
          responseText = `❌ Cooldown must be between 0 and 1440 minutes (24 hours). You provided: ${minutes} minutes.`;
        } else {
          const cooldownSeconds = minutes * 60;
          userPrefs.updateUserPreference(user_id, { customCooldown: cooldownSeconds });
          const minuteText = minutes === 1 ? 'minute' : 'minutes';
          responseText = `✓ Your cooldown has been set to ${minutes} ${minuteText}.`;
          console.log(`User ${user_id} set custom cooldown to ${minutes} minutes via slash command`);
        }
      }
    } else if (args === 'addchannel') {
      // Admin-only command
      if (!isAdmin(user_id)) {
        responseText = '❌ You must be an admin to configure channels.';
      } else {
        // Respond immediately to avoid timeout, then open modal asynchronously
        clearTimeout(safetyTimeout);
        res.json({
          response_type: 'ephemeral',
          text: 'Opening configuration modal...'
        });

        // Open modal asynchronously (don't await here)
        openAddChannelModal(trigger_id).catch(error => {
          console.error('Error opening add channel modal:', error);
        });
        return;
      }
    } else if (args.startsWith('editchannel')) {
      // Admin-only command
      if (!isAdmin(user_id)) {
        responseText = '❌ You must be an admin to configure channels.';
      } else {
        const channelIdMatch = args.match(/^editchannel\s+([A-Z0-9]+)$/i);
        if (!channelIdMatch) {
          responseText = '❌ Invalid format. Use: `/dasilva editchannel C0AB1P97UBB`';
        } else {
          const channelId = channelIdMatch[1].toUpperCase();
          const config = channelConfigModule.getChannel(channelId);
          if (!config) {
            responseText = `❌ Channel ${channelId} is not configured.`;
          } else {
            // Respond immediately to avoid timeout, then open modal asynchronously
            clearTimeout(safetyTimeout);
            res.json({
              response_type: 'ephemeral',
              text: 'Opening configuration modal...'
            });

            // Open modal asynchronously (don't await here)
            openEditChannelModal(trigger_id, channelId, config).catch(error => {
              console.error('Error opening edit channel modal:', error);
            });
            return;
          }
        }
      }
    } else if (args.startsWith('deletechannel')) {
      // Admin-only command
      if (!isAdmin(user_id)) {
        responseText = '❌ You must be an admin to configure channels.';
      } else {
        const channelIdMatch = args.match(/^deletechannel\s+([A-Z0-9]+)$/i);
        if (!channelIdMatch) {
          responseText = '❌ Invalid format. Use: `/dasilva deletechannel C0AB1P97UBB`';
        } else {
          const channelId = channelIdMatch[1].toUpperCase();
          const config = channelConfigModule.getChannel(channelId);
          if (!config) {
            responseText = `❌ Channel ${channelId} is not configured.`;
          } else {
            // Respond immediately to avoid timeout, then open modal asynchronously
            clearTimeout(safetyTimeout);
            res.json({
              response_type: 'ephemeral',
              text: 'Opening confirmation modal...'
            });

            // Open modal asynchronously (don't await here)
            openDeleteConfirmationModal(trigger_id, channelId, config).catch(error => {
              console.error('Error opening delete confirmation modal:', error);
            });
            return;
          }
        }
      }
    } else if (args === 'listchannels') {
      // Admin-only command
      if (!isAdmin(user_id)) {
        responseText = '❌ You must be an admin to view channel configurations.';
      } else {
        const channels = channelConfigModule.getAllChannels();
        if (channels.length === 0) {
          responseText = 'No channels configured yet. Use `/dasilva addchannel` to add one.';
        } else {
          responseText = '*Configured Channels:*\n\n' +
            channels.map(([id, cfg]) =>
              `• *${cfg.name}* (\`${id}\`)\n  Docs: \`${cfg.docsFolder}\` | Instructions: \`${cfg.instructionsFile}\``
            ).join('\n\n');
        }
      }
    } else {
      responseText = `❌ Unknown command: \`${text}\`\n\nType \`/dasilva help\` to see available commands.`;
    }

    // Respond ephemerally (only visible to the user)
    clearTimeout(safetyTimeout);
    res.json({
      response_type: 'ephemeral',
      text: responseText
    });

  } catch (error) {
    console.error('Error handling slash command:', error);
    clearTimeout(safetyTimeout);
    if (!res.headersSent) {
      res.json({
        response_type: 'ephemeral',
        text: '❌ Sorry, there was an error processing your command. Please try again.'
      });
    }
  }
});

// Slack event endpoint
app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;

  // Handle Slack URL verification challenge
  if (type === 'url_verification') {
    return res.send({ challenge });
  }

  // Respond quickly to Slack (required within 3 seconds)
  res.status(200).send();

  // Handle app mentions
  if (event && event.type === 'app_mention') {
    await handleMention(event);
    return; // Don't process as regular message
  }

  // Handle channel messages (ignore bot messages and mentions to prevent loops)
  if (event && event.type === 'message' && !event.bot_id && !event.subtype) {
    // Skip if this is a mention (already handled above as app_mention)
    if (event.text && event.text.match(/<@[A-Z0-9]+>/)) {
      debug('Skipping message - contains mention');
      return;
    }
    await handleChannelMessage(event);
  }
});

// Slack interactions endpoint (for modals)
app.post('/slack/interactions', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload);
    const { type, user, view } = payload;

    debug('Interaction received:', { type, callback_id: view?.callback_id, user_id: user.id });

    // Handle modal submissions
    if (type === 'view_submission') {
      const callback_id = view.callback_id;

      if (callback_id === 'add_channel_modal') {
        const result = await handleAddChannelSubmission(view, user.id);
        return res.json(result);
      } else if (callback_id === 'edit_channel_modal') {
        const result = await handleEditChannelSubmission(view, user.id);
        return res.json(result);
      } else if (callback_id === 'delete_channel_modal') {
        const result = await handleDeleteChannelConfirmation(view, user.id);
        return res.json(result);
      }
    }

    // Default response for unhandled interactions
    res.status(200).send();

  } catch (error) {
    console.error('Error handling interaction:', error);
    res.status(200).json({
      response_action: 'errors',
      errors: {
        channel_id_block: 'An error occurred processing your request. Please try again.'
      }
    });
  }
});

// Modal opener functions
async function openAddChannelModal(triggerId) {
  try {
    await slackClient.views.open({
      trigger_id: triggerId,
      view: modalDefs.getAddChannelModal()
    });
  } catch (error) {
    console.error('Error opening add channel modal:', error);
    throw error;
  }
}

async function openEditChannelModal(triggerId, channelId, config) {
  try {
    await slackClient.views.open({
      trigger_id: triggerId,
      view: modalDefs.getEditChannelModal(channelId, config)
    });
  } catch (error) {
    console.error('Error opening edit channel modal:', error);
    throw error;
  }
}

async function openDeleteConfirmationModal(triggerId, channelId, config) {
  try {
    await slackClient.views.open({
      trigger_id: triggerId,
      view: modalDefs.getDeleteConfirmationModal(channelId, config.name)
    });
  } catch (error) {
    console.error('Error opening delete confirmation modal:', error);
    throw error;
  }
}

// Modal submission handlers
async function handleAddChannelSubmission(view, userId) {
  // Extract values from modal
  const values = view.state.values;
  const channelId = values.channel_id_block.channel_id.value.trim().toUpperCase();
  const channelName = values.channel_name_block.channel_name.value.trim();
  const docsFolder = values.docs_folder_block.docs_folder.value.trim();
  const instructionsFile = values.instructions_file_block.instructions_file.value.trim();

  console.log(`Admin ${userId} attempting to add channel: ${channelId}`);

  // Add channel using the module
  const result = channelConfigModule.addChannel(channelId, {
    name: channelName,
    docsFolder: docsFolder,
    instructionsFile: instructionsFile
  });

  if (!result.success) {
    // Return validation errors
    if (result.errors) {
      return {
        response_action: 'errors',
        errors: {
          channel_id_block: result.errors.channel_id || undefined,
          channel_name_block: result.errors.channel_name || undefined,
          docs_folder_block: result.errors.docs_folder || undefined,
          instructions_file_block: result.errors.instructions_file || undefined
        }
      };
    } else {
      return {
        response_action: 'errors',
        errors: {
          channel_id_block: result.error
        }
      };
    }
  }

  // Clear the modal immediately (must respond within 3 seconds)
  const response = { response_action: 'clear' };

  // Reload the channel configuration asynchronously (don't await - can take >3s)
  reloadChannel(channelId).then(reloaded => {
    console.log(`✓ Channel ${channelId} added by admin ${userId}. Reload: ${reloaded ? 'success' : 'failed'}`);
  }).catch(error => {
    console.error(`Error reloading channel ${channelId} after add:`, error);
  });

  return response;
}

async function handleEditChannelSubmission(view, userId) {
  // Extract channel ID from private_metadata
  const channelId = view.private_metadata;

  // Extract values from modal
  const values = view.state.values;
  const channelName = values.channel_name_block.channel_name.value.trim();
  const docsFolder = values.docs_folder_block.docs_folder.value.trim();
  const instructionsFile = values.instructions_file_block.instructions_file.value.trim();

  console.log(`Admin ${userId} attempting to edit channel: ${channelId}`);

  // Update channel using the module
  const result = channelConfigModule.updateChannel(channelId, {
    name: channelName,
    docsFolder: docsFolder,
    instructionsFile: instructionsFile
  });

  if (!result.success) {
    // Return validation errors
    if (result.errors) {
      return {
        response_action: 'errors',
        errors: {
          channel_name_block: result.errors.channel_name || undefined,
          docs_folder_block: result.errors.docs_folder || undefined,
          instructions_file_block: result.errors.instructions_file || undefined
        }
      };
    } else {
      return {
        response_action: 'errors',
        errors: {
          channel_name_block: result.error
        }
      };
    }
  }

  // Clear the modal immediately (must respond within 3 seconds)
  // Reload the channel configuration asynchronously (don't await - can take >3s)
  reloadChannel(channelId).then(reloaded => {
    console.log(`✓ Channel ${channelId} updated by admin ${userId}. Reload: ${reloaded ? 'success' : 'failed'}`);
  }).catch(error => {
    console.error(`Error reloading channel ${channelId} after update:`, error);
  });

  return { response_action: 'clear' };
}

async function handleDeleteChannelConfirmation(view, userId) {
  // Extract channel ID from private_metadata
  const channelId = view.private_metadata;

  console.log(`Admin ${userId} attempting to delete channel: ${channelId}`);

  // Delete channel using the module
  const result = channelConfigModule.deleteChannel(channelId);

  if (!result.success) {
    return {
      response_action: 'errors',
      errors: {
        _general: result.error
      }
    };
  }

  // Remove from memory
  delete channelDocs[channelId];
  delete channelInstructions[channelId];

  console.log(`✓ Channel ${channelId} deleted by admin ${userId}`);

  return { response_action: 'clear' };
}

// Reload a single channel's documentation
async function reloadChannel(channelId) {
  const config = channelConfigModule.getChannel(channelId);
  if (!config) {
    console.error(`Cannot reload: Channel ${channelId} not found in config`);
    return false;
  }

  if (!embedder) {
    console.error('Embedder not initialized yet');
    return false;
  }

  try {
    // Clear existing channel data
    delete channelDocs[channelId];
    delete channelInstructions[channelId];

    // Reload using the same logic as initializeDocumentation
    const docsPath = path.join(__dirname, 'docs', config.docsFolder);

    if (!fs.existsSync(docsPath)) {
      console.warn(`Warning: Docs folder not found for channel ${config.name}: ${docsPath}`);
      return false;
    }

    // Load instructions file
    if (config.instructionsFile) {
      const instructionsPath = path.join(docsPath, config.instructionsFile);
      if (fs.existsSync(instructionsPath)) {
        channelInstructions[channelId] = fs.readFileSync(instructionsPath, 'utf-8');
        console.log(`Reloaded instructions for ${config.name}`);
      } else {
        console.warn(`Warning: Instructions file not found: ${instructionsPath}`);
        channelInstructions[channelId] = 'Answer questions based only on the provided documentation.';
      }
    } else {
      channelInstructions[channelId] = 'Answer questions based only on the provided documentation.';
    }

    // Load all other markdown files
    const files = fs.readdirSync(docsPath)
      .filter(f => f.endsWith('.md') && f !== config.instructionsFile);

    const chunks = [];

    // Load and chunk files
    for (const file of files) {
      const filePath = path.join(docsPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const fileChunks = chunkText(content, CHUNK_SIZE);

      fileChunks.forEach((chunk, index) => {
        chunks.push({
          text: chunk,
          source: file,
          chunkIndex: index
        });
      });
    }

    // Generate embeddings for all chunks
    console.log(`Embedding ${chunks.length} chunks for ${config.name}...`);
    for (const chunk of chunks) {
      const output = await embedder(chunk.text, { pooling: 'mean', normalize: true });
      chunk.embedding = Array.from(output.data);
    }

    channelDocs[channelId] = chunks;
    console.log(`✓ Hot-reloaded channel: ${config.name} (${channelId}) - ${chunks.length} chunks from ${files.length} documents`);
    return true;
  } catch (error) {
    console.error(`Error reloading channel ${channelId}:`, error);
    return false;
  }
}

// Handle when bot is mentioned
async function handleMention(event) {
  try {
    const { text, channel, ts, user } = event;
    
    console.log(`? Mention request received from user ${user} (msg: ${ts})`);
    debug(`Mention received in channel ${channel}: ${text}`);
    
    // Check if we have configuration for this channel
    const config = channelConfig.channels[channel];
    if (!config) {
      await slackClient.chat.postMessage({
        channel: channel,
        thread_ts: ts,
        text: "Sorry, I'm not configured for this channel yet."
      });
      return;
    }

    // Get instructions (always included)
    const instructions = channelInstructions[channel] || 'Answer based only on provided documentation.';
    
    // Remove the bot mention from the text
    const userMessage = text.replace(/<@[A-Z0-9]+>/g, '').trim();
    
    // Get relevant chunks based on the user's question
    const allChunks = channelDocs[channel] || [];
    const relevantChunks = await findRelevantChunks(allChunks, userMessage, MAX_CHUNKS);
    
    debug(`Found ${relevantChunks.length} relevant chunks out of ${allChunks.length} total`);
    
    const docsContext = relevantChunks.length > 0
      ? relevantChunks.map(chunk => `[From ${chunk.source}]\n${chunk.text}`).join('\n\n---\n\n')
      : 'No relevant documentation found.';

    // Build messages with instructions + documentation context
    const messages = [
      { 
        role: "system", 
        content: `${instructions}\n\n---\n\n# Available Documentation:\n\n${docsContext}`
      },
      { role: "user", content: userMessage }
    ];

    // Call ChatGPT
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: messages,
      max_completion_tokens: MAX_COMPLETION_TOKENS
    });

    debug('Full completion object:', JSON.stringify(completion, null, 2));
    debug('Choices:', completion.choices);
    debug('First choice:', completion.choices?.[0]);
    
    const reply = completion.choices[0].message.content;
    debug('Reply received:', reply);
    debug('Reply length:', reply?.length || 0);

    // Safety check: ensure we have a reply
    if (!reply || reply.trim().length === 0) {
      console.error('Empty reply from OpenAI');
      console.error('Full response:', JSON.stringify(completion, null, 2));
      await slackClient.chat.postMessage({
        channel: channel,
        thread_ts: ts,
        text: "Sorry, I wasn't able to generate a response. Could you try rephrasing your question?"
      });
      return;
    }

    // Post reply publicly in thread (not ephemeral - mentions are public)
    await slackClient.chat.postMessage({
      channel: channel,
      thread_ts: ts,
      text: reply
    });

    const totalTokens = completion.usage?.total_tokens || 0;
    console.log(`✓ Mention reply (${totalTokens} tokens) sent to channel ${channel} (msg: ${ts})`);

  } catch (error) {
    console.error('Error handling mention:', error);
    
    // Send error message to Slack
    try {
      await slackClient.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: "Sorry, I encountered an error processing your request."
      });
    } catch (slackError) {
      console.error('Error sending error message to Slack:', slackError);
    }
  }
}

// Handle messages in channels the bot is in
async function handleChannelMessage(event) {
  try {
    const { text, user, channel } = event;
    
    debug(`Channel message from user ${user} in ${channel}: ${text}`);

    // Check if we have configuration for this channel
    const config = channelConfig.channels[channel];
    if (!config) {
      // Silently ignore messages from unconfigured channels
      return;
    }

    // Check if user has silenced themselves
    if (userPrefs.isUserSilenced(user)) {
      debug(`Skipping - user ${user} is silenced`);
      return;
    }

    // Smart filter: Only respond to questions/requests
    if (!looksLikeQuestion(text)) {
      debug('Skipping - does not look like a question');
      return;
    }

    // Rate limiting: Check if we recently responded to this user
    if (!shouldRespondToUser(channel, user)) {
      debug(`Skipping - user ${user} in cooldown period`);
      return;
    }

    console.log(`? Public request received from user ${user} in channel ${channel} (msg: ${event.ts})`);

    // Get instructions (always included)
    const instructions = channelInstructions[channel] || 'Answer based only on provided documentation.';
    
    // Get documentation for this channel
    const allChunks = channelDocs[channel] || [];
    const relevantChunks = await findRelevantChunks(allChunks, text, MAX_CHUNKS);
    
    debug(`Found ${relevantChunks.length} relevant chunks out of ${allChunks.length} total`);
    
    const docsContext = relevantChunks.length > 0
      ? relevantChunks.map(chunk => `[From ${chunk.source}]\n${chunk.text}`).join('\n\n---\n\n')
      : 'No relevant documentation found.';

    // Build messages with instructions + documentation context
    const messages = [
      { 
        role: "system", 
        content: `${instructions}\n\n---\n\n# Available Documentation:\n\n${docsContext}`
      },
      { role: "user", content: text }
    ];

    // Call ChatGPT
    debug('Calling OpenAI with', messages[0].content.length, 'chars of context');
    
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: messages,
      max_completion_tokens: MAX_COMPLETION_TOKENS
    });

    debug('Full completion response:', JSON.stringify(completion, null, 2));
    const reply = completion.choices[0].message.content;
    debug('Reply received:', reply);
    debug('Reply length:', reply?.length || 0);

    // Safety check: ensure we have a reply
    if (!reply || reply.trim().length === 0) {
      console.error('Empty reply from OpenAI');
      await slackClient.chat.postEphemeral({
        channel: channel,
        user: user,
        text: "Sorry, I wasn't able to generate a response. Could you try rephrasing your question?" + HELP_FOOTER
      });
      return;
    }

    // Send ephemeral message (only visible to the user who posted)
    await slackClient.chat.postEphemeral({
      channel: channel,  // Post in the same channel
      user: user,        // Only this user can see it
      text: `_Only visible to you:_\n\n${reply}${HELP_FOOTER}`
    });

    // Record that we responded to this user
    recordResponse(channel, user);

    const totalTokens = completion.usage?.total_tokens || 0;
    console.log(`✓ Ephemeral reply (${totalTokens} tokens) sent to user ${user} in channel ${channel} (msg: ${event.ts})`);

  } catch (error) {
    console.error('Error handling channel message:', error);
    console.error('Error details:', error.message);

    // Notify user of error via ephemeral message
    try {
      await slackClient.chat.postEphemeral({
        channel: event.channel,
        user: event.user,
        text: "Sorry, I encountered an error processing your message. Please try again." + HELP_FOOTER
      });
    } catch (slackError) {
      console.error('Error sending error message to Slack:', slackError);
    }
  }
}

// Initialize everything and start server
async function startServer() {
  try {
    await initializeDocumentation();
    
    app.listen(port, () => {
      console.log(`dasilva listening on port ${port}`);
      console.log('Ready to answer questions!');
    });
  } catch (error) {
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
}

startServer();