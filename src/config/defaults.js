const SERVER_CHANNELS = Object.freeze({
  aiHelp: { id: '1536216193621430384', name: 'Ajuda IA', emoji: '💬' },
  nightExpansion: { id: '1536216161291866223', name: 'Expansão Noturna', emoji: '🌙' },
  tasks: { id: '1549732420507406346', name: 'Tarefas', emoji: '📋' },
  general: { id: '1536216132162424912', name: 'Geral', emoji: '💬' },
  commands: { id: '1536216147421167636', name: 'Comandos', emoji: '🧭' },
  handouts: { id: '1536216187241889832', name: 'Apostilas', emoji: '📚' },
  essays: { id: '1536216158389145632', name: 'Redação', emoji: '📝' },
  speak: { id: '1536216154744291379', name: 'SPEAK', emoji: '🎤' },
  matific: { id: '1536216176089243668', name: 'Matific', emoji: '🧮' },
  khanAcademy: { id: '1536216163959185499', name: 'Khan Academy', emoji: '📖' },
  reportCard: { id: '1545518119580074104', name: 'Boletim', emoji: '📊' },
  professionalEducation: { id: '1536216170393509971', name: 'Educação Profissional', emoji: '💼' },
  preparaSp: { id: '1536216173266346044', name: 'Prepara SP', emoji: '📘' },
  alura: { id: '1536470011558760508', name: 'Alura', emoji: '💻' },
  openEnglish: { id: '1536470082983821424', name: 'Open English', emoji: '🇬🇧' },
  leia: { id: '1538240309132009623', name: 'Leia', emoji: '📖' },
  media: { id: '1536216135173939231', name: 'Mídia', emoji: '🖼️' },
});

const EMBED_COLORS = Object.freeze({
  primary: 0xffffff,
});

const DEFAULT_PROFILE = {
  name: 'SPEAK',
  general: {
    serviceName: 'SPEAK',
    supportMessage: '',
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
    namePrefix: 'shu',
    initialMessage: '🎫 Central de Atendimento',
    closingMessage: 'Este ticket foi fechado pela equipe.',
    closeButtonLabel: 'Fechar',
    staffRoleIds: ['1536253284309008445'],
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
    fallbackMessage: `Amigo, não sei responder isso KKK 😭 Vai no <#${SERVER_CHANNELS.aiHelp.id}> que eles te salvam.`,
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

module.exports = {
  EMBED_COLORS,
  SERVER_CHANNELS,
  createDefaultGuildConfig,
  createDefaultProfile,
};