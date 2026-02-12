// ============================================================================
// ACTIVE THREAD TRACKING
// ============================================================================

// Track threads the bot is actively participating in
const activeThreads = new Map(); // key: "channelId:threadTs", value: timestamp of last activity

const ACTIVE_THREAD_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Periodically clean up stale active threads
setInterval(
  () => {
    const now = Date.now();
    for (const [key, lastActivity] of activeThreads) {
      if (now - lastActivity > ACTIVE_THREAD_TTL_MS) {
        activeThreads.delete(key);
      }
    }
  },
  10 * 60 * 1000,
); // Check every 10 minutes

/**
 * Check if a thread is currently active (bot is participating)
 */
function isThreadActive(channelId, threadTs) {
  return activeThreads.has(`${channelId}:${threadTs}`);
}

/**
 * Mark a thread as active (bot is participating)
 */
function markThreadActive(channelId, threadTs) {
  activeThreads.set(`${channelId}:${threadTs}`, Date.now());
}

module.exports = {
  isThreadActive,
  markThreadActive,
};
