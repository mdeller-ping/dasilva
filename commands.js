const {
  getUserPreference,
  updateUserPreference,
  getVectorId,
  getAllChannelPreferences,
  updateChannelPreference,
  deleteChannelPreference,
} = require("./utils-preferences");
const channelConfigModule = require("./utils-channel");
const logger = require("./utils-logger");
const {
  RESPONSE_COOLDOWN_SECONDS,
  UNKNOWN_COMMAND_MESSAGE,
} = require("./utils-variables");
const { isValidVectorId } = require("./utils-openai");

function adminOnly(fn) {
  return (ctx) => {
    if (!ctx.isAdmin) return "You must be an admin to use this command.";
    return fn(ctx);
  };
}

function handleHelp(ctx) {
  const userPref = getUserPreference(ctx.userId);
  const silencedStatus = userPref.silenced ? "Yes" : "No";
  const cooldownStatus =
    userPref.customCooldown !== null
      ? `${userPref.customCooldown / 60} minutes`
      : `Default (${RESPONSE_COOLDOWN_SECONDS / 60} minutes)`;

  let text = `

I monitor specific channels and help answer questions.

*How I respond:*
- *@mention me* - I reply *publicly* in a thread
- *Reply in that thread* - I stay in the conversation and respond to follow-ups (no need to @mention me again)
- *Ask a question in the channel* - I may reply *privately* to avoid channel spam and not discourage participation

*What do I know:*
- I'm trained on internal and external documentation relevant to this channel's topics

*Slash Commands:*
- \`/dasilva help\` - Show this message
- \`/dasilva silence\` - Pause private (ambient) responses
- \`/dasilva unsilence\` - Allow private (ambient) responses
- \`/dasilva cooldown <minutes>\` - Set cooldown (0-1440 minutes)

*Your current settings:*
- Silenced: ${silencedStatus}
- Cooldown: ${cooldownStatus}`;

  if (ctx.isAdmin) {
    text += `

*Admin Commands:*
- \`/dasilva subscribe\` - Add current channel to configuration
- \`/dasilva leave\` - Remove current channel from configuration
- \`/dasilva channels\` - List all configured channels
- \`/dasilva addvector <id>\` - Connect an OpenAI vector store to this channel
- \`/dasilva dropvector\` - Remove vector store from this channel
- \`/dasilva listvector\` - Show all vector store configurations`;
  }

  return text;
}

function handleSilence(ctx) {
  updateUserPreference(ctx.userId, { silenced: true });
  logger.info(
    `[${ctx.channelId}]: User ${ctx.userId} enabled silence mode via slash command`,
  );
  return "DaSilva has been silenced. You won't receive ambient responses. Use `/dasilva unsilence` to resume. (@mentions still work!)";
}

function handleUnsilence(ctx) {
  updateUserPreference(ctx.userId, { silenced: false });
  logger.info(
    `[${ctx.channelId}]: User ${ctx.userId} disabled silence mode via slash command`,
  );
  return "You'll now receive ambient responses when you ask questions.";
}

function handleCooldown(ctx) {
  const minutesMatch = ctx.args.match(/^cooldown\s+(\d+)$/);
  if (!minutesMatch) {
    return "Invalid cooldown format. Use a number like: `/dasilva cooldown 10` (for 10 minutes).";
  }
  const minutes = parseInt(minutesMatch[1], 10);
  if (minutes < 0 || minutes > 1440) {
    return `Cooldown must be between 0 and 1440 minutes (24 hours). You provided: ${minutes} minutes.`;
  }
  const cooldownSeconds = minutes * 60;
  updateUserPreference(ctx.userId, {
    customCooldown: cooldownSeconds,
  });
  const minuteText = minutes === 1 ? "minute" : "minutes";
  logger.info(
    `[${ctx.channelId}]: User ${ctx.userId} set custom cooldown to ${minutes} minutes via slash command`,
  );
  return `Your cooldown has been set to ${minutes} ${minuteText}.`;
}

function handleSubscribe(ctx) {
  if (channelConfigModule.channelExists(ctx.channelId)) {
    return `Channel <#${ctx.channelId}> is already configured.`;
  }
  const result = channelConfigModule.subscribe(ctx.channelId);
  if (result.success) {
    logger.info(
      `[${ctx.channelId}]: channel subscribed by admin ${ctx.userId}`,
    );
    return `Channel <#${ctx.channelId}> subscribed successfully! Use \`/dasilva addvector <vector_id>\` to connect an OpenAI vector store.`;
  }
  return `Failed to add channel: ${result.error}`;
}

function handleLeave(ctx) {
  if (!channelConfigModule.channelExists(ctx.channelId)) {
    return "This channel is not configured.";
  }
  return { text: "Opening leave confirmation...", action: "open_leave_modal" };
}

function handleChannels() {
  const channels = channelConfigModule.getAllChannels();
  if (channels.length === 0) {
    return "No channels configured yet. Use `/dasilva subscribe` to add one.";
  }
  return (
    "*Configured Channels:*\n\n" +
    channels
      .map(([id]) => {
        const vectorId = getVectorId(id);
        const vectorInfo = vectorId
          ? `Vector: \`${vectorId}\``
          : "_No vector store_";
        return `\u2022 <#${id}> (\`${id}\`)\n  ${vectorInfo}`;
      })
      .join("\n\n")
  );
}

function handleAddVector(ctx) {
  const vectorId = ctx.originalText.trim().split(/\s+/)[1];
  if (!isValidVectorId(vectorId)) {
    return "Invalid vector store ID. Usage: `/dasilva addvector vs_xxxxx`";
  }
  updateChannelPreference(ctx.channelId, {
    vector_id: vectorId,
  });
  logger.info(
    `[${ctx.channelId}]: vector store ${vectorId} added by admin ${ctx.userId}`,
  );
  return `Vector store \`${vectorId}\` configured for <#${ctx.channelId}>.`;
}

function handleDropVector(ctx) {
  const existed = deleteChannelPreference(ctx.channelId);
  if (existed) {
    logger.info(
      `[${ctx.channelId}]: vector store removed by admin ${ctx.userId}`,
    );
    return `Vector store removed from <#${ctx.channelId}>.`;
  }
  return `No vector store configured for <#${ctx.channelId}>.`;
}

function handleListVector() {
  const allPrefs = getAllChannelPreferences();
  const entries = Object.entries(allPrefs).filter(([, pref]) => pref.vector_id);
  if (entries.length === 0) {
    return "No vector stores configured for any channel.";
  }
  return (
    "*Vector Store Configuration:*\n\n" +
    entries
      .map(([id, pref]) => `\u2022 <#${id}> (\`${id}\`): \`${pref.vector_id}\``)
      .join("\n")
  );
}

const commands = {
  "": handleHelp,
  help: handleHelp,
  about: handleHelp,
  silence: handleSilence,
  unsilence: handleUnsilence,
  cooldown: handleCooldown,
  subscribe: adminOnly(handleSubscribe),
  leave: adminOnly(handleLeave),
  channels: adminOnly(handleChannels),
  addvector: adminOnly(handleAddVector),
  dropvector: adminOnly(handleDropVector),
  listvector: adminOnly(handleListVector),
};

function dispatch(ctx) {
  const [cmd] = ctx.args.split(/\s+/);
  const handler = commands[cmd];
  if (handler) return handler(ctx);
  return UNKNOWN_COMMAND_MESSAGE.replace("{command}", ctx.originalText);
}

module.exports = { dispatch };
