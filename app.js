require("dotenv").config();
const express = require("express");
const { WebClient } = require("@slack/web-api");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const util = require("util");
const userPrefs = require("./user-preferences");
const channelConfigModule = require("./channel-config");
const channelPrefs = require("./channel-preferences");
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
const THREAD_CONTEXT_MESSAGES =
  parseInt(process.env.THREAD_CONTEXT_MESSAGES) || 10; // Thread history messages to include
const HELP_FOOTER = "\n\n_Type `/dasilva help` for more information_";
const ADMIN_USERS = (process.env.ADMIN_USERS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const LOG_CHANNEL = process.env.LOG_CHANNEL || null;
const FEEDBACK_EMOJI = process.env.FEEDBACK_EMOJI || "feedback";
const FEEDBACK_CHANNEL = process.env.FEEDBACK_CHANNEL || null;

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

let isInitialized = false;
let botUserId = null;

// Initialize clients
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: process.env.OPENAI_API_TIMEOUT || 30000, // 30 second timeout
  maxRetries: 0, // Retry twice on failure
});

// Is optional PERSISTENT_STORAGE value set?
if (process.env.PERSISTENT_STORAGE) {
  log(`[GLOBAL]: Using persistent storage: ${process.env.PERSISTENT_STORAGE}`);
}

// Is optional PERSISTENT_STORAGE value set?

debug(`DEBUG_MODE=${DEBUG_MODE}`);

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

  debug(
    `[${channelId}]: cooldown check for user ${userId} (lastTime: ${lastTime})`,
  );

  if (!lastTime) return true;

  // Check for custom cooldown, otherwise use default
  const customCooldown = userPrefs.getUserCooldown(userId);
  const cooldown =
    customCooldown !== null ? customCooldown : RESPONSE_COOLDOWN_SECONDS;

  const timeSinceLastResponse = (Date.now() - lastTime) / 1000;

  debug`[${channelId}]: cooldown timer ${userId}: ${timeSinceLastResponse >= cooldown}`;
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

// =========================================
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
- I'm trained on internal and external documentation relevant to this channel's topics

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
- \`/dasilva addvector <id>\` - Connect an OpenAI vector store to this channel
- \`/dasilva dropvector\` - Remove vector store from this channel
- \`/dasilva listvector\` - Show all vector store configurations`;
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
          // Add channel configuration
          const result = channelConfigModule.subscribe(channelId);

          if (result.success) {
            responseText = `Channel <#${channelId}> subscribed successfully! Use \`/dasilva addvector <vector_id>\` to connect an OpenAI vector store.`;
            log(`Channel ${channelId} added by admin ${userId}`);
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
              .map(([id]) => {
                const vectorId = channelPrefs.getVectorId(id);
                const vectorInfo = vectorId
                  ? `Vector: \`${vectorId}\``
                  : "_No vector store_";
                return `\u2022 <#${id}> (\`${id}\`)\n  ${vectorInfo}`;
              })
              .join("\n\n");
        }
      }
    } else if (args.startsWith("addvector ")) {
      // Admin-only command
      if (!isAdmin(userId)) {
        responseText = "You must be an admin to manage vector stores.";
      } else {
        // Read vector_id from original text to preserve case
        const vectorId = text.trim().split(/\s+/)[1];
        if (!vectorId || !vectorId.startsWith("vs_")) {
          responseText =
            "Invalid vector store ID. Usage: `/dasilva addvector vs_xxxxx`";
        } else {
          channelPrefs.updateChannelPreference(channelId, {
            vector_id: vectorId,
          });
          responseText = `Vector store \`${vectorId}\` configured for <#${channelId}>.`;
          log(
            `[${channelId}]: vector store ${vectorId} added by admin ${userId}`,
          );
        }
      }
    } else if (args === "dropvector") {
      // Admin-only command
      if (!isAdmin(userId)) {
        responseText = "You must be an admin to manage vector stores.";
      } else {
        const existed = channelPrefs.deleteChannelPreference(channelId);
        if (existed) {
          responseText = `Vector store removed from <#${channelId}>.`;
          log(`[${channelId}]: vector store removed by admin ${userId}`);
        } else {
          responseText = `No vector store configured for <#${channelId}>.`;
        }
      }
    } else if (args === "listvector") {
      // Admin-only command
      if (!isAdmin(userId)) {
        responseText =
          "You must be an admin to view vector store configurations.";
      } else {
        const allPrefs = channelPrefs.getAllChannelPreferences();
        const entries = Object.entries(allPrefs).filter(
          ([, pref]) => pref.vector_id,
        );
        if (entries.length === 0) {
          responseText = "No vector stores configured for any channel.";
        } else {
          responseText =
            "*Vector Store Configuration:*\n\n" +
            entries
              .map(
                ([id, pref]) =>
                  `\u2022 <#${id}> (\`${id}\`): \`${pref.vector_id}\``,
              )
              .join("\n");
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

// =========================================
// Slack event endpoint
app.post("/slack/events", async (req, res) => {
  const { type, challenge, event } = req.body;

  if (type === "url_verification") {
    return res.send({ challenge });
  }

  // Respond quickly to Slack (required within 3 seconds)
  res.status(200).send();

  if (!event) return;

  // Reaction events (feedback flow)
  if (event.type === "reaction_added") {
    return handleReactionAdded(event);
  }

  // Ignore bot messages and subtypes (edits, joins, etc.)
  if (event.bot_id || event.subtype) return;

  // Regular channel messages
  if (event.type === "message") {
    // if bot was mentioned, always reply

    if (event.text?.includes(`<@${botUserId}>`)) {
      return replyPublic(event);
    }

    // Active thread follow-up → reply publicly (continue the conversation)
    if (
      event.thread_ts &&
      activeThreads.has(`${event.channel}:${event.thread_ts}`)
    ) {
      return replyPublic(event);
    }

    // Non-active thread → ignore (don't jump into unrelated threads)
    if (event.thread_ts) return;

    // Root channel message → ephemeral reply if it's a question
    return replyEphemeral(event);
  }
});

// =========================================
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

        if (action?.action_id === "promote_to_public") {
          const { channel, messageTs, reply } = JSON.parse(action.value);

          try {
            // Post public reply to the original message
            await slackClient.chat.postMessage({
              channel: channel,
              thread_ts: messageTs,
              text: reply,
            });

            // Delete the ephemeral message
            if (payload.response_url) {
              await axios.post(payload.response_url, { delete_original: true });
            }
          } catch (error) {
            logError("Error promoting ephemeral to public:", error);
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

  // Delete the channel
  const result = channelConfigModule.leave(channelId);

  if (!result.success) {
    return {
      response_action: "errors",
      errors: {
        confirmation_block: result.error,
      },
    };
  }

  // Remove vector store preference for this channel
  channelPrefs.deleteChannelPreference(channelId);

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

// Check if channel is configured and has a vector store
function getChannelContext(channelId) {
  const config = channelConfigModule.getChannel(channelId);
  if (!config) return null;
  const vectorId = channelPrefs.getVectorId(channelId);
  if (!vectorId) return null;
  return { config, vectorId };
}

function summarizeOpenAIError(err) {
  return {
    name: err?.name,
    message: err?.message,
    type: err?.type,
    code: err?.code,
    status: err?.status,
    requestID: err?.requestID,
    headers: err?.headers
      ? {
          "x-request-id": err.headers["x-request-id"],
          "openai-processing-ms": err.headers["openai-processing-ms"],
          "retry-after": err.headers["retry-after"],
        }
      : undefined,
  };
}

function summarizeOpenAIResponse(response) {
  const output = response?.output ?? [];
  const first = output[0];

  return {
    id: response?.id,
    model: response?.model,

    status: response?.status, // <-- ADD
    incomplete_reason: response?.incomplete_details?.reason, // <-- ADD
    error: response?.error
      ? {
          code: response.error.code,
          message: response.error.message,
          type: response.error.type,
        }
      : undefined,

    usage: response?.usage
      ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined,

    output_text_len: response?.output_text?.length ?? 0,
    output_count: output.length,
    output_types: output.map((o) => o?.type).filter(Boolean),

    finish_reason:
      first?.finish_reason ?? first?.content?.[0]?.finish_reason ?? undefined,
  };
}

// Call OpenAI with file_search against the channel's vector store
async function callOpenAI(text, vectorId, threadHistory = []) {
  const instructions = fs.readFileSync(
    path.join(__dirname, "instructions.md"),
    "utf-8",
  );
  return openai.responses.create({
    model: MODEL,
    instructions,
    input: [...threadHistory, { role: "user", content: text }],
    tools: [{ type: "file_search", vector_store_ids: [vectorId] }],
    max_output_tokens: MAX_COMPLETION_TOKENS,
  });
}

// Reply publicly in a thread (@mentions and active thread follow-ups)
async function replyPublic(event) {
  const { text, channel: channelId, ts, user: userId } = event;
  const threadTs = event.thread_ts || ts;

  log(`[${channelId}]: public request from ${userId} in thread ${threadTs}`);

  const ctx = getChannelContext(channelId);
  if (!ctx) {
    const msg = !channelConfigModule.getChannel(channelId)
      ? "Sorry, I'm not configured for this channel yet."
      : "Sorry, I'm not trained for this channel yet.";
    log(`[${channelId}]: ${msg}`);
    await slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: msg,
    });

    return;
  }

  const userMessage = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  const threadHistory = event.thread_ts
    ? await getThreadHistory(channelId, event.thread_ts, ts)
    : [];

  // try {
  //   const response = await callOpenAI(userMessage, ctx.vectorId, threadHistory);
  //   const reply = response.output_text;

  //   if (!reply?.trim()) {
  //     await slackClient.chat.postMessage({
  //       channel: channelId,
  //       thread_ts: threadTs,
  //       text: "Sorry, I'm not able to answer that question. It may be outside the scope of what I've been trained on in this channel.",
  //     });
  //     log(`[${channelId}]: empty llm response returned for thread ${threadTs}`);
  //     return;
  //   }

  //   await slackClient.chat.postMessage({
  //     channel: channelId,
  //     thread_ts: threadTs,
  //     text: reply,
  //   });

  //   activeThreads.set(`${channelId}:${threadTs}`, Date.now());
  //   log(
  //     `[${channelId}]: public response (${response.usage?.total_tokens || 0} tokens) for ${userId} in thread ${threadTs}`,
  //   );
  // } catch (error) {
  //   logError("Error in replyPublic:", error);
  //   try {
  //     await slackClient.chat.postMessage({
  //       channel: channelId,
  //       thread_ts: threadTs,
  //       text: "Sorry, I encountered an error processing your request.",
  //     });
  //   } catch (slackError) {
  //     logError("Error sending error message to Slack:", slackError);
  //   }
  // }

  try {
    const response = await callOpenAI(userMessage, ctx.vectorId, threadHistory);
    const reply = response.output_text;

    if (!reply?.trim()) {
      let openAIResponse = JSON.stringify(summarizeOpenAIResponse(response));
      let reasonText = "";

      if (
        openAIResponse.status == "incomplete" &&
        openAIResponse.incomplete_reason == "max_output_tokens"
      ) {
        // ran out of output tokens
        log(
          `[${channelId}]: llm ran out of response tokens for thread ${threadTs}`,
        );
        let reasonText =
          "I was unable to answer due to complexity. Please try to rephrase your question.";
      } else if (openAIResponse.status == "completed") {
        // ran out of output tokens
        log(`[${channelId}]: llm untrained response for thread ${threadTs}`);
        let reasonText =
          "Sorry, I'm not able to answer that question. It may be outside the scope of what I've been trained on in this channel.";
      }
      // Log *why* it was empty
      log(
        `[${channelId}]: empty llm response for thread ${threadTs} ${openAIResponse}`,
      );

      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: reasonText,
      });

      return;
    }

    await slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: reply,
    });

    activeThreads.set(`${channelId}:${threadTs}`, Date.now());

    log(
      `[${channelId}]: public response (${response.usage?.total_tokens || 0} tokens) for ${userId} in thread ${threadTs} ` +
        JSON.stringify({
          id: response.id,
          usage: response.usage,
        }),
    );
  } catch (error) {
    // Distinguish OpenAI errors from Slack errors
    const isLikelyOpenAI =
      error?.name?.includes("OpenAI") ||
      error?.requestID ||
      typeof error?.status === "number";

    if (isLikelyOpenAI) {
      logError("Error in replyPublic (OpenAI):", summarizeOpenAIError(error));
    } else {
      logError("Error in replyPublic:", error);
    }

    try {
      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "Sorry, I encountered an error processing your request.",
      });
    } catch (slackError) {
      logError("Error sending error message to Slack:", {
        name: slackError?.name,
        message: slackError?.message,
        code: slackError?.code,
        data: slackError?.data, // slack web api often includes useful detail here
      });
    }
  }
}

// Reply ephemerally to ambient questions in root channel messages
async function replyEphemeral(event) {
  const { text, user: userId, channel: channelId } = event;

  const ctx = getChannelContext(channelId);
  if (!ctx) return;

  if (!looksLikeQuestion(text)) return;
  if (!shouldRespondToUser(channelId, userId)) return;
  if (userPrefs.isUserSilenced(userId)) return;

  log(`[${channelId}]: ambient request from ${userId} (msg: ${event.ts})`);

  try {
    const response = await callOpenAI(text, ctx.vectorId);
    debug(`${console.dir(response)}`);

    const reply = response.output_text;

    if (!reply?.trim()) {
      log(
        `[${channelId}]: ambient response suppressed for ${userId} (empty reply)`,
      );
      return;
    }

    // Suppress responses where the model says it can't answer
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
    if (declinePatterns.some((p) => reply.toLowerCase().includes(p))) {
      log(
        `[${channelId}]: ambient response suppressed for ${userId} (model declined)`,
      );
      return;
    }

    await slackClient.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `_Only visible to you:_\n\n${reply}${HELP_FOOTER}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `_Only visible to you:_\n\n${reply}${HELP_FOOTER}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Promote to public thread",
              },
              action_id: "promote_to_public",
              value: JSON.stringify({
                channel: channelId,
                messageTs: event.ts,
                reply: reply,
              }),
            },
          ],
        },
      ],
    });

    recordResponse(channelId, userId);
    log(
      `[${channelId}]: ephemeral response (${response.usage?.total_tokens || 0} tokens) for ${userId}`,
    );
  } catch (error) {
    log(
      `[${channelId}]: unable to send ephemeral message response to ${userId}`,
    );

    // logError("Error in replyEphemeral:", error);
    // try {
    //   await slackClient.chat.postEphemeral({
    //     channel: channelId,
    //     user: userId,
    //     text:
    //       "Sorry, I encountered an error processing your message. Please try again." +
    //       HELP_FOOTER,
    //   });
    // } catch (slackError) {
    //   logError("Error sending error message to Slack:", slackError);
    // }
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

    debug(`${console.dir(reaction)}`);

    // Only process the configured feedback emoji
    if (reaction.split(":")[0] !== FEEDBACK_EMOJI) {
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

// Initialize everything and start server
async function startServer() {
  try {
    // Load channel preferences (vector store mappings)
    channelPrefs.loadPreferences();
    isInitialized = true;
    log("[GLOBAL]: Initialization complete");

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
