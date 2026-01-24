# Dasilva - AI-Powered Slack Bot

A channel-specific AI assistant for Slack that responds to questions based on custom documentation using local semantic search.

## Overview

Dasilva is a Slack bot that monitors configured channels and provides AI-powered responses based on channel-specific documentation. It offers two interaction modes:

1. **@mentions** - Public threaded responses when explicitly tagged (always responds)
2. **Ambient listening** - Private ephemeral responses to questions in monitored channels (smart filtering)

## Current Features (MVP)

### Core Functionality
- ✅ **Local semantic search** using `@xenova/transformers` embeddings
- ✅ Channel-specific documentation from Markdown files
- ✅ AI responses powered by OpenAI (`gpt-5-mini` or `gpt-5-nano`)
- ✅ Two interaction modes: @mentions (public) and ambient (private ephemeral)
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

## Project Structure

```
dasilva/
├── app.js                      # Main application
├── package.json                # Dependencies
├── channel-config.json         # Channel configurations (gitignored)
├── channel-config.json.example # Template for channel config
├── .env.local                  # Environment variables (gitignored)
├── .env.local.example          # Template for environment variables
├── .gitignore                  # Git ignore rules
├── README.md                   # This file
└── docs/
    ├── .gitkeep                # Preserves docs folder in git
    └── your-channel/           # Your channel-specific docs (gitignored)
        ├── _instructions.md    # Always-included instructions
        └── *.md                # Content files (chunked & searched)
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

3. Create `.env.local` from the example:
```bash
cp .env.local.example .env.local
```

4. Configure environment variables in `.env.local`:
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

3. Install the app to your workspace and copy the Bot User OAuth Token

4. **Event Subscriptions**:
   - Enable Events
   - Set Request URL: `https://your-domain.com/slack/events`
   - Subscribe to bot events:
     - `app_mention`
     - `message.channels`

5. Invite the bot to channels: `/invite @dasilva` in each channel

### Channel Configuration

1. Get your Slack channel IDs:
   - Right-click channel → "View channel details" → Copy Channel ID

2. Create `channel-config.json` from the example:
```bash
cp channel-config.json.example channel-config.json
```

3. Edit `channel-config.json`:
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
- [ ] **Typing indicators** - Show bot is "thinking"
- [ ] **Reaction-based controls** - Let users dismiss/retry with emoji reactions
- [ ] **Admin commands** - Slash commands for managing bot
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
Ensure all variables from `.env.local` are set in your hosting platform's environment configuration.

### Monitoring Recommendations
- Set up uptime monitoring (UptimeRobot, Pingdom)
- Enable error tracking (Sentry, Rollbar)
- Monitor API costs (OpenAI dashboard)
- Track response times and success rates

## Troubleshooting

### Bot doesn't respond
1. Check bot is invited to the channel: `/invite @dasilva`
2. Verify channel ID in `channel-config.json`
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
- Adjust `RESPONSE_COOLDOWN_SECONDS` in `.env.local`
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