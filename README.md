# Dasilva - AI-Powered Slack Bot

Dasilva is a Slack bot that monitors subscribed channels and provides AI-powered responses based on channel-specific documentation. It offers two interaction modes:

1. **@mentions** - Public threaded responses when explicitly tagged (always responds)
2. **Ambient listening** - Private ephemeral responses to public questions in subscribed channels

## Technologies

**Runtime & Server**
- Node.js
- Express.js - Web framework for HTTP endpoints

**AI & ML**
- OpenAI API - gpt-5-mini or gpt-5-nano models
- Xenova/transformers - Local semantic embeddings to minimize token size to OpenAI

**Slack Integration**
- @slack/web-api - Slack API client for posting messages, reading channels

**Development Tools**
- dotenv  - Environment variable management
- ESLint  - Code linting and quality
- Nodemon - Development hot-reload

## Current Features (MVP)

### Core Functionality
- **Local semantic search** using `@xenova/transformers` embeddings
- Channel-specific documentation from Markdown files
- AI responses powered by OpenAI (`gpt-5-mini` or `gpt-5-nano`)
- Two interaction modes: @mentions (public) and ambient (private ephemeral)
- **Slash commands** for user preferences (`/dasilva help`, `/dasilva silence`, etc.)
- **Admin configuration via Slack** - Subscribe/unsubscribe channels without server access
- **Hot reload** - Channel changes take effect immediately (no restart needed)
- Smart question detection - only ambient mode responds to actual questions
- Per-user rate limiting to prevent spam (ambient mode only)
- Ephemeral messages for ambient responses (only visible to questioner)
- Public threaded replies for @mentions
- **Slack formatting support** - proper code blocks, inline code, bold text
- Configurable token limits, chunking, and cooldown periods
- Debug mode for verbose logging
- Token usage tracking in logs

### Smart Filtering (Ambient Mode Only)
- Only responds to messages that look like questions (ends with `?`, starts with question words, contains help keywords)
- Ambient responses are ephemeral (private) and won't clutter channels or discourage others from participating
- Rate limits responses per user (default: 5 minutes cooldown)
- Users must opt in via `/dasilva unsilence` when `AMBIENT_MODE=false`
- @mentions bypass ALL filtering and cooldowns

### Documentation Management
- **Instructions file** (`_instructions.md`) - Always included with every request
- **Content files** (all other `.md` files) - Chunked and semantically searched
- Documentation loaded and embedded at startup
- Semantic search finds relevant chunks based on question meaning
- **Canvas-based file upload** - Admins can upload .md/.txt files to designated Slack channel for automatic ingestion

### Anti-Hallucination
- Instructions guide the model to be helpful but accurate
- Won't invent features or capabilities not in documentation
- Proper Slack formatting for technical content

## Project Structure

```
dasilva/
├── app.js                           # Main application
├── user-preferences.js              # User preference management (silence, cooldown)
├── channel-config.js                # Channel configuration (directory-based)
├── modal-definitions.js             # Slack Block Kit modal definitions
├── package.json                     # Dependencies and scripts
├── package-lock.json                # Locked dependency versions
├── .env                             # Environment variables (gitignored, contains API keys)
├── env.example                      # Template for environment configuration
├── .gitignore                       # Git ignore rules
├── eslint.config.js                 # ESLint configuration
├── README.md                        # This file
├── LICENSE                          # Apache 2.0 License
└── sample-docs/                     # Example channel documentation
        ├── _instructions.md         # Sample instructions file, with anti hallucination
        └── engineering.md           # Sample documentation for engineering team
└── channels/                        # Channel documentation directories
    └── <channelId>/                 # One directory per subscribed channel
        ├── _instructions.md         # Channel-specific instructions (always included)
        └── *.md                     # Other documentation files (semantically searched)
```

## Setup

### Prerequisites
- Node.js (v18+)
- npm
- Slack workspace with admin access
- OpenAI API key with access to gpt-5-mini or gpt-5-nano

### Installation

```bash
git clone https://github.com/mdeller-ping/dasilva
cd dasilva
npm install
cp env.example .env
npm start
```

Navigate to <https://YOUR.BOT.URL>

```bash
Dasilva is alive!
```

### Slack App Configuration

1. Create a new Slack App from Manifest at https://api.slack.com/apps

2. Choose your workspace

3. Paste in the manifest and customize with your <https://YOUR.BOT.URL>
```json
{
    "display_information": {
        "name": "Dasilva - Product Champion"
    },
    "features": {
        "bot_user": {
            "display_name": "Dasilva - Product Champion",
            "always_online": false
        },
        "slash_commands": [
            {
                "command": "/dasilva",
                "url": "<https://YOUR.BOT.URL>/slack/commands",
                "description": "Interact with Dasilva bot",
                "usage_hint": "help | silence | unsilence | cooldown <minutes>",
                "should_escape": false
            }
        ]
    },
    "oauth_config": {
        "scopes": {
            "bot": [
                "app_mentions:read",
                "channels:history",
                "channels:read",
                "chat:write",
                "commands",
                "im:write",
                "incoming-webhook",
                "users:read",
                "files:read",
                "canvases:read",
                "groups:history"
            ]
        }
    },
    "settings": {
        "event_subscriptions": {
            "request_url": "<https://YOUR.BOT.URL>/slack/events",
            "bot_events": [
                "app_mention",
                "file_shared",
                "message.channels",
                "message.groups"
            ]
        },
        "interactivity": {
            "is_enabled": true,
            "request_url": "<https://YOUR.BOT.URL>/slack/interactions"
        },
        "org_deploy_enabled": false,
        "socket_mode_enabled": false,
        "token_rotation_enabled": false
    }
}
```

4. Note Slack's Signing Secret (Basic Information - App Credentials)

5. OAuth & Permissions - Install to your workspace

6. Select Channel for Webhook (create if necessary), click Allow

7. Note Slack's Bot User OAuth Token (OAuth & Permissions - OAuth Tokens)

4. Configure environment variables in `.env`:
```bash
SLACK_BOT_TOKEN=xoxb-your-token-here-from-above
SLACK_SIGNING_SECRET=your-signing-secret-here-from-above
OPENAI_API_KEY=sk-your-openai-key-here
```

## Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `MODEL` | gpt-5-mini | OpenAI model (gpt-5-mini or gpt-5-nano) |
| `MAX_COMPLETION_TOKENS` | 4000 | Max tokens for response (reasoning models need 4000+) |
| `RESPONSE_COOLDOWN_SECONDS` | 300 | Cooldown between ambient responses to same user (5 min) |
| `CHUNK_SIZE` | 2000 | Characters per documentation chunk |
| `MAX_CHUNKS` | 5 | Number of chunks to include in context |
| `DEBUG_MODE` | false | Enable verbose logging including token counts |
| `AMBIENT_MODE` | false | when false, users must opt in via unsilence |
| `ADMIN_USERS` | | comma delimited Slack IDs (ADMIN_USERS=U01234ABCDE,U56789FGHIJ) |
| `OPENAI_API_KEY` | your-openai-key | replace with your OpenAI API Key |
| `SLACK_BOT_TOKEN` | your-slack-bot-token | replace with your Slack Bot Token |
| `SLACK_SIGNING_SECRET` | your-slack-signing-secret | Replace with your Slack Signing Secret |

### Setting Up Admin Users

1. Find your Slack user ID:
   - Open your profile in Slack
   - Select "..." → "Copy member ID"

2. Add admin Slack user IDs to your `.env` file:
```bash
# Admin users who can configure channels (comma-separated Slack user IDs)
ADMIN_USERS=U01234ABCDE,U56789FGHIJ
```

### Channel Configuration

Channels are configured by directory presence. Each subscribed channel has a folder at `channels/<channelId>/`.

**Subscribe to Slack Channel**

1. Invite the bot to a channel: `/invite @dasilva`
2. Run `/dasilva subscribe` in that channel
3. The bot creates `channels/<channelId>/` automatically

**Add Documentation**

1. In Slack channel, Upload File: _instructions.md
2. In Slack channel, Upload File: Your custom documentation as .txt or .md

#### Admin Slash Commands

Admin users have access to additional slash commands:

- **`/dasilva subscribe`** - Subscribe the current channel
  - Creates `channels/<channelId>/` directory automatically
  - Channel is ready for documentation immediately

- **`/dasilva leave`** - Unsubscribe the current channel
  - Opens a confirmation modal (requires typing channel ID to confirm)
  - Deletes the channel directory and all its documentation

- **`/dasilva list`** - Shows all configured channels

#### Hot Reload

After adding documentation, the bot automatically:
- Re-processes all markdown files
- Regenerates embeddings for semantic search
- Updates in-memory cache

No bot restart required! Documentation is available immediately.

#### Troubleshooting

**"You must be an admin" message:**
- Verify your Slack user ID is in the `ADMIN_USERS` environment variable
- Restart the bot after adding your user ID to `.env`

**Modal doesn't open:**
- Check bot logs for API errors
- Ensure your Slack app has the `commands` scope configured
- Verify the interactions endpoint is set up (see Slack App Configuration below)

### Slack App Configuration (for Admin Features)

In addition to the basic Slack app setup, admin features require:

1. **Interactivity & Shortcuts**:
   - Enable Interactivity
   - Set Request URL: `https://your-domain.com/slack/interactions`
   - This allows the bot to display and process modal forms

2. **Slash Commands** (update usage hint):
   - Update `/dasilva` command usage hint to include admin commands:
   - Usage Hint: `help | silence | unsilence | cooldown <minutes> | subscribe | leave | list`

### Running the Bot

Development mode (with auto-restart):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

### Local Development with ngrok

```bash
ngrok http 3000
```
Update Slack Event Subscriptions with the ngrok URL.

## Usage

### @Mention Mode (Public)
User: `@dasilva what are our key features?`
Bot: Responds publicly in a thread (visible to everyone)

### Ambient Mode (Private)
User: `what are our key features?`
Bot: Responds with ephemeral message (only visible to the user who asked)

## User Commands

Users can control their interaction with the bot using slash commands. All responses are ephemeral (private) and won't clutter channels.

### Available Slash Commands

**`/dasilva help`** (or `/dasilva about` or just `/dasilva`)
Display information about the bot, available commands, and your current settings.

**`/dasilva silence`**
Opt-out of ambient mode responses. The bot will stop responding to your questions in channels. @mentions will still work.

**`/dasilva unsilence`**
Resume receiving ambient mode responses.

**`/dasilva cooldown <minutes>`**
Set a custom cooldown period in minutes (0-1440). This overrides the default 5-minute cooldown.

Examples:
```
/dasilva cooldown 10
```
Sets cooldown to 10 minutes.

```
/dasilva cooldown 0
```
Disables cooldown (responses to all questions).

### Command Notes

- **Slash commands are recommended** - They're cleaner and don't create visible messages in channels
- Commands are **case-insensitive** - `/dasilva silence`, `/dasilva Silence`, and `/dasilva SILENCE` all work
- Commands work in **any channel where the bot is installed**
- All command responses are **ephemeral (private)** - only you see the response
- User settings (Silence, Cooldown) are **global** - they apply across all channels where the bot is active
- Custom cooldowns and silence preferences **persist** across bot restarts

## Uploading Documentation via Slack Canvas

Admins can upload documentation directly through Slack using Canvas folders, without needing server access.

### Setup

1. **Upload files to the canvas**:
   - Upload `.md` or `.txt` files to the channel
   - The bot will automatically:
     - Detect the upload (admin users only)
     - Download the file
     - Save it to the channel's docs folder
     - Re-embed the documentation
     - Confirm with a message in the channel

### Upload Requirements

- **Admin only**: Only users listed in `ADMIN_USERS` env variable can upload
- **Supported formats**: `.md`, `.txt`, `.markdown`, `.text` files only
- **Automatic processing**: File is immediately processed and made available to the bot

### Example Workflow

```
1. Admin uploads "new-feature.md" to the channel
2. Bot detects upload and processes it
3. Bot posts: "Successfully added documentation: new-feature.md"
4. Documentation is immediately available for queries
```

## Troubleshooting

### Bot doesn't respond
1. Check bot is invited to the channel: `/invite @dasilva`
2. Verify channel is subscribed: `/dasilva list` (admin only)
3. Check logs for errors: `DEBUG_MODE=true`
4. Verify Slack Event Subscriptions URL is correct
5. Check that `channels/<channelId>/` folder exists with documentation

### Empty responses from reasoning models
- **Increase `MAX_COMPLETION_TOKENS`** - Reasoning models (gpt-5-mini/nano) use tokens for thinking
- Set to at least 4000 tokens to allow room for reasoning + output
- Check debug logs for `"reasoning_tokens"` usage
- If `"content": ""` and `"finish_reason": "length"`, increase token limit

### Bot responds twice to @mentions
- Fixed in current version - bot now skips duplicate message events
- If still happening, check Event Subscriptions aren't duplicated

### Poor quality responses
- Try increasing `MAX_CHUNKS` to include more context (e.g., 10)
- Increase `CHUNK_SIZE` for larger context per chunk (e.g., 3000)
- Check that `_instructions.md` has clear guidelines
- Verify documentation is well-organized and clear

### Startup is slow
- Normal: 30-60 seconds to download embedding model and process docs
- Model is cached after first run
- Consider reducing doc size or number of chunks if too slow

### Rate limiting issues
- Adjust `RESPONSE_COOLDOWN_SECONDS` in `.env`
- Remember: rate limiting only applies to ambient mode, not @mentions
- Check rate limit map isn't growing unbounded (add cleanup for production)

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit a pull request

## Credits

Built with:
- [Slack Web API](https://slack.dev/node-slack-sdk/)
- [OpenAI API](https://platform.openai.com/)
- [Transformers.js](https://huggingface.co/docs/transformers.js) - Local embeddings
- [Express](https://expressjs.com/)