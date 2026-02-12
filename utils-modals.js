const logger = require("./utils-logger");
const channelConfigModule = require("./utils-channel");
const { deleteChannelPreference } = require("./utils-preferences");
const { openView, postMessage } = require("./utils-slack");
const modalDefs = require("./modal-definitions");
const { FEEDBACK_CHANNEL } = require("./utils-variables");

// ============================================================================
// MODAL HANDLERS
// ============================================================================

/**
 * Open the leave channel confirmation modal
 */
async function openLeaveChannelModal(triggerId, channelId) {
  try {
    await openView(triggerId, modalDefs.leaveChannelModal(channelId));
  } catch (error) {
    logger.error("Error opening leave channel modal:", error);
    throw error;
  }
}

/**
 * Handle leave channel modal submission
 * Validates confirmation and removes channel configuration
 */
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

  logger.info(`[${channelId}] admin ${userId} attempting to leave channel`);

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
  deleteChannelPreference(channelId);

  logger.info(`[${channelId}] channel left by admin ${userId}`);

  // Clear the modal
  return { response_action: "clear" };
}

/**
 * Handle feedback modal submission
 * Collects user feedback and posts to feedback channel
 */
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

    logger.info(
      `[${channel}] (${messageTs}) feedback submitted by ${userId} - category: ${category}`,
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

      await postMessage(FEEDBACK_CHANNEL, feedbackMessage, {
        unfurl_links: false,
      });
    }

    return { response_action: "clear" };
  } catch (error) {
    logger.error("Error handling feedback submission:", error);
    return {
      response_action: "errors",
      errors: {
        feedback_category_block:
          "An error occurred submitting your feedback. Please try again.",
      },
    };
  }
}

module.exports = {
  openLeaveChannelModal,
  handleLeaveChannelSubmission,
  handleFeedbackSubmission,
};
