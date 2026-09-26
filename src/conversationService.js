const { askSpeak, buildSafeServerContext, getFallback, createConversationStore, isSensitivePrompt } = require('./aiService');

const conversations = createConversationStore();
const OFFLINE_MESSAGE = 'Estou temporariamente off, chora ai kkk 😭';

function conversationKey(guildId, channelId, userId) {
  return `${guildId}:${channelId}:${userId}`;
}

async function answerSpeakMessage({
  guildId,
  channelId,
  userId,
  text,
  aiConfig,
  profile,
  availableCustomEmojis = [],
  ask = askSpeak,
}) {
  const prompt = text.trim();
  const key = conversationKey(guildId, channelId, userId);
  if (!aiConfig || aiConfig.enabled === false) return OFFLINE_MESSAGE;
  if (!prompt || isSensitivePrompt(prompt)) return getFallback(aiConfig);

  const history = conversations.get(key);
  let response;
  try {
    response = await ask(prompt, {
      ...aiConfig,
      availableCustomEmojis,
      serverContext: buildSafeServerContext(profile),
    }, globalThis.fetch, history);
  } catch {
    response = getFallback(aiConfig);
  }
  const finalResponse = response && response.trim() ? response : getFallback(aiConfig);
  conversations.append(key, prompt, finalResponse);
  return finalResponse;
}

module.exports = {
  answerSpeakMessage,
  conversationKey,
  OFFLINE_MESSAGE,
};