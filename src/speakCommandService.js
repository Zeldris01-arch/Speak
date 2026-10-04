const { commands } = require('./commands');
const { SERVER_CHANNELS, getConfiguredChannel } = require('./config/defaults');
const { answerSpeakMessage } = require('./conversationService');

const COMMAND_CATEGORIES = [
  ['📍 Canais', ['canais', 'cone-onde-fica']],
  ['🎫 Atendimento', ['ticket']],
  ['📦 Acesso', ['up', 'down', 'ver']],
  ['🛠️ Staff', ['root-clear', 'cone-clear', 'up', 'down', 'ver', 'anuncio', 'promocao', 'cone-visor', 'coneondeficaconfig-add']],
  ['⚙️ Configuração', ['config', 'painel']],
  ['💳 Apoiador', ['apoiador-painel']],
  ['📚 Informações', ['ping', 'help', 'commands', 'status']],
];
const STAFF_COMMANDS = new Set([
  'root-clear', 'cone-clear', 'config', 'painel', 'up', 'down', 'ver', 'anuncio', 'promocao', 'coneondeficaconfig-add',
]);
const CHANNEL_ALIASES = Object.freeze({
  handouts: ['apostila', 'apostilas'],
  essays: ['redacao', 'redacoes'],
  speak: ['speak', 'speake', 'speek'],
  matific: ['matific', 'mathfic'],
  khanAcademy: ['khan academy', 'khan'],
  nightExpansion: ['expansao noturna', 'expansao'],
  professionalEducation: ['educacao profissional', 'profissional'],
  preparaSp: ['prepara sp', 'prepara'],
  alura: ['alura'],
  openEnglish: ['open english'],
  leia: ['leia'],
  tasks: ['atividade', 'atividades', 'tarefa', 'tarefas'],
  reportCard: ['boletim'],
  aiHelp: ['chat de ajuda', 'ajuda ia', 'chat help', 'ajuda'],
  general: ['geral'],
  media: ['midia'],
  commands: ['comandos'],
});
const LOCATION_INTENT = /\b(?:onde\s+(?:fica|ficam|esta|estao|encontro|acho|vejo|faco|realizo)|qual\s+(?:e\s+)?(?:o\s+)?canal|canal\s+(?:do|da|de)|me\s+manda\s+(?:o\s+)?canal)\b/;

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[!?.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getChannelByName(value, profile) {
  const normalized = normalizeText(value);
  const customChannel = profile?.general?.customChannels?.find((channel) =>
    ` ${normalized} `.includes(` ${normalizeText(channel.name)} `));
  if (customChannel) return { info: { name: customChannel.name, emoji: '📍' }, channel: customChannel };
  for (const [key, aliases] of Object.entries(CHANNEL_ALIASES)) {
    if (aliases.some((alias) => ` ${normalized} `.includes(` ${alias} `))) {
      return { info: SERVER_CHANNELS[key], channel: getConfiguredChannel(profile, key) };
    }
  }
  return null;
}

function getLocationReply(text, explicit = false, profile) {
  const normalized = normalizeText(text);
  if (!explicit && !LOCATION_INTENT.test(normalized)) return null;
  const match = getChannelByName(normalized, profile);
  if (!match) return null;
  const { info: channelInfo, channel } = match;
  if (!channel) return `${channelInfo.emoji} ${channelInfo.name} ainda não foi configurado neste servidor.`;
  return `${channel.emoji || channelInfo.emoji || '📍'} ${channel.name} fica aqui: <#${channel.id}>`;
}

function getRegisteredSubcommands() {
  const cone = commands.find((command) => command.name === 'cone');
  return (cone?.options || []).filter((option) => option.type === 1);
}

function renderCommandName(name, format, prefix = '!cone') {
  if (name === 'cone-visor') return '/cone visor <id>';
  if (name === 'cone-onde-fica') return '/cone onde-fica [nome]';
  if (name === 'coneondeficaconfig-add') return '/coneondeficaconfig add <id> <nome>';
  if (name === 'root-clear') return format === 'slash' ? '/clear <numero>' : `${prefix} clear <quantidade>`;
  if (name === 'apoiador-painel') return '/apoiador painel';
  const prefixName = name;
  if (format === 'slash') {
    if (name === 'cone-visor' || name === 'visor') return '/cone visor <id>';
    if (name === 'cone-onde-fica' || name === 'onde-fica') return '/cone onde-fica [nome]';
    const subcommand = name.startsWith('cone-') ? name.slice('cone-'.length) : name;
    if (subcommand === 'clear') return '/cone clear <numero>';
    if (['up', 'down'].includes(subcommand)) return `/cone ${subcommand} <usuario> <motivo>`;
    if (subcommand === 'ver') return '/cone ver <usuario>';
    if (['anuncio', 'promocao'].includes(subcommand)) return `/cone ${subcommand} <texto>`;
    if (subcommand === 'painel') return '/cone painel <canal> · /apoiador painel <canal>';
    return `/cone ${subcommand}`;
  }
  if (name === 'clear' || name === 'cone-clear') return `${prefix} clear <quantidade>`;
  if (['up', 'down', 'cone-up', 'cone-down'].includes(name)) return `${prefix} ${name.replace('cone-', '')} <usuário> <motivo>`;
  if (name === 'ver' || name === 'cone-ver') return `${prefix} ver <usuário>`;
  if (['anuncio', 'promocao', 'cone-anuncio', 'cone-promocao'].includes(name)) return `${prefix} ${name.replace('cone-', '')} <texto>`;
  if (name === 'painel' || name === 'cone-painel') return `${prefix} painel <#canal> [normal|v2]`;
  return `${prefix} ${prefixName}`;
}

function getRegisteredCommands() {
  const entries = [];
  for (const command of commands) {
    if (command.name === 'clear') entries.push({ name: 'root-clear', description: command.description });
    if (command.name === 'apoiador') {
      for (const subcommand of command.options || []) {
        if (subcommand.type === 1) entries.push({ name: subcommand.name, description: subcommand.description, format: 'supporter' });
      }
    }
    if (command.name === 'cone') {
      entries.push(...getRegisteredSubcommands().map((subcommand) => ({
        name: subcommand.name === 'clear'
          ? 'cone-clear'
          : ['visor', 'onde-fica'].includes(subcommand.name) ? `cone-${subcommand.name}` : subcommand.name,
        description: subcommand.description,
      })));
    }
    if (command.name === 'coneondeficaconfig') {
      entries.push(...command.options.map((subcommand) => ({
        name: `coneondeficaconfig-${subcommand.name}`,
        description: subcommand.description,
      })));
    }
  }
  entries.push({ name: 'apoiador-painel', description: 'Painel de compras e apoio', format: 'supporter' });
  return entries;
}

function createCommandsMessage(format = 'prefix', summary = false, prefix = '!cone') {
  const entries = getRegisteredCommands();
  const lines = ['📖 Comandos do Cone'];
  for (const [category, names] of COMMAND_CATEGORIES) {
    const categoryEntries = entries.filter((entry) => names.includes(entry.name))
      .filter((entry) => !summary || ['help', 'ping', 'status', 'canais', 'config', 'painel', 'root-clear', 'cone-clear', 'cone-onde-fica', 'cone-visor'].includes(entry.name));
    if (!categoryEntries.length) continue;
    lines.push('', category);
    for (const entry of categoryEntries) {
      const staffNote = STAFF_COMMANDS.has(entry.name) ? ' (Staff)' : '';
      lines.push(`${renderCommandName(entry.name, format, prefix)}${staffNote}\n${entry.description}`);
    }
  }
  return lines.join('\n');
}

function getChannelsMessage(profile) {
  const orderedKeys = [
    'handouts', 'essays', 'speak', 'matific', 'khanAcademy', 'nightExpansion',
    'professionalEducation', 'preparaSp', 'alura', 'openEnglish', 'leia',
    'tasks', 'reportCard', 'aiHelp', 'general', 'media', 'commands',
  ];
  const lines = orderedKeys.flatMap((key) => {
    const channel = getConfiguredChannel(profile, key);
    if (!channel) return [];
    return `${channel.emoji} ${channel.name} → <#${channel.id}>`;
  });
  const listedIds = new Set(orderedKeys
    .map((key) => getConfiguredChannel(profile, key)?.id)
    .filter(Boolean));
  for (const channel of profile?.general?.customChannels || []) {
    if (listedIds.has(channel.id)) continue;
    listedIds.add(channel.id);
    lines.push(`📍 ${channel.name} → <#${channel.id}>`);
  }
  return lines.length ? lines.join('\n') : 'Nenhum canal foi configurado neste servidor.';
}

function buildSafeStatus(profile, ping = 0) {
  return [
    '🤖 Cone online',
    `IA: ${profile.ai?.enabled ? 'ON' : 'OFF'}`,
    `Prefixo: ${profile.general?.prefix || '!cone'}`,
    `⚡ Latência: ${Number.isFinite(ping) ? `${Math.round(ping)} ms` : 'indisponível'}`,
    `📍 Canais configurados: ${Object.values(profile.general?.channelIds || {}).filter(Boolean).length}`,
    `🎫 Tickets: ${profile.ticket?.categoryId ? 'ON' : 'OFF'}`,
    '💳 Pagamentos: OFF',
  ].join('\n');
}

async function dispatchSpeakText(text, context) {
  const normalized = normalizeText(text);
  const [firstWord, ...remainingWords] = normalized.split(' ');
  const argument = remainingWords.join(' ');
  const location = getLocationReply(text, false, context.profile);
  if (location) return { content: location, allowedMentions: { parse: [] } };

  if (normalized === 'ping') {
    return { content: `🏓 Pong! Latência do bot: ${Number.isFinite(context.ping) ? `${Math.round(context.ping)} ms` : 'indisponível'}.` };
  }
  if (normalized === 'help' || normalized === 'ajuda') {
    return { content: createCommandsMessage(context.format, true, context.profile?.general?.prefix || '!cone') };
  }
  if (normalized === 'commands' || normalized === 'comandos') {
    return { content: createCommandsMessage(context.format, false, context.profile?.general?.prefix || '!cone') };
  }
  if (normalized === 'status') return { content: buildSafeStatus(context.profile, context.ping) };
  if (normalized === 'canais' || normalized === 'channels') {
    return { content: getChannelsMessage(context.profile), allowedMentions: { parse: [] } };
  }

  const answer = await answerSpeakMessage({
    guildId: context.guildId,
    channelId: context.channelId,
    userId: context.userId,
    text,
    aiConfig: context.profile.ai,
    profile: context.profile,
    availableCustomEmojis: context.availableCustomEmojis,
    ask: context.ask,
  });
  return { content: answer, allowedMentions: { parse: [] } };
}

module.exports = {
  buildSafeStatus,
  createCommandsMessage,
  dispatchSpeakText,
  getChannelByName,
  getChannelsMessage,
  getLocationReply,
  getRegisteredCommands,
  normalizeText,
};
