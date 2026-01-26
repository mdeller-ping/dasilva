/**
 * Slack Block Kit modal definitions for channel configuration
 */

/**
 * Get modal for confirming channel deletion
 */
function leaveChannelModal(channelId) {
  return {
    type: 'modal',
    callback_id: 'leave_channel_modal',
    private_metadata: channelId,
    title: {
      type: 'plain_text',
      text: 'Leave Channel'
    },
    submit: {
      type: 'plain_text',
      text: 'Leave'
    },
    close: {
      type: 'plain_text',
      text: 'Cancel'
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Warning: This action is permanent and cannot be undone!*'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Dasilva will no longer monitor channel \`${channelId}\`.\n\nThis will remove all indexed documentation from the bot.`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'input',
        block_id: 'confirmation_block',
        label: {
          type: 'plain_text',
          text: `Type "${channelId}" to confirm`
        },
        element: {
          type: 'plain_text_input',
          action_id: 'confirmation_input',
          placeholder: {
            type: 'plain_text',
            text: channelId
          }
        },
        hint: {
          type: 'plain_text',
          text: 'This confirmation is required to prevent accidental deletion'
        }
      }
    ]
  };
}

module.exports = {
  leaveChannelModal
};
