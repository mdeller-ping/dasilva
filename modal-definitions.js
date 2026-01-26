/**
 * Slack Block Kit modal definitions for channel configuration
 */

/**
 * Get modal for confirming channel deletion
 */
function getDeleteChannelModal(channelId) {
  return {
    type: 'modal',
    callback_id: 'delete_channel_modal',
    private_metadata: channelId,
    title: {
      type: 'plain_text',
      text: 'Delete Channel'
    },
    submit: {
      type: 'plain_text',
      text: 'Delete'
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
          text: `You are about to delete the configuration for channel \`${channelId}\`.\n\nThis will remove all documentation in \`channels/${channelId}/\`.`
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
  getDeleteChannelModal
};
