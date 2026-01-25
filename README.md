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
- ✅ **Local semantic search** using `@xenova/transformers` embeddings
- ✅ Channel-specific documentation from Markdown files
- ✅ AI responses powered by OpenAI (`gpt-5-mini` or `gpt-5-nano`)
- ✅ Two interaction modes: @mentions (public) and ambient (private ephemeral)
- ✅ **Slash commands** for user preferences (`/dasilva help`, `/dasilva silence`, etc.)
- ✅ Smart question detection - only ambient mode responds to actual questions
- ✅ Per-user rate limiting to prevent spam (ambient mode only)
- ✅ Ephemeral messages for ambient responses (only visible to questioner)
- ✅ Public threaded replies for @mentions
- ✅ **Slack formatting support** - proper code blocks, inline code, bold text
- ✅ Configurable token limits, chunking, and cooldown periods
- ✅ Debug mode for verbose logging
- ✅ Token usage tracking in logs

### Smart Filtering (Ambient Mode Only)
- Only responds to messages that look like questions (ends with `?`, starts with question words, contains help keywords)
- Rate limits responses per user (default: 5 minutes cooldown)
- @mentions bypass ALL filtering and cooldowns

### Documentation Management
- **Instructions file** (`_instructions.md`) - Always included with every request
- **Content files** (all other `.md` files) - Chunked and semantically searched
- Documentation loaded and embedded at startup
- Semantic search finds relevant chunks based on question meaning
- Easy to update - just edit markdown files and restart

### Anti-Hallucination
- Instructions guide the model to be helpful but accurate
- Won't invent features or capabilities not in documentation
- Proper Slack formatting for technical content

## Current Implementation Status

This bot is currently deployed and actively serving **two channels**:

1. **Engineering Channel** - 109 lines of documentation
   - Code review and testing best practices
   - Git workflow and database migration standards
   - Security practices and documentation requirements

2. **PingOne Protect Internal Channel** - 1,959 lines of documentation
   - PingOne Protect fraud prevention service overview
   - Risk predictors and evaluation mechanics
   - Default risk policy and integration mechanisms

**Recent Updates** (from git history):
- ✅ Added ESLint for code quality and consistency
- ✅ Implemented chunk-based architecture with improved output formatting
- ✅ Enhanced logging and token usage tracking
- ✅ Refined question detection and rate limiting

## Project Structure

```
dasilva/
├── app.js                           # Main application (467 lines)
├── package.json                     # Dependencies and scripts
├── package-lock.json                # Locked dependency versions
├── .env                            # Environment variables (gitignored, contains API keys)
├── .env.example                    # Template for environment configuration
├── .gitignore                      # Git ignore rules
├── eslint.config.js                # ESLint configuration
├── README.md                       # This file
└── docs/
    ├── channel-config.json         # Channel-to-documentation mapping (gitignored)
    ├── channel-config.json.example # Configuration template
    ├── engineering/                # Engineering team documentation
    │   ├── _instructions.md        # Always-included system instructions
    │   ├── Engineering - Best Practices.md
    │   └── Engineering - LLM Overides.md
    └── pingone-protect-internal/   # PingOne Protect team documentation
        ├── _instructions.md        # Always-included system instructions
        ├── PingOne Protect - Best Practices (Internal).md
        └── PingOne Protect - LLM Overides.md
```

**Current Documentation**: 2,068 lines across 6 markdown files for 2 channels

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
cp .env.example .env
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

### Slack App Configuration

1. Create a new Slack app at https://api.slack.com/apps

2. **OAuth & Permissions** - Add Bot Token Scopes:
   - `app_mentions:read`
   - `chat:write`
   - `channels:read`
   - `channels:history`

3. **Slash Commands**:
   - Create a new slash command: `/dasilva`
   - Request URL: `https://your-domain.com/slack/commands`
   - Short Description: "Interact with Dasilva bot"
   - Usage Hint: `help | silence | unsilence | cooldown <minutes>`

4. Install the app to your workspace and copy the Bot User OAuth Token

5. **Event Subscriptions**:
   - Enable Events
   - Set Request URL: `https://your-domain.com/slack/events`
   - Subscribe to bot events:
     - `app_mention`
     - `message.channels`

6. Invite the bot to channels: `/invite @dasilva` in each channel

### Channel Configuration

1. Get your Slack channel IDs:
   - Right-click channel → "View channel details" → Copy Channel ID

2. Create `docs/channel-config.json` from the example:
```bash
cp docs/channel-config.json.example docs/channel-config.json
```

3. Edit `docs/channel-config.json`:
```json
{
  "channels": {
    "C01234ABCD": {
      "name": "product-team",
      "docsFolder": "product-team",
      "instructionsFile": "_instructions.md"
    }
  }
}
```

4. Create your documentation folder:
```bash
mkdir -p docs/product-team
```

5. Create your instructions file `docs/product-team/_instructions.md`:
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

6. Add your content files:
   - Create `.md` files: `docs/product-team/overview.md`, `features.md`, etc.
   - All `.md` files except `_instructions.md` will be chunked and semantically searched
   - `_instructions.md` is always included with every request

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

- ❌ **No conversation memory** - Bot only sees the current message, not chat history
- ❌ **No thread context** - Cannot reference "the previous message"
- ❌ **In-memory rate limiting** - Resets on restart
- ❌ **Single-instance only** - No distributed deployment support
- ❌ **No request verification** - Trusts all Slack requests (security risk)
- ❌ **No message editing** - Cannot update responses
- ❌ **No analytics** - No tracking of usage or performance
- ⚠️ **Startup time** - 30-60 seconds to load embedding model and process docs

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
- [x] **User slash commands** - `/dasilva` commands for user preferences
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
2. Verify channel ID in `docs/channel-config.json`
3. Check logs for errors: `DEBUG_MODE=true`
4. Verify Slack Event Subscriptions URL is correct
5. Check that docs folder exists and matches config

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