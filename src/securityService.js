const { ChannelType, PermissionFlagsBits } = require('discord.js');

const MESSAGE_WINDOWS = new Map();
const FLOOD_WINDOWS = new Map();
const RAID_WINDOWS = new Map();

function normalizeText(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getSecurityConfig(profile = {}) {
  const config = profile.security || {};
  return {
    antiRaid: {
      enabled: false,
      memberLimit: 5,
      intervalSeconds: 10,
      action: 'alert',
      ...(config.antiRaid || {}),
    },
    antiSpam: {
      enabled: false,
      messages: 5,
      intervalSeconds: 5,
      action: 'warn',
      ...(config.antiSpam || {}),
    },
    antiFlood: {
      enabled: false,
      threshold: 5,
      intervalSeconds: 3,
      action: 'warn',
      message: '<@USER_ID> Para de flood, isso pode resultar em punição.',
      ...(config.antiFlood || {}),
    },
    antiLink: {
      enabled: false,
      allowedDomains: [],
      ignoredChannels: [],
      ignoredRoles: [],
      action: 'delete',
      ...(config.antiLink || {}),
    },
    antiInvite: {
      enabled: false,
      ignoredChannels: [],
      ignoredRoles: [],
      action: 'delete',
      ...(config.antiInvite || {}),
    },
    antiBot: {
      enabled: false,
      action: 'log',
      ...(config.antiBot || {}),
    },
    mentionProtection: {
      enabled: false,
      limit: 5,
      action: 'delete',
      ignoredChannels: [],
      ignoredRoles: [],
      ...(config.mentionProtection || {}),
    },
    blockedWords: {
      enabled: false,
      words: [],
      ...(config.blockedWords || {}),
    },
    lockdown: {
      enabled: false,
      channelIds: [],
      ...(config.lockdown || {}),
    },
    logChannelId: config.logChannelId || profile.admin?.logChannelId || '',
  };
}

function parseAllowedDomain(domain = '') {
  const value = String(domain).trim().toLowerCase();
  return value.replace(/^\./, '').replace(/\/$/, '');
}

function isDomainAllowed(domain, allowedDomains = []) {
  const normalized = parseAllowedDomain(domain);
  return allowedDomains.some((entry) => {
    const allowed = parseAllowedDomain(entry);
    return allowed === normalized || normalized.endsWith(`.${allowed}`);
  });
}

function hasIgnoredRole(member, ignoredRoles = []) {
  if (!member?.roles?.cache || !ignoredRoles.length) return false;
  return ignoredRoles.some((roleId) => member.roles.cache.has(roleId));
}

function isIgnoredByConfiguration(message, config, member) {
  if (!message?.guild) return true;
  if (config.antiLink?.ignoredChannels?.includes(message.channel.id)) return true;
  if (config.antiInvite?.ignoredChannels?.includes(message.channel.id)) return true;
  if (config.mentionProtection?.ignoredChannels?.includes(message.channel.id)) return true;
  if (hasIgnoredRole(member, config.antiLink?.ignoredRoles || [])) return true;
  if (hasIgnoredRole(member, config.antiInvite?.ignoredRoles || [])) return true;
  if (hasIgnoredRole(member, config.mentionProtection?.ignoredRoles || [])) return true;
  return false;
}

async function logSecurityEvent(guild, profile, content) {
  const security = getSecurityConfig(profile);
  const channelId = security.logChannelId || profile.admin?.logChannelId;
  if (!channelId || !guild) return;
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      await channel.send({ content: `🛡️ ${content}`, allowedMentions: { parse: [] } }).catch(() => {});
    }
  } catch {}
}

async function warnUser(message, content) {
  if (!message?.guild || message.author.bot || !message.channel?.isTextBased?.()) return;
  try {
    await message.reply({
      content,
      allowedMentions: { users: [message.author.id] },
    }).catch(() => {});
  } catch {}
}

async function deleteAndReport(message, reason, profile, warningText) {
  if (!message || !message.guild) return;
  try {
    await message.delete().catch(() => {});
  } catch {}
  if (warningText) await warnUser(message, warningText);
  if (profile) {
    await logSecurityEvent(message.guild, profile, `${reason} em #${message.channel.name || message.channel.id}.`);
  }
}

async function triggerLockdown(guild, profile, enabled = true) {
  const security = getSecurityConfig(profile);
  const channelIds = new Set(security.lockdown.channelIds || []);
  const botMember = guild.members.me;
  if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) return false;

  const targetChannels = (guild.channels.cache || new Map()).values();
  for (const channel of targetChannels) {
    if (!channel || !channel.isTextBased?.() || (!channelIds.size && !enabled)) continue;
    const shouldTarget = !channelIds.size || channelIds.has(channel.id);
    if (!shouldTarget) continue;
    try {
      if (enabled) {
        await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
          SendMessages: false,
          SendMessagesInThreads: false,
        }).catch(() => {});
      } else {
        await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
          SendMessages: null,
          SendMessagesInThreads: null,
        }).catch(() => {});
      }
    } catch {}
  }

  security.lockdown.enabled = enabled;
  profile.security = security;
  return true;
}

async function handleRaidDetection(guild, profile, action = 'alert') {
  const security = getSecurityConfig(profile);
  if (!security.antiRaid.enabled) return false;
  const raidAction = action || security.antiRaid.action || 'alert';
  await logSecurityEvent(guild, profile, `🚨 Anti-Raid acionado: ${security.antiRaid.memberLimit} entradas em ${security.antiRaid.intervalSeconds}s. Ação: ${raidAction}.`);
  if (raidAction === 'lockdown' || raidAction === 'alert+lockdown' || raidAction === 'alert + lockdown') {
    await triggerLockdown(guild, profile, true);
  }
  return true;
}

async function handleAntiBot(member, profile) {
  const security = getSecurityConfig(profile);
  if (!member.user.bot || !security.antiBot.enabled) return false;
  const action = security.antiBot.action || 'log';
  await logSecurityEvent(member.guild, profile, `🤖 Anti-Bot: ${member.user.tag} (${member.id}) entrou e a ação configurada foi ${action}.`);
  if (action === 'kick' || action === 'expulsar') {
    try {
      await member.kick('Anti-Bot ativado.');
    } catch {}
  }
  return true;
}

async function handleMemberJoin(member, profile) {
  const security = getSecurityConfig(profile);
  if (!member?.guild || !profile) return false;

  const guildId = member.guild.id;
  const now = Date.now();
  const window = RAID_WINDOWS.get(guildId) || [];
  window.push(now);
  const thresholdMs = Math.max(1, Number(security.antiRaid.intervalSeconds || 10) * 1000);
  const filtered = window.filter((value) => now - value <= thresholdMs);
  RAID_WINDOWS.set(guildId, filtered);

  if (security.antiRaid.enabled && filtered.length >= Number(security.antiRaid.memberLimit || 5)) {
    await handleRaidDetection(member.guild, profile, security.antiRaid.action || 'alert');
    RAID_WINDOWS.set(guildId, []);
    return true;
  }

  if (security.antiBot.enabled && member.user.bot) {
    return handleAntiBot(member, profile);
  }
  return false;
}

async function handleMessageSecurity(message, profile) {
  if (!message || !message.guild || message.author.bot || message.webhookId || !profile) return false;
  if (message.author.id === message.client?.user?.id) return false;

  const security = getSecurityConfig(profile);
  if (!security) return false;

  const member = message.member || null;
  const content = message.content || '';
  if (!content.trim()) return false;

  if (security.lockdown.enabled && (security.lockdown.channelIds || []).includes(message.channel.id)) {
    try {
      await message.delete().catch(() => {});
      await warnUser(message, '🔒 O servidor está em modo de segurança. Aguarde a liberação da equipe.');
      await logSecurityEvent(message.guild, profile, `🔒 Lockdown ativo: mensagem de <@${message.author.id}> removida em #${message.channel.name || message.channel.id}.`);
      return true;
    } catch {}
  }

  if (security.blockedWords.enabled && Array.isArray(security.blockedWords.words)) {
    const words = security.blockedWords.words
      .map((value) => String(value).trim())
      .filter(Boolean);
    const found = words.find((word) => normalizeText(content).includes(normalizeText(word)));
    if (found) {
      await message.delete().catch(() => {});
      await warnUser(message, `<@${message.author.id}> Suas mensagens continuam com palavras proibidas! Tome cuidado com o que você envia.`);
      await logSecurityEvent(message.guild, profile, `🚫 Palavra bloqueada detectada: "${found}" por <@${message.author.id}> em #${message.channel.name || message.channel.id}.`);
      return true;
    }
  }

  if (security.antiLink.enabled && !isIgnoredByConfiguration(message, security, member)) {
    const linkPattern = /(https?:\/\/|www\.)[^\s]+/i;
    const matches = content.match(linkPattern) || [];
    for (const match of matches) {
      try {
        const url = new URL(match.startsWith('http') ? match : `https://${match}`);
        const host = url.hostname.toLowerCase();
        if (host === 'discord.com' || host === 'discord.gg' || host === 'www.discord.com' || host === 'discordapp.com') {
          continue;
        }
        if (!isDomainAllowed(host, security.antiLink.allowedDomains || [])) {
          await message.delete().catch(() => {});
          await warnUser(message, `<@${message.author.id}> Links não permitidos foram removidos para manter o servidor seguro.`);
          await logSecurityEvent(message.guild, profile, `🔗 Link não autorizado em #${message.channel.name || message.channel.id}: ${host}.`);
          return true;
        }
      } catch {}
    }
  }

  if (security.antiInvite.enabled && !isIgnoredByConfiguration(message, security, member)) {
    const invitePattern = /(discord\.gg\/|discord(?:app)?\.com\/invite\/)/i;
    if (invitePattern.test(content)) {
      await message.delete().catch(() => {});
      await warnUser(message, `<@${message.author.id}> Convites de servidor não são permitidos aqui.`);
      await logSecurityEvent(message.guild, profile, `📩 Convite do Discord removido de <@${message.author.id}> em #${message.channel.name || message.channel.id}.`);
      return true;
    }
  }

  if (security.antiSpam.enabled && !member?.user?.bot) {
    const key = `${message.guild.id}:${message.author.id}`;
    const bucket = MESSAGE_WINDOWS.get(key) || [];
    const now = Date.now();
    const currentWindow = bucket.filter((time) => now - time <= Number(security.antiSpam.intervalSeconds || 5) * 1000);
    currentWindow.push(now);
    MESSAGE_WINDOWS.set(key, currentWindow);
    if (currentWindow.length >= Number(security.antiSpam.messages || 5)) {
      const action = security.antiSpam.action || 'warn';
      if (action === 'timeout') {
        await member.timeout?.(Number(security.antiSpam.intervalSeconds || 5) * 1000, 'Anti-Spam').catch(() => {});
      } else if (action === 'delete') {
        await message.delete().catch(() => {});
      } else {
        await warnUser(message, `<@${message.author.id}> Você está mandando mensagens em excesso. Pare antes que seja aplicada uma punição.`);
      }
      await logSecurityEvent(message.guild, profile, `🧾 Anti-Spam: ${currentWindow.length} mensagens em ${security.antiSpam.intervalSeconds}s por <@${message.author.id}>.`);
      MESSAGE_WINDOWS.set(key, []);
      return true;
    }
  }

  if (security.antiFlood.enabled && !member?.user?.bot) {
    const key = `${message.guild.id}:flood:${message.author.id}`;
    const bucket = FLOOD_WINDOWS.get(key) || [];
    const now = Date.now();
    const currentWindow = bucket.filter((time) => now - time <= Number(security.antiFlood.intervalSeconds || 3) * 1000);
    currentWindow.push(now);
    FLOOD_WINDOWS.set(key, currentWindow);
    const repeated = currentWindow.length >= Number(security.antiFlood.threshold || 5)
      && normalizeText(message.content).length > 0;
    if (repeated) {
      const action = security.antiFlood.action || 'warn';
      const warning = (security.antiFlood.message || '<@USER_ID> Para de flood, isso pode resultar em punição.').replace('<@USER_ID>', `<@${message.author.id}>`);
      if (action === 'delete') {
        await message.delete().catch(() => {});
      } else {
        await warnUser(message, warning);
      }
      await logSecurityEvent(message.guild, profile, `🌊 Anti-Flood: excesso de mensagens rápidas por <@${message.author.id}> em #${message.channel.name || message.channel.id}.`);
      FLOOD_WINDOWS.set(key, []);
      return true;
    }
  }

  if (security.mentionProtection.enabled && !isIgnoredByConfiguration(message, security, member)) {
    const mentionCount = (content.match(/@everyone|@here|<@&?\d+>/g) || []).length;
    if (mentionCount >= Number(security.mentionProtection.limit || 5) || /(\@everyone|\@here)/i.test(content)) {
      await message.delete().catch(() => {});
      await warnUser(message, `<@${message.author.id}> Mencione apenas quando for realmente necessário e evite abuso de menções.`);
      await logSecurityEvent(message.guild, profile, `📣 Proteção de menções: abuso detectado por <@${message.author.id}> em #${message.channel.name || message.channel.id}.`);
      return true;
    }
  }

  return false;
}

module.exports = {
  getSecurityConfig,
  handleMessageSecurity,
  handleMemberJoin,
  triggerLockdown,
  logSecurityEvent,
};
