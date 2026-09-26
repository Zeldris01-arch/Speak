require('dotenv').config();

const {
  Client,
  Events,
  REST,
  Routes,
  GatewayIntentBits,
} = require('discord.js');
const { commands } = require('./commands');
const {
  configStore,
  handleInteraction,
  handlePrefixClear,
  handlePrefixWorkflow,
  handleWorkspaceUpload,
} = require('./interactionHandler');
const { handleAdminMessage } = require('./adminService');
const { startExpirationWorker } = require('./accessExpirationService');
const { dispatchSpeakText } = require('./speakCommandService');
const { SERVER_CHANNELS } = require('./config/defaults');

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('A variável DISCORD_TOKEN não foi definida.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  try {
    const rest = new REST({ version: '10' }).setToken(token);
    const botUser = await rest.get(Routes.user());

    await rest.put(Routes.applicationCommands(botUser.id), { body: commands });
    console.log(`Conectado como ${readyClient.user.tag}. Slash commands registrados.`);
  } catch {
    console.error('Falha ao registrar os Slash Commands.');
  }
  startExpirationWorker(readyClient, configStore);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.webhookId) return;
  try {
    if (await handleWorkspaceUpload(message, configStore)) return;
    if (await handlePrefixClear(message, configStore)) return;
    if (await handleAdminMessage(message, configStore)) return;

    if (!message.guild) return;
    if (await handlePrefixWorkflow(message, configStore)) return;
    const content = message.content.trim();
    const prefixMatch = content.match(/^!s(?:\s+([\s\S]*))?$/i);
    const legacyMatch = content.match(/^\?speak(?:\s+([\s\S]*))?$/i);
    const mentionPattern = new RegExp(`<@!?${client.user.id}>`, 'i');
    const mentioned = mentionPattern.test(content);
    const aiChannelId = SERVER_CHANNELS.aiHelp.id;
    const inAiChannel = message.channel.id === aiChannelId || message.channel.parentId === aiChannelId;
    if (!prefixMatch && !legacyMatch && !mentioned && !inAiChannel) return;

    const profile = await configStore.getActiveProfile(message.guild.id);
    let question = prefixMatch ? prefixMatch[1] || '' : legacyMatch ? legacyMatch[1] || '' : content;
    if (mentioned) question = question.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    const payload = await dispatchSpeakText(question || 'oi', {
      format: 'prefix',
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
      profile,
      ping: client.ws.ping,
      availableCustomEmojis: [...(message.guild.emojis?.cache?.values?.() || [])]
        .map((emoji) => emoji.toString()),
    });
    await message.reply(payload);
  } catch {
    await message.reply({
      content: 'Ação administrativa não concluída. Confira as permissões, a hierarquia dos cargos e o canal de logs.',
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  await handleInteraction(interaction);
});

client.login(token).catch(() => {
  console.error('Falha ao conectar ao Discord.');
  process.exitCode = 1;
});