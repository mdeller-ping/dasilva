require('dotenv').config();
const express = require('express');
const { WebClient } = require('@slack/web-api');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('@xenova/transformers');
const axios = require('axios');
const util = require('util');
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
const AMBIENT_MODE = process.env.AMBIENT_MODE === 'true';
const LOG_CHANNEL = process.env.LOG_CHANNEL || null;

// Logging helpers: always log to console, optionally forward to a Slack channel
function sendToLogChannel(text) {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const flat = text.replace(/\s+/g, ' ');
  slackClient.chat.postMessage({ channel: LOG_CHANNEL, text: `\`${timestamp}: ${flat}\`` }).catch(err => {
    console.error(`[LOG_CHANNEL] Failed to post to ${LOG_CHANNEL}:`, err.message);
  });
}

function log(...args) {
  console.log(...args);
  if (LOG_CHANNEL) {
    sendToLogChannel(util.format(...args));
  }
}

function logError(...args) {
  console.error(...args);
  if (LOG_CHANNEL) {
    sendToLogChannel(`[ERROR] ${util.format(...args)}`);
  }
}

function logWarn(...args) {
  console.warn(...args);
  if (LOG_CHANNEL) {
    sendToLogChannel(`[WARN] ${util.format(...args)}`);
  }
}

// Helper for debug logging (console-only, not forwarded to Slack)
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

// Ensure channels directory exists on startup
if (process.env.PERSISTENT_STORAGE) {
  log(`[GLOBAL]: Using persistent storage: ${process.env.PERSISTENT_STORAGE}`);
}
if (!fs.existsSync(channelConfigModule.CHANNELS_DIR)) {
  fs.mkdirSync(channelConfigModule.CHANNELS_DIR, { recursive: true });
  log(`[GLOBAL]: Created channels directory: ${channelConfigModule.CHANNELS_DIR}`);
}

// This will be populated asynchronously
const channelDocs = {};
const channelInstructions = {}; // Always-included instructions per channel

// Initialize embedder and load documentation
async function initializeDocumentation() {
  log('[GLOBAL]: Initializing embedding model...');
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  log('[GLOBAL]: Embedding model loaded!');

  log('[GLOBAL]: Loading and embedding documentation...');

  for (const [channelId, config] of channelConfigModule.getAllChannels()) {
    const channelPath = config.channelPath;

    if (!fs.existsSync(channelPath)) {
      logWarn(`[${channelId}]: Warning: Channel folder not found: ${channelPath}`);
      continue;
    }

    // Load instructions file (always included, not chunked)
    const instructionsPath = path.join(channelPath, channelConfigModule.INSTRUCTIONS_FILE);
    if (fs.existsSync(instructionsPath)) {
      channelInstructions[channelId] = fs.readFileSync(instructionsPath, 'utf-8');
      log(`[${channelId}]: Loaded instructions for`);
    } else {
      channelInstructions[channelId] = 'Answer questions based only on the provided documentation.';
    }

    // Load all other markdown files (excluding instructions file)
    const files = fs.readdirSync(channelPath)
      .filter(f => f.endsWith('.md') && f !== channelConfigModule.INSTRUCTIONS_FILE);

    log(`[${channelId}]: Found ${files.length} markdown files:`, files);

    const chunks = [];

    // Load and chunk files
    for (const file of files) {
      const filePath = path.join(channelPath, file);
      log(`[${channelId}]: Reading file: ${file}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      log(`[${channelId}]:   File length: ${content.length} characters`);
      const fileChunks = chunkText(content, CHUNK_SIZE);
      log(`[${channelId}]:   Created ${fileChunks.length} chunks`);

      fileChunks.forEach((chunk, index) => {
        chunks.push({
          text: chunk,
          source: file,
          chunkIndex: index
        });
      });
    }

    log(`[${channelId}]: Total chunks to embed: ${chunks.length}`);

    // Generate embeddings for all chunks
    log(`[${channelId}]: Embedding ${chunks.length} chunks...`);
    for (const chunk of chunks) {
      const output = await embedder(chunk.text, { pooling: 'mean', normalize: true });
      chunk.embedding = Array.from(output.data);
    }

    channelDocs[channelId] = chunks;
    log(`[${channelId}]: Loaded ${chunks.length} chunks from ${files.length} documents`);
  }

  log('[GLOBAL]: Documentation loading complete!');
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
    logError('Embedder not initialized yet');
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
  res.send('dasilva is alive!');
});

// Slack slash command endpoint
app.post('/slack/commands', async (req, res) => {
  // Set a safety timeout to respond within 2.5 seconds no matter what
  const safetyTimeout = setTimeout(() => {
    if (!res.headersSent) {
      logWarn('Slash command took too long - sending fallback response');
      res.json({
        response_type: 'ephemeral',
        text: 'Request is taking longer than expected. Please try again.'
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
        text: 'Bot is still initializing. Please wait a moment and try again.'
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
- *@mention me* - I reply *publicly* in the channel
- *Ask a question in the channel* - I may reply *privately* (DM) to avoid channel spam and not discourage participation

*What do I know:*
- I’m trained on internal and external documentation relevant to this channel’s topics

*Slash Commands:*
- \`/dasilva help\` - Show this message
- \`/dasilva silence\` - Pause private (ambient) responses
- \`/dasilva unsilence\` - Allow private (ambient) responses
- \`/dasilva cooldown <minutes>\` - Set cooldown (0-1440 minutes)

*Your current settings:*
- Silenced: ${silencedStatus}
- Cooldown: ${cooldownStatus}`;

      // Add admin commands to help if user is admin
      if (isAdmin(user_id)) {
        responseText += `

*Admin Commands:*
- \`/dasilva subscribe\` - Add current channel to configuration
- \`/dasilva leave\` - Remove current channel from configuration
- \`/dasilva list\` - List all configured channels`;
      }
    } else if (args === 'silence') {
      userPrefs.updateUserPreference(user_id, { silenced: true });
      responseText = "DaSilva has been silenced. You won't receive ambient responses. Use `/dasilva unsilence` to resume. (@mentions still work!)";
      log(`[${channelId}]: User ${user_id} enabled silence mode via slash command`);
    } else if (args === 'unsilence') {
      userPrefs.updateUserPreference(user_id, { silenced: false });
      responseText = "You'll now receive ambient responses when you ask questions.";
      log(`User ${user_id} disabled silence mode via slash command`);
    } else if (args.startsWith('cooldown ')) {
      const minutesMatch = args.match(/^cooldown\s+(\d+)$/);
      if (!minutesMatch) {
        responseText = "Invalid cooldown format. Use a number like: `/dasilva cooldown 10` (for 10 minutes).";
      } else {
        const minutes = parseInt(minutesMatch[1], 10);
        if (minutes < 0 || minutes > 1440) {
          responseText = `Cooldown must be between 0 and 1440 minutes (24 hours). You provided: ${minutes} minutes.`;
        } else {
          const cooldownSeconds = minutes * 60;
          userPrefs.updateUserPreference(user_id, { customCooldown: cooldownSeconds });
          const minuteText = minutes === 1 ? 'minute' : 'minutes';
          responseText = `Your cooldown has been set to ${minutes} ${minuteText}.`;
          log(`User ${user_id} set custom cooldown to ${minutes} minutes via slash command`);
        }
      }
    } else if (args === 'subscribe') {
      // Admin-only command
      if (!isAdmin(user_id)) {
        responseText = 'You must be an admin to configure channels.';
      } else {
        // Use the current channel context
        const channelId = req.body.channel_id;

        // Check if channel already exists
        if (channelConfigModule.channelExists(channelId)) {
          responseText = `Channel <#${channelId}> is already configured.`;
        } else {
          // Add channel configuration (creates the directory)
          const result = channelConfigModule.subscribe(channelId);

          if (result.success) {
            responseText = `Channel <#${channelId}> configured successfully!\n\nChannel folder: \`${path.join(channelConfigModule.CHANNELS_DIR, channelId)}\`\n\n_Add markdown files to the channel folder and I'll start using them. Use \`_instructions.md\` for system instructions._`;

            // Reload channel asynchronously
            reloadChannel(channelId).then(reloaded => {
              log(`Channel ${channelId} added by admin ${user_id}. Reload: ${reloaded ? 'success' : 'no docs yet'}`);
            }).catch(error => {
              logError(`Error reloading channel ${channelId}:`, error);
            });
          } else {
            responseText = `Failed to add channel: ${result.error}`;
          }
        }
      }
    } else if (args === 'leave') {
      // Admin-only command
      if (!isAdmin(user_id)) {
        responseText = 'You must be an admin to configure channels.';
      } else {
        // Use the current channel context
        const channelId = req.body.channel_id;

        if (!channelConfigModule.channelExists(channelId)) {
          responseText = `This channel is not configured.`;
        } else {
          // Respond immediately to avoid timeout, then open modal asynchronously
          clearTimeout(safetyTimeout);
          res.json({
            response_type: 'ephemeral',
            text: 'Opening leave confirmation...'
          });

          // Open modal asynchronously (don't await here)
          openLeaveChannelModal(trigger_id, channelId).catch(error => {
            logError('Error opening leave channel modal:', error);
          });
          return;
        }
      }
    } else if (args === 'list') {
      // Admin-only command
      if (!isAdmin(user_id)) {
        responseText = 'You must be an admin to view channel configurations.';
      } else {
        const channels = channelConfigModule.getAllChannels();
        if (channels.length === 0) {
          responseText = 'No channels configured yet. Use `/dasilva subscribe` to add one.';
        } else {
          responseText = '*Configured Channels:*\n\n' +
            channels.map(([id]) =>
              `• <#${id}> (\`${id}\`)\n  Path: \`${path.join(channelConfigModule.CHANNELS_DIR, id)}\``
            ).join('\n\n');
        }
      }
    } else {
      responseText = `Unknown command: \`${text}\`\n\nType \`/dasilva help\` to see available commands.`;
    }

    // Respond ephemerally (only visible to the user)
    clearTimeout(safetyTimeout);
    res.json({
      response_type: 'ephemeral',
      text: responseText
    });

  } catch (error) {
    logError('Error handling slash command:', error);
    clearTimeout(safetyTimeout);
    if (!res.headersSent) {
      res.json({
        response_type: 'ephemeral',
        text: 'Sorry, there was an error processing your command. Please try again.'
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

  // Log all incoming events for debugging
  debug(`Event received: type=${event?.type}, subtype=${event?.subtype}`);

  // Handle file uploads (message with file_share subtype)
  if (event && event.type === 'message' && event.subtype === 'file_share') {
    debug('File share message detected');
    if (event.files && event.files.length > 0) {
      for (const file of event.files) {
        await handleFileUpload({
          file_id: file.id,
          channel_id: event.channel,
          user_id: event.user
        });
      }
    }
    return;
  }

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

  // Handle file uploads
  if (event && event.type === 'file_shared') {
    await handleFileUpload(event);
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

      if (callback_id === 'leave_channel_modal') {
        const result = await handleLeaveChannelSubmission(view, user.id);
        return res.json(result);
      }
    }

    // Default response for unhandled interactions
    res.status(200).send();

  } catch (error) {
    logError('Error handling interaction:', error);
    res.status(200).json({
      response_action: 'errors',
      errors: {
        channel_id_block: 'An error occurred processing your request. Please try again.'
      }
    });
  }
});

// Modal opener functions
async function openLeaveChannelModal(triggerId, channelId) {
  try {
    await slackClient.views.open({
      trigger_id: triggerId,
      view: modalDefs.leaveChannelModal(channelId)
    });
  } catch (error) {
    logError('Error opening leave channel modal:', error);
    throw error;
  }
}

// Modal submission handlers
async function handleLeaveChannelSubmission(view, userId) {
  // Extract channel ID from private_metadata
  const channelId = view.private_metadata;

  // Verify the channel exists
  if (!channelConfigModule.channelExists(channelId)) {
    return {
      response_action: 'errors',
      errors: {
        confirmation_block: 'Channel not found'
      }
    };
  }

  // Extract confirmation input from modal
  const values = view.state.values;
  const confirmationInput = values.confirmation_block.confirmation_input.value.trim();

  log(`Admin ${userId} attempting to leave channel: ${channelId}`);

  // Validate that user typed the exact channel ID
  if (confirmationInput !== channelId) {
    return {
      response_action: 'errors',
      errors: {
        confirmation_block: `You must type "${channelId}" exactly to confirm deletion`
      }
    };
  }

  // Delete the channel (removes the directory)
  const result = channelConfigModule.leave(channelId);

  if (!result.success) {
    return {
      response_action: 'errors',
      errors: {
        confirmation_block: result.error
      }
    };
  }

  // Remove from memory
  delete channelDocs[channelId];
  delete channelInstructions[channelId];

  log(`Channel ${channelId} deleted by admin ${userId}`);

  // Clear the modal
  return { response_action: 'clear' };
}

// Reload a single channel's documentation
async function reloadChannel(channelId) {
  const config = channelConfigModule.getChannel(channelId);
  if (!config) {
    logError(`Cannot reload: Channel ${channelId} not found`);
    return false;
  }

  if (!embedder) {
    logError('Embedder not initialized yet');
    return false;
  }

  try {
    // Clear existing channel data
    delete channelDocs[channelId];
    delete channelInstructions[channelId];

    const channelPath = config.channelPath;

    if (!fs.existsSync(channelPath)) {
      logWarn(`Warning: Channel folder not found: ${channelPath}`);
      return false;
    }

    // Load instructions file
    const instructionsPath = path.join(channelPath, channelConfigModule.INSTRUCTIONS_FILE);
    if (fs.existsSync(instructionsPath)) {
      channelInstructions[channelId] = fs.readFileSync(instructionsPath, 'utf-8');
      log(`Reloaded instructions for ${channelId}`);
    } else {
      channelInstructions[channelId] = 'Answer questions based only on the provided documentation.';
    }

    // Load all other markdown files
    const files = fs.readdirSync(channelPath)
      .filter(f => f.endsWith('.md') && f !== channelConfigModule.INSTRUCTIONS_FILE);

    const chunks = [];

    // Load and chunk files
    for (const file of files) {
      const filePath = path.join(channelPath, file);
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
    log(`Embedding ${chunks.length} chunks for ${channelId}...`);
    for (const chunk of chunks) {
      const output = await embedder(chunk.text, { pooling: 'mean', normalize: true });
      chunk.embedding = Array.from(output.data);
    }

    channelDocs[channelId] = chunks;
    log(`Hot-reloaded channel ${channelId} - ${chunks.length} chunks from ${files.length} documents`);
    return true;
  } catch (error) {
    logError(`Error reloading channel ${channelId}:`, error);
    return false;
  }
}

// Handle when bot is mentioned
async function handleMention(event) {
  try {
    const { text, channel, ts, user } = event;
    
    log(`[${channel}]: @mention request received from user ${user} (msg: ${ts})`);
    debug(`Mention received in channel ${channel}: ${text}`);
    
    // Check if we have configuration for this channel
    const config = channelConfigModule.getChannel(channel);
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
    
    if (allChunks.length === 0) {
      // No documents, skip
      log(`[${channel}]: skipping - no channel documents`);
      await slackClient.chat.postMessage({
        channel: channel,
        thread_ts: ts,
        text: "Sorry, I have not been trained for this channel yet."
      });
      return;
    }

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
      logError('Empty reply from OpenAI');
      logError('Full response:', JSON.stringify(completion, null, 2));
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
    log(`[${channel}]: @mention response (${totalTokens} tokens) sent for ${user} (msg: ${ts})`);

  } catch (error) {
    logError('Error handling mention:', error);
    
    // Send error message to Slack
    try {
      await slackClient.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: "Sorry, I encountered an error processing your request."
      });
    } catch (slackError) {
      logError('Error sending error message to Slack:', slackError);
    }
  }
}

// Handle messages in channels the bot is in
async function handleChannelMessage(event) {
  try {
    const { text, user, channel } = event;
    
    debug(`Channel message from user ${user} in ${channel}: ${text}`);

    // Check if we have configuration for this channel
    const config = channelConfigModule.getChannel(channel);
    if (!config) {
      // Silently ignore messages from unconfigured channels
      debug(`Skipping - channel ${channel} is not subscribed`);
      return;
    }

    debug(`Ambient Mode: ${AMBIENT_MODE}`)

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

    log(`[${channel}]: ambient request received from user ${user} (msg: ${event.ts})`);

    // Get instructions (always included)
    const instructions = channelInstructions[channel] || 'Answer based only on provided documentation.';
    
    // Get documentation for this channel
    const allChunks = channelDocs[channel] || [];
    const relevantChunks = await findRelevantChunks(allChunks, text, MAX_CHUNKS);
    
    if (allChunks.length === 0) {
      // No documents, skip
      log(`[${channel}]: skipping - no channel documents`);
      return;
    }

    debug(`Found ${relevantChunks.length} relevant chunks out of ${allChunks.length} total`);
    
    const docsContext = relevantChunks.length > 0
      ? relevantChunks.map(chunk => `[From ${chunk.source}]\n${chunk.text}`).join('\n\n---\n\n')
      : 'No relevant documentation found.';

    // Build messages with instructions + documentation context
    // For ambient messages, instruct the model to stay silent when unsure
    const ambientGuidance = '\n\nIMPORTANT: This is an ambient channel message, NOT a direct question to you. Only respond if you are confident you can provide a helpful, accurate answer based on the available documentation. If you are not confident, or the documentation does not cover the topic, respond with exactly an empty message (no text at all). Do not apologize or explain that you cannot answer - just return nothing.';

    const messages = [
      {
        role: "system",
        content: `${instructions}\n\n---\n\n# Available Documentation:\n\n${docsContext}${ambientGuidance}`
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

    // If reply is empty, stay silent (low confidence or no relevant answer)
    if (!reply || reply.trim().length === 0) {
      log(`[${channel}]: ambient response NOT sent to user ${user} (out of scope or not relevant)`);
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
    log(`[${channel}]: ambient response (${totalTokens} tokens) sent to user ${user} (msg: ${event.ts})`);

  } catch (error) {
    logError('Error handling channel message:', error);
    logError('Error details:', error.message);
    log(`[${event.channel}]: ambient response NOT sent to user ${event.user} (error: ${error.message})`);

    // Notify user of error via ephemeral message
    try {
      await slackClient.chat.postEphemeral({
        channel: event.channel,
        user: event.user,
        text: "Sorry, I encountered an error processing your message. Please try again." + HELP_FOOTER
      });
    } catch (slackError) {
      logError('Error sending error message to Slack:', slackError);
    }
  }
}

// Track recently processed files to prevent duplicates
const recentlyProcessedFiles = new Map();
const FILE_DEDUP_TTL_MS = 60000; // 1 minute

// Handle file uploads to canvas
async function handleFileUpload(event) {
  try {
    const { file_id, channel_id, user_id } = event;

    debug(`File upload detected: ${file_id} in channel ${channel_id} by user ${user_id}`);

    // Deduplicate: skip if we recently processed this file
    if (recentlyProcessedFiles.has(file_id)) {
      debug(`Skipping - file ${file_id} already processed recently`);
      return;
    }
    recentlyProcessedFiles.set(file_id, Date.now());

    // Clean up old entries periodically
    for (const [id, timestamp] of recentlyProcessedFiles) {
      if (Date.now() - timestamp > FILE_DEDUP_TTL_MS) {
        recentlyProcessedFiles.delete(id);
      }
    }

    // Check if user is admin
    if (!isAdmin(user_id)) {
      debug('Skipping - user is not admin');
      return;
    }

    // Check if we have configuration for this channel
    const config = channelConfigModule.getChannel(channel_id);
    if (!config) {
      debug('Skipping - channel not configured');
      return;
    }

    // Get file information
    const fileInfo = await slackClient.files.info({ file: file_id });
    const file = fileInfo.file;

    debug(`File info: ${file.name}, type: ${file.filetype}, size: ${file.size}`);

    log(`[${channel_id}]: processing file upload: ${file.name}`);

    // Validate file type
    const allowedExtensions = ['md', 'txt', 'text', 'markdown'];
    const fileExtension = file.name.split('.').pop().toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
      debug(`Skipping file upload - unsupported type: .${fileExtension} (${file.name})`);
      return;
    }

    // Download file content
    const fileContent = await downloadSlackFile(file);

    // Save to channel's folder
    const targetPath = path.join(channelConfigModule.CHANNELS_DIR, channel_id, file.name);
    fs.writeFileSync(targetPath, fileContent, 'utf-8');

    log(`[${channel_id}]: saved file to: ${targetPath}`);

    // Re-embed documentation for this channel
    await reEmbedChannel(channel_id);

    // Notify success
    await slackClient.chat.postMessage({
      channel: channel_id,
      text: `Successfully added documentation: *${file.name}*`
    });

    log(`[${channel_id}]: file upload complete: ${file.name}`);

  } catch (error) {
    logError('Error handling file upload:', error);
    logError('Error details:', error.message);

    // Notify user of error
    try {
      await slackClient.chat.postEphemeral({
        channel: event.channel_id,
        user: event.user_id,
        text: `Failed to process file upload: ${error.message}`
      });
    } catch (slackError) {
      logError('Error sending error message to Slack:', slackError);
    }
  }
}

// Helper: Download file from Slack with retry logic
async function downloadSlackFile(file, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(file.url_private, {
        headers: {
          'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
        },
        responseType: 'text',
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      const isRetryable = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND';

      if (isRetryable && attempt < maxRetries) {
        log(`Download attempt ${attempt} failed (${error.code}), retrying in ${attempt}s...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        continue;
      }

      logError('Error downloading file:', error);
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }
}

// Helper: Re-embed documentation for a specific channel
async function reEmbedChannel(channelId) {
  log(`[${channelId}]: re-embedding documentation...`);

  const channelPath = path.join(channelConfigModule.CHANNELS_DIR, channelId);

  if (!fs.existsSync(channelPath)) {
    logWarn(`Warning: Channel folder not found: ${channelPath}`);
    return;
  }

  // Reload instructions file
  const instructionsPath = path.join(channelPath, channelConfigModule.INSTRUCTIONS_FILE);
  if (fs.existsSync(instructionsPath)) {
    channelInstructions[channelId] = fs.readFileSync(instructionsPath, 'utf-8');
    log(`[${channelId}]: reloaded instructions`);
  }

  // Load all markdown files (excluding instructions file)
  const files = fs.readdirSync(channelPath)
    .filter(f => f.endsWith('.md') && f !== channelConfigModule.INSTRUCTIONS_FILE);

  log(`[${channelId}]: found ${files.length} markdown files to embed`);

  const chunks = [];

  // Load and chunk files
  for (const file of files) {
    const filePath = path.join(channelPath, file);
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

  log(`[${channelId}]: embedding ${chunks.length} chunks...`);

  // Generate embeddings for all chunks
  for (const chunk of chunks) {
    const output = await embedder(chunk.text, { pooling: 'mean', normalize: true });
    chunk.embedding = Array.from(output.data);
  }

  // Update the in-memory documentation
  channelDocs[channelId] = chunks;

  log(`[${channelId}]: re-embedded ${chunks.length} chunks from ${files.length} documents`);
}

// Initialize everything and start server
async function startServer() {
  try {
    await initializeDocumentation();
    
    app.listen(port, () => {
      log(`[GLOBAL]: dasilva listening on port ${port}`);
      log('[GLOBAL]: Ready to answer questions!');
    });
  } catch (error) {
    logError('Failed to initialize:', error);
    process.exit(1);
  }
}

startServer();