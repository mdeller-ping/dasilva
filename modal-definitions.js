/**
 * Slack Block Kit modal definitions for channel configuration
 */

/**
 * Get modal for editing an existing channel configuration
 */
function getEditChannelModal(channelId, existingConfig) {
  return {
    type: 'modal',
    callback_id: 'edit_channel_modal',
    private_metadata: channelId, // Store original channel ID
    title: {
      type: 'plain_text',
      text: 'Edit Channel Config'
    },
    submit: {
      type: 'plain_text',
      text: 'Save Changes'
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
          text: `*Editing:* ${existingConfig.name} (\`${channelId}\`)`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'input',
        block_id: 'channel_name_block',
        label: {
          type: 'plain_text',
          text: 'Channel Name'
        },
        element: {
          type: 'plain_text_input',
          action_id: 'channel_name',
          initial_value: existingConfig.name
        },
        hint: {
          type: 'plain_text',
          text: 'Human-readable name for logging and identification'
        }
      },
      {
        type: 'input',
        block_id: 'docs_folder_block',
        label: {
          type: 'plain_text',
          text: 'Docs Folder'
        },
        element: {
          type: 'plain_text_input',
          action_id: 'docs_folder',
          initial_value: existingConfig.docsFolder
        },
        hint: {
          type: 'plain_text',
          text: 'Folder name inside /docs directory (must already exist)'
        }
      },
      {
        type: 'input',
        block_id: 'instructions_file_block',
        label: {
          type: 'plain_text',
          text: 'Instructions File'
        },
        element: {
          type: 'plain_text_input',
          action_id: 'instructions_file',
          initial_value: existingConfig.instructionsFile
        },
        hint: {
          type: 'plain_text',
          text: 'Filename for channel-specific instructions'
        }
      }
    ]
  };
}

/**
 * Get modal for confirming channel deletion
 */
function getDeleteChannelModal(channelId, channelConfig) {
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
          text: ':warning: *This action is permanent and cannot be undone!*'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `You are about to delete the configuration for:\n\n*${channelConfig.name}* (\`${channelId}\`)\n\nDocs Folder: \`${channelConfig.docsFolder}\`\nInstructions: \`${channelConfig.instructionsFile}\``
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
          text: `Type the channel name "${channelConfig.name}" to confirm`
        },
        element: {
          type: 'plain_text_input',
          action_id: 'confirmation_input',
          placeholder: {
            type: 'plain_text',
            text: channelConfig.name
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
  getEditChannelModal,
  getDeleteChannelModal
};
