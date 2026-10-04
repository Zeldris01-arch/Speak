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
const { handleMessageSecurity, handleMemberJoin } = require('./securityService');

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('A variável DISCORD_TOKEN não foi definida.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
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
    if (!message.guild) return;
    const profile = await configStore.getActiveProfile(message.guild.id);
    if (await handleMessageSecurity(message, profile)) return;
    const prefix = profile.general.prefix || '!cone';
    if (await handlePrefixClear(message, configStore, {}, prefix)) return;
    if (await handleAdminMessage(message, configStore, prefix)) return;
    if (await handlePrefixWorkflow(message, configStore, prefix)) return;
    const content = message.content.trim();
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixMatch = content.match(new RegExp(`^${escapedPrefix}(?:\\s+([\\s\\S]*))?$`, 'i'));
    const mentionPattern = new RegExp(`<@!?${client.user.id}>`, 'i');
    const mentioned = mentionPattern.test(content);
    const aiChannelId = profile.general.channelIds.aiHelp;
    const inAiChannel = Boolean(aiChannelId && (message.channel.id === aiChannelId || message.channel.parentId === aiChannelId));
    if (!prefixMatch && !mentioned && !inAiChannel) return;

    let question = prefixMatch ? prefixMatch[1] || '' : content;
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

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const profile = await configStore.getActiveProfile(member.guild.id);
    await handleMemberJoin(member, profile);
  } catch {}
});

client.on(Events.InteractionCreate, async (interaction) => {
  await handleInteraction(interaction);
});

client.login(token).catch(() => {
  console.error('Falha ao conectar ao Discord.');
  process.exitCode = 1;
});