require("dotenv").config();
const express = require("express");
const { WebClient } = require("@slack/web-api");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("@xenova/transformers");
const axios = require("axios");
const util = require("util");
const userPrefs = require("./user-preferences");
const channelConfigModule = require("./channel-config");
const modalDefs = require("./modal-definitions");

const app = express();
const port = process.env.PORT || 3000;

// Configuration
const MAX_COMPLETION_TOKENS =
  parseInt(process.env.MAX_COMPLETION_TOKENS) || 4000; // Higher default for reasoning models
const RESPONSE_COOLDOWN_SECONDS =
  parseInt(process.env.RESPONSE_COOLDOWN_SECONDS) || 300; // 5 minutes default
const DEBUG_MODE = process.env.DEBUG_MODE === "true";
const MODEL = process.env.MODEL || "gpt-5-mini"; // OpenAI model to use
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE) || 2000; // Characters per chunk
const MAX_CHUNKS = parseInt(process.env.MAX_CHUNKS) || 5; // Number of chunks to include
const THREAD_CONTEXT_MESSAGES =
  parseInt(process.env.THREAD_CONTEXT_MESSAGES) || 10; // Thread history messages to include
const HELP_FOOTER = "\n\n_Type `/dasilva help` for more information_";
const ADMIN_USERS = (process.env.ADMIN_USERS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const AMBIENT_MODE = process.env.AMBIENT_MODE === "true";
const LOG_CHANNEL = process.env.LOG_CHANNEL || null;
const FEEDBACK_EMOJI = process.env.FEEDBACK_EMOJI || "feedback";
const FEEDBACK_CHANNEL = process.env.FEEDBACK_CHANNEL || null;
const AMBIENT_MIN_SCORE = parseFloat(process.env.AMBIENT_MIN_SCORE) || 0.3; // Minimum chunk similarity score for ambient responses

// Logging helpers: always log to console, optionally forward to a Slack channel

function sendToLogChannel(text) {
  const timestamp = new Date().toISOString().replace("T", " ").replace("Z", "");
  const flat = text.replace(/\s+/g, " ");
  slackClient.chat
    .postMessage({ channel: LOG_CHANNEL, text: `\`${timestamp}: ${flat}\`` })
    .catch((err) => {
      console.error(
        `[LOG_CHANNEL] Failed to post to ${LOG_CHANNEL}:`,
        err.message,
      );
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
    console.log("[DEBUG]", ...args);
  }
}

// Helper to check if user is admin
function isAdmin(userId) {
  return ADMIN_USERS.includes(userId);
}

// Rate limiting: Track last response time per user per channel
const lastResponseTimes = new Map(); // key: "channelId:userId", value: timestamp

// Track threads the bot is actively participating in
const activeThreads = new Map(); // key: "channelId:threadTs", value: timestamp of last activity
const ACTIVE_THREAD_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Periodically clean up stale active threads
setInterval(
  () => {
    const now = Date.now();
    for (const [key, lastActivity] of activeThreads) {
      if (now - lastActivity > ACTIVE_THREAD_TTL_MS) {
        activeThreads.delete(key);
      }
    }
  },
  10 * 60 * 1000,
); // Check every 10 minutes

// Embedder will be initialized asynchronously
let embedder = null;
let isInitialized = false;
let botUserId = null;

// Initialize clients
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
  maxRetries: 2, // Retry twice on failure
});

// Ensure channels directory exists on startup
if (process.env.PERSISTENT_STORAGE) {
  log(`[GLOBAL]: Using persistent storage: ${process.env.PERSISTENT_STORAGE}`);
}
if (!fs.existsSync(channelConfigModule.CHANNELS_DIR)) {
  fs.mkdirSync(channelConfigModule.CHANNELS_DIR, { recursive: true });
  log(
    `[GLOBAL]: Created channels directory: ${channelConfigModule.CHANNELS_DIR}`,
  );
}

// This will be populated asynchronously
const channelDocs = {};
const channelInstructions = {}; // Always-included instructions per channel

// Initialize embedder and load documentation
async function initializeDocumentation() {
  log("[GLOBAL]: Initializing embedding model...");
  embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  log("[GLOBAL]: Embedding model loaded!");

  log("[GLOBAL]: Loading and embedding documentation...");

  for (const [channelId, config] of channelConfigModule.getAllChannels()) {
    const channelPath = config.channelPath;

    if (!fs.existsSync(channelPath)) {
      logWarn(
        `[${channelId}]: Warning: Channel folder not found: ${channelPath}`,
      );
      continue;
    }

    // Load instructions file (always included, not chunked)
    const instructionsPath = path.join(
      channelPath,
      channelConfigModule.INSTRUCTIONS_FILE,
    );
    if (fs.existsSync(instructionsPath)) {
      channelInstructions[channelId] = fs.readFileSync(
        instructionsPath,
        "utf-8",
      );
      log(`[${channelId}]: Loaded instructions for`);
    } else {
      channelInstructions[channelId] =
        "Answer questions based only on the provided documentation.";
    }

    // Load all other markdown files (excluding instructions file)
    const files = fs
      .readdirSync(channelPath)
      .filter(
        (f) => f.endsWith(".md") && f !== channelConfigModule.INSTRUCTIONS_FILE,
      );

    log(`[${channelId}]: Found ${files.length} markdown files:`, files);

    const chunks = [];

    // Load and chunk files
    for (const file of files) {
      const filePath = path.join(channelPath, file);
      log(`[${channelId}]: Reading file: ${file}`);
      const content = fs.readFileSync(filePath, "utf-8");
      log(`[${channelId}]:   File length: ${content.length} characters`);
      const fileChunks = chunkText(content, CHUNK_SIZE);
      log(`[${channelId}]:   Created ${fileChunks.length} chunks`);

      fileChunks.forEach((chunk, index) => {
        chunks.push({
          text: chunk,
          source: file,
          chunkIndex: index,
        });
      });
    }

    log(`[${channelId}]: Total chunks to embed: ${chunks.length}`);

    // Generate embeddings for all chunks
    log(`[${channelId}]: Embedding ${chunks.length} chunks...`);
    for (const chunk of chunks) {
      const output = await embedder(chunk.text, {
        pooling: "mean",
        normalize: true,
      });
      chunk.embedding = Array.from(output.data);
    }

    channelDocs[channelId] = chunks;
    log(
      `[${channelId}]: Loaded ${chunks.length} chunks from ${files.length} documents`,
    );
  }

  log("[GLOBAL]: Documentation loading complete!");
  isInitialized = true;
}

// Helper: Split text into chunks
function chunkText(text, chunkSize) {
  const chunks = [];
  const paragraphs = text.split("\n\n");
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (
      (currentChunk + paragraph).length > chunkSize &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// Helper: Find most relevant chunks using semantic similarity
function cosineSimilarity(a, b) {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function findRelevantChunks(chunks, query, maxChunks) {
  if (!embedder) {
    logError("Embedder not initialized yet");
    return [];
  }

  // Generate embedding for the query
  const queryEmbedding = await embedder(query, {
    pooling: "mean",
    normalize: true,
  });
  const queryVector = Array.from(queryEmbedding.data);

  // Score all chunks by semantic similarity
  const scoredChunks = chunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(queryVector, chunk.embedding),
  }));

  // Return top matches
  return scoredChunks.sort((a, b) => b.score - a.score).slice(0, maxChunks);
}

// Helper: Check if message looks like a question that needs answering
function looksLikeQuestion(text) {
  const lowerText = text.toLowerCase().trim();

  // Ends with question mark
  if (lowerText.endsWith("?")) return true;

  // Starts with question words
  const questionStarters = [
    "what",
    "when",
    "where",
    "who",
    "why",
    "how",
    "which",
    "can",
    "could",
    "would",
    "should",
    "is",
    "are",
    "does",
    "do",
  ];
  const firstWord = lowerText.split(" ")[0];
  if (questionStarters.includes(firstWord)) return true;

  // Contains help/explain/tell keywords
  const helpKeywords = [
    "help",
    "explain",
    "tell me",
    "show me",
    "how do",
    "what is",
    "where can",
  ];
  if (helpKeywords.some((keyword) => lowerText.includes(keyword))) return true;

  return false;
}

// Helper: Check if we should respond based on rate limiting
function shouldRespondToUser(channelId, userId) {
  const key = `${channelId}:${userId}`;
  const lastTime = lastResponseTimes.get(key);

  if (!lastTime) return true;

  // Check for custom cooldown, otherwise use default
  const customCooldown = userPrefs.getUserCooldown(userId);
  const cooldown =
    customCooldown !== null ? customCooldown : RESPONSE_COOLDOWN_SECONDS;

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
app.get("/", (req, res) => {
  res.send("dasilva is alive!");
});

// Slack slash command endpoint
app.post("/slack/commands", async (req, res) => {
  // Set a safety timeout to respond within 2.5 seconds no matter what
  const safetyTimeout = setTimeout(() => {
    if (!res.headersSent) {
      logWarn("Slash command took too long - sending fallback response");
      res.json({
        response_type: "ephemeral",
        text: "Request is taking longer than expected. Please try again.",
      });
    }
  }, 2500);

  try {
    const {
      command,
      text,
      user_id: userId,
      trigger_id,
      channel_id: channelId,
    } = req.body;

    // Verify it's our command
    if (command !== "/dasilva") {
      clearTimeout(safetyTimeout);
      return res.status(404).send("Unknown command");
    }

    // Check if bot is ready (within first 100ms to ensure fast response)
    if (!isInitialized) {
      clearTimeout(safetyTimeout);
      return res.json({
        response_type: "ephemeral",
        text: "Bot is still initializing. Please wait a moment and try again.",
      });
    }

    // Parse the subcommand
    const args = text.trim().toLowerCase();

    let responseText = "";

    // Handle different subcommands
    if (args === "help" || args === "about" || args === "") {
      const userPref = userPrefs.getUserPreference(userId);
      const silencedStatus = userPref.silenced ? "Yes" : "No";
      const cooldownStatus =
        userPref.customCooldown !== null
          ? `${userPref.customCooldown / 60} minutes`
          : `Default (${RESPONSE_COOLDOWN_SECONDS / 60} minutes)`;

      responseText = `

I monitor specific channels and help answer questions.

*How I respond:*
- *@mention me* - I reply *publicly* in a thread
- *Reply in that thread* - I stay in the conversation and respond to follow-ups (no need to @mention me again)
- *Ask a question in the channel* - I may reply *privately* to avoid channel spam and not discourage participation

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
      if (isAdmin(userId)) {
        responseText += `

*Admin Commands:*
- \`/dasilva subscribe\` - Add current channel to configuration
- \`/dasilva leave\` - Remove current channel from configuration
- \`/dasilva channels\` - List all configured channels
- \`/dasilva flushdocs\` - Delete all documents from this channel`;
      }
    } else if (args === "silence") {
      userPrefs.updateUserPreference(userId, { silenced: true });
      responseText =
        "DaSilva has been silenced. You won't receive ambient responses. Use `/dasilva unsilence` to resume. (@mentions still work!)";
      log(
        `[${channelId}]: User ${userId} enabled silence mode via slash command`,
      );
    } else if (args === "unsilence") {
      userPrefs.updateUserPreference(userId, { silenced: false });
      responseText =
        "You'll now receive ambient responses when you ask questions.";
      log(`User ${userId} disabled silence mode via slash command`);
    } else if (args.startsWith("cooldown ")) {
      const minutesMatch = args.match(/^cooldown\s+(\d+)$/);
      if (!minutesMatch) {
        responseText =
          "Invalid cooldown format. Use a number like: `/dasilva cooldown 10` (for 10 minutes).";
      } else {
        const minutes = parseInt(minutesMatch[1], 10);
        if (minutes < 0 || minutes > 1440) {
          responseText = `Cooldown must be between 0 and 1440 minutes (24 hours). You provided: ${minutes} minutes.`;
        } else {
          const cooldownSeconds = minutes * 60;
          userPrefs.updateUserPreference(userId, {
            customCooldown: cooldownSeconds,
          });
          const minuteText = minutes === 1 ? "minute" : "minutes";
          responseText = `Your cooldown has been set to ${minutes} ${minuteText}.`;
          log(
            `User ${userId} set custom cooldown to ${minutes} minutes via slash command`,
          );
        }
      }
    } else if (args === "subscribe") {
      // Admin-only command
      if (!isAdmin(userId)) {
        responseText = "You must be an admin to configure channels.";
      } else {
        // Check if channel already exists
        if (channelConfigModule.channelExists(channelId)) {
          responseText = `Channel <#${channelId}> is already configured.`;
        } else {
          // Add channel configuration (creates the directory)
          const result = channelConfigModule.subscribe(channelId);

          if (result.success) {
            responseText = `Channel <#${channelId}> configured successfully!\n\nChannel folder: \`${path.join(channelConfigModule.CHANNELS_DIR, channelId)}\`\n\n_Add markdown files to the channel folder and I'll start using them. Use \`_instructions.md\` for system instructions._`;

            // Reload channel asynchronously
            reloadChannel(channelId)
              .then((reloaded) => {
                log(
                  `Channel ${channelId} added by admin ${userId}. Reload: ${reloaded ? "success" : "no docs yet"}`,
                );
              })
              .catch((error) => {
                logError(`Error reloading channel ${channelId}:`, error);
              });
          } else {
            responseText = `Failed to add channel: ${result.error}`;
          }
        }
      }
    } else if (args === "leave") {
      // Admin-only command
      if (!isAdmin(userId)) {
        responseText = "You must be an admin to configure channels.";
      } else {
        if (!channelConfigModule.channelExists(channelId)) {
          responseText = `This channel is not configured.`;
        } else {
          // Respond immediately to avoid timeout, then open modal asynchronously
          clearTimeout(safetyTimeout);
          res.json({
            response_type: "ephemeral",
            text: "Opening leave confirmation...",
          });

          // Open modal asynchronously (don't await here)
          openLeaveChannelModal(trigger_id, channelId).catch((error) => {
            logError("Error opening leave channel modal:", error);
          });
          return;
        }
      }
    } else if (args === "channels") {
      // Admin-only command
      if (!isAdmin(userId)) {
        responseText = "You must be an admin to view channel configurations.";
      } else {
        const channels = channelConfigModule.getAllChannels();
        if (channels.length === 0) {
          responseText =
            "No channels configured yet. Use `/dasilva subscribe` to add one.";
        } else {
          responseText =
            "*Configured Channels:*\n\n" +
            channels
              .map(
                ([id]) =>
                  `• <#${id}> (\`${id}\`)\n  Path: \`${path.join(channelConfigModule.CHANNELS_DIR, id)}\``,
              )
              .join("\n\n");
        }
      }
    } else if (args === "flushdocs") {
      // Admin-only command
      if (!isAdmin(userId)) {
        responseText = "You must be an admin to flush channel documents.";
      } else {
        if (!channelConfigModule.channelExists(channelId)) {
          responseText = "This channel is not configured.";
        } else {
          const channelPath = path.join(
            channelConfigModule.CHANNELS_DIR,
            channelId,
          );

          if (!fs.existsSync(channelPath)) {
            responseText = "Channel folder not found.";
          } else {
            // Delete all document files (keep the directory itself)
            const files = fs.readdirSync(channelPath);
            let deletedCount = 0;
            for (const file of files) {
              const filePath = path.join(channelPath, file);
              if (fs.statSync(filePath).isFile()) {
                fs.unlinkSync(filePath);
                deletedCount++;
              }
            }

            // Clear in-memory docs and instructions for this channel
            delete channelDocs[channelId];
            delete channelInstructions[channelId];

            log(
              `[${channelId}]: flushdocs by admin ${userId} - deleted ${deletedCount} files`,
            );
            responseText = `Flushed ${deletedCount} file(s) from <#${channelId}>. Upload new documents to retrain.`;
          }
        }
      }
    } else {
      responseText = `Unknown command: \`${text}\`\n\nType \`/dasilva help\` to see available commands.`;
    }

    // Respond ephemerally (only visible to the user)
    clearTimeout(safetyTimeout);
    res.json({
      response_type: "ephemeral",
      text: responseText,
    });
  } catch (error) {
    logError("Error handling slash command:", error);
    clearTimeout(safetyTimeout);
    if (!res.headersSent) {
      res.json({
        response_type: "ephemeral",
        text: "Sorry, there was an error processing your command. Please try again.",
      });
    }
  }
});

// Slack event endpoint
app.post("/slack/events", async (req, res) => {
  const { type, challenge, event } = req.body;

  // Handle Slack URL verification challenge
  if (type === "url_verification") {
    return res.send({ challenge });
  }

  // Respond quickly to Slack (required within 3 seconds)
  res.status(200).send();

  // Log all incoming events for debugging
  // debug(`Event received: type=${event?.type}, subtype=${event?.subtype}`);

  // Handle file_shared events
  if (event && event.type === "file_shared") {
    debug("File shared event detected");
    await handleFileUpload({
      fileId: event.file_id,
      channelId: event.channel_id,
      userId: event.user_id,
    });
    return;
  }

  // Handle file uploads (message with file_share subtype)
  if (event && event.type === "message" && event.subtype === "file_share") {
    debug("File share message detected");
    if (event.files && event.files.length > 0) {
      const allowedExtensions = ["md", "txt", "text", "markdown"];
      for (const file of event.files) {
        const ext = file.name?.split(".").pop().toLowerCase();
        if (!ext || !allowedExtensions.includes(ext)) {
          log(
            `[${event.channel}]: ignoring file upload with unsupported type: ${file.name || "unknown"}`,
          );
          continue;
        }
        await handleFileUpload({
          fileId: file.id,
          channelId: event.channel,
          userId: event.user,
        });
      }
    }
    return;
  }

  // Handle reaction_added events (feedback flow)
  if (event && event.type === "reaction_added") {
    debug(
      `Reaction added: ${event.reaction} by ${event.user} on message ${event.item?.ts}`,
    );
    await handleReactionAdded(event);
    return;
  }

  // Handle app mentions
  if (event && event.type === "app_mention") {
    await handleMention(event);
    return; // Don't process as regular message
  }

  // Handle channel messages (ignore bot messages and mentions to prevent loops)
  if (event && event.type === "message" && !event.bot_id && !event.subtype) {
    // Skip if this is a mention (already handled above as app_mention)
    if (event.text && event.text.match(/<@[A-Z0-9]+>/)) {
      debug("Skipping message - contains mention");
      return;
    }

    // If this is a reply in a thread the bot is actively participating in, treat it like a mention
    if (
      event.thread_ts &&
      activeThreads.has(`${event.channel}:${event.thread_ts}`)
    ) {
      debug("Message in active thread - routing to handleMention");
      await handleMention(event);
      return;
    }

    await handleChannelMessage(event);
  }

  // Note: file_shared events are handled above via file_share subtype
});

// Slack interactions endpoint (for modals)
app.post(
  "/slack/interactions",
  express.urlencoded({ extended: true }),
  async (req, res) => {
    try {
      const payload = JSON.parse(req.body.payload);
      const { type, user, view } = payload;

      debug("Interaction received:", {
        type,
        callback_id: view?.callback_id,
        user_id: user.id,
      });

      // Handle button clicks (block_actions)
      if (type === "block_actions") {
        const action = payload.actions?.[0];

        if (action?.action_id === "open_feedback_modal") {
          const { channel, messageTs } = JSON.parse(action.value);

          try {
            await slackClient.views.open({
              trigger_id: payload.trigger_id,
              view: modalDefs.feedbackModal(channel, messageTs),
            });
          } catch (error) {
            logError("Error opening feedback modal:", error);
          }

          // Remove the ephemeral "Give Feedback" button message
          if (payload.response_url) {
            axios
              .post(payload.response_url, { delete_original: true })
              .catch((error) => {
                debug(
                  "Failed to delete ephemeral feedback prompt:",
                  error.message,
                );
              });
          }

          return res.status(200).send();
        }

        return res.status(200).send();
      }

      // Handle modal submissions
      if (type === "view_submission") {
        const callback_id = view.callback_id;

        if (callback_id === "leave_channel_modal") {
          const result = await handleLeaveChannelSubmission(view, user.id);
          return res.json(result);
        }

        if (callback_id === "feedback_modal") {
          const result = await handleFeedbackSubmission(view, user.id);
          return res.json(result);
        }
      }

      // Default response for unhandled interactions
      res.status(200).send();
    } catch (error) {
      logError("Error handling interaction:", error);
      res.status(200).json({
        response_action: "errors",
        errors: {
          channel_id_block:
            "An error occurred processing your request. Please try again.",
        },
      });
    }
  },
);

// Modal opener functions
async function openLeaveChannelModal(triggerId, channelId) {
  try {
    await slackClient.views.open({
      trigger_id: triggerId,
      view: modalDefs.leaveChannelModal(channelId),
    });
  } catch (error) {
    logError("Error opening leave channel modal:", error);
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
      response_action: "errors",
      errors: {
        confirmation_block: "Channel not found",
      },
    };
  }

  // Extract confirmation input from modal
  const values = view.state.values;
  const confirmationInput =
    values.confirmation_block.confirmation_input.value.trim();

  log(`[${channelId}]: admin ${userId} attempting to leave channel`);

  // Validate that user typed the exact channel ID
  if (confirmationInput !== channelId) {
    return {
      response_action: "errors",
      errors: {
        confirmation_block: `You must type "${channelId}" exactly to confirm deletion`,
      },
    };
  }

  // Delete the channel (removes the directory)
  const result = channelConfigModule.leave(channelId);

  if (!result.success) {
    return {
      response_action: "errors",
      errors: {
        confirmation_block: result.error,
      },
    };
  }

  // Remove from memory
  delete channelDocs[channelId];
  delete channelInstructions[channelId];

  log(`[${channelId}]: channel left by admin ${userId}`);

  // Clear the modal
  return { response_action: "clear" };
}

// Handle feedback modal submission
async function handleFeedbackSubmission(view, userId) {
  try {
    const { channel, messageTs } = JSON.parse(view.private_metadata);

    const values = view.state.values;
    const category =
      values.feedback_category_block.feedback_category_input.selected_option
        .value;
    const categoryLabel =
      values.feedback_category_block.feedback_category_input.selected_option
        .text.text;
    const details =
      values.feedback_details_block?.feedback_details_input?.value ||
      "No additional details";

    log(
      `[${channel}]: feedback submitted by ${userId} - category: ${category}`,
    );

    if (FEEDBACK_CHANNEL) {
      const feedbackMessage = [
        ":clipboard: *Response Feedback Received*",
        "",
        `*From:* <@${userId}>`,
        `*Channel:* <#${channel}>`,
        `*Message:* https://slack.com/archives/${channel}/p${messageTs.replace(".", "")}`,
        `*Category:* ${categoryLabel}`,
        `*Details:* ${details}`,
      ].join("\n");

      await slackClient.chat.postMessage({
        channel: FEEDBACK_CHANNEL,
        text: feedbackMessage,
        unfurl_links: false,
      });
    }

    return { response_action: "clear" };
  } catch (error) {
    logError("Error handling feedback submission:", error);
    return {
      response_action: "errors",
      errors: {
        feedback_category_block:
          "An error occurred submitting your feedback. Please try again.",
      },
    };
  }
}

// Reload a single channel's documentation
async function reloadChannel(channelId) {
  const config = channelConfigModule.getChannel(channelId);
  if (!config) {
    logError(`Cannot reload: Channel ${channelId} not found`);
    return false;
  }

  if (!embedder) {
    logError("Embedder not initialized yet");
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
    const instructionsPath = path.join(
      channelPath,
      channelConfigModule.INSTRUCTIONS_FILE,
    );
    if (fs.existsSync(instructionsPath)) {
      channelInstructions[channelId] = fs.readFileSync(
        instructionsPath,
        "utf-8",
      );
      log(`Reloaded instructions for ${channelId}`);
    } else {
      channelInstructions[channelId] =
        "Answer questions based only on the provided documentation.";
    }

    // Load all other markdown files
    const files = fs
      .readdirSync(channelPath)
      .filter(
        (f) => f.endsWith(".md") && f !== channelConfigModule.INSTRUCTIONS_FILE,
      );

    const chunks = [];

    // Load and chunk files
    for (const file of files) {
      const filePath = path.join(channelPath, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const fileChunks = chunkText(content, CHUNK_SIZE);

      fileChunks.forEach((chunk, index) => {
        chunks.push({
          text: chunk,
          source: file,
          chunkIndex: index,
        });
      });
    }

    // Generate embeddings for all chunks
    log(`Embedding ${chunks.length} chunks for ${channelId}...`);
    for (const chunk of chunks) {
      const output = await embedder(chunk.text, {
        pooling: "mean",
        normalize: true,
      });
      chunk.embedding = Array.from(output.data);
    }

    channelDocs[channelId] = chunks;
    log(
      `Hot-reloaded channel ${channelId} - ${chunks.length} chunks from ${files.length} documents`,
    );
    return true;
  } catch (error) {
    logError(`Error reloading channel ${channelId}:`, error);
    return false;
  }
}

// Fetch recent thread history from Slack and map to OpenAI message roles
async function getThreadHistory(channel, threadTs, currentMessageTs) {
  try {
    const result = await slackClient.conversations.replies({
      channel: channel,
      ts: threadTs,
      limit: 50,
    });

    if (!result.ok || !result.messages) return [];

    // Exclude the current message (we add it separately)
    const threadMessages = result.messages.filter(
      (msg) => msg.ts !== currentMessageTs,
    );

    // Map to OpenAI roles and take the last N messages
    return threadMessages
      .slice(-THREAD_CONTEXT_MESSAGES)
      .map((msg) => ({
        role: msg.bot_id ? "assistant" : "user",
        content: (msg.text || "").replace(/<@[A-Z0-9]+>/g, "").trim(),
      }))
      .filter((msg) => msg.content.length > 0);
  } catch (error) {
    logError("Error fetching thread history:", error);
    return [];
  }
}

// Handle when bot is mentioned (or continues a conversation in an active thread)
async function handleMention(event) {
  try {
    const { text, channel: channelId, ts, user: userId } = event;
    const threadTs = event.thread_ts || ts; // Reply in the parent thread if one exists

    log(
      `[${channelId}]: request received from user ${userId} in thread ${threadTs} (msg: ${ts})`,
    );
    debug(`Mention/thread message in channel ${channelId}: ${text}`);

    // Check if we have configuration for this channel
    const config = channelConfigModule.getChannel(channelId);
    if (!config) {
      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "Sorry, I'm not configured for this channel yet.",
      });
      return;
    }

    // Get instructions (always included)
    const instructions =
      channelInstructions[channelId] ||
      "Answer based only on provided documentation.";

    // Remove the bot mention from the text
    const userMessage = text.replace(/<@[A-Z0-9]+>/g, "").trim();

    // Get relevant chunks based on the user's question
    const allChunks = channelDocs[channelId] || [];
    const relevantChunks = await findRelevantChunks(
      allChunks,
      userMessage,
      MAX_CHUNKS,
    );

    if (allChunks.length === 0) {
      // No documents, skip
      log(`[${channelId}]: skipping - no channel documents`);
      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "Sorry, I have not been trained for this channel yet.",
      });
      return;
    }

    debug(
      `Found ${relevantChunks.length} relevant chunks out of ${allChunks.length} total`,
    );

    const docsContext =
      relevantChunks.length > 0
        ? relevantChunks
            .map((chunk) => `[From ${chunk.source}]\n${chunk.text}`)
            .join("\n\n---\n\n")
        : "No relevant documentation found.";

    // Build messages with instructions + documentation context
    // Instruct the model to decline answering when the documentation doesn't cover the topic
    const mentionGuidance =
      "\n\nIMPORTANT: You must only answer based on the available documentation above. If the question is not covered by the documentation, or you are not confident you can provide an accurate answer from it, respond with exactly an empty message (no text at all). Do not guess or make up an answer.";

    // Fetch thread history if this is part of an ongoing thread
    const threadHistory = event.thread_ts
      ? await getThreadHistory(channelId, event.thread_ts, ts)
      : [];

    if (threadHistory.length > 0) {
      debug(`Including ${threadHistory.length} thread history messages`);
    }

    const messages = [
      {
        role: "system",
        content: `${instructions}\n\n---\n\n# Available Documentation:\n\n${docsContext}${mentionGuidance}`,
      },
      ...threadHistory,
      { role: "user", content: userMessage },
    ];

    // Call ChatGPT
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: messages,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    });

    debug("Full completion object:", JSON.stringify(completion, null, 2));
    debug("Choices:", completion.choices);
    debug("First choice:", completion.choices?.[0]);

    const reply = completion.choices[0].message.content;
    debug("Reply received:", reply);
    debug("Reply length:", reply?.length || 0);

    // If reply is empty, the model declined to answer (out of scope or low confidence)
    if (!reply || reply.trim().length === 0) {
      log(
        `[${channelId}]: response NOT sent for ${userId} (out of scope or not relevant)`,
      );
      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "Sorry, I'm not able to answer that question. It may be outside the scope of what I've been trained on in this channel.",
      });
      return;
    }

    // Post reply publicly in thread (not ephemeral - mentions are public)
    await slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: reply,
    });

    // Track this thread so the bot continues responding to follow-ups
    activeThreads.set(`${channelId}:${threadTs}`, Date.now());

    const totalTokens = completion.usage?.total_tokens || 0;
    log(
      `[${channelId}]: response (${totalTokens} tokens) sent for ${userId} in thread ${threadTs}`,
    );
  } catch (error) {
    logError("Error handling mention:", error);

    // Send error message to Slack
    try {
      await slackClient.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        text: "Sorry, I encountered an error processing your request.",
      });
    } catch (slackError) {
      logError("Error sending error message to Slack:", slackError);
    }
  }
}

// Handle messages in channels the bot is in
async function handleChannelMessage(event) {
  try {
    const { text, user: userId, channel: channelId } = event;

    debug(`Channel message from user ${userId} in ${channelId}: ${text}`);

    // Safety net: skip if this is a thread the bot is actively participating in
    // (should already be routed to handleMention, but prevent duplicate ephemeral responses)
    if (
      event.thread_ts &&
      activeThreads.has(`${channelId}:${event.thread_ts}`)
    ) {
      debug(`Skipping ambient - active thread ${event.thread_ts}`);
      return;
    }

    // Check if we have configuration for this channel
    const config = channelConfigModule.getChannel(channelId);
    if (!config) {
      // Silently ignore messages from unconfigured channels
      debug(`Skipping - channel ${channelId} is not subscribed`);
      return;
    }

    debug(`Ambient Mode: ${AMBIENT_MODE}`);

    // Smart filter: Only respond to questions/requests
    if (!looksLikeQuestion(text)) {
      debug("Skipping - does not look like a question");
      return;
    }

    // Rate limiting: Check if we recently responded to this user
    if (!shouldRespondToUser(channelId, userId)) {
      debug(`Skipping - user ${userId} in cooldown period`);
      return;
    }

    // Get instructions (always included)
    const instructions =
      channelInstructions[channelId] ||
      "Answer based only on provided documentation.";

    // Get documentation for this channel
    const allChunks = channelDocs[channelId] || [];
    const relevantChunks = await findRelevantChunks(
      allChunks,
      text,
      MAX_CHUNKS,
    );

    if (allChunks.length === 0) {
      // No documents, skip
      log(`[${channelId}]: skipping - no channel documents`);
      return;
    }

    debug(
      `Found ${relevantChunks.length} relevant chunks out of ${allChunks.length} total`,
    );

    // For ambient messages, check if the best chunk score meets the minimum threshold
    // If no chunks are relevant enough, skip the OpenAI call entirely
    const topScore = relevantChunks.length > 0 ? relevantChunks[0].score : 0;

    log(
      `[${channelId}]: ambient from user ${userId} (msg: ${event.ts}) (score: ${topScore}) (silencedStatus: ${userPrefs.isUserSilenced(userId)})`,
    );

    if (topScore < AMBIENT_MIN_SCORE) {
      log(
        `[${channelId}]: ambient skipped for user ${userId} - top chunk score ${topScore.toFixed(3)} below threshold ${AMBIENT_MIN_SCORE}`,
      );
      return;
    }

    // Check if user has silenced themselves
    if (userPrefs.isUserSilenced(userId)) {
      debug(`Skipping - user ${userId} is silenced`);
      return;
    }

    debug(
      `Top chunk score: ${topScore.toFixed(3)} (threshold: ${AMBIENT_MIN_SCORE})`,
    );

    const docsContext =
      relevantChunks.length > 0
        ? relevantChunks
            .map((chunk) => `[From ${chunk.source}]\n${chunk.text}`)
            .join("\n\n---\n\n")
        : "No relevant documentation found.";

    // Build messages with instructions + documentation context
    // For ambient messages, instruct the model to stay silent when unsure
    const ambientGuidance =
      "\n\nIMPORTANT: This is an ambient channel message, NOT a direct question to you. Only respond if you are confident you can provide a helpful, accurate answer based on the available documentation. If you are not confident, or the documentation does not cover the topic, respond with exactly an empty message (no text at all). Do not apologize or explain that you cannot answer - just return nothing.";

    const messages = [
      {
        role: "system",
        content: `${instructions}\n\n---\n\n# Available Documentation:\n\n${docsContext}${ambientGuidance}`,
      },
      { role: "user", content: text },
    ];

    // Call ChatGPT
    debug(
      "Calling OpenAI with",
      messages[0].content.length,
      "chars of context",
    );

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: messages,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    });

    debug("Full completion response:", JSON.stringify(completion, null, 2));
    const reply = completion.choices[0].message.content;
    debug("Reply received:", reply);
    debug("Reply length:", reply?.length || 0);

    // If reply is empty, stay silent (low confidence or no relevant answer)
    if (!reply || reply.trim().length === 0) {
      log(
        `[${channelId}]: ambient response NOT sent to user ${userId} (out of scope or not relevant)`,
      );
      return;
    }

    // Suppress responses where the model says it can't answer (not trained, out of scope, etc.)
    const replyLower = reply.toLowerCase();
    const declinePatterns = [
      "not been trained",
      "not trained",
      "outside the scope",
      "outside of the scope",
      "don't have information",
      "do not have information",
      "no relevant documentation",
      "not covered by the documentation",
      "cannot answer",
      "can't answer",
      "unable to answer",
      "not able to answer",
    ];
    if (declinePatterns.some((pattern) => replyLower.includes(pattern))) {
      log(
        `[${channelId}]: ambient response suppressed for user ${userId} (model declined to answer)`,
      );
      return;
    }

    // Send ephemeral message (only visible to the user who posted)
    await slackClient.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `_Only visible to you:_\n\n${reply}${HELP_FOOTER}`,
    });

    // Record that we responded to this user
    recordResponse(channelId, userId);

    const totalTokens = completion.usage?.total_tokens || 0;
    log(
      `[${channelId}]: ambient response (${totalTokens} tokens) sent to user ${userId} (msg: ${event.ts})`,
    );
  } catch (error) {
    logError("Error handling channel message:", error);
    logError("Error details:", error.message);
    log(
      `[${event.channel}]: ambient response NOT sent to user ${event.user} (error: ${error.message})`,
    );

    // Notify user of error via ephemeral message
    try {
      await slackClient.chat.postEphemeral({
        channel: event.channel,
        user: event.user,
        text:
          "Sorry, I encountered an error processing your message. Please try again." +
          HELP_FOOTER,
      });
    } catch (slackError) {
      logError("Error sending error message to Slack:", slackError);
    }
  }
}

// Handle reaction_added events for feedback flow
async function handleReactionAdded(event) {
  try {
    const {
      user: reactingUserId,
      reaction,
      item,
      item_user: messageAuthorId,
    } = event;

    // Only process the configured feedback emoji
    if (reaction !== FEEDBACK_EMOJI) {
      debug(`Ignoring reaction: ${reaction} (not feedback emoji)`);
      return;
    }

    // Only process reactions on bot's own messages
    if (!botUserId || messageAuthorId !== botUserId) {
      debug(
        `Ignoring feedback reaction: message author ${messageAuthorId} is not the bot ${botUserId}`,
      );
      return;
    }

    // Don't process reactions from the bot itself
    if (reactingUserId === botUserId) {
      debug("Ignoring feedback reaction from bot itself");
      return;
    }

    const { channel, ts: messageTs } = item;

    log(
      `[${channel}]: feedback reaction from user ${reactingUserId} on message ${messageTs}`,
    );

    // Send ephemeral message with "Give Feedback" button
    await slackClient.chat.postEphemeral({
      channel: channel,
      user: reactingUserId,
      text: "Would you like to provide feedback on this response?",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Would you like to provide feedback on this response?",
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              text: "Give Feedback",
            },
            action_id: "open_feedback_modal",
            value: JSON.stringify({ channel, messageTs }),
            style: "primary",
          },
        },
      ],
    });
  } catch (error) {
    logError("Error handling reaction_added:", error);
  }
}

// Track recently processed files to prevent duplicates
const recentlyProcessedFiles = new Map();
const FILE_DEDUP_TTL_MS = 60000; // 1 minute

// Handle file uploads to canvas
async function handleFileUpload(event) {
  try {
    const { fileId, channelId, userId } = event;

    debug(
      `File upload detected: ${fileId} in channel ${channelId} by user ${userId}`,
    );

    // Deduplicate: skip if we recently processed this file
    if (recentlyProcessedFiles.has(fileId)) {
      debug(`Skipping - file ${fileId} already processed recently`);
      return;
    }
    recentlyProcessedFiles.set(fileId, Date.now());

    // Clean up old entries periodically
    for (const [id, timestamp] of recentlyProcessedFiles) {
      if (Date.now() - timestamp > FILE_DEDUP_TTL_MS) {
        recentlyProcessedFiles.delete(id);
      }
    }

    // Check if user is admin
    if (!isAdmin(userId)) {
      debug("Skipping - user is not admin");
      return;
    }

    // Check if we have configuration for this channel
    const config = channelConfigModule.getChannel(channelId);
    if (!config) {
      debug("Skipping - channel not configured");
      return;
    }

    // Get file information
    const fileInfo = await slackClient.files.info({ file: fileId });
    const file = fileInfo.file;

    debug(
      `File info: ${file.name}, type: ${file.filetype}, size: ${file.size}`,
    );

    log(`[${channelId}]: processing file upload: ${file.name}`);

    // Validate file type
    const allowedExtensions = ["md", "txt", "text", "markdown"];
    const fileExtension = file.name.split(".").pop().toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
      log(
        `[${channelId}]: skipping file upload - unsupported type: .${fileExtension} (${file.name})`,
      );
      return;
    }

    // Download file content
    const fileContent = await downloadSlackFile(file);

    // Save to channel's folder
    const targetPath = path.join(
      channelConfigModule.CHANNELS_DIR,
      channelId,
      file.name,
    );
    fs.writeFileSync(targetPath, fileContent, "utf-8");

    log(`[${channelId}]: saved file to: ${targetPath}`);

    // Re-embed documentation for this channel
    await reEmbedChannel(channelId);

    // Notify success
    await slackClient.chat.postMessage({
      channel: channelId,
      text: `Successfully added documentation: *${file.name}*`,
    });

    log(`[${channelId}]: file upload complete: ${file.name}`);
  } catch (error) {
    logError("Error handling file upload:", error);
    logError("Error details:", error.message);

    // Notify user of error
    try {
      await slackClient.chat.postEphemeral({
        channel: event.channelId,
        user: event.userId,
        text: `Failed to process file upload: ${error.message}`,
      });
    } catch (slackError) {
      logError("Error sending error message to Slack:", slackError);
    }
  }
}

// Helper: Download file from Slack with retry logic
async function downloadSlackFile(file, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(file.url_private, {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        },
        responseType: "text",
        timeout: 30000,
      });

      return response.data;
    } catch (error) {
      const isRetryable =
        error.code === "ECONNRESET" ||
        error.code === "ETIMEDOUT" ||
        error.code === "ENOTFOUND";

      if (isRetryable && attempt < maxRetries) {
        log(
          `Download attempt ${attempt} failed (${error.code}), retrying in ${attempt}s...`,
        );
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }

      logError("Error downloading file:", error);
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
  const instructionsPath = path.join(
    channelPath,
    channelConfigModule.INSTRUCTIONS_FILE,
  );
  if (fs.existsSync(instructionsPath)) {
    channelInstructions[channelId] = fs.readFileSync(instructionsPath, "utf-8");
    log(`[${channelId}]: reloaded instructions`);
  }

  // Load all markdown files (excluding instructions file)
  const files = fs
    .readdirSync(channelPath)
    .filter(
      (f) => f.endsWith(".md") && f !== channelConfigModule.INSTRUCTIONS_FILE,
    );

  log(`[${channelId}]: found ${files.length} markdown files to embed`);

  const chunks = [];

  // Load and chunk files
  for (const file of files) {
    const filePath = path.join(channelPath, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const fileChunks = chunkText(content, CHUNK_SIZE);

    fileChunks.forEach((chunk, index) => {
      chunks.push({
        text: chunk,
        source: file,
        chunkIndex: index,
      });
    });
  }

  log(`[${channelId}]: embedding ${chunks.length} chunks...`);

  // Generate embeddings for all chunks
  for (const chunk of chunks) {
    const output = await embedder(chunk.text, {
      pooling: "mean",
      normalize: true,
    });
    chunk.embedding = Array.from(output.data);
  }

  // Update the in-memory documentation
  channelDocs[channelId] = chunks;

  log(
    `[${channelId}]: re-embedded ${chunks.length} chunks from ${files.length} documents`,
  );
}

// Initialize everything and start server
async function startServer() {
  try {
    await initializeDocumentation();

    // Resolve the bot's own Slack user ID for filtering reactions
    try {
      const authResult = await slackClient.auth.test();
      botUserId = authResult.user_id;
      log(`[GLOBAL]: Bot user ID resolved: ${botUserId}`);
    } catch (error) {
      logError(
        "[GLOBAL]: Failed to resolve bot user ID (feedback reactions will not work):",
        error.message,
      );
    }

    app.listen(port, () => {
      log(`[GLOBAL]: dasilva listening on port ${port}`);
      log("[GLOBAL]: Ready to answer questions!");
    });
  } catch (error) {
    logError("Failed to initialize:", error);
    process.exit(1);
  }
}

startServer();
