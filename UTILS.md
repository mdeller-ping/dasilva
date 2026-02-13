# Utility File Organization Guide

This document defines the purpose and responsibilities of each utility helper file in the DaSilva codebase.

## File Organization Principles

- **Single Responsibility**: Each utility file handles one cohesive domain
- **Clear Boundaries**: Minimal overlap between files
- **Consistent Naming**: All utilities use `utils-*.js` naming convention
- **Explicit Exports**: Only export functions that are used elsewhere

---

## Core Utilities

### `utils-logger.js`

**Purpose**: Centralized logging with level control and Slack forwarding

**Responsibilities**:

- Console logging with levels (DEBUG, INFO, WARN, ERROR)
- Optional forwarding to Slack LOG_CHANNEL
- Log level filtering based on LOG_LEVEL env var
- Formatting log output with timestamps

**When to add code here**:

- Adding new log levels
- Changing log formatting
- Adding new log destinations (file, external service)
- Log filtering or throttling logic

**Key exports**:

- `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`
- `logger.isEnabled()`, `logger.level`

---

### `utils-variables.js`

**Purpose**: Centralized configuration and environment variable management

**Responsibilities**:

- Parse environment variables with defaults
- Export constants used across the application
- Group related configuration (OpenAI, Slack, Server, etc.)
- Document configuration options

**When to add code here**:

- Adding new environment variables
- Defining application-wide constants
- Setting default values
- Grouping related configuration

**Key exports**:

- OpenAI config: `MODEL`, `MAX_COMPLETION_TOKENS`, `OPENAI_API_TIMEOUT`
- Slack config: `THREAD_CONTEXT_MESSAGES`, `RESPONSE_COOLDOWN_SECONDS`, `EPHEMERAL_FOOTER`
- Admin config: `GLOBAL_ADMINS`
- Server config: `PORT`
- Messages: `UNKNOWN_COMMAND_MESSAGE`, `FEEDBACK_EMOJI`, `FEEDBACK_CHANNEL`

---

## Integration Utilities

### `utils-slack.js`

**Purpose**: Slack API client and request handling

**Responsibilities**:

- Initialize Slack WebClient
- Verify incoming Slack request signatures
- Wrapper functions for Slack API calls
- Thread history retrieval
- Error handling and summarization

**When to add code here**:

- Adding new Slack API calls (postMessage, updateMessage, etc.)
- Signature verification logic
- Slack-specific error handling
- Thread or conversation management

**Key exports**:

- `slackClient` - WebClient instance
- `verifySlackRequest` - Express middleware for signature verification
- `postThreadReply()`, `postEphemeral()`, `updateMessage()`, `postMessage()`
- `openView()` - For modals
- `getBotUserId()`, `getThreadHistory()`
- `summarizeSlackError()`

---

### `utils-openai.js`

**Purpose**: OpenAI API client and response handling

**Responsibilities**:

- Initialize OpenAI client
- Call OpenAI responses API with vector stores
- Load instructions from file
- Summarize responses and errors
- Validate vector store IDs

**When to add code here**:

- OpenAI API calls (new endpoints, parameters)
- Response parsing and summarization
- OpenAI-specific error handling
- Vector store validation

**Key exports**:

- `callOpenAI()` - Main API call with vector search
- `summarizeOpenAIResponse()` - Extract key response metadata
- `summarizeOpenAIError()` - Format errors for logging
- `isOpenAIError()` - Detect OpenAI vs other errors
- `isValidVectorId()` - Validate vector store ID format

---

## Data Management Utilities

### `utils-preferences.js`

**Purpose**: Persistent user and channel preferences with file-based storage

**Responsibilities**:

- Generic PreferenceManager class for file-based JSON storage
- User preferences (silence, cooldown)
- Channel preferences (vector_id, subscribed)
- Auto-reload on file changes
- Graceful degradation on errors

**When to add code here**:

- Adding new user preference fields
- Adding new channel preference fields
- Changing persistence strategy (Redis, DB)
- Adding preference validation

**Key exports**:
**User preferences**:

- `getUserPreference()`, `updateUserPreference()`
- `isUserSilenced()`, `getUserCooldown()`

**Channel preferences**:

- `getChannelPreference()`, `updateChannelPreference()`, `deleteChannelPreference()`
- `getAllChannelPreferences()`, `getVectorId()`, `isChannelSubscribed()`

**Class**: `PreferenceManager` - Reusable preference file manager

---

### `utils-channel.js`

**Purpose**: Channel subscription management and business logic

**Responsibilities**:

- Channel existence checks
- Subscribe/leave operations
- Channel configuration retrieval
- Channel ID validation

**When to add code here**:

- Channel subscription business logic
- Channel validation rules
- Operations that require channel context

**Key exports**:

- `channelExists()` - Check if channel is subscribed
- `getChannel()` - Get channel config object
- `getAllChannels()` - List all subscribed channels
- `subscribe()` - Subscribe to a channel
- `leave()` - Unsubscribe from a channel

**Note**: This is a thin wrapper around `utils-preferences.js`. Consider merging if it doesn't grow beyond current scope.

---

## Feature Utilities

### `utils-message.js`

**Purpose**: Message event handling and analysis

**Responsibilities**:

- Handle @mention events
- Handle ambient (question-based) events
- Handle reaction events for feedback
- Question detection logic
- Channel context retrieval
- "Thinking..." message management

**When to add code here**:

- New message event types
- Message content analysis
- Question detection patterns
- Message response logic

**Key exports**:

- `handleMention()` - Process @mention and active thread messages
- `handleAmbient()` - Process ambient questions
- `handleReactionAdded()` - Process feedback reactions
- `looksLikeQuestion()` - Detect if text is a question
- `getChannelContext()` - Get channel config + vector store
- `setBotUserId()` - Initialize bot user ID

---

### `utils-modals.js`

**Purpose**: Slack modal (Block Kit) handling

**Responsibilities**:

- Open modals for user interactions
- Process modal submissions
- Validate modal input
- Channel leave confirmation flow
- Feedback collection flow

**When to add code here**:

- New modal workflows
- Modal submission validation
- Modal state management

**Key exports**:

- `openLeaveChannelModal()` - Open leave confirmation
- `handleLeaveChannelSubmission()` - Process leave modal
- `handleFeedbackSubmission()` - Process feedback modal

---

### `utils-ratelimit.js`

**Purpose**: Rate limiting for ambient responses

**Responsibilities**:

- Track last response time per user per channel
- Check if user should receive response (cooldown)
- Record response timestamps
- Support custom per-user cooldowns

**When to add code here**:

- Rate limiting algorithms
- Cooldown tracking
- User-specific rate limit overrides

**Key exports**:

- `isUserOnCooldown()` - Check if cooldown allows response
- `recordResponse()` - Record that bot responded

**Note**: Currently in-memory. Consider Redis for production multi-instance deployment.

---

### `utils-threads.js`

**Purpose**: Active thread tracking

**Responsibilities**:

- Track threads bot is participating in
- Auto-expire threads after TTL (2 hours)
- Determine if bot should respond to thread messages

**When to add code here**:

- Thread state management
- TTL logic
- Thread cleanup strategies

**Key exports**:

- `isThreadActive()` - Check if bot is in this thread
- `markThreadActive()` - Mark thread as active

**Note**: Currently in-memory. Consider Redis for production multi-instance deployment.

---

## Decision Guide

### When creating a new utility file:

**DO create a new file if**:

- It represents a distinct external integration (new API)
- It handles a new domain/feature area (analytics, caching, etc.)
- The existing file would exceed 500 lines with the addition
- It has minimal dependencies on other utils

**DON'T create a new file if**:

- It's a single function that fits in an existing util
- It's tightly coupled to an existing util's domain
- It creates circular dependencies

### When choosing where to add a function:

1. **External API call?** → `utils-slack.js` or `utils-openai.js`
2. **Environment variable or constant?** → `utils-variables.js`
3. **User or channel data?** → `utils-preferences.js`
4. **Message processing?** → `utils-message.js`
5. **Modal interaction?** → `utils-modals.js`
6. **Rate limiting or throttling?** → `utils-ratelimit.js`
7. **Thread management?** → `utils-threads.js`
8. **Logging?** → `utils-logger.js`

### When to merge files:

Consider merging if:

- Two files are always imported together
- One file is just a thin wrapper around another
- Combined size would be < 500 lines
- They share > 50% of their dependencies

**Example**: `utils-channel.js` could be merged into `utils-preferences.js` since it's currently a thin wrapper.

---

## Code Review Checklist

When adding to utilities:

- [ ] Function has clear single responsibility
- [ ] Exports only what's needed elsewhere
- [ ] Has JSDoc comment explaining parameters and return value
- [ ] Error handling is appropriate (try/catch, return null, throw)
- [ ] Uses consistent naming (camelCase for internal, match API for external)
- [ ] Imports only what it needs
- [ ] No circular dependencies
- [ ] Gracefully handles edge cases (null, undefined, empty)
