# Dasilva - AI-Powered Slack Bot

A channel-specific AI assistant for Slack that responds to questions based on custom documentation using local semantic search.

## Overview

Dasilva is a Slack bot that monitors configured channels and provides AI-powered responses based on channel-specific documentation. It offers two interaction modes:

1. **@mentions** - Public threaded responses when explicitly tagged (always responds)
2. **Ambient listening** - Private ephemeral responses to questions in monitored channels (smart filtering)

## Technologies

**Runtime & Server**
- Node.js (v18+)
- Express.js (v5.2.1) - Web framework for HTTP endpoints

**AI & ML**
- OpenAI API (@openai v6.16.0) - gpt-5-mini or gpt-5-nano models
- Xenova/transformers (v2.17.1) - Local semantic embeddings (Hugging Face Transformers.js)

**Slack Integration**
- @slack/web-api (v7.13.0) - Slack API client for posting messages, reading channels

**Development Tools**
- dotenv (v16.4.5) - Environment variable management
- ESLint (v9.39.2) - Code linting and quality
- Nodemon (v3.1.9) - Development hot-reload

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
- Rate limits responses per user (default: 5 minutes cooldown)
- @mentions bypass ALL filtering and cooldowns

### Documentation Management
- **Instructions file** (`_instructions.md`) - Always included with every request
- **Content files** (all other `.md` files) - Chunked and semantically searched
- Documentation loaded and embedded at startup
- Semantic search finds relevant chunks based on question meaning
- **Canvas-based file upload** - Admins can upload .md/.txt files to designated Slack canvas for automatic ingestion
- Easy to update - just edit markdown files and restart, or upload via Slack canvas

### Anti-Hallucination
- Instructions guide the model to be helpful but accurate
- Won't invent features or capabilities not in documentation
- Proper Slack formatting for technical content

## Current Implementation Status

This bot uses a directory-based configuration where each subscribed channel has its own folder at `channels/<channelId>/`.

**Recent Updates**:
- Simplified channel configuration (directory-based, no JSON config file)
- Removed emoji from all user-facing messages
- Streamlined admin commands (subscribe/leave)

## Project Structure

```
dasilva/
├── app.js                           # Main application
├── user-preferences.js              # User preference management (silence, cooldown)
├── channel-config.js                # Channel configuration (directory-based)
├── modal-definitions.js             # Slack Block Kit modal definitions
├── package.json                     # Dependencies and scripts
├── package-lock.json                # Locked dependency versions
├── .env                            # Environment variables (gitignored, contains API keys)
├── env.example                      # Template for environment configuration
├── .gitignore                      # Git ignore rules
├── eslint.config.js                # ESLint configuration
├── README.md                       # This file
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

1. Clone the repository:
```bash
git clone <repo-url>
cd dasilva
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` from the example:
```bash
cp env.example .env
```

5. Start the bot:
```bash
npm start
```

4. Configure environment variables in `.env`:
```bash
PORT=3000
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
OPENAI_API_KEY=sk-your-openai-key-here

# Model configuration
MODEL=gpt-5-mini

# Reasoning models need more tokens (they use tokens for internal thinking)
MAX_COMPLETION_TOKENS=4000

# Rate limiting
RESPONSE_COOLDOWN_SECONDS=300

# Document chunking
CHUNK_SIZE=2000
MAX_CHUNKS=5

# Debug logging
DEBUG_MODE=false
```

### Setting Up Admin Users

1. Find your Slack user ID:
   - Open your profile in Slack
   - Select "..." → "Copy member ID"

2. Add admin Slack user IDs to your `.env` file:
```bash
# Admin users who can configure channels (comma-separated Slack user IDs)
ADMIN_USERS=U01234ABCDE,U56789FGHIJ
```

### Slack App Configuration

1. Create a new Slack app at https://api.slack.com/apps

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
                "url": "https://<YOUR.URL>/slack/commands",
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
            "request_url": "https://<YOUR.URL>/slack/events",
            "bot_events": [
                "app_mention",
                "file_shared",
                "message.channels",
                "message.groups"
            ]
        },
        "interactivity": {
            "is_enabled": true,
            "request_url": "https://<YOUR.URL>/slack/interactions"
        },
        "org_deploy_enabled": false,
        "socket_mode_enabled": false,
        "token_rotation_enabled": false
    }
}
```

2. Install the app to your workspace and copy the Bot User OAuth Token

### Channel Configuration

Channels are configured by directory presence. Each subscribed channel has a folder at `channels/<channelId>/`.

**Option 1: Subscribe via Slack (recommended)**
1. Invite the bot to a channel: `/invite @dasilva`
2. Run `/dasilva subscribe` in that channel
3. The bot creates `channels/<channelId>/` automatically
4. Add your documentation files to that folder

**Option 2: Manual setup**
1. Get your Slack channel ID:
   - Right-click channel → "View channel details" → Copy Channel ID

2. Create a channel folder:
```bash
mkdir -p channels/C01234ABCDE
```

3. Create your instructions file `channels/C01234ABCDE/_instructions.md`:
```markdown
# Product Team Assistant

You are a helpful expert on our product. Answer questions clearly based on the information provided.

## Response Formatting for Slack

Use Slack's formatting syntax:
- Code blocks for JSON/code with ```language
- Inline code for technical terms with `backticks`
- Bold for emphasis with *asterisks*

## Guidelines

Be direct and helpful. Don't fabricate information not in the docs.
```

4. Add your content files:
   - Create `.md` files: `channels/C01234ABCDE/overview.md`, `features.md`, etc.
   - All `.md` files except `_instructions.md` will be chunked and semantically searched
   - `_instructions.md` is always included with every request

### Admin Configuration via Slack

Admins can configure channels directly from Slack without server access.

#### Admin Slash Commands

Admin users have access to additional slash commands:

- **`/dasilva subscribe`** - Subscribe the current channel
  - Creates `channels/<channelId>/` directory automatically
  - Channel is ready for documentation immediately

- **`/dasilva leave`** - Unsubscribe the current channel
  - Opens a confirmation modal (requires typing channel ID to confirm)
  - Deletes the channel directory and all its documentation

- **`/dasilva list`** - Shows all configured channels

#### How It Works

1. Admin invites the bot to a channel: `/invite @dasilva`
2. Admin runs `/dasilva subscribe` in that channel
3. The bot creates a folder at `channels/<channelId>/`
4. Admin adds documentation:
   - Upload `.md` files directly via Slack (admin only)
   - Or add files to `channels/<channelId>/` on the server
5. The bot automatically embeds new documentation (no restart needed)

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
Disables cooldown (instant responses).

### Command Notes

- **Slash commands are recommended** - They're cleaner and don't create visible messages in channels
- Commands are **case-insensitive** - `/dasilva silence`, `/dasilva Silence`, and `/dasilva SILENCE` all work
- Commands work in **any channel where the bot is installed**
- All command responses are **ephemeral (private)** - only you see the response
- Settings are **global** - they apply across all channels where the bot is active
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

### Troubleshooting Canvas Uploads

- **Nothing happens**: Check that you're an admin (`ADMIN_USERS` in .env)
- **File type error**: Only `.md` and `.txt` files are supported
- **Permission error**: Ensure bot has `files:read` and `canvases:read` scopes
- **Events subscriptions**: Subscribe to bot events `file_shared`

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

## Performance Characteristics

**Startup Behavior**
- Initial load: 30-60 seconds to download embedding model and process documentation
- Model caching: Embedding model is cached locally after first download
- Documentation processing: Chunks are generated at startup and cached in memory
- Memory usage: Proportional to documentation size and number of chunks

**Runtime Performance**
- Semantic search: Local embedding computation (no external API calls)
- Response time: Dependent on OpenAI API latency (typically 2-5 seconds)
- Concurrent requests: Single-threaded Node.js handles multiple channels simultaneously
- Rate limiting: In-memory per-user, per-channel tracking (resets on restart)

## Known Limitations (MVP)

- **No conversation memory** - Bot only sees the current message, not chat history
- **No thread context** - Cannot reference "the previous message"
- **In-memory rate limiting** - Resets on restart
- **Single-instance only** - No distributed deployment support
- **No request verification** - Trusts all Slack requests (security risk)
- **No message editing** - Cannot update responses
- **No analytics** - No tracking of usage or performance
- **Startup time** - 30-60 seconds to load embedding model and process docs

## Production TODOs

### Critical (Security & Reliability)
- [ ] **Slack request verification** - Verify requests using signing secret
- [ ] **Error monitoring** - Add Sentry or similar error tracking
- [ ] **Persistent rate limiting** - Use Redis or database
- [ ] **Health check endpoint** - Add `/health` for load balancers
- [ ] **Graceful shutdown** - Handle SIGTERM properly
- [ ] **Request timeouts** - Prevent hung connections
- [ ] **Environment validation** - Validate all required env vars on startup

### High Priority (Scale & Features)
- [ ] **Conversation memory** - Store recent messages per thread
- [ ] **Thread context** - Load previous messages when responding
- [ ] **Message editing** - Allow bot to update/correct responses
- [ ] **Multiple instances** - Support horizontal scaling
- [ ] **Database integration** - Persist configurations and rate limits
- [ ] **Hot reload** - Reload docs without restart
- [ ] **Cost tracking** - Monitor OpenAI API usage
- [ ] **Analytics** - Track questions, responses, channels

### Medium Priority (UX Improvements)
- **User slash commands** - `/dasilva` commands for user preferences (done)
- [ ] **Typing indicators** - Show bot is "thinking"
- [ ] **Reaction-based controls** - Let users dismiss/retry with emoji reactions
- [ ] **Admin commands** - Additional slash commands for managing bot (reload docs, stats, etc.)
- [ ] **Feedback collection** - 👍/👎 reactions for responses
- [ ] **Source citations** - Link to specific docs in responses
- [ ] **Multi-file search** - Better chunking/search for large doc sets
- [ ] **Custom question patterns** - Per-channel question detection rules

### Lower Priority (Nice to Have)
- [ ] **Web dashboard** - UI for managing channels and docs
- [ ] **A/B testing** - Test different prompts/models
- [ ] **Scheduled summaries** - Daily/weekly channel summaries
- [ ] **Multi-language support** - Detect and respond in user's language
- [ ] **Voice/video support** - Transcribe and respond to voice messages
- [ ] **Integration with other tools** - Jira, Confluence, GitHub, etc.

## Deployment

### Recommended Platforms
- **Railway.app** - Easy, auto-deploys from Git
- **Render.com** - Free tier available
- **Fly.io** - Good for Node.js apps
- **Heroku** - Classic choice
- **AWS ECS/Fargate** - For enterprise scale

### Environment Variables in Production
Ensure all variables from `.env` are set in your hosting platform's environment configuration.

### Monitoring Recommendations
- Set up uptime monitoring (UptimeRobot, Pingdom)
- Enable error tracking (Sentry, Rollbar)
- Monitor API costs (OpenAI dashboard)
- Track response times and success rates

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

## License

[Undecided, but currently Rights Reserved]

## Credits

Built with:
- [Slack Web API](https://slack.dev/node-slack-sdk/)
- [OpenAI API](https://platform.openai.com/)
- [Transformers.js](https://huggingface.co/docs/transformers.js) - Local embeddings
- [Express](https://expressjs.com/)