require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { loadChannelPreferences } = require("./utils-preferences");
const commands = require("./commands");
const modalDefs = require("./modal-definitions");
const logger = require("./utils-logger");
const {
  verifySlackRequest,
  postThreadReply,
  openView,
  getBotUserId,
} = require("./utils-slack");
const { PORT, GLOBAL_ADMINS } = require("./utils-variables");
const { isThreadActive, markThreadActive } = require("./utils-threads");
const {
  handleMention,
  handleAmbient,
  handleReactionAdded,
  setBotUserId,
  looksLikeQuestion,
  looksLikeChatter,
} = require("./utils-message");
const {
  openLeaveChannelModal,
  handleLeaveChannelSubmission,
  handleFeedbackSubmission,
} = require("./utils-modals");
const { isUserSilencedInChannel } = require("./utils-preferences");
const { isUserOnCooldown } = require("./utils-ratelimit");
const {
  initializeRedis,
  closeRedis,
  isRedisConnected,
} = require("./utils-redis");

// ============================================================================
// REDIS INITIALIZATION
// ============================================================================

// Initialize Redis connection
(async () => {
  try {
    await initializeRedis();
  } catch (error) {
    logger.error(
      "Failed to initialize Redis. Thread tracking will be unavailable.",
    );
    // Don't exit - allow bot to run without Redis for basic functionality
  }
})();

// Graceful shutdown handler
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  await closeRedis();
  process.exit(0);
});

const app = express();
const port = PORT;

// Helper to check if user is admin
function isAdmin(userId) {
  return GLOBAL_ADMINS.includes(userId);
}

let isInitialized = false;
let botUserId = null;

// Is optional PERSISTENT_STORAGE value set?
if (process.env.PERSISTENT_STORAGE) {
  logger.info(`Using persistent storage: ${process.env.PERSISTENT_STORAGE}`);
}

// Middleware to capture raw body for Slack signature verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
);
app.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
);

// Health check
app.get("/", (req, res) => {
  const redisStatus = isRedisConnected() ? "connected" : "disconnected";
  res.json({
    status: "ok",
    redis: redisStatus,
    uptime: process.uptime(),
  });
});

// =========================================
// Slack slash command endpoint

app.post("/slack/commands", verifySlackRequest, async (req, res) => {
  // Set a safety timeout to respond within 2.5 seconds no matter what
  const safetyTimeout = setTimeout(() => {
    if (!res.headersSent) {
      logger.warn("Slash command took too long - sending fallback response");
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

    // Build context for command dispatcher
    const ctx = {
      args: text.trim().toLowerCase(),
      originalText: text.trim(),
      userId,
      channelId,
      isAdmin: isAdmin(userId),
    };

    // Dispatch to command handler
    const result = commands.dispatch(ctx);

    // Handle special case: leave command opens a modal
    if (typeof result === "object" && result.action === "open_leave_modal") {
      clearTimeout(safetyTimeout);
      res.json({
        response_type: "ephemeral",
        text: result.text,
      });

      // Open modal asynchronously (don't await here)
      openLeaveChannelModal(trigger_id, channelId).catch((error) => {
        logger.error("Error opening leave channel modal:", error);
      });
      return;
    }

    // Normal response (string)
    clearTimeout(safetyTimeout);
    res.json({
      response_type: "ephemeral",
      text: result,
    });
  } catch (error) {
    logger.error("Error handling slash command:", error);
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
app.post("/slack/events", verifySlackRequest, async (req, res) => {
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
    // the bot was mentioned - always reply
    if (event.text?.includes(`<@${botUserId}>`)) {
      return handleMention(event);
    }

    // active thread respond to messages that look like questions
    if (
      event.thread_ts &&
      (await isThreadActive(event.channel, event.thread_ts))
    ) {
      // does this look like a question?
      if (!looksLikeQuestion(event.text)) {
        logger.info(
          `[${event.channel}] (${event.ts}) threaded ambient message from ${event.user} does not look like question. Ignoring.`,
        );
        return;
      }
      return handleMention(event);
    }

    // non active thread - ignore (do not invite yourself to the conversation)
    if (event.thread_ts) return;

    // root channel message

    // does this look like a question?
    if (!looksLikeQuestion(event.text)) {
      logger.info(
        `[${event.channel}] (${event.ts}) ambient message from ${event.user} does not look like question. Ignoring.`,
      );
      return;
    }

    // is the user on cooldown?
    if (!isUserOnCooldown(event.channel, event.user)) {
      logger.info(
        `[${event.channel}] (${event.ts}) ambient message from ${event.user} who is on cooldown. Ignoring.`,
      );
      return;
    }

    // has user silenced the bot from answering ambient questions in this channel?
    if (isUserSilencedInChannel(event.user, event.channel)) {
      logger.info(
        `[${event.channel}] (${event.ts}) ambient message from ${event.user} who is silenced in this channel. Ignoring.`,
      );
      return;
    }

    // we should reply
    return handleAmbient(event);
  }
});

// =========================================
// Slack interactions endpoint (for modals)

app.post("/slack/interactions", verifySlackRequest, async (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload);
    const { type, user, view } = payload;

    logger.debug("Interaction received:", {
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
          await openView(
            payload.trigger_id,
            modalDefs.feedbackModal(channel, messageTs),
          );
        } catch (error) {
          logger.error("Error opening feedback modal:", error);
        }

        // Remove the ephemeral "Give Feedback" button message
        if (payload.response_url) {
          axios
            .post(payload.response_url, { delete_original: true })
            .catch((error) => {
              logger.debug(
                "Failed to delete ephemeral feedback prompt:",
                error.message,
              );
            });
        }

        return res.status(200).send();
      }

      if (action?.action_id === "promote_to_public") {
        const { channel, messageTs, reply } = JSON.parse(action.value);

        logger.info(
          `[${channel}] (${messageTs}) promoting ephemeral response requested by ${user.id}`,
        );

        try {
          // Post public reply to the original message
          await postThreadReply(channel, messageTs, reply);

          // Mark this thread as active so follow-ups are handled like @mention threads
          await markThreadActive(channel, messageTs);

          // Delete the ephemeral message
          if (payload.response_url) {
            await axios.post(payload.response_url, { delete_original: true });
          }
        } catch (error) {
          logger.error("Error promoting ephemeral to public:", error);
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
    logger.error("Error handling interaction:", error);
    res.status(200).json({
      response_action: "errors",
      errors: {
        channel_id_block:
          "An error occurred processing your request. Please try again.",
      },
    });
  }
});

// Initialize everything and start server
async function startServer() {
  try {
    // Load channel preferences (vector store mappings)
    loadChannelPreferences();
    isInitialized = true;
    logger.info("Initialization complete");

    // Resolve the bot's own Slack user ID for filtering reactions
    try {
      botUserId = await getBotUserId();
      setBotUserId(botUserId); // Set in utils-message for event handlers
      logger.info(`bot user id resolved: ${botUserId}`);
    } catch (error) {
      logger.error(
        "Failed to resolve bot user id (feedback reactions will not work):",
        error.message,
      );
    }

    app.listen(port, () => {
      logger.info(`dasilva listening on port ${port}`);
      logger.info("ready to answer questions");
    });
  } catch (error) {
    logger.error("failed to initialize:", error);
    process.exit(1);
  }
}

startServer();
