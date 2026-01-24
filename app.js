require('dotenv').config();
const express = require('express');
const { WebClient } = require('@slack/web-api');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('@xenova/transformers');

const app = express();
const port = process.env.PORT || 3000;

// Configuration
const MAX_COMPLETION_TOKENS = parseInt(process.env.MAX_COMPLETION_TOKENS) || 4000; // Higher default for reasoning models
const RESPONSE_COOLDOWN_SECONDS = parseInt(process.env.RESPONSE_COOLDOWN_SECONDS) || 300; // 5 minutes default
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
const MODEL = process.env.MODEL || 'gpt-5-mini'; // OpenAI model to use
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE) || 2000; // Characters per chunk
const MAX_CHUNKS = parseInt(process.env.MAX_CHUNKS) || 5; // Number of chunks to include

// Helper for debug logging
function debug(...args) {
  if (DEBUG_MODE) {
    console.log('[DEBUG]', ...args);
  }
}

// Rate limiting: Track last response time per user per channel
const lastResponseTimes = new Map(); // key: "channelId:userId", value: timestamp

// Embedder will be initialized asynchronously
let embedder = null;

// Initialize clients
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
  maxRetries: 2   // Retry twice on failure
});

// Load channel configurations and documentation
const channelConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'channel-config.json'), 'utf-8')
);

// This will be populated asynchronously
const channelDocs = {};
const channelInstructions = {}; // Always-included instructions per channel

// Initialize embedder and load documentation
async function initializeDocumentation() {
  console.log('Initializing embedding model...');
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Embedding model loaded!');

  console.log('Loading and embedding documentation...');
  
  for (const [channelId, config] of Object.entries(channelConfig.channels)) {
    const docsPath = path.join(__dirname, 'docs', config.docsFolder);
    
    if (!fs.existsSync(docsPath)) {
      console.warn(`Warning: Docs folder not found for channel ${config.name}: ${docsPath}`);
      continue;
    }

    // Load instructions file (always included, not chunked)
    if (config.instructionsFile) {
      const instructionsPath = path.join(docsPath, config.instructionsFile);
      if (fs.existsSync(instructionsPath)) {
        channelInstructions[channelId] = fs.readFileSync(instructionsPath, 'utf-8');
        console.log(`Loaded instructions for ${config.name}`);
      } else {
        console.warn(`Warning: Instructions file not found: ${instructionsPath}`);
        channelInstructions[channelId] = 'Answer questions based only on the provided documentation.';
      }
    } else {
      channelInstructions[channelId] = 'Answer questions based only on the provided documentation.';
    }

    // Load all other markdown files (excluding instructions file)
    const files = fs.readdirSync(docsPath)
      .filter(f => f.endsWith('.md') && f !== config.instructionsFile);
    
    console.log(`Found ${files.length} markdown files in ${docsPath}:`, files);
    
    const chunks = [];
    
    // Load and chunk files
    for (const file of files) {
      const filePath = path.join(docsPath, file);
      console.log(`Reading file: ${filePath}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      console.log(`  File length: ${content.length} characters`);
      const fileChunks = chunkText(content, CHUNK_SIZE);
      console.log(`  Created ${fileChunks.length} chunks`);
      
      fileChunks.forEach((chunk, index) => {
        chunks.push({
          text: chunk,
          source: file,
          chunkIndex: index
        });
      });
    }
    
    console.log(`Total chunks to embed: ${chunks.length}`);
    
    // Generate embeddings for all chunks
    console.log(`Embedding ${chunks.length} chunks for ${config.name}...`);
    for (const chunk of chunks) {
      const output = await embedder(chunk.text, { pooling: 'mean', normalize: true });
      chunk.embedding = Array.from(output.data);
    }

    channelDocs[channelId] = chunks;
    console.log(`✓ Loaded ${chunks.length} chunks from ${files.length} documents for ${config.name} (${channelId})`);
  }

  console.log('Documentation loading complete!');
}

// Helper: Split text into chunks
function chunkText(text, chunkSize) {
  const chunks = [];
  const paragraphs = text.split('\n\n');
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Helper: Find most relevant chunks using semantic similarity
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function findRelevantChunks(chunks, query, maxChunks) {
  if (!embedder) {
    console.error('Embedder not initialized yet');
    return [];
  }
  
  // Generate embedding for the query
  const queryEmbedding = await embedder(query, { pooling: 'mean', normalize: true });
  const queryVector = Array.from(queryEmbedding.data);
  
  // Score all chunks by semantic similarity
  const scoredChunks = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(queryVector, chunk.embedding)
  }));
  
  // Return top matches
  return scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks);
}

// Helper: Check if message looks like a question that needs answering
function looksLikeQuestion(text) {
  const lowerText = text.toLowerCase().trim();
  
  // Ends with question mark
  if (lowerText.endsWith('?')) return true;
  
  // Starts with question words
  const questionStarters = ['what', 'when', 'where', 'who', 'why', 'how', 'which', 'can', 'could', 'would', 'should', 'is', 'are', 'does', 'do'];
  const firstWord = lowerText.split(' ')[0];
  if (questionStarters.includes(firstWord)) return true;
  
  // Contains help/explain/tell keywords
  const helpKeywords = ['help', 'explain', 'tell me', 'show me', 'how do', 'what is', 'where can'];
  if (helpKeywords.some(keyword => lowerText.includes(keyword))) return true;
  
  return false;
}

// Helper: Check if we should respond based on rate limiting
function shouldRespondToUser(channelId, userId) {
  const key = `${channelId}:${userId}`;
  const lastTime = lastResponseTimes.get(key);
  
  if (!lastTime) return true;
  
  const timeSinceLastResponse = (Date.now() - lastTime) / 1000;
  return timeSinceLastResponse >= RESPONSE_COOLDOWN_SECONDS;
}

// Helper: Record that we responded to a user
function recordResponse(channelId, userId) {
  const key = `${channelId}:${userId}`;
  lastResponseTimes.set(key, Date.now());
}

// Middleware to parse JSON
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.send('dasilva is alive! 🤖');
});

// Slack event endpoint
app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;

  // Handle Slack URL verification challenge
  if (type === 'url_verification') {
    return res.send({ challenge });
  }

  // Respond quickly to Slack (required within 3 seconds)
  res.status(200).send();

  // Handle app mentions
  if (event && event.type === 'app_mention') {
    await handleMention(event);
    return; // Don't process as regular message
  }

  // Handle channel messages (ignore bot messages and mentions to prevent loops)
  if (event && event.type === 'message' && !event.bot_id && !event.subtype) {
    // Skip if this is a mention (already handled above as app_mention)
    if (event.text && event.text.match(/<@[A-Z0-9]+>/)) {
      debug('Skipping message - contains mention');
      return;
    }
    await handleChannelMessage(event);
  }
});

// Handle when bot is mentioned
async function handleMention(event) {
  try {
    const { text, channel, ts, user } = event;
    
    console.log(`? Mention request received from user ${user} (msg: ${ts})`);
    debug(`Mention received in channel ${channel}: ${text}`);
    
    // Check if we have configuration for this channel
    const config = channelConfig.channels[channel];
    if (!config) {
      await slackClient.chat.postMessage({
        channel: channel,
        thread_ts: ts,
        text: "Sorry, I'm not configured for this channel yet."
      });
      return;
    }

    // Get instructions (always included)
    const instructions = channelInstructions[channel] || 'Answer based only on provided documentation.';
    
    // Remove the bot mention from the text
    const userMessage = text.replace(/<@[A-Z0-9]+>/g, '').trim();
    
    // Get relevant chunks based on the user's question
    const allChunks = channelDocs[channel] || [];
    const relevantChunks = await findRelevantChunks(allChunks, userMessage, MAX_CHUNKS);
    
    debug(`Found ${relevantChunks.length} relevant chunks out of ${allChunks.length} total`);
    
    const docsContext = relevantChunks.length > 0
      ? relevantChunks.map(chunk => `[From ${chunk.source}]\n${chunk.text}`).join('\n\n---\n\n')
      : 'No relevant documentation found.';

    // Build messages with instructions + documentation context
    const messages = [
      { 
        role: "system", 
        content: `${instructions}\n\n---\n\n# Available Documentation:\n\n${docsContext}`
      },
      { role: "user", content: userMessage }
    ];

    // Call ChatGPT
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: messages,
      max_completion_tokens: MAX_COMPLETION_TOKENS
    });

    debug('Full completion object:', JSON.stringify(completion, null, 2));
    debug('Choices:', completion.choices);
    debug('First choice:', completion.choices?.[0]);
    
    const reply = completion.choices[0].message.content;
    debug('Reply received:', reply);
    debug('Reply length:', reply?.length || 0);

    // Safety check: ensure we have a reply
    if (!reply || reply.trim().length === 0) {
      console.error('Empty reply from OpenAI');
      console.error('Full response:', JSON.stringify(completion, null, 2));
      await slackClient.chat.postMessage({
        channel: channel,
        thread_ts: ts,
        text: "Sorry, I wasn't able to generate a response. Could you try rephrasing your question?"
      });
      return;
    }

    // Post reply publicly in thread (not ephemeral - mentions are public)
    await slackClient.chat.postMessage({
      channel: channel,
      thread_ts: ts,
      text: reply
    });

    const totalTokens = completion.usage?.total_tokens || 0;
    console.log(`✓ Mention reply (${totalTokens} tokens) sent to channel ${channel} (msg: ${ts})`);

  } catch (error) {
    console.error('Error handling mention:', error);
    
    // Send error message to Slack
    try {
      await slackClient.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: "Sorry, I encountered an error processing your request."
      });
    } catch (slackError) {
      console.error('Error sending error message to Slack:', slackError);
    }
  }
}

// Handle messages in channels the bot is in
async function handleChannelMessage(event) {
  try {
    const { text, user, channel } = event;
    
    debug(`Channel message from user ${user} in ${channel}: ${text}`);

    // Check if we have configuration for this channel
    const config = channelConfig.channels[channel];
    if (!config) {
      // Silently ignore messages from unconfigured channels
      return;
    }

    // Smart filter: Only respond to questions/requests
    if (!looksLikeQuestion(text)) {
      debug('Skipping - does not look like a question');
      return;
    }

    // Rate limiting: Check if we recently responded to this user
    if (!shouldRespondToUser(channel, user)) {
      debug(`Skipping - user ${user} in cooldown period`);
      return;
    }

    console.log(`? Public request received from user ${user} in channel ${channel} (msg: ${event.ts})`);

    // Get instructions (always included)
    const instructions = channelInstructions[channel] || 'Answer based only on provided documentation.';
    
    // Get documentation for this channel
    const allChunks = channelDocs[channel] || [];
    const relevantChunks = await findRelevantChunks(allChunks, text, MAX_CHUNKS);
    
    debug(`Found ${relevantChunks.length} relevant chunks out of ${allChunks.length} total`);
    
    const docsContext = relevantChunks.length > 0
      ? relevantChunks.map(chunk => `[From ${chunk.source}]\n${chunk.text}`).join('\n\n---\n\n')
      : 'No relevant documentation found.';

    // Build messages with instructions + documentation context
    const messages = [
      { 
        role: "system", 
        content: `${instructions}\n\n---\n\n# Available Documentation:\n\n${docsContext}`
      },
      { role: "user", content: text }
    ];

    // Call ChatGPT
    debug('Calling OpenAI with', messages[0].content.length, 'chars of context');
    
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: messages,
      max_completion_tokens: MAX_COMPLETION_TOKENS
    });

    debug('Full completion response:', JSON.stringify(completion, null, 2));
    const reply = completion.choices[0].message.content;
    debug('Reply received:', reply);
    debug('Reply length:', reply?.length || 0);

    // Safety check: ensure we have a reply
    if (!reply || reply.trim().length === 0) {
      console.error('Empty reply from OpenAI');
      await slackClient.chat.postEphemeral({
        channel: channel,
        user: user,
        text: "Sorry, I wasn't able to generate a response. Could you try rephrasing your question?"
      });
      return;
    }

    // Send ephemeral message (only visible to the user who posted)
    await slackClient.chat.postEphemeral({
      channel: channel,  // Post in the same channel
      user: user,        // Only this user can see it
      text: `_Only visible to you:_\n\n${reply}`
    });

    // Record that we responded to this user
    recordResponse(channel, user);

    const totalTokens = completion.usage?.total_tokens || 0;
    console.log(`✓ Ephemeral reply (${totalTokens} tokens) sent to user ${user} in channel ${channel} (msg: ${event.ts})`);

  } catch (error) {
    console.error('Error handling channel message:', error);
    console.error('Error details:', error.message);
    
    // Notify user of error via ephemeral message
    try {
      await slackClient.chat.postEphemeral({
        channel: event.channel,
        user: event.user,
        text: "Sorry, I encountered an error processing your message. Please try again."
      });
    } catch (slackError) {
      console.error('Error sending error message to Slack:', slackError);
    }
  }
}

// Initialize everything and start server
async function startServer() {
  try {
    await initializeDocumentation();
    
    app.listen(port, () => {
      console.log(`dasilva listening on port ${port}`);
      console.log('Ready to answer questions!');
    });
  } catch (error) {
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
}

startServer();