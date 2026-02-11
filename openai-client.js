const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const MODEL = process.env.MODEL || "gpt-5-mini";
const MAX_COMPLETION_TOKENS =
  parseInt(process.env.MAX_COMPLETION_TOKENS) || 4000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: process.env.OPENAI_API_TIMEOUT || 30000,
  maxRetries: 0,
});

function callOpenAI(text, vectorId, threadHistory = []) {
  const instructions = fs.readFileSync(
    path.join(__dirname, "instructions.md"),
    "utf-8",
  );
  return openai.responses.create({
    model: MODEL,
    instructions,
    input: [...threadHistory, { role: "user", content: text }],
    tools: [{ type: "file_search", vector_store_ids: [vectorId] }],
    max_output_tokens: MAX_COMPLETION_TOKENS,
  });
}

function summarizeOpenAIError(err) {
  return {
    name: err?.name,
    message: err?.message,
    type: err?.type,
    code: err?.code,
    status: err?.status,
    requestID: err?.requestID,
    headers: err?.headers
      ? {
          "x-request-id": err.headers["x-request-id"],
          "openai-processing-ms": err.headers["openai-processing-ms"],
          "retry-after": err.headers["retry-after"],
        }
      : undefined,
  };
}

function summarizeSlackError(err) {
  return {
    name: err?.name,
    message: err?.message,
    code: err?.code,
    data: err?.data,
  };
}

function summarizeOpenAIResponse(response) {
  const output = response?.output ?? [];
  const first = output[0];

  return {
    id: response?.id,
    model: response?.model,
    status: response?.status,
    incomplete_reason: response?.incomplete_details?.reason,
    error: response?.error
      ? {
          code: response.error.code,
          message: response.error.message,
          type: response.error.type,
        }
      : undefined,
    usage: response?.usage
      ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined,
    output_text_len: response?.output_text?.length ?? 0,
    output_count: output.length,
    output_types: output.map((o) => o?.type).filter(Boolean),
    finish_reason:
      first?.finish_reason ?? first?.content?.[0]?.finish_reason ?? undefined,
  };
}

function logServiceError(context, error) {
  const isOpenAI =
    error?.name?.includes("OpenAI") ||
    error?.requestID ||
    typeof error?.status === "number";
  if (isOpenAI) {
    logger.error(`${context} (OpenAI):`, summarizeOpenAIError(error));
  } else {
    logger.error(`${context}:`, summarizeSlackError(error));
  }
}

module.exports = {
  callOpenAI,
  summarizeOpenAIResponse,
  logServiceError,
};
