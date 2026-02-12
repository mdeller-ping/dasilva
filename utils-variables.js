/**
 * Centralized configuration for the DaSilva bot
 * All environment variable parsing and default values are defined here
 */

// ============================================================================
// OpenAI Configuration
// ============================================================================

const MODEL = process.env.MODEL || "gpt-5-mini";
const MAX_COMPLETION_TOKENS =
  parseInt(process.env.MAX_COMPLETION_TOKENS) || 4000;
const OPENAI_API_TIMEOUT = parseInt(process.env.OPENAI_API_TIMEOUT) || 30000; // 30 seconds
const OPENAI_MAX_RETRIES = 0; // No retries by default

// ============================================================================
// Slack Configuration
// ============================================================================

const THREAD_CONTEXT_MESSAGES =
  parseInt(process.env.THREAD_CONTEXT_MESSAGES) || 10; // Thread history messages to include
const RESPONSE_COOLDOWN_SECONDS =
  parseInt(process.env.RESPONSE_COOLDOWN_SECONDS) || 60; // 1 minute default
const EPHEMERAL_FOOTER =
  "\n\n\n\n_Type `/dasilva help` for more information_\n\n_If this response is helpful, use the promote button so everyone can benefit._";

// ============================================================================
// Messages & UI Text
// ============================================================================

const UNKNOWN_COMMAND_MESSAGE =
  "Unknown command: `{command}`\n\nType `/dasilva help` to see available commands.";

// ============================================================================
// Admin & Permissions
// ============================================================================

const GLOBAL_ADMINS = (process.env.GLOBAL_ADMINS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// ============================================================================
// Feedback Configuration
// ============================================================================

const FEEDBACK_EMOJI = process.env.FEEDBACK_EMOJI || "wave";
const FEEDBACK_CHANNEL = process.env.FEEDBACK_CHANNEL || null;

// ============================================================================
// Server Configuration
// ============================================================================

const PORT = parseInt(process.env.PORT) || 3000;

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // OpenAI
  MODEL,
  MAX_COMPLETION_TOKENS,
  OPENAI_API_TIMEOUT,
  OPENAI_MAX_RETRIES,

  // Slack
  THREAD_CONTEXT_MESSAGES,
  RESPONSE_COOLDOWN_SECONDS,
  EPHEMERAL_FOOTER,

  // Messages
  UNKNOWN_COMMAND_MESSAGE,

  // Admin
  GLOBAL_ADMINS,

  // Feedback
  FEEDBACK_EMOJI,
  FEEDBACK_CHANNEL,

  // Server
  PORT,
};
