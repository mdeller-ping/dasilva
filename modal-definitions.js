/**
 * Slack Block Kit modal definitions for channel configuration
 */

/**
 * Get modal for adding a new channel configuration
 */
function getAddChannelModal() {
  return {
    type: 'modal',
    callback_id: 'add_channel_modal',
    title: {
      type: 'plain_text',
      text: 'Add Channel Config'
    },
    submit: {
      type: 'plain_text',
      text: 'Add Channel'
    },
    close: {
      type: 'plain_text',
      text: 'Cancel'
    },
    blocks: [
      {
        type: 'input',
        block_id: 'channel_id_block',
        label: {
          type: 'plain_text',
          text: 'Channel ID'
        },
        element: {
          type: 'plain_text_input',
          action_id: 'channel_id',
          placeholder: {
            type: 'plain_text',
            text: 'C0AB1P97UBB'
          }
        },
        hint: {
          type: 'plain_text',
          text: 'Find in channel details (starts with C)'
        }
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
          placeholder: {
            type: 'plain_text',
            text: 'engineering'
          }
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
          placeholder: {
            type: 'plain_text',
            text: 'engineering'
          }
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
          initial_value: '_instructions.md'
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
 * Get confirmation modal for deleting a channel configuration
 */
function getDeleteConfirmationModal(channelId, channelName) {
  return {
    type: 'modal',
    callback_id: 'delete_channel_modal',
    private_metadata: channelId, // Store channel ID to delete
    title: {
      type: 'plain_text',
      text: 'Delete Channel?'
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
          text: `:warning: *Are you sure you want to delete this channel configuration?*`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Channel:* ${channelName}\n*ID:* \`${channelId}\``
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_This will remove the channel from the configuration file. The bot will no longer respond in this channel._'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_Note: This does not delete the documentation folder or files._'
        }
      }
    ]
  };
}

module.exports = {
  getAddChannelModal,
  getEditChannelModal,
  getDeleteConfirmationModal
};
