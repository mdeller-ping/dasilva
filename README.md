# Dasilva - AI-Powered Slack Bot

A channel-specific AI assistant for Slack that responds to questions based on custom documentation.

## Overview

Dasilva is a Slack bot that monitors configured channels and provides AI-powered responses based on channel-specific documentation. It offers two interaction modes:

1. **@mentions** - Public responses when explicitly tagged
2. **Ambient listening** - Private ephemeral responses to questions in monitored channels

## Current Features (MVP)

### Core Functionality
- ✅ Channel-specific documentation loading from Markdown files
- ✅ AI responses powered by OpenAI (gpt-5-nano)
- ✅ Two interaction modes: @mentions (public) and ambient (private)
- ✅ Smart question detection - only responds to actual questions
- ✅ Per-user rate limiting to prevent spam
- ✅ Ephemeral messages for ambient responses (only visible to questioner)
- ✅ Public threaded replies for @mentions
- ✅ Configurable token limits and cooldown periods
- ✅ Debug mode for verbose logging

### Smart Filtering
- Only responds to messages that look like questions (ends with `?`, starts with question words, contains help keywords)
- Rate limits responses per user (default: 5 minutes cooldown)
- @mentions bypass rate limiting and filtering

### Documentation Management
- Loads all `.md` files from channel-specific folders at startup
- Documentation cached in memory for fast responses
- Channel-specific system prompts and instructions
- Easy to update - just edit markdown files and restart

## Project Structure

```
dasilva/
├── app.js                      # Main application
├── package.json                # Dependencies
├── .env.local                  # Environment variables (not committed)
├── .env.local.example          # Template for environment variables
├── .gitignore                  # Git ignore rules
└── docs/
    ├── channel-config.json     # Channel configurations
    ├── product-team/           # Documentation for product channel
    │   └── *.md
    └── engineering/            # Documentation for engineering channel
        └── *.md
```

## Setup

### Prerequisites
- Node.js (v18+)
- npm
- Slack workspace with admin access
- OpenAI API key

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
MAX_COMPLETION_TOKENS=1000
RESPONSE_COOLDOWN_SECONDS=300
DEBUG_MODE=false
```

### Slack App Configuration

1. Create a new Slack app at https://api.slack.com/apps

2. **OAuth & Permissions** - Add Bot Token Scopes:
   - `app_mentions:read`
   - `chat:write`
   - `channels:read`
   - `channels:history`
   - `im:write`
   - `users:read`

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

2. Edit `docs/channel-config.json`:
```json
{
  "channels": {
    "C01234ABCD": {
      "name": "product-team",
      "docsFolder": "product-team",
      "systemPrompt": "You are a product assistant..."
    }
  }
}
```

3. Add documentation:
   - Create folder: `docs/product-team/`
   - Add markdown files: `overview.md`, `features.md`, etc.
   - Bot loads all `.md` files automatically

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
| `MAX_COMPLETION_TOKENS` | 1000 | Max response length from AI |
| `RESPONSE_COOLDOWN_SECONDS` | 300 | Cooldown between responses to same user (5 min) |
| `DEBUG_MODE` | false | Enable verbose logging |

## Known Limitations (MVP)

- ❌ **No conversation memory** - Bot only sees the current message, not chat history
- ❌ **No thread context** - Cannot reference "the previous message"
- ❌ **In-memory rate limiting** - Resets on restart
- ❌ **Single-instance only** - No distributed deployment support
- ❌ **No authentication** - Trusts all Slack requests
- ❌ **No message editing** - Cannot update responses
- ❌ **No analytics** - No tracking of usage or performance

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

### Empty responses
- Check OpenAI API key is valid
- Verify network connectivity
- Check token limits aren't too low
- Enable debug mode to see API responses

### Rate limiting issues
- Adjust `RESPONSE_COOLDOWN_SECONDS` in `.env.local`
- Check rate limit map isn't growing unbounded (add cleanup for production)

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit a pull request

## License

[Your License Here]

## Credits

Built with:
- [Slack Web API](https://slack.dev/node-slack-sdk/)
- [OpenAI API](https://platform.openai.com/)
- [Express](https://expressjs.com/)