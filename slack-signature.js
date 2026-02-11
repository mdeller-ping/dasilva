const crypto = require("crypto");
const logger = require("./logger");

// Maximum age of a request (5 minutes) to prevent replay attacks
const MAX_REQUEST_AGE_SECONDS = 60 * 5;

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

module.exports = {
  verifySlackSignature,
  verifySlackRequest,
};
