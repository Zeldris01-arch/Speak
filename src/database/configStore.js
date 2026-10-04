const fs = require('node:fs/promises');
const path = require('node:path');

const { createDefaultGuildConfig, createDefaultProfile } = require('../config/defaults');

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'data', 'guild-config.json');

function normalizeProfile(profile = {}) {
  const defaults = createDefaultProfile();
  const normalized = { ...defaults, ...profile };
  for (const key of ['general', 'panel', 'payment', 'ticket', 'ai', 'permissions', 'admin', 'emojis', 'announcements', 'promotions', 'security']) {
    normalized[key] = { ...defaults[key], ...(profile[key] ?? {}) };
  }
  normalized.security.antiRaid = { ...defaults.security.antiRaid, ...(profile.security?.antiRaid ?? {}) };
  normalized.security.antiSpam = { ...defaults.security.antiSpam, ...(profile.security?.antiSpam ?? {}) };
  normalized.security.antiFlood = { ...defaults.security.antiFlood, ...(profile.security?.antiFlood ?? {}) };
  normalized.security.antiLink = { ...defaults.security.antiLink, ...(profile.security?.antiLink ?? {}) };
  normalized.security.antiInvite = { ...defaults.security.antiInvite, ...(profile.security?.antiInvite ?? {}) };
  normalized.security.antiBot = { ...defaults.security.antiBot, ...(profile.security?.antiBot ?? {}) };
  normalized.security.mentionProtection = { ...defaults.security.mentionProtection, ...(profile.security?.mentionProtection ?? {}) };
  normalized.security.blockedWords = { ...defaults.security.blockedWords, ...(profile.security?.blockedWords ?? {}) };
  normalized.security.lockdown = { ...defaults.security.lockdown, ...(profile.security?.lockdown ?? {}) };
  normalized.security.logChannelId ??= defaults.security.logChannelId;
  normalized.security.blockedWords.words = Array.isArray(profile.security?.blockedWords?.words)
    ? profile.security.blockedWords.words.map((word) => String(word).trim()).filter(Boolean)
    : defaults.security.blockedWords.words;
  normalized.security.antiLink.allowedDomains = Array.isArray(profile.security?.antiLink?.allowedDomains)
    ? profile.security.antiLink.allowedDomains.map((value) => String(value).trim()).filter(Boolean)
    : defaults.security.antiLink.allowedDomains;
  normalized.security.antiLink.ignoredChannels = Array.isArray(profile.security?.antiLink?.ignoredChannels)
    ? profile.security.antiLink.ignoredChannels.filter((value) => /^\d{17,20}$/.test(String(value)))
    : defaults.security.antiLink.ignoredChannels;
  normalized.security.antiInvite.ignoredChannels = Array.isArray(profile.security?.antiInvite?.ignoredChannels)
    ? profile.security.antiInvite.ignoredChannels.filter((value) => /^\d{17,20}$/.test(String(value)))
    : defaults.security.antiInvite.ignoredChannels;
  normalized.general.channelIds = { ...defaults.general.channelIds, ...(profile.general?.channelIds ?? {}) };
  normalized.general.customChannels = Array.isArray(profile.general?.customChannels)
    ? profile.general.customChannels.filter((channel) => channel && /^\d{17,20}$/.test(channel.id) && typeof channel.name === 'string')
    : [];
  normalized.ticket.callCooldowns ??= {};
  normalized.ticket.ratings = Array.isArray(normalized.ticket.ratings) ? normalized.ticket.ratings : [];
  normalized.ticket.records = Array.isArray(normalized.ticket.records) ? normalized.ticket.records : [];
  normalized.permissions.areas = { ...defaults.permissions.areas, ...(profile.permissions?.areas ?? {}) };
  for (const [area, areaDefaults] of Object.entries(defaults.permissions.areas)) {
    normalized.permissions.areas[area] = {
      ...areaDefaults,
      ...(profile.permissions?.areas?.[area] ?? {}),
    };
  }
  normalized.admin.pendingActions ??= {};
  if (/^Amigo, não sei responder isso KKK 😭 Vai no <#\d{17,20}> que eles te salvam\.$/.test(normalized.ai.fallbackMessage)
    || /^Amigo não sei responder isso, va no canal <#\d{17,20}> \| lembra ok$/.test(normalized.ai.fallbackMessage)) {
    normalized.ai.fallbackMessage = defaults.ai.fallbackMessage;
  }
  if (normalized.panel.color?.toLowerCase() === '#5865f2') normalized.panel.color = '#FFFFFF';
  for (const section of ['announcements', 'promotions']) {
    if (normalized[section].color?.toLowerCase() === '#236a57') normalized[section].color = '#FFFFFF';
  }
  normalized.plans = Array.isArray(profile.plans) ? profile.plans : [];
  normalized.coupons = Array.isArray(profile.coupons) ? profile.coupons : [];
  normalized.couponHistory = Array.isArray(profile.couponHistory) ? profile.couponHistory : [];
  normalized.paymentHistory = Array.isArray(profile.paymentHistory) ? profile.paymentHistory : [];
  normalized.accesses = Array.isArray(profile.accesses) ? profile.accesses : [];
  normalized.roleHistory = Array.isArray(profile.roleHistory) ? profile.roleHistory : [];
  normalized.resetHistory = Array.isArray(profile.resetHistory) ? profile.resetHistory : [];
  normalized.staffActions = Array.isArray(profile.staffActions) ? profile.staffActions : [];
  normalized.accounts ??= {};
  return normalized;
}

function normalizeGuildConfig(config = {}) {
  const defaults = createDefaultGuildConfig();
  const profiles = Object.fromEntries(
    Object.entries(config.profiles ?? defaults.profiles).map(([id, profile]) => [id, normalizeProfile(profile)]),
  );
  if (!profiles[defaults.activeProfileId]) profiles[defaults.activeProfileId] = createDefaultProfile();
  return {
    ...defaults,
    ...config,
    profiles,
  };
}

class ConfigStore {
  constructor(filePath = DEFAULT_CONFIG_PATH) {
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async readAll() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async getGuild(guildId) {
    const data = await this.readAll();
    return structuredClone(normalizeGuildConfig(data[guildId]));
  }

  async listGuildIds() {
    return Object.keys(await this.readAll());
  }

  async getActiveProfile(guildId) {
    const guildConfig = await this.getGuild(guildId);
    const profile = guildConfig.profiles[guildConfig.activeProfileId];
    if (!profile) throw new Error('O perfil ativo não existe.');
    return profile;
  }

  async updateGuild(guildId, update) {
    const operation = this.writeQueue.then(async () => {
      const data = await this.readAll();
      const guildConfig = normalizeGuildConfig(data[guildId]);

      await update(guildConfig);
      data[guildId] = guildConfig;

      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(temporaryPath, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(temporaryPath, this.filePath);

      return structuredClone(guildConfig);
    });

    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async updateActiveProfile(guildId, update) {
    return this.updateGuild(guildId, (guildConfig) => {
      const profile = guildConfig.profiles[guildConfig.activeProfileId];
      if (!profile) throw new Error('O perfil ativo não existe.');
      update(profile);
    });
  }
}

module.exports = {
  ConfigStore,
};