const logger = require("./utils-logger");
const channelConfigModule = require("./utils-channel");
const { getVectorId } = require("./utils-preferences");
const {
  postThreadReply,
  postEphemeral,
  updateMessage,
  getThreadHistory,
  summarizeSlackError,
} = require("./utils-slack");
const {
  callOpenAI,
  summarizeOpenAIResponse,
  summarizeOpenAIError,
  isOpenAIError,
} = require("./utils-openai");
const { markThreadActive } = require("./utils-threads");
const { recordResponse } = require("./utils-ratelimit");
const {
  THREAD_CONTEXT_MESSAGES,
  EPHEMERAL_FOOTER,
  FEEDBACK_EMOJI,
} = require("./utils-variables");

// ============================================================================
// MODULE STATE
// ============================================================================

// Bot user ID (set during initialization)
let botUserId = null;

/**
 * Set the bot's user ID (called during app initialization)
 */
function setBotUserId(userId) {
  botUserId = userId;
  logger.debug(`utils-message: botUserId set to ${userId}`);
}

// ============================================================================
// MESSAGE ANALYSIS
// ============================================================================

/**
 * Check if message looks like a question that needs answering
 * Used for ambient mode to determine if bot should respond
 */
function looksLikeQuestion(text) {
  const lowerText = text.toLowerCase().trim();

  // Ends with question mark
  if (lowerText.endsWith("?")) return true;

  // Starts with question words
  const questionStarters = [
    "who",
    "what",
    "where",
    "when",
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

/**
 * Check if message looks like gratitude, humor, affirmation
 * Used for ambient mode to determine if bot should respond
 */
function looksLikeChatter(text) {
  if (!text) return false;

  const lowerText = text.toLowerCase().trim();

  // // Very short messages (1–3 words) that aren't questions
  // const wordCount = lowerText.split(/\s+/).length;
  // if (wordCount <= 3 && !lowerText.endsWith("?")) {
  //   return true;
  // }

  // Common gratitude / acknowledgements
  const gratitudePatterns = [
    /^thanks\b/,
    /^thank you\b/,
    /\bthanks\b/,
    /\bthank you\b/,
    /\bthx\b/,
    /\bty\b/,
    /\bappreciate it\b/,
  ];

  // Simple acknowledgements / affirmations
  const acknowledgmentPatterns = [
    /^ok\b/,
    /^okay\b/,
    /^got it\b/,
    /^makes sense\b/,
    /^understood\b/,
    /^cool\b/,
    /^nice\b/,
    /^awesome\b/,
    /^perfect\b/,
    /^great\b/,
    /^lol\b/,
    /^haha\b/,
    /^👍$/,
    /^🙏$/,
  ];

  // Meta / conversational fluff
  const conversationalPatterns = [
    /\blove that\b/,
    /\bthat('?| i)s great\b/,
    /\bbreaking the internet\b/,
    /\busing up .* processing costs\b/,
  ];

  const allPatterns = [
    ...gratitudePatterns,
    ...acknowledgmentPatterns,
    ...conversationalPatterns,
  ];

  return allPatterns.some((pattern) => pattern.test(lowerText));
}

// ============================================================================
// CHANNEL CONTEXT
// ============================================================================

/**
 * Check if channel is configured and has a vector store
 * Returns context object or null
 */
function getChannelContext(channelId) {
  const config = channelConfigModule.getChannel(channelId);
  if (!config) return null;
  const vectorId = getVectorId(channelId);
  if (!vectorId) return null;
  return { config, vectorId };
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle @mention events and active thread follow-ups
 * Reply publicly in a thread
 */
async function handleMention(event) {
  const { text, channel: channelId, ts, user: userId } = event;
  const threadTs = event.thread_ts || ts;

  logger.info(`[${channelId}] (${threadTs}) mention request from ${userId}`);

  const ctx = getChannelContext(channelId);
  if (!ctx) {
    const msg = !channelConfigModule.getChannel(channelId)
      ? "Sorry, I'm not configured for this channel yet."
      : "Sorry, I'm not trained for this channel yet.";
    logger.info(`[${channelId}] ${msg}`);
    await postThreadReply(channelId, threadTs, msg);

    return;
  }

  // Post initial "thinking" message
  let thinkingMessage;
  try {
    thinkingMessage = await postThreadReply(
      channelId,
      threadTs,
      "_Thinking..._",
    );
  } catch (error) {
    logger.error("Error posting thinking message:", error);
    // Fallback to original behavior if we can't post the thinking message
    await postThreadReply(
      channelId,
      threadTs,
      "Sorry, I encountered an error processing your request.",
    );
    return;
  }

  const userMessage = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  const threadHistory = event.thread_ts
    ? await getThreadHistory(
        channelId,
        event.thread_ts,
        ts,
        THREAD_CONTEXT_MESSAGES,
      )
    : [];

  try {
    const response = await callOpenAI(userMessage, ctx.vectorId, threadHistory);
    const reply = response.output_text;

    if (!reply?.trim()) {
      const responseSummary = summarizeOpenAIResponse(response);
      let reasonText = "";

      if (
        responseSummary.status === "incomplete" &&
        responseSummary.incomplete_reason === "max_output_tokens"
      ) {
        logger.info(
          `[${channelId}] (${threadTs}) llm ran out of response tokens`,
        );
        reasonText =
          "I was unable to answer due to complexity. Please try to rephrase your question.";
      } else if (responseSummary.status === "completed") {
        logger.info(`[${channelId}] (${threadTs}) llm untrained response`);
        reasonText =
          "Sorry, I'm not able to answer that question. It may be outside the scope of what I've been trained on in this channel.";
      } else {
        logger.info(
          `[${channelId}] (${threadTs}) llm empty response with unexpected status`,
        );
        reasonText =
          "Sorry, I encountered an unexpected issue processing your request.";
      }

      logger.info(
        `[${channelId}] (${threadTs}) empty llm response`,
        JSON.stringify(responseSummary),
      );

      // Update the thinking message with the error
      await updateMessage(channelId, thinkingMessage.ts, reasonText);

      return;
    }

    // Update the thinking message with the actual response
    await updateMessage(channelId, thinkingMessage.ts, reply);

    await markThreadActive(channelId, threadTs);

    logger.info(`[${channelId}] (${event.ts}) public response to ${userId}`);
    logger.info(
      `[${channelId}] (${event.ts})  `,
      JSON.stringify(summarizeOpenAIResponse(response)),
    );
  } catch (error) {
    // Distinguish OpenAI errors from Slack errors
    if (isOpenAIError(error)) {
      logger.error(
        "Error in handleMention (OpenAI):",
        summarizeOpenAIError(error),
      );
    } else {
      logger.error("Error in handleMention:", error);
    }

    // Update the thinking message with the error
    try {
      await updateMessage(
        channelId,
        thinkingMessage.ts,
        "Sorry, I encountered an error processing your request.",
      );
    } catch (slackError) {
      logger.error(
        "Error updating message with error:",
        summarizeSlackError(slackError),
      );
    }
  }
}

/**
 * Handle ambient questions in root channel messages
 * Reply ephemerally to avoid channel spam
 */
async function handleAmbient(event) {
  const { text, user: userId, channel: channelId } = event;

  const ctx = getChannelContext(channelId);
  if (!ctx) return;

  logger.info(`[${channelId}] (${event.ts}) ambient request from ${userId}`);

  try {
    const response = await callOpenAI(text, ctx.vectorId);
    logger.debug("OpenAI response:", response);

    const reply = response.output_text;

    if (!reply?.trim()) {
      logger.info(
        `[${channelId}] (${event.ts}) ephemeral response for ${userId} suppressed (empty reply)`,
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
      logger.info(
        `[${channelId}] (${event.ts}) ephemeral response for ${userId} suppressed (${p})`,
      );
      return;
    }

    // Slack blocks have a 3000 character limit for section text
    // Reserve space for the prefix and footer
    const maxFirstMessageLength = 2900 - EPHEMERAL_FOOTER.length;
    let firstPartReply = reply;
    let continuationParts = [];

    // Split long responses into multiple messages
    if (reply.length > maxFirstMessageLength) {
      firstPartReply = reply.substring(0, maxFirstMessageLength);

      // Find a good break point (end of sentence or paragraph)
      const lastPeriod = firstPartReply.lastIndexOf(". ");
      const lastNewline = firstPartReply.lastIndexOf("\n");
      const breakPoint = Math.max(lastPeriod, lastNewline);

      if (breakPoint > maxFirstMessageLength * 0.8) {
        // If we found a good break point in the last 20%, use it
        firstPartReply = reply.substring(0, breakPoint + 1).trim();
      }

      // Split the rest into chunks (ephemeral messages can be longer without blocks)
      let remainingText = reply.substring(firstPartReply.length).trim();
      const maxContinuationLength = 3500; // Plain text can be a bit longer

      while (remainingText.length > 0) {
        if (remainingText.length <= maxContinuationLength) {
          continuationParts.push(remainingText);
          break;
        }

        // Find a good break point
        let chunk = remainingText.substring(0, maxContinuationLength);
        const lastPeriod = chunk.lastIndexOf(". ");
        const lastNewline = chunk.lastIndexOf("\n");
        const breakPoint = Math.max(lastPeriod, lastNewline);

        if (breakPoint > maxContinuationLength * 0.8) {
          chunk = remainingText.substring(0, breakPoint + 1).trim();
        }

        continuationParts.push(chunk);
        remainingText = remainingText.substring(chunk.length).trim();
      }

      logger.info(
        `[${channelId}] (${event.ts}) split response into ${1 + continuationParts.length} messages (${reply.length} total chars)`,
      );
    }

    const ephemeralText = `_Only visible to you:_\n\n${firstPartReply}${continuationParts.length > 0 ? "\n\n_(continued below...)_" : ""}${EPHEMERAL_FOOTER}`;

    try {
      // Send first message with blocks and promote button
      await postEphemeral(channelId, userId, ephemeralText, {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ephemeralText,
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
                  reply: reply, // Always promote the full response
                }),
              },
            ],
          },
        ],
      });

      // Send continuation messages if needed
      for (let i = 0; i < continuationParts.length; i++) {
        const partNumber = i + 2;
        const isLast = i === continuationParts.length - 1;
        const continuationText = `_Continued (part ${partNumber}/${1 + continuationParts.length}):_\n\n${continuationParts[i]}${isLast ? EPHEMERAL_FOOTER : ""}`;

        await postEphemeral(channelId, userId, continuationText);
      }
    } catch (blockError) {
      // If blocks fail (e.g., invalid formatting), fall back to plain text
      logger.warn(
        `[${channelId}] (${event.ts}) blocks failed for ${userId}, falling back to plain text:`,
        blockError.message,
      );

      await postEphemeral(channelId, userId, ephemeralText);

      // Still send continuation parts even in fallback mode
      for (let i = 0; i < continuationParts.length; i++) {
        const partNumber = i + 2;
        const isLast = i === continuationParts.length - 1;
        const continuationText = `_Continued (part ${partNumber}/${1 + continuationParts.length}):_\n\n${continuationParts[i]}${isLast ? EPHEMERAL_FOOTER : ""}`;

        await postEphemeral(channelId, userId, continuationText);
      }
    }

    recordResponse(channelId, userId);
    logger.info(`[${channelId}] (${event.ts}) ephemeral response to ${userId}`);
    logger.info(
      `[${channelId}] (${event.ts})  `,
      JSON.stringify(summarizeOpenAIResponse(response)),
    );
  } catch (error) {
    if (isOpenAIError(error)) {
      logger.error(
        `[${channelId}] error in handleAmbient (OpenAI) for ${userId}:`,
        summarizeOpenAIError(error),
      );
    } else {
      logger.error(
        `[${channelId}] error in handleAmbient (Slack) for ${userId}:`,
        summarizeSlackError(error),
      );
    }
  }
}

/**
 * Handle reaction_added events for feedback flow
 */
async function handleReactionAdded(event) {
  try {
    const {
      user: reactingUserId,
      reaction,
      item,
      item_user: messageAuthorId,
    } = event;

    logger.debug("Reaction event:", reaction);

    // Only process the configured feedback emoji
    if (reaction.split(":")[0] !== FEEDBACK_EMOJI) {
      logger.debug(`Ignoring reaction: ${reaction} (not feedback emoji)`);
      return;
    }

    // Only process reactions on bot's own messages
    if (!botUserId || messageAuthorId !== botUserId) {
      logger.debug(
        `Ignoring feedback reaction: message author ${messageAuthorId} is not the bot ${botUserId}`,
      );
      return;
    }

    // Don't process reactions from the bot itself
    if (reactingUserId === botUserId) {
      logger.debug("Ignoring feedback reaction from bot itself");
      return;
    }

    const { channel, ts: messageTs } = item;

    logger.info(
      `[${channel}] (${messageTs}) feedback reaction from user ${reactingUserId}`,
    );

    // Send ephemeral message with "Give Feedback" button
    await postEphemeral(
      channel,
      reactingUserId,
      "Would you like to provide feedback on this response?",
      {
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
      },
    );
  } catch (error) {
    logger.error("Error handling reaction_added:", error);
  }
}

module.exports = {
  looksLikeQuestion,
  looksLikeChatter,
  getChannelContext,
  handleMention,
  handleAmbient,
  handleReactionAdded,
  setBotUserId,
};
