/**
 * LLM provider — Amazon Bedrock with Claude Opus 4.6
 * Only external API call in the system.
 */
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const MODEL_ID = process.env.LLM_MODEL || 'us.anthropic.claude-opus-4-6-v1';

/**
 * Send a chat completion request to Bedrock Claude.
 * @param {string} systemPrompt - System instructions
 * @param {Array<{role: string, content: string}>} messages - Conversation messages
 * @param {object} options - { maxTokens, temperature }
 * @returns {string} Assistant response text
 */
export async function chat(systemPrompt, messages, options = {}) {
  const { maxTokens = 4096, temperature = 0.3, timeoutMs = 60000 } = options;

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  // Issue #14: Add timeout to prevent hung LLM calls
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await client.send(command, { abortSignal: controller.signal });
    const result = JSON.parse(new TextDecoder().decode(response.body));
    return result.content?.[0]?.text || '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stream a chat completion.
 * @yields {string} Text chunks
 */
export async function* chatStream(systemPrompt, messages, options = {}) {
  const { maxTokens = 4096, temperature = 0.3 } = options;

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  };

  const command = new InvokeModelWithResponseStreamCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const response = await client.send(command);

  for await (const event of response.body) {
    if (event.chunk) {
      const data = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
      if (data.type === 'content_block_delta' && data.delta?.text) {
        yield data.delta.text;
      }
    }
  }
}
