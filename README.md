# DaSilva - AI-Powered Slack Bot

DaSilva is a Slack bot that monitors subscribed channels and provides AI-powered responses based on channel-specific documentation stored in OpenAI vector stores.

## Interaction Modes

1. **@mentions** - Public threaded responses when explicitly tagged
2. **Thread participation** - Continues responding to follow-ups in active threads without requiring @mentions
3. **Ambient listening** - Private ephemeral responses to questions in subscribed channels (with rate limiting)

## Technologies

**Runtime & Server**

- Node.js 18+
- Express.js - Web framework for HTTP endpoints

**AI & ML**

- OpenAI API - GPT-5 models with vector store search

**Slack Integration**

- @slack/web-api - Slack API client

**Development Tools**

- dotenv - Environment variable management
- ESLint - Code linting
- Nodemon - Development hot-reload

## Project Structure

```
dasilva/
├── app.js                      # Main Express application & routing
├── commands.js                 # Slash command handlers
├── modal-definitions.js        # Slack Block Kit modal definitions
│
├── utils-logger.js             # Centralized logging with Slack forwarding
├── utils-variables.js          # Configuration & environment variables
├── utils-slack.js              # Slack API client & helpers
├── utils-openai.js             # OpenAI API client & helpers
├── utils-preferences.js        # User & channel preferences (file-based)
├── utils-channel.js            # Channel subscription management
├── utils-message.js            # Message event handlers
├── utils-modals.js             # Modal interaction handlers
├── utils-ratelimit.js          # Rate limiting for ambient responses
├── utils-threads.js            # Active thread tracking
│
├── instructions.md             # System instructions for OpenAI
├── package.json                # Dependencies and scripts
├── manifest.json               # Slack App manifest
├── .env                        # Environment variables (gitignored)
├── env.example                 # Template for configuration
│
├── README.md                   # This file
├── UTILS.md                    # Utility file organization guide
├── TODO.md                     # Roadmap & known limitations
└── LICENSE                     # Apache 2.0 License
```

## Key Features

### Core Functionality

- **Vector store integration** - Uses OpenAI vector stores for semantic search
- **Three interaction modes** - @mentions (public), thread participation (public), ambient (private)
- **Slash commands** - User preferences and admin configuration
- **Smart question detection** - Only responds to actual questions in ambient mode
- **Per-user rate limiting** - Configurable cooldowns to prevent spam
- **Thread context** - Includes recent thread messages for multi-turn conversations
- **Slack request verification** - Cryptographic signature validation
- **Thinking indicators** - Updates message to show bot is processing

### Admin Features

- **Channel management** - Subscribe/unsubscribe via Slack commands
- **Vector store configuration** - Connect channels to OpenAI vector stores
- **No server access needed** - Full configuration via Slack UI
- **Hot reload** - Preference changes take effect immediately

### Smart Filtering (Ambient Mode)

- Question detection (ends with `?`, starts with question words, contains help keywords)
- Ephemeral responses (only visible to questioner)
- Per-user cooldowns (default: 1 minute, customizable)
- Opt-in when `AMBIENT_MODE=false`
- @mentions bypass all filtering and cooldowns

### Feedback System

- React with configured emoji (default: 👋) to bot messages
- Opens feedback modal for response quality tracking
- Posts feedback to configured Slack channel

## Setup

### Prerequisites

- Node.js v18+
- Slack workspace with admin access
- OpenAI API key with vector store access

### Installation

```bash
git clone https://github.com/mdeller-ping/dasilva
cd dasilva
npm install
cp env.example .env
```

Edit `.env` with your configuration (see below).

```bash
npm start
```

Navigate to `https://YOUR.BOT.URL` to verify:

```
ok
```

### Slack App Configuration

1. Create a new Slack App from manifest at https://api.slack.com/apps
2. Choose your workspace
3. Paste `manifest.json` and customize with your bot URL
4. Note Signing Secret (Basic Information - App Credentials)
5. Install to workspace (OAuth & Permissions)
6. Select channel for webhook, click Allow
7. Note Bot User OAuth Token (OAuth & Permissions)

### Environment Configuration

Create `.env` file:

```bash
# Required
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
OPENAI_API_KEY=sk-your-openai-key-here

# Optional - Admin Users (comma-separated Slack user IDs)
GLOBAL_ADMINS=U01234ABCDE,U56789FGHIJ

# Optional - Server
PORT=3000

# Optional - OpenAI
MODEL=gpt-5-mini
MAX_COMPLETION_TOKENS=4000
OPENAI_API_TIMEOUT=30000

# Optional - Slack Behavior
THREAD_CONTEXT_MESSAGES=10
RESPONSE_COOLDOWN_SECONDS=60
AMBIENT_MODE=false

# Optional - Feedback
FEEDBACK_EMOJI=wave
FEEDBACK_CHANNEL=C01234ABCDE

# Optional - Logging
LOG_LEVEL=INFO
LOG_CHANNEL=C01234ABCDE

# Optional - Storage
PERSISTENT_STORAGE=/path/to/storage
```

### Finding Your Slack User ID

1. Open your profile in Slack
2. Select "..." → "Copy member ID"
3. Add to `GLOBAL_ADMINS` in `.env`
4. Restart the bot

### Channel Setup

**Subscribe to a channel:**

1. Invite bot: `/invite @dasilva`
2. Subscribe: `/dasilva subscribe`
3. Connect vector store: `/dasilva addvector vs_xxxxx`

**Verify setup:**

```
/dasilva channels
```

## Configuration Reference

| Variable                    | Default    | Description                                          |
| --------------------------- | ---------- | ---------------------------------------------------- |
| `PORT`                      | 3000       | Server port                                          |
| `MODEL`                     | gpt-5-mini | OpenAI model to use                                  |
| `MAX_COMPLETION_TOKENS`     | 4000       | Max tokens for response                              |
| `RESPONSE_COOLDOWN_SECONDS` | 60         | Cooldown between ambient responses (seconds)         |
| `THREAD_CONTEXT_MESSAGES`   | 10         | Prior thread messages to include                     |
| `AMBIENT_MODE`              | false      | If false, users must opt-in via `/dasilva unsilence` |
| `GLOBAL_ADMINS`             | (empty)    | Comma-separated Slack user IDs with admin access     |
| `PERSISTENT_STORAGE`        | (cwd)      | Path for preference files                            |
| `LOG_LEVEL`                 | INFO       | Logging level: DEBUG, INFO, WARN, ERROR              |
| `LOG_CHANNEL`               | (none)     | Slack channel to receive log copies                  |
| `FEEDBACK_EMOJI`            | wave       | Emoji name for feedback trigger                      |
| `FEEDBACK_CHANNEL`          | (none)     | Channel for feedback submissions                     |
| `OPENAI_API_TIMEOUT`        | 30000      | OpenAI request timeout (ms)                          |
| `OPENAI_MAX_RETRIES`        | 0          | OpenAI retry attempts                                |

## Usage

### User Commands

All commands respond ephemerally (only you see the response):

- **`/dasilva help`** - Show information and current settings
- **`/dasilva silence`** - Opt-out of ambient responses
- **`/dasilva unsilence`** - Resume ambient responses
- **`/dasilva cooldown <minutes>`** - Set custom cooldown (0-1440)

Examples:

```
/dasilva cooldown 10    # 10 minute cooldown
/dasilva cooldown 0     # No cooldown
```

### Admin Commands

Admin users (listed in `GLOBAL_ADMINS`) have additional commands:

- **`/dasilva subscribe`** - Subscribe current channel
- **`/dasilva leave`** - Unsubscribe current channel (confirmation required)
- **`/dasilva channels`** - List all configured channels
- **`/dasilva addvector <id>`** - Connect OpenAI vector store
- **`/dasilva dropvector`** - Remove vector store from channel
- **`/dasilva listvector`** - Show all vector store configurations

### Interaction Examples

**@Mention (Public)**

```
User: @dasilva what are our key features?
Bot:  [responds publicly in thread]
User: Tell me more about feature X
Bot:  [continues responding, no @mention needed]
```

**Ambient (Private)**

```
User: what are our key features?
Bot:  [responds with ephemeral message, only visible to user]
      [includes "Promote to public thread" button]
```

**Promote Ambient to Public**

```
User: [clicks "Promote to public thread" button]
Bot:  [posts same response publicly, marks thread as active]
```

## Running the Bot

**Development mode** (auto-restart on changes):

```bash
npm run dev
```

**Production mode**:

```bash
npm start
```

**Local development with ngrok**:

```bash
ngrok http 3000
```

Update Slack Event Subscriptions with ngrok URL.

## Docker Deployment

### Using Docker Compose (Recommended)

The easiest way to run DaSilva with Redis is using Docker Compose:

```bash
# Build and start both the bot and Redis
docker-compose up -d

# View logs
docker-compose logs -f dasilva

# Stop services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

**Environment variables**: Docker Compose automatically loads your `.env` file. Make sure to create one based on `env.example`.

### Using Docker Only

If you prefer to run just the container:

```bash
# Build the image
docker build -t dasilva .

# Run the container
docker run -d \
  --name dasilva-bot \
  -p 3000:3000 \
  --env-file .env \
  dasilva

# View logs
docker logs -f dasilva-bot

# Stop container
docker stop dasilva-bot
```

**Note**: If using Docker without Compose, you'll need to set up Redis separately and configure `REDIS_URL` in your `.env` file.

### Production Deployment

For production deployments:

1. **Set appropriate environment variables** in your `.env` file
2. **Configure Redis persistence** (already enabled in docker-compose.yml)
3. **Set up reverse proxy** (nginx, Traefik) for HTTPS
4. **Use a process manager** or orchestrator (Docker Swarm, Kubernetes)
5. **Monitor logs** via `docker-compose logs` or centralized logging

Example nginx reverse proxy configuration:

```nginx
server {
    listen 80;
    server_name your-bot-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Health Checks

The Docker container includes health checks that verify the bot is responding:

```bash
# Check container health
docker ps

# Manual health check
curl http://localhost:3000/
```

Expected response:
```json
{
  "status": "ok",
  "redis": "connected",
  "uptime": 123.456
}
```

## Troubleshooting

### Bot doesn't respond

1. Check bot is invited: `/invite @dasilva`
2. Verify subscription: `/dasilva channels` (admin)
3. Check vector store connected: `/dasilva listvector` (admin)
4. Enable debug logs: `LOG_LEVEL=DEBUG`
5. Verify Slack Event Subscriptions URL

### Empty responses from reasoning models

- Increase `MAX_COMPLETION_TOKENS` (reasoning uses tokens for thinking)
- Set to at least 4000 for gpt-5-mini/nano
- Check logs for `incomplete_reason: "max_output_tokens"`

### Rate limiting issues

- Adjust `RESPONSE_COOLDOWN_SECONDS`
- Remember: cooldown only applies to ambient mode
- Users can set custom cooldowns: `/dasilva cooldown <minutes>`

### Signature verification failures

- Verify `SLACK_SIGNING_SECRET` matches Slack App credentials
- Check system clock is accurate (rejects requests > 5 minutes old)
- Ensure raw body is captured in Express middleware

### Admin commands don't work

- Verify user ID is in `GLOBAL_ADMINS` environment variable
- Restart bot after changing `.env`
- Check logs for authorization failures

## Development

### Adding a new utility file

See [UTILS.md](UTILS.md) for organization guidelines.

**Quick decision tree:**

1. External API? → `utils-slack.js` or `utils-openai.js`
2. Configuration? → `utils-variables.js`
3. User/channel data? → `utils-preferences.js`
4. Message handling? → `utils-message.js`
5. Modal interaction? → `utils-modals.js`
6. Rate limiting? → `utils-ratelimit.js`
7. Thread tracking? → `utils-threads.js`
8. Logging? → `utils-logger.js`

## License

Apache 2.0 - See LICENSE file
