// remove bot from channel
function leaveChannelModal(channelId) {
  return {
    type: "modal",
    callback_id: "leave_channel_modal",
    private_metadata: channelId,
    title: {
      type: "plain_text",
      text: "Leave Channel",
    },
    submit: {
      type: "plain_text",
      text: "Leave",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Warning: This action is permanent and cannot be undone!*",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `DaSilva will no longer monitor channel \`${channelId}\`.\n\nThis will remove all indexed documentation from the bot.`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "input",
        block_id: "confirmation_block",
        label: {
          type: "plain_text",
          text: `Type "${channelId}" to confirm`,
        },
        element: {
          type: "plain_text_input",
          action_id: "confirmation_input",
          placeholder: {
            type: "plain_text",
            text: channelId,
          },
        },
        hint: {
          type: "plain_text",
          text: "This confirmation is required to prevent accidental deletion",
        },
      },
    ],
  };
}

// solicit feedback
function feedbackModal(channel, messageTs) {
  return {
    type: "modal",
    callback_id: "feedback_modal",
    private_metadata: JSON.stringify({ channel, messageTs }),
    title: {
      type: "plain_text",
      text: "Response Feedback",
    },
    submit: {
      type: "plain_text",
      text: "Submit",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Help us improve by sharing what went wrong with this response.",
        },
      },
      {
        type: "input",
        block_id: "feedback_category_block",
        label: {
          type: "plain_text",
          text: "Category",
        },
        element: {
          type: "static_select",
          action_id: "feedback_category_input",
          placeholder: {
            type: "plain_text",
            text: "Select a category",
          },
          options: [
            {
              text: { type: "plain_text", text: "Inaccurate" },
              value: "inaccurate",
            },
            {
              text: { type: "plain_text", text: "Incomplete" },
              value: "incomplete",
            },
            {
              text: { type: "plain_text", text: "Outdated docs" },
              value: "outdated_docs",
            },
            {
              text: { type: "plain_text", text: "Off-topic" },
              value: "off_topic",
            },
            {
              text: { type: "plain_text", text: "Other" },
              value: "other",
            },
          ],
        },
      },
      {
        type: "input",
        block_id: "feedback_details_block",
        optional: true,
        label: {
          type: "plain_text",
          text: "Details (optional)",
        },
        element: {
          type: "plain_text_input",
          action_id: "feedback_details_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Any additional details about what was wrong...",
          },
        },
      },
    ],
  };
}

module.exports = {
  leaveChannelModal,
  feedbackModal,
};
