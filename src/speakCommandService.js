const { commands } = require('./commands');
const { SERVER_CHANNELS } = require('./config/defaults');
const { answerSpeakMessage } = require('./conversationService');
const { createSalaDoFuturoPayload } = require('./salaDoFuturoService');

const COMMAND_CATEGORIES = [
  ['🤖 IA', ['oi']],
  ['📍 Canais', ['canais', 'ondefica']],
  ['🎫 Atendimento', ['ticket', 'login', 'reset']],
  ['📦 Acesso', ['up', 'down', 'ver']],
  ['🛠️ Staff', ['clear', 'anuncio', 'promocao']],
  ['⚙️ Configuração', ['config', 'painel']],
  ['💳 Apoiador', ['apoiador-painel']],
  ['📚 Informações', ['ping', 'help', 'commands', 'status', 'speak', 'saladofuturo', 'cmsp', 'sala-do-futuro']],
];
const STAFF_COMMANDS = new Set([
  'clear', 'config', 'painel', 'up', 'down', 'ver', 'anuncio', 'promocao',
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

function getChannelByName(value) {
  const normalized = normalizeText(value);
  for (const [key, aliases] of Object.entries(CHANNEL_ALIASES)) {
    const channel = SERVER_CHANNELS[key];
    if (aliases.some((alias) => ` ${normalized} `.includes(` ${alias} `))) {
      return channel;
    }
  }
  return null;
}

function getLocationReply(text, explicit = false) {
  const normalized = normalizeText(text);
  if (!explicit && !LOCATION_INTENT.test(normalized)) return null;
  const channel = getChannelByName(normalized);
  if (!channel && /sala do futuro|sala futuro/.test(normalized)) {
    return `Não há um canal dedicado da Sala do Futuro configurado. Para orientação, use <#${SERVER_CHANNELS.aiHelp.id}>.`;
  }
  if (!channel) return null;
  return `${channel.emoji} ${channel.name} fica aqui: <#${channel.id}>`;
}

function getRegisteredSubcommands() {
  const shu = commands.find((command) => command.name === 'shu');
  return (shu?.options || []).filter((option) => option.type === 1);
}

function renderCommandName(name, format) {
  if (name === 'apoiador-painel') return '/apoiador painel';
  const prefixName = name === 'sala-do-futuro' ? 'sala do futuro' : name;
  if (format === 'slash') {
    if (name === 'clear') return '/clear <numero>';
    if (name === 'ondefica') return '/shu ondefica <nome>';
    if (name === 'painel') return '/apoiador painel <canal>';
    if (['up', 'down'].includes(name)) return `/shu ${name} <usuario> <motivo>`;
    if (name === 'ver') return '/shu ver <usuario>';
    if (['anuncio', 'promocao'].includes(name)) return `/shu ${name} <texto>`;
    return `/shu ${name}`;
  }
  if (name === 'clear') return '!s clear <quantidade>';
  if (['up', 'down'].includes(name)) return `!s ${name} <usuário> <motivo>`;
  if (name === 'ver') return '!s ver <usuário>';
  if (['anuncio', 'promocao'].includes(name)) return `!s ${name} <texto>`;
  if (name === 'ondefica') return '!s ondefica <canal>';
  if (name === 'painel') return '!s painel <#canal> [normal|v2]';
  return `!s ${prefixName}`;
}

function getRegisteredCommands() {
  const entries = [];
  for (const command of commands) {
    if (command.name === 'clear') entries.push({ name: 'clear', description: command.description });
    if (command.name === 'apoiador') {
      for (const subcommand of command.options || []) {
        if (subcommand.type === 1) entries.push({ name: subcommand.name, description: subcommand.description, format: 'supporter' });
      }
    }
    if (command.name === 'shu') {
      entries.push(...getRegisteredSubcommands().map((subcommand) => ({
        name: subcommand.name,
        description: subcommand.description,
      })));
    }
  }
  entries.push({ name: 'apoiador-painel', description: 'Painel de compras e apoio', format: 'supporter' });
  return entries;
}

function createCommandsMessage(format = 'prefix', summary = false) {
  const entries = getRegisteredCommands();
  const lines = ['📖 Comandos do SHU'];
  for (const [category, names] of COMMAND_CATEGORIES) {
    const categoryEntries = entries.filter((entry) => names.includes(entry.name))
      .filter((entry) => !summary || ['oi', 'help', 'ping', 'status', 'canais', 'ondefica', 'config', 'painel', 'clear'].includes(entry.name));
    if (!categoryEntries.length) continue;
    lines.push('', category);
    for (const entry of categoryEntries) {
      const staffNote = STAFF_COMMANDS.has(entry.name) ? ' (Staff)' : '';
      lines.push(`${renderCommandName(entry.name, format)}${staffNote}\n${entry.description}`);
    }
  }
  return lines.join('\n');
}

function getChannelsMessage() {
  const orderedKeys = [
    'handouts', 'essays', 'speak', 'matific', 'khanAcademy', 'nightExpansion',
    'professionalEducation', 'preparaSp', 'alura', 'openEnglish', 'leia',
    'tasks', 'reportCard', 'aiHelp', 'general', 'media', 'commands',
  ];
  return orderedKeys.map((key) => {
    const channel = SERVER_CHANNELS[key];
    return `${channel.emoji} ${channel.name} → <#${channel.id}>`;
  }).join('\n');
}

function buildSafeStatus(profile, ping = 0) {
  return [
    '🤖 SPEAK online',
    `IA: ${profile.ai?.enabled ? 'ON' : 'OFF'}`,
    `Prefixo: !s`,
    `⚡ Latência: ${Number.isFinite(ping) ? `${Math.round(ping)} ms` : 'indisponível'}`,
    `📍 Canais configurados: ${Object.keys(SERVER_CHANNELS).length}`,
    `🎫 Tickets: ${profile.ticket?.categoryId ? 'ON' : 'OFF'}`,
    '💳 Pagamentos: OFF',
  ].join('\n');
}

async function dispatchSpeakText(text, context) {
  const normalized = normalizeText(text);
  const [firstWord, ...remainingWords] = normalized.split(' ');
  const argument = remainingWords.join(' ');
  const location = getLocationReply(text)
    || (firstWord === 'ondefica' ? getLocationReply(argument, true) : null);
  if (location) return { content: location, allowedMentions: { parse: [] } };

  if (normalized === 'ping') {
    return { content: `🏓 Pong! Latência do bot: ${Number.isFinite(context.ping) ? `${Math.round(context.ping)} ms` : 'indisponível'}.` };
  }
  if (normalized === 'help' || normalized === 'ajuda') {
    return { content: createCommandsMessage(context.format, true) };
  }
  if (normalized === 'commands' || normalized === 'comandos') {
    return { content: createCommandsMessage(context.format) };
  }
  if (normalized === 'status') return { content: buildSafeStatus(context.profile, context.ping) };
  if (normalized === 'canais' || normalized === 'channels') {
    return { content: getChannelsMessage(), allowedMentions: { parse: [] } };
  }
  if (normalized === 'speak') {
    return { content: `SPEAK é a plataforma de inglês da rede estadual de São Paulo, no contexto da Sala do Futuro. Canal SPEAK: <#${SERVER_CHANNELS.speak.id}>.`, allowedMentions: { parse: [] } };
  }
  if (normalized === 'cmsp') {
    return { content: `O CMSP é uma plataforma educacional digital da rede estadual. Este servidor não tem procedimentos de acesso confirmados; peça orientação em <#${SERVER_CHANNELS.aiHelp.id}>.`, allowedMentions: { parse: [] } };
  }
  if (normalized === 'saladofuturo' || normalized === 'sala do futuro' || normalized === 'sala futuro'
    || normalized === 'sala-do-futuro') {
    return createSalaDoFuturoPayload();
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
