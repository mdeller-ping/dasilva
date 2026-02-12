const { WebClient } = require("@slack/web-api");
const crypto = require("crypto");
const logger = require("./utils-logger");

// Maximum age of a request (5 minutes) to prevent replay attacks
const MAX_REQUEST_AGE_SECONDS = 60 * 5;

// Initialize Slack WebClient
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// ============================================================================
// SIGNATURE VERIFICATION
// ============================================================================

/**
 * Verifies the signature of an incoming Slack request
 * @param {string} signingSecret - The Slack signing secret from environment
 * @param {Object} headers - Request headers
 * @param {string} rawBody - Raw request body as string
 * @returns {boolean} True if signature is valid
 */
function verifySlackSignature(signingSecret, headers, rawBody) {
  if (!signingSecret) {
    logger.error("SLACK_SIGNING_SECRET not configured");
    return false;
  }

  const timestamp = headers["x-slack-request-timestamp"];
  const slackSignature = headers["x-slack-signature"];

  if (!timestamp || !slackSignature) {
    logger.warn("Missing Slack signature headers");
    return false;
  }

  // Prevent replay attacks by checking timestamp
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > MAX_REQUEST_AGE_SECONDS) {
    logger.warn(`Request timestamp too old: ${timestamp}`);
    return false;
  }

  // Compute the signature
  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(sigBasestring, "utf8")
      .digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(mySignature, "utf8"),
      Buffer.from(slackSignature, "utf8"),
    );

    if (!isValid) {
      logger.warn("Slack signature verification failed");
    }

    return isValid;
  } catch (error) {
    // timingSafeEqual throws if buffer lengths don't match
    logger.warn("Slack signature verification failed (length mismatch)");
    return false;
  }
}

/**
 * Express middleware to verify Slack request signatures
 * Requires raw body to be available in req.rawBody
 */
function verifySlackRequest(req, res, next) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!req.rawBody) {
    logger.error("Raw body not available for signature verification");
    return res.status(500).send("Internal server error");
  }

  const isValid = verifySlackSignature(signingSecret, req.headers, req.rawBody);

  if (!isValid) {
    logger.warn(`Rejected request to ${req.path} - invalid signature`);
    return res.status(401).send("Unauthorized");
  }

  next();
}

// ============================================================================
// SLACK API HELPERS
// ============================================================================

/**
 * Post a threaded reply in Slack
 * @param {string} channel - Channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {string} text - Message text
 * @returns {Promise} Slack API response
 */
function postThreadReply(channel, threadTs, text) {
  return slackClient.chat.postMessage({ channel, thread_ts: threadTs, text });
}

/**
 * Post an ephemeral message (visible only to a specific user)
 * @param {string} channel - Channel ID
 * @param {string} user - User ID
 * @param {string} text - Message text
 * @param {Object} options - Additional options (blocks, thread_ts, etc.)
 * @returns {Promise} Slack API response
 */
function postEphemeral(channel, user, text, options = {}) {
  return slackClient.chat.postEphemeral({
    channel,
    user,
    text,
    ...options,
  });
}

/**
 * Update an existing message
 * @param {string} channel - Channel ID
 * @param {string} ts - Message timestamp
 * @param {string} text - New message text
 * @param {Object} options - Additional options (blocks, etc.)
 * @returns {Promise} Slack API response
 */
function updateMessage(channel, ts, text, options = {}) {
  return slackClient.chat.update({
    channel,
    ts,
    text,
    ...options,
  });
}

/**
 * Post a message to a channel
 * @param {string} channel - Channel ID
 * @param {string} text - Message text
 * @param {Object} options - Additional options (blocks, thread_ts, etc.)
 * @returns {Promise} Slack API response
 */
function postMessage(channel, text, options = {}) {
  return slackClient.chat.postMessage({
    channel,
    text,
    ...options,
  });
}

/**
 * Open a modal view
 * @param {string} triggerId - Trigger ID from interaction
 * @param {Object} view - Modal view definition
 * @returns {Promise} Slack API response
 */
function openView(triggerId, view) {
  return slackClient.views.open({
    trigger_id: triggerId,
    view,
  });
}

/**
 * Get bot user ID (requires auth.test call)
 * @returns {Promise<string>} Bot user ID
 */
async function getBotUserId() {
  const authResult = await slackClient.auth.test();
  return authResult.user_id;
}

/**
 * Fetch recent thread history from Slack and map to OpenAI message roles
 * @param {string} channel - Channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {string} currentMessageTs - Current message timestamp to exclude
 * @param {number} contextMessages - Number of messages to include (default: 10)
 * @returns {Promise<Array>} Array of {role, content} objects
 */
async function getThreadHistory(
  channel,
  threadTs,
  currentMessageTs,
  contextMessages = 10,
) {
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
      .slice(-contextMessages)
      .map((msg) => ({
        role: msg.bot_id ? "assistant" : "user",
        content: (msg.text || "").replace(/<@[A-Z0-9]+>/g, "").trim(),
      }))
      .filter((msg) => msg.content.length > 0);
  } catch (error) {
    logger.error("Error fetching thread history:", error);
    return [];
  }
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Summarize a Slack error for logging
 * @param {Error} err - Slack error object
 * @returns {Object} Summarized error
 */
function summarizeSlackError(err) {
  return {
    name: err?.name,
    message: err?.message,
    code: err?.code,
    data: err?.data,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Client instance
  slackClient,

  // Signature verification
  verifySlackSignature,
  verifySlackRequest,

  // API helpers
  postThreadReply,
  postEphemeral,
  updateMessage,
  postMessage,
  openView,
  getBotUserId,
  getThreadHistory,

  // Error handling
  summarizeSlackError,
};
