const SERVER_CHANNELS = Object.freeze({
  aiHelp: { name: 'Ajuda IA', emoji: '💬' },
  nightExpansion: { name: 'Expansão Noturna', emoji: '🌙' },
  tasks: { name: 'Tarefas', emoji: '📋' },
  general: { name: 'Geral', emoji: '💬' },
  commands: { name: 'Comandos', emoji: '🧭' },
  handouts: { name: 'Apostilas', emoji: '📚' },
  essays: { name: 'Redação', emoji: '📝' },
  speak: { name: 'SPEAK', emoji: '🎤' },
  matific: { name: 'Matific', emoji: '🧮' },
  khanAcademy: { name: 'Khan Academy', emoji: '📖' },
  reportCard: { name: 'Boletim', emoji: '📊' },
  professionalEducation: { name: 'Educação Profissional', emoji: '💼' },
  preparaSp: { name: 'Prepara SP', emoji: '📘' },
  alura: { name: 'Alura', emoji: '💻' },
  openEnglish: { name: 'Open English', emoji: '🇬🇧' },
  leia: { name: 'Leia', emoji: '📖' },
  media: { name: 'Mídia', emoji: '🖼️' },
});

const EMBED_COLORS = Object.freeze({
  primary: 0xffffff,
});

const DEFAULT_PROFILE = {
  name: 'SPEAK',
  general: {
    serviceName: 'SPEAK',
    supportMessage: '',
    prefix: '!cone',
    channelIds: Object.fromEntries(Object.keys(SERVER_CHANNELS).map((key) => [key, ''])),
    customChannels: [],
  },
  panel: {
    title: 'SPEAK',
    description: '',
    information: '',
    price: '',
    buttonLabel: 'Gerar pagamento',
    buttonEmoji: '💳',
    supportButtonLabel: 'Dúvidas/Suporte',
    loginButtonLabel: 'Login',
    resetButtonLabel: 'Reset',
    color: '#FFFFFF',
    imageUrl: '',
    thumbnailUrl: '',
    bannerUrl: '',
    channelId: '',
    messageId: '',
  },
  emojis: {
    payment: '', coupon: '', support: '', login: '', reset: '',
  },
  announcements: {
    title: 'SPEAK', imageUrl: '', color: '#FFFFFF', footer: '', emoji: '',
  },
  promotions: {
    title: 'SPEAK · Promoção', imageUrl: '', color: '#FFFFFF', footer: '',
  },
  payment: {
    price: '',
    chargeName: 'SPEAK',
    description: '',
    expirationMinutes: '',
    approvedBehavior: 'ticket',
  },
  ticket: {
    enabled: true,
    categoryId: '',
    panelChannelId: '',
    panelMessageId: '',
    panelTitle: '🎫 Central de Atendimento',
    panelDescription: 'Precisa de ajuda? Abra um ticket e nossa equipe irá atender você.',
    panelImageUrl: '',
    panelThumbnailUrl: '',
    panelColor: '#FFFFFF',
    panelButtonLabel: 'Abrir Ticket',
    panelButtonEmoji: '🎫',
    logsChannelId: '',
    transcriptsChannelId: '',
    ratingsChannelId: '',
    ratingsEnabled: false,
    transcriptsEnabled: false,
    callsEnabled: true,
    preventDuplicates: true,
    deleteAfterClose: false,
    namePrefix: 'cone',
    initialMessage: '🎫 Central de Atendimento',
    closingMessage: 'Este ticket foi fechado pela equipe.',
    closeButtonLabel: 'Fechar',
    records: [],
    staffRoleIds: [],
    callCooldowns: {},
    ratings: [],
  },
  speakRoleId: '',
  ai: {
    enabled: false,
    freeMode: false,
    emojisEnabled: true,
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'z-ai/glm-5.3',
    channelId: '',
    allowedChannels: [],
    fallbackMessage: 'Amigo, não sei responder isso KKK 😭 Procure a equipe responsável pelo atendimento.',
    instructions: '',
    knowledge: '',
  },
  workspace: {
    name: 'SPEAK Workspace',
    script: '',
    language: 'typescript',
    files: [],
  },
  permissions: {
    userIds: [],
    roleIds: [],
    areas: {
      general: { userIds: [], roleIds: [] },
      channels: { userIds: [], roleIds: [] },
      panel: { userIds: [], roleIds: [] },
      payments: { userIds: [], roleIds: [] },
      coupons: { userIds: [], roleIds: [] },
      plans: { userIds: [], roleIds: [] },
      tickets: { userIds: [], roleIds: [] },
      speakRole: { userIds: [], roleIds: [] },
      ai: { userIds: [], roleIds: [] },
      sales: { userIds: [], roleIds: [] },
      announcements: { userIds: [], roleIds: [] },
      promotions: { userIds: [], roleIds: [] },
      logs: { userIds: [], roleIds: [] },
      permissions: { userIds: [], roleIds: [] },
      system: { userIds: [], roleIds: [] },
    },
  },
  plans: [],
  coupons: [],
  couponHistory: [],
  paymentHistory: [],
  accesses: [],
  roleHistory: [],
  resetHistory: [],
  staffActions: [],
  admin: {
    logChannelId: '',
    pendingActions: {},
  },
  security: {
    logChannelId: '',
    antiRaid: {
      enabled: false,
      memberLimit: 5,
      intervalSeconds: 10,
      action: 'alert',
    },
    antiSpam: {
      enabled: false,
      messages: 5,
      intervalSeconds: 5,
      action: 'warn',
    },
    antiFlood: {
      enabled: false,
      threshold: 5,
      intervalSeconds: 3,
      action: 'warn',
      message: '<@USER_ID> Para de flood, isso pode resultar em punição.',
    },
    antiLink: {
      enabled: false,
      allowedDomains: [],
      ignoredChannels: [],
      ignoredRoles: [],
      action: 'delete',
    },
    antiInvite: {
      enabled: false,
      ignoredChannels: [],
      ignoredRoles: [],
      action: 'delete',
    },
    antiBot: {
      enabled: false,
      action: 'log',
    },
    mentionProtection: {
      enabled: false,
      limit: 5,
      action: 'delete',
      ignoredChannels: [],
      ignoredRoles: [],
    },
    blockedWords: {
      enabled: false,
      words: [],
    },
    lockdown: {
      enabled: false,
      channelIds: [],
    },
  },
  accounts: {},
};

function createDefaultProfile() {
  return structuredClone(DEFAULT_PROFILE);
}

function createDefaultGuildConfig() {
  return {
    activeProfileId: 'speak',
    profiles: {
      speak: createDefaultProfile(),
    },
  };
}

function getConfiguredChannel(profile, key) {
  const channel = SERVER_CHANNELS[key];
  const id = profile?.general?.channelIds?.[key];
  return channel && id ? { ...channel, id } : null;
}

module.exports = {
  EMBED_COLORS,
  SERVER_CHANNELS,
  createDefaultGuildConfig,
  createDefaultProfile,
  getConfiguredChannel,
};