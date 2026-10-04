const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { randomUUID } = require('node:crypto');

const { ConfigStore } = require('./database/configStore');
const { EMBED_COLORS, SERVER_CHANNELS } = require('./config/defaults');
const { dispatchSpeakText, getChannelsMessage, getLocationReply } = require('./speakCommandService');
const { AccessService } = require('./accessService');
const { getFallback } = require('./aiService');
const { isSensitivePrompt } = require('./aiService');
const { answerSpeakMessage } = require('./conversationService');
const { couponMenu, handleCouponComponent, handleCouponModal } = require('./couponService');
const {
  canAccessAdminArea,
  canAccessAnyAdminArea,
  canConfigure,
  canManageSpeak,
  STAFF_DENIED_MESSAGE,
  isIsekayUser,
  isSpeakStaff,
} = require('./permissions');
const {
  buildPlanMenu,
  handleAdminComponent,
  handleAdminModal,
  handleAdminSlashCommand,
  handleHistoryComponent,
  showUserHistory,
} = require('./adminService');
const { PaymentService } = require('./paymentService');
const { ZPayProvider } = require('./zPayProvider');

const configStore = new ConfigStore();
const accessService = new AccessService(configStore);
const paymentService = new PaymentService(new ZPayProvider(), configStore);
const pendingWorkspaceUploads = new Map();
const pendingWorkspaceArchives = new Map();
const WORKSPACE_UPLOAD_TTL = 15 * 60 * 1000;
const MAX_WORKSPACE_ARCHIVE_SIZE = 8 * 1024 * 1024;
const CONFIG_SECTIONS = [
  ['general', '📦 Geral'],
  ['channels', '📍 Canais do servidor'],
  ['prefix', '⌨️ Prefixo'],
  ['links', '🔗 Vínculos'],
  ['owner', '👑 Painel ADM'],
  ['panel', '🎨 Painel'],
  ['payment', '💳 Pagamentos'],
  ['coupons', '🎟️ Cupons'],
  ['plans', '📦 Planos'],
  ['ticket', '🎫 Tickets'],
  ['logs', '📊 Logs'],
  ['speakRole', '🎤 Cargo SPEAK'],
  ['ai', '🤖 IA'],
  ['phrases', '💤 Falas'],
  ['workspace', 'SPEAK'],
  ['announcements', '📢 Anúncios'],
  ['promotions', '🎉 Promoções'],
  ['permissions', '🔐 Permissões'],
  ['security', '🛡️ Segurança'],
  ['system', '📁 Sistema/Dados'],
];

const CHANNEL_GROUPS = [
  ['platforms', 'Plataformas', ['speak', 'matific', 'khanAcademy', 'professionalEducation', 'preparaSp']],
  ['resources', 'Materiais', ['alura', 'openEnglish', 'leia', 'handouts', 'essays']],
  ['support', 'Apoio', ['reportCard', 'tasks', 'nightExpansion', 'aiHelp', 'general']],
  ['community', 'Comunidade', ['media', 'commands']],
];

const PERMISSION_AREAS = [
  ['general', 'Geral'], ['channels', 'Canais do servidor'], ['panel', 'Painel'], ['payments', 'Pagamentos'], ['coupons', 'Cupons'],
  ['plans', 'Planos'], ['tickets', 'Tickets'], ['logs', 'Logs'], ['speakRole', 'Cargo SPEAK'], ['ai', 'IA'], ['workspace', 'SPEAK'],
  ['announcements', 'Anúncios'], ['promotions', 'Promoções'], ['system', 'Configurações salvas'],
];

function configArea(section) {
  return ({ payment: 'payments', ticket: 'tickets', phrases: 'ai', prefix: 'general', links: 'general' })[section] || section;
}

function ephemeral() {
  return { flags: 64 };
}

function button(customId, label, emoji, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style);
}

function ticketConfigControls(profile) {
  return [
    new ActionRowBuilder().addComponents(
      button('speak:config:tickets:edit:panel', 'Editar Painel', '🎨'),
      button('speak:config:tickets:edit:category', 'Categoria', '📁'),
      button('speak:config:tickets:edit:staff', 'Cargo Staff', '👥'),
      button('speak:config:tickets:edit:logs', 'Logs', '📊'),
      button('speak:config:tickets:edit:transcripts', 'Transcript', '📄'),
    ),
    new ActionRowBuilder().addComponents(
      button('speak:config:tickets:edit:ratings', 'Avaliações', '⭐'),
      button('speak:config:tickets:edit:calls', 'Chamadas', '📞'),
      button('speak:config:tickets:edit:button', 'Botão', '🔘'),
      button('speak:config:tickets:launch', 'Lançar Painel', '📢'),
      button('speak:config:tickets:test', 'Testar', '🔄'),
    ),
    new ActionRowBuilder().addComponents(
      button('speak:config:tickets:edit:message', 'Mensagens', '💬'),
      button('speak:config:tickets:edit:identity', 'Identidade', '🏷️'),
      button('speak:config:tickets:enabled:true', 'Ativar', '🟢', profile.ticket.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      button('speak:config:tickets:enabled:false', 'Desativar', '🔴', profile.ticket.enabled ? ButtonStyle.Secondary : ButtonStyle.Danger),
    ),
  ];
}

function ticketConfigModal(profile, action) {
  const ticket = profile.ticket;
  const fields = {
    panel: [
      textField('panelTitle', 'Título do painel', ticket.panelTitle, TextInputStyle.Short, true),
      textField('panelDescription', 'Descrição do painel', ticket.panelDescription, TextInputStyle.Paragraph, true),
      textField('panelImageUrl', 'Imagem HTTPS (opcional)', ticket.panelImageUrl),
      textField('panelThumbnailUrl', 'Thumbnail HTTPS (opcional)', ticket.panelThumbnailUrl),
      textField('panelColor', 'Cor hexadecimal', ticket.panelColor || '#FFFFFF'),
    ],
    category: [textField('categoryId', 'ID da categoria', ticket.categoryId)],
    staff: [textField('staffRoleIds', 'IDs dos cargos Staff (vírgula)', joinIds(ticket.staffRoleIds))],
    logs: [
      textField('panelChannelId', 'Canal do painel (ID)', ticket.panelChannelId),
      textField('logsChannelId', 'Canal de logs (ID)', ticket.logsChannelId),
      textField('transcriptsChannelId', 'Canal de transcripts (ID)', ticket.transcriptsChannelId),
      textField('ratingsChannelId', 'Canal de avaliações (ID)', ticket.ratingsChannelId),
    ],
    transcripts: [
      textField('transcriptsEnabled', 'Transcript ativo (true/false)', String(ticket.transcriptsEnabled)),
      textField('transcriptsChannelId', 'Canal de transcripts (ID)', ticket.transcriptsChannelId),
    ],
    ratings: [
      textField('ratingsEnabled', 'Avaliações ativas (true/false)', String(ticket.ratingsEnabled)),
      textField('ratingsChannelId', 'Canal de avaliações (ID)', ticket.ratingsChannelId),
    ],
    calls: [
      textField('callsEnabled', 'Chamadas ativas (true/false)', String(ticket.callsEnabled)),
      textField('preventDuplicates', 'Evitar tickets duplicados (true/false)', String(ticket.preventDuplicates)),
    ],
    button: [
      textField('panelButtonLabel', 'Nome do botão', ticket.panelButtonLabel),
      textField('panelButtonEmoji', 'Emoji do botão', ticket.panelButtonEmoji),
    ],
    message: [
      textField('initialMessage', 'Mensagem inicial', ticket.initialMessage, TextInputStyle.Paragraph),
      textField('closingMessage', 'Mensagem ao fechar', ticket.closingMessage, TextInputStyle.Paragraph),
    ],
    identity: [
      textField('namePrefix', 'Prefixo do nome do ticket', ticket.namePrefix),
      textField('closeButtonLabel', 'Texto do botão de fechamento', ticket.closeButtonLabel),
    ],
  }[action] || [];
  return new ModalBuilder()
    .setCustomId(`speak:config:tickets:save:${action}`)
    .setTitle(`Tickets · ${action}`.slice(0, 45))
    .addComponents(fields.map((field) => new ActionRowBuilder().addComponents(field)));
}

function ticketPanelPayload(profile) {
  const ticket = profile.ticket;
  const embed = new EmbedBuilder()
    .setColor(ticket.panelColor || EMBED_COLORS.primary)
    .setTitle(ticket.panelTitle)
    .setDescription(ticket.panelDescription);
  if (ticket.panelImageUrl) embed.setImage(ticket.panelImageUrl);
  if (ticket.panelThumbnailUrl) embed.setThumbnail(ticket.panelThumbnailUrl);
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      button('speak:ticket:open', ticket.panelButtonLabel, configuredEmoji(ticket.panelButtonEmoji, '🎫')),
    )],
  };
}

function aiToggleControls(profile) {
  return [
    new ActionRowBuilder().addComponents(
      button('speak:config:ai:enabled:true', 'IA ON', '🟢', profile.ai.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      button('speak:config:ai:enabled:false', 'IA OFF', '🔴', profile.ai.enabled ? ButtonStyle.Secondary : ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      button('speak:config:ai:emojisEnabled:true', 'Emojis ON', '🟢', profile.ai.emojisEnabled !== false ? ButtonStyle.Success : ButtonStyle.Secondary),
      button('speak:config:ai:emojisEnabled:false', 'Emojis OFF', '🔴', profile.ai.emojisEnabled === false ? ButtonStyle.Danger : ButtonStyle.Secondary),
    ),
  ];
}

function configuredEmoji(value, fallback) {
  const custom = String(value ?? '').match(/^<(a?):([A-Za-z0-9_]+):(\d+)>$/);
  if (custom) return { id: custom[3], name: custom[2], animated: custom[1] === 'a' };
  return value || fallback;
}

function hasStaffRole(member, roleIds) {
  const roles = member?.roles?.cache;
  return Boolean(roles?.some?.((role) => roleIds.includes(role.id))
    || roleIds.some((roleId) => roles?.has?.(roleId)));
}

function isAiChannelAllowed(interaction, profile) {
  const allowedChannelId = profile.ai.channelId || profile.general.channelIds.aiHelp || profile.ticket.categoryId;
  return Boolean(allowedChannelId && (interaction.channelId === allowedChannelId || interaction.channel?.parentId === allowedChannelId));
}

function configMenu(userId) {
  const sections = isIsekayUser(userId) ? CONFIG_SECTIONS : CONFIG_SECTIONS.filter(([value]) => value !== 'owner');
  const select = new StringSelectMenuBuilder()
    .setCustomId('speak:config:section')
    .setPlaceholder('Escolha uma área para configurar')
    .addOptions(sections.map(([value, label]) => ({ label, value })));
  return [new ActionRowBuilder().addComponents(select)];
}

function permissionsAreaMenu() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('speak:config:permissions:area')
    .setPlaceholder('Escolha uma área para autorizar')
    .addOptions(PERMISSION_AREAS.map(([value, label]) => ({ label, value })));
  return [new ActionRowBuilder().addComponents(select)];
}

function subMenu(section) {
  const choices = section === 'channels'
    ? CHANNEL_GROUPS.map(([value, label]) => [value, label])
    : section === 'panel'
    ? [['content', 'Conteúdo'], ['appearance', 'Imagens e canal'], ['labels', 'Textos dos botões']]
    : section === 'ticket'
      ? [['settings', 'Configurações'], ['identity', 'Nome e fechamento']]
    : section === 'ai'
      ? [['settings', 'Controles da IA'], ['knowledge', 'Base confiável']]
      : section === 'payment'
        ? [['settings', 'Configuração'], ['provider', 'Status Z.PAY']]
      : section === 'plans'
        ? [['manage', 'Criar ou editar planos']]
      : section === 'workspace'
        ? [['script', 'Workspace / Scripts'], ['files', 'Arquivos salvos']]
        : [['settings', 'Configurações do ticket'], ['identity', 'Nome e fechamento']];
  const select = new StringSelectMenuBuilder()
    .setCustomId(`speak:config:sub:${section}`)
    .setPlaceholder('Escolha o que deseja editar')
    .addOptions(choices.map(([value, label]) => ({ label, value })));
  return [new ActionRowBuilder().addComponents(select)];
}

function textField(id, label, value, style = TextInputStyle.Short, required = false) {
  const field = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required);
  if (value) field.setValue(String(value).slice(0, style === TextInputStyle.Paragraph ? 4000 : 100));
  return field;
}

function joinIds(value) {
  return Array.isArray(value) ? value.join(', ') : '';
}

function modalFields(profile, section, subsection) {
  if (section === 'prefix') return [
    textField('prefix', 'Prefixo (deve começar com !)', profile.general.prefix || '!cone', TextInputStyle.Short, true),
  ];
  if (section === 'channels') {
    const group = CHANNEL_GROUPS.find(([value]) => value === subsection);
    return (group?.[2] || []).map((key) => textField(
      `channel_${key}`,
      `${SERVER_CHANNELS[key].name} (ID)`,
      profile.general.channelIds[key],
    ));
  }
  if (section === 'general') return [
    textField('panelChannelId', 'Canal do painel (ID)', profile.panel.channelId),
    textField('speakRoleId', 'Cargo SPEAK (ID)', profile.speakRoleId),
    textField('permissionUsers', 'IDs de usuários (vírgula)', joinIds(profile.permissions.userIds)),
    textField('permissionRoles', 'IDs de cargos (vírgula)', joinIds(profile.permissions.roleIds)),
    textField('adminLogChannelId', 'Canal de logs admin (ID)', profile.admin.logChannelId),
  ];
  if (section === 'logs') return [
    textField('adminLogChannelId', 'Canal de logs administrativos (ID)', profile.admin.logChannelId),
    textField('logsChannelId', 'Canal de logs de tickets (ID)', profile.ticket.logsChannelId),
  ];
  if (section === 'phrases') return [
    textField('fallbackMessage', 'IA não soube responder', profile.ai.fallbackMessage, TextInputStyle.Paragraph, true),
  ];
  if (section === 'panel' && subsection === 'content') return [
    textField('title', 'Título', profile.panel.title, TextInputStyle.Short, true),
    textField('description', 'Descrição', profile.panel.description, TextInputStyle.Paragraph),
    textField('information', 'Informações adicionais', profile.panel.information, TextInputStyle.Paragraph),
    textField('price', 'Preço exibido', profile.panel.price),
  ];
  if (section === 'panel' && subsection === 'appearance') return [
    textField('imageUrl', 'Imagem (URL HTTPS)', profile.panel.imageUrl),
    textField('thumbnailUrl', 'Thumbnail (URL HTTPS)', profile.panel.thumbnailUrl),
    textField('bannerUrl', 'GIF/banner (URL HTTPS)', profile.panel.bannerUrl),
    textField('panelChannelId', 'Canal padrão do painel (ID)', profile.panel.channelId),
  ];
  if (section === 'panel' && subsection === 'labels') return [
    textField('paymentButtonLabel', 'Texto do botão de pagamento', profile.panel.buttonLabel),
    textField('supportButtonLabel', 'Texto do botão de suporte', profile.panel.supportButtonLabel),
    textField('loginButtonLabel', 'Texto do botão Login', profile.panel.loginButtonLabel),
    textField('resetButtonLabel', 'Texto do botão Reset', profile.panel.resetButtonLabel),
  ];
  if (section === 'payment') return [
    textField('price', 'Preço', profile.payment.price),
    textField('chargeName', 'Nome da cobrança', profile.payment.chargeName),
    textField('description', 'Descrição', profile.payment.description, TextInputStyle.Paragraph),
    textField('expirationMinutes', 'Expiração em minutos', profile.payment.expirationMinutes),
    textField('approvedBehavior', 'Ação após confirmação', profile.payment.approvedBehavior),
  ];
  if (section === 'ticket' && subsection === 'settings') return [
    textField('categoryId', 'Categoria dos tickets (ID)', profile.ticket.categoryId),
    textField('logsChannelId', 'Canal de logs (ID)', profile.ticket.logsChannelId),
    textField('staffRoleIds', 'IDs de cargos (vírgula)', joinIds(profile.ticket.staffRoleIds)),
    textField('initialMessage', 'Mensagem inicial', profile.ticket.initialMessage, TextInputStyle.Paragraph),
  ];
  if (section === 'ticket' && subsection === 'identity') return [
    textField('namePrefix', 'Prefixo do nome do ticket', profile.ticket.namePrefix),
    textField('closeButtonLabel', 'Texto do botão de fechamento', profile.ticket.closeButtonLabel),
  ];
  if (section === 'speakRole') return [
    textField('roleId', 'Cargo SPEAK (ID)', profile.speakRoleId),
  ];
  if (section === 'ai' && subsection === 'knowledge') return [
    textField('knowledge', 'Base confiável SPEAK', profile.ai.knowledge, TextInputStyle.Paragraph),
  ];
  if (section === 'ai') return [
    textField('enabled', 'IA habilitada (true/false)', String(profile.ai.enabled)),
    textField('freeMode', 'Conversa livre (true/false)', String(profile.ai.freeMode)),
    textField('emojisEnabled', 'Emojis da IA (true/false)', String(profile.ai.emojisEnabled !== false)),
    textField('channelId', 'Canal/categoria permitida (ID)', profile.ai.channelId),
    textField('allowedChannels', 'Canais permitidos (IDs, vírgula)', joinIds(profile.ai.allowedChannels)),
    textField('model', 'Modelo NVIDIA NIM', profile.ai.model),
    textField('instructions', 'Instruções de estilo SPEAK', profile.ai.instructions, TextInputStyle.Paragraph),
  ];
  if (section === 'workspace') return [
    textField('workspaceName', 'Nome do workspace SPEAK', profile.workspace?.name || 'SPEAK Workspace'),
    textField('workspaceLanguage', 'Linguagem / stack', profile.workspace?.language || 'typescript'),
    textField('workspaceCode', 'Código / script / projeto', profile.workspace?.script || profile.workspace?.code || '', TextInputStyle.Paragraph),
  ];
  if (section === 'announcements') return [
    textField('title', 'Título do anúncio', profile.announcements.title),
    textField('imageUrl', 'Imagem/GIF HTTPS (opcional)', profile.announcements.imageUrl),
    textField('emoji', 'Emoji Unicode/customizado', profile.announcements.emoji),
    textField('footer', 'Rodapé', profile.announcements.footer),
  ];
  if (section === 'promotions') return [
    textField('title', 'Título da promoção', profile.promotions.title),
    textField('imageUrl', 'Imagem/GIF HTTPS (opcional)', profile.promotions.imageUrl),
    textField('footer', 'Rodapé', profile.promotions.footer),
  ];
  if (section === 'security') return [
    textField('securityEnabled', 'Proteção geral (true/false)', String(profile.security?.antiRaid?.enabled || profile.security?.antiSpam?.enabled || profile.security?.lockdown?.enabled || false)),
    textField('raidEnabled', 'Anti-Raid ativo (true/false)', String(profile.security?.antiRaid?.enabled ?? false)),
    textField('spamEnabled', 'Anti-Spam ativo (true/false)', String(profile.security?.antiSpam?.enabled ?? false)),
    textField('floodEnabled', 'Anti-Flood ativo (true/false)', String(profile.security?.antiFlood?.enabled ?? false)),
    textField('linkEnabled', 'Anti-Link ativo (true/false)', String(profile.security?.antiLink?.enabled ?? false)),
    textField('inviteEnabled', 'Anti-Invite ativo (true/false)', String(profile.security?.antiInvite?.enabled ?? false)),
    textField('botEnabled', 'Anti-Bot ativo (true/false)', String(profile.security?.antiBot?.enabled ?? false)),
    textField('mentionEnabled', 'Proteção de menções (true/false)', String(profile.security?.mentionProtection?.enabled ?? false)),
    textField('lockdownEnabled', 'Lockdown ativo (true/false)', String(profile.security?.lockdown?.enabled ?? false)),
    textField('logChannelId', 'Canal de logs de segurança (ID)', profile.security?.logChannelId || profile.admin?.logChannelId || ''),
  ];
  if (section === 'system') return [
    textField('payment', 'Emoji pagamento (unicode/custom)', profile.emojis.payment),
    textField('coupon', 'Emoji cupom (unicode/custom)', profile.emojis.coupon),
    textField('support', 'Emoji suporte (unicode/custom)', profile.emojis.support),
    textField('login', 'Emoji login (unicode/custom)', profile.emojis.login),
    textField('reset', 'Emoji reset (unicode/custom)', profile.emojis.reset),
  ];
  if (section === 'permissions') {
    const area = profile.permissions.areas[subsection] ?? { userIds: [], roleIds: [] };
    return [
      textField('userIds', 'IDs de usuários (vírgula)', joinIds(area.userIds)),
      textField('roleIds', 'IDs de cargos (vírgula)', joinIds(area.roleIds)),
    ];
  }
  return [
    textField('userIds', 'IDs de usuários (vírgula)', joinIds(profile.permissions.userIds)),
    textField('roleIds', 'IDs de cargos (vírgula)', joinIds(profile.permissions.roleIds)),
  ];
}

async function showConfigModal(interaction, profile, section, subsection = 'settings') {
  if (section === 'owner') {
    const modal = new ModalBuilder()
      .setCustomId('speak:config:save:owner:console').setTitle('Painel ADM Isekay')
      .addComponents(
        new ActionRowBuilder().addComponents(
          textField('ownerCommand', 'Comando ADM', '!cone ver 123456789', TextInputStyle.Paragraph, true),
        ),
      );
    await interaction.showModal(modal);
    return;
  }
  if (section === 'permissions' && subsection === 'settings') {
    await interaction.update({ content: 'Permissões por área', components: permissionsAreaMenu() });
    return;
  }
  if (section === 'coupons') {
    await interaction.update({ content: 'Gestão de cupons', components: couponMenu(profile) });
    return;
  }
  if (section === 'sales' || section === 'system') {
    const embed = new EmbedBuilder().setTitle(section === 'sales' ? 'Vendas SPEAK' : 'Dados e sistema SPEAK')
      .setColor(EMBED_COLORS.primary)
      .setDescription(section === 'sales'
        ? `Pagamentos registrados: ${profile.paymentHistory.length}\nAprovados: ${profile.paymentHistory.filter((payment) => payment.status === 'PAID').length}\nPendentes: ${profile.paymentHistory.filter((payment) => payment.status === 'PENDING').length}\nCupons: ${profile.coupons.length}`
        : `Planos: ${profile.plans.length}\nCupons: ${profile.coupons.length}\nAcessos: ${profile.accesses.length}\nHistórico Staff: ${profile.staffActions.length}`);
    await interaction.update({ content: '', embeds: [embed], components: [] });
    return;
  }
  const fields = modalFields(profile, section, subsection);
  const modal = new ModalBuilder()
    .setCustomId(`speak:config:save:${section}:${subsection}`)
    .setTitle(`Configuração: ${CONFIG_SECTIONS.find(([key]) => key === section)?.[1] ?? section}`)
    .addComponents(fields.map((field) => new ActionRowBuilder().addComponents(field)));
  await interaction.showModal(modal);
}

function parseIds(value) {
  const ids = value.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.some((id) => !/^\d{17,20}$/.test(id))) throw new Error('IDs inválidos. Use IDs do Discord separados por vírgula.');
  return [...new Set(ids)];
}

function parseOptionalId(value) {
  const id = value.trim();
  if (id && !/^\d{17,20}$/.test(id)) throw new Error('ID inválido. Informe um ID do Discord ou deixe vazio.');
  return id;
}

function parseUrl(value) {
  if (!value.trim()) return '';
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Informe uma URL válida usando HTTPS.');
  }
  if (url.protocol !== 'https:') throw new Error('As URLs de imagem precisam usar HTTPS.');
  return url.toString();
}

async function saveConfig(interaction, section, subsection, store) {
  const values = Object.fromEntries(interaction.fields.fields.map((field) => [field.customId, field.value.trim()]));
  const optionalIdFields = ['panelChannelId', 'speakRoleId', 'categoryId', 'logsChannelId', 'roleId', 'channelId', 'adminLogChannelId'];
  for (const key of optionalIdFields) if (key in values) values[key] = parseOptionalId(values[key]);
  for (const key of Object.keys(values).filter((field) => field.startsWith('channel_'))) {
    values[key] = parseOptionalId(values[key]);
  }
  if (values.prefix && !/^![^\s!][^\s]{0,14}$/.test(values.prefix)) {
    throw new Error('O prefixo deve começar com ! e ter de 2 a 16 caracteres sem espaços.');
  }
  for (const key of ['permissionUsers', 'permissionRoles', 'staffRoleIds', 'userIds', 'roleIds', 'allowedChannels']) {
    if (key in values) values[key] = parseIds(values[key]);
  }
  for (const key of ['imageUrl', 'thumbnailUrl', 'bannerUrl']) {
    if (key in values) values[key] = parseUrl(values[key]);
  }
  if (values.color && !/^#[\da-f]{6}$/i.test(values.color)) throw new Error('A cor deve estar no formato #RRGGBB.');
  for (const key of ['paymentButtonLabel', 'supportButtonLabel', 'loginButtonLabel', 'resetButtonLabel', 'closeButtonLabel']) {
    if (values[key] !== undefined && (!values[key] || values[key].length > 80)) {
      throw new Error('Os textos dos botões devem ter entre 1 e 80 caracteres.');
    }
  }
  if (values.title?.length > 256) throw new Error('O título do painel deve ter até 256 caracteres.');
  if (values.initialMessage?.length > 2000) throw new Error('A mensagem inicial deve ter até 2000 caracteres.');
  if (values.fallbackMessage && values.fallbackMessage.length > 1800) throw new Error('A fala de fallback deve ter até 1800 caracteres.');
  if (values.enabled && !['true', 'false'].includes(values.enabled.toLowerCase())) {
    throw new Error('IA habilitada deve ser true ou false.');
  }
  if (values.freeMode && !['true', 'false'].includes(values.freeMode.toLowerCase())) {
    throw new Error('Conversa livre deve ser true ou false.');
  }
  if (values.emojisEnabled && !['true', 'false'].includes(values.emojisEnabled.toLowerCase())) {
    throw new Error('Emojis da IA deve ser true ou false.');
  }

  await store.updateActiveProfile(interaction.guildId, (profile) => {
    if (section === 'channels') {
      for (const [key, value] of Object.entries(values)) {
        profile.general.channelIds[key.slice('channel_'.length)] = value;
      }
      return;
    }
    const mappings = {
      general: {
        panelChannelId: ['panel', 'channelId'],
        speakRoleId: ['root', 'speakRoleId'],
        permissionUsers: ['permissions', 'userIds'],
        permissionRoles: ['permissions', 'roleIds'],
        adminLogChannelId: ['admin', 'logChannelId'],
      },
      prefix: { prefix: ['general', 'prefix'] },
      logs: {
        adminLogChannelId: ['admin', 'logChannelId'],
        logsChannelId: ['ticket', 'logsChannelId'],
      },
      payment: Object.fromEntries(Object.keys(values).map((key) => [key, ['payment', key]])),
      speakRole: { roleId: ['root', 'speakRoleId'] },
      ai: {
        enabled: ['ai', 'enabled'], freeMode: ['ai', 'freeMode'], emojisEnabled: ['ai', 'emojisEnabled'],
        channelId: ['ai', 'channelId'], allowedChannels: ['ai', 'allowedChannels'], fallbackMessage: ['ai', 'fallbackMessage'],
        model: ['ai', 'model'], instructions: ['ai', 'instructions'], knowledge: ['ai', 'knowledge'],
      },
      phrases: { fallbackMessage: ['ai', 'fallbackMessage'] },
      workspace: {
        workspaceName: ['workspace', 'name'], workspaceLanguage: ['workspace', 'language'], workspaceCode: ['workspace', 'script'],
      },
      announcements: {
        title: ['announcements', 'title'], imageUrl: ['announcements', 'imageUrl'],
        color: ['announcements', 'color'], emoji: ['announcements', 'emoji'], footer: ['announcements', 'footer'],
      },
      promotions: {
        title: ['promotions', 'title'], imageUrl: ['promotions', 'imageUrl'],
        color: ['promotions', 'color'], footer: ['promotions', 'footer'],
      },
      security: {
        securityEnabled: ['security', 'enabled'],
        raidEnabled: ['security', 'antiRaid', 'enabled'],
        spamEnabled: ['security', 'antiSpam', 'enabled'],
        floodEnabled: ['security', 'antiFlood', 'enabled'],
        linkEnabled: ['security', 'antiLink', 'enabled'],
        inviteEnabled: ['security', 'antiInvite', 'enabled'],
        botEnabled: ['security', 'antiBot', 'enabled'],
        mentionEnabled: ['security', 'mentionProtection', 'enabled'],
        lockdownEnabled: ['security', 'lockdown', 'enabled'],
        logChannelId: ['security', 'logChannelId'],
      },
      system: Object.fromEntries(Object.keys(values).map((key) => [key, ['emojis', key]])),
      permissions: Object.fromEntries(Object.keys(values).map((key) => [key, ['permissions', 'areas', subsection, key]])),
      panel: {
        title: ['panel', 'title'], description: ['panel', 'description'], information: ['panel', 'information'],
        price: ['panel', 'price'], color: ['panel', 'color'], imageUrl: ['panel', 'imageUrl'],
        thumbnailUrl: ['panel', 'thumbnailUrl'], bannerUrl: ['panel', 'bannerUrl'],
        panelChannelId: ['panel', 'channelId'], paymentButtonLabel: ['panel', 'buttonLabel'],
        supportButtonLabel: ['panel', 'supportButtonLabel'], loginButtonLabel: ['panel', 'loginButtonLabel'],
        resetButtonLabel: ['panel', 'resetButtonLabel'],
      },
      ticket: {
        categoryId: ['ticket', 'categoryId'], logsChannelId: ['ticket', 'logsChannelId'],
        staffRoleIds: ['ticket', 'staffRoleIds'], initialMessage: ['ticket', 'initialMessage'],
        namePrefix: ['ticket', 'namePrefix'], closeButtonLabel: ['ticket', 'closeButtonLabel'],
      },
    };
    for (const [key, value] of Object.entries(values)) {
      const destination = mappings[section]?.[key];
      if (!destination) continue;
      if (destination[0] === 'root') profile[destination[1]] = value;
      else if (section === 'logs' || section === 'phrases') profile[destination[0]][destination[1]] = value;
      else if (section === 'permissions') {
        profile.permissions.areas[subsection] ??= { userIds: [], roleIds: [] };
        profile.permissions.areas[subsection][key] = value;
      } else if (section === 'ai') {
        const normalized = value.toLowerCase() === 'true';
        if (key === 'enabled') profile.ai.enabled = normalized;
        else if (key === 'freeMode') profile.ai.freeMode = normalized;
        else if (key === 'emojisEnabled') profile.ai.emojisEnabled = normalized;
        else if (key === 'allowedChannels') profile.ai.allowedChannels = Array.isArray(value) ? value : value.split(',').map((part) => part.trim()).filter(Boolean);
        else profile.ai[destination[1]] = value;
      } else if (section === 'workspace') {
        profile.workspace ??= { name: 'SPEAK Workspace', language: 'typescript', script: '', files: [] };
        if (key === 'workspaceName') profile.workspace.name = value;
        else if (key === 'workspaceLanguage') profile.workspace.language = value || 'typescript';
        else if (key === 'workspaceCode') profile.workspace.script = value;
      } else if (section === 'security') {
        profile.security ??= {};
        if (key === 'logChannelId') {
          profile.security.logChannelId = value;
        } else if (key === 'raidEnabled') {
          profile.security.antiRaid ??= {};
          profile.security.antiRaid.enabled = value.toLowerCase() === 'true';
        } else if (key === 'spamEnabled') {
          profile.security.antiSpam ??= {};
          profile.security.antiSpam.enabled = value.toLowerCase() === 'true';
        } else if (key === 'floodEnabled') {
          profile.security.antiFlood ??= {};
          profile.security.antiFlood.enabled = value.toLowerCase() === 'true';
        } else if (key === 'linkEnabled') {
          profile.security.antiLink ??= {};
          profile.security.antiLink.enabled = value.toLowerCase() === 'true';
        } else if (key === 'inviteEnabled') {
          profile.security.antiInvite ??= {};
          profile.security.antiInvite.enabled = value.toLowerCase() === 'true';
        } else if (key === 'botEnabled') {
          profile.security.antiBot ??= {};
          profile.security.antiBot.enabled = value.toLowerCase() === 'true';
        } else if (key === 'mentionEnabled') {
          profile.security.mentionProtection ??= {};
          profile.security.mentionProtection.enabled = value.toLowerCase() === 'true';
        } else if (key === 'lockdownEnabled') {
          profile.security.lockdown ??= {};
          profile.security.lockdown.enabled = value.toLowerCase() === 'true';
        }
      } else profile[destination[0]][destination[1]] = key === 'enabled' ? value.toLowerCase() === 'true' : value;
    }
  });

  await interaction.reply({ content: 'Configuração salva.', ...ephemeral() });
}

async function saveTicketConfig(interaction, action, store) {
  const values = Object.fromEntries(interaction.fields.fields.map((field) => [field.customId, field.value.trim()]));
  for (const key of ['categoryId', 'panelChannelId', 'logsChannelId', 'transcriptsChannelId', 'ratingsChannelId']) {
    if (key in values) values[key] = parseOptionalId(values[key]);
  }
  if (values.staffRoleIds !== undefined) values.staffRoleIds = parseIds(values.staffRoleIds);
  for (const key of ['panelImageUrl', 'panelThumbnailUrl']) {
    if (key in values) values[key] = parseUrl(values[key]);
  }
  if (values.panelColor && !/^#[\da-f]{6}$/i.test(values.panelColor)) {
    throw new Error('A cor deve estar no formato #RRGGBB.');
  }
  for (const key of ['transcriptsEnabled', 'ratingsEnabled', 'callsEnabled', 'preventDuplicates']) {
    if (key in values && !['true', 'false'].includes(values[key].toLowerCase())) {
      throw new Error(`${key} deve ser true ou false.`);
    }
  }
  for (const key of ['panelTitle', 'panelDescription', 'panelButtonLabel', 'panelButtonEmoji']) {
    if (key in values && !values[key]) throw new Error('Os campos do painel e do botão não podem ficar vazios.');
  }
  if (values.panelTitle?.length > 256 || values.panelDescription?.length > 4000
    || values.initialMessage?.length > 2000 || values.panelButtonLabel?.length > 80) {
    throw new Error('Um dos textos excede o limite permitido pelo Discord.');
  }

  await store.updateActiveProfile(interaction.guildId, (profile) => {
    const destinations = {
      panel: ['panelTitle', 'panelDescription', 'panelImageUrl', 'panelThumbnailUrl', 'panelColor'],
      category: ['categoryId'],
      staff: ['staffRoleIds'],
      logs: ['panelChannelId', 'logsChannelId', 'transcriptsChannelId', 'ratingsChannelId'],
      transcripts: ['transcriptsEnabled', 'transcriptsChannelId'],
      ratings: ['ratingsEnabled', 'ratingsChannelId'],
      calls: ['callsEnabled', 'preventDuplicates'],
      button: ['panelButtonLabel', 'panelButtonEmoji'],
      message: ['initialMessage', 'closingMessage'],
      identity: ['namePrefix', 'closeButtonLabel'],
    };
    for (const key of destinations[action] || []) {
      if (!(key in values)) continue;
      const property = key.endsWith('Enabled') || key === 'preventDuplicates'
        ? values[key].toLowerCase() === 'true'
        : values[key];
      profile.ticket[key] = property;
    }
  });
  await interaction.reply({ content: 'Configuração de Tickets salva.', ...ephemeral() });
}

async function sendSafeLog(guild, profile, message, files) {
  const channelId = profile.ticket.logsChannelId;
  if (!channelId) return;
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send({
      content: message,
      ...(files ? { files } : {}),
      allowedMentions: { parse: [] },
    });
  } catch {}
}

async function createTicket(interaction, profile, store = configStore) {
  if (!profile.ticket.enabled) {
    await interaction.reply({ content: 'A abertura de Tickets está desativada neste servidor.', ...ephemeral() });
    return;
  }
  const category = profile.ticket.categoryId
    ? await interaction.guild.channels.fetch(profile.ticket.categoryId).catch(() => null)
    : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    await interaction.reply({ content: 'A categoria de tickets não está configurada corretamente.', ...ephemeral() });
    return;
  }

  const openRecord = (await store.getActiveProfile(interaction.guildId)).ticket.records
    .find((record) => record.userId === interaction.user.id && ['opening', 'open'].includes(record.status));
  const cachedTicket = interaction.guild.channels.cache?.find?.((channel) =>
    channel.parentId === category.id && channel.topic?.startsWith(`speak-ticket:${interaction.user.id}`));
  if (profile.ticket.preventDuplicates && (openRecord || cachedTicket)) {
    const channel = openRecord?.channelId
      ? await interaction.guild.channels.fetch(openRecord.channelId).catch(() => null)
      : cachedTicket;
    if (openRecord?.status === 'opening' || channel) {
      await interaction.reply({ content: `Você já possui um ticket aberto${channel ? `: ${channel}` : ''}.`, ...ephemeral() });
      return;
    }
    await store.updateActiveProfile(interaction.guildId, (current) => {
      current.ticket.records = current.ticket.records.filter((record) => record.id !== openRecord.id);
    });
  }

  const reservationId = randomUUID();
  let duplicate = false;
  await store.updateActiveProfile(interaction.guildId, (current) => {
    if (current.ticket.preventDuplicates && current.ticket.records.some((record) =>
      record.userId === interaction.user.id && ['opening', 'open'].includes(record.status))) {
      duplicate = true;
      return;
    }
    current.ticket.records.push({ id: reservationId, userId: interaction.user.id, status: 'opening', createdAt: Date.now() });
  });
  if (duplicate) {
    await interaction.reply({ content: 'Você já possui um ticket aberto.', ...ephemeral() });
    return;
  }

  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 45);
  const prefix = (profile.ticket.namePrefix || 'ticket').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30) || 'ticket';
  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    {
      id: interaction.client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
    },
    ...(profile.ticket.staffRoleIds || []).map((id) => ({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    })),
  ];
  let channel;
  try {
    channel = await interaction.guild.channels.create({
      name: `${prefix}-${safeName}`.slice(0, 95),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `speak-ticket:${interaction.user.id}`,
      permissionOverwrites: overwrites,
    });
    const controls = new ActionRowBuilder().addComponents(
      button('speak:ticket:close', profile.ticket.closeButtonLabel || 'Fechar', '🔒', ButtonStyle.Danger),
      button('speak:ticket:call', 'Chamar Staff', '📞', ButtonStyle.Secondary),
      button('speak:ticket:claim', 'Assumir', '👤', ButtonStyle.Secondary),
    );
    const access = new ActionRowBuilder().addComponents(
      button('speak:login', profile.panel.loginButtonLabel, configuredEmoji(profile.emojis.login, '🔐')),
      button('speak:reset', profile.panel.resetButtonLabel, configuredEmoji(profile.emojis.reset, '🔄')),
      button('speak:ticket:support', profile.panel.supportButtonLabel, '🎫'),
      button('speak:ticket:ai', 'Perguntar à IA', '🤖'),
    );
    await channel.send({
      content: `<@${interaction.user.id}>\n${profile.ticket.initialMessage || 'Central de Atendimento'}`,
      components: [controls, access],
      allowedMentions: { users: [interaction.user.id] },
    });
    await store.updateActiveProfile(interaction.guildId, (current) => {
      const record = current.ticket.records.find((item) => item.id === reservationId);
      if (record) Object.assign(record, { channelId: channel.id, status: 'open' });
    });
    await interaction.reply({ content: `Seu ticket foi criado: ${channel}`, ...ephemeral() });
    await sendSafeLog(interaction.guild, profile, `Ticket criado: ${channel} (usuário <@${interaction.user.id}>).`);
  } catch (error) {
    if (channel) await channel.delete().catch(() => {});
    await store.updateActiveProfile(interaction.guildId, (current) => {
      current.ticket.records = current.ticket.records.filter((record) => record.id !== reservationId);
    });
    throw error;
  }
}

async function showLogin(interaction, profile) {
  let accounts = [];
  if (interaction.guildId && accessService.encryptionSecret) {
    accounts = await accessService.list(interaction.guildId, interaction.user.id);
  }
  const content = accounts.length
    ? `Acessos ativos: ${accounts.map((account) => account.ra).join(', ')}`
    : 'Nenhum acesso SPEAK ativo.';
  await interaction.reply({
    content,
    components: [new ActionRowBuilder().addComponents(button('speak:login:open', 'Login', '🔐', ButtonStyle.Primary))],
    ...ephemeral(),
  });
}

function loginModal() {
  return new ModalBuilder()
    .setCustomId('speak:login:submit')
    .setTitle('Login SPEAK')
    .addComponents(
      new ActionRowBuilder().addComponents(textField('ra', 'RA + UF', '', TextInputStyle.Short, true)),
      new ActionRowBuilder().addComponents(textField('password', 'Senha', '', TextInputStyle.Short, true)),
    );
}

async function showReset(interaction) {
  const status = await accessService.getResetStatus(interaction.guildId, interaction.user.id);
  if (!status.remaining) {
    await interaction.reply({ content: 'Você atingiu o limite de 2 resets deste mês.', ...ephemeral() });
    return;
  }
  const accounts = await accessService.list(interaction.guildId, interaction.user.id);
  if (!accounts.length) {
    await interaction.reply({ content: 'Você não possui RAs ativos para resetar.', ...ephemeral() });
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId('speak:reset:select')
    .setPlaceholder('Selecione um RA')
    .addOptions(accounts.map((account) => ({ label: account.ra.slice(0, 100), value: account.id })));
  await interaction.reply({
    content: `Resets restantes neste mês: ${status.remaining}. Selecione um RA.`,
    components: [new ActionRowBuilder().addComponents(select)],
    ...ephemeral(),
  });
}

async function handlePanelButton(interaction, profile, store = configStore) {
  if (interaction.customId === 'speak:payment') {
    await interaction.reply({ content: 'O checkout não está disponível no momento. Procure a equipe SPEAK. Nenhum pagamento foi iniciado.', ...ephemeral() });
    return;
  }
  if (interaction.customId === 'speak:coupon') {
    await handleCouponComponent(interaction, store);
    return;
  }
  if (interaction.customId === 'speak:support') {
    await createTicket(interaction, profile, store);
    return;
  }
  if (interaction.customId === 'speak:login') {
    await showLogin(interaction, profile);
    return;
  }
  if (interaction.customId === 'speak:reset') await showReset(interaction);
}

async function createTicketTranscript(channel) {
  const messages = [];
  let before;
  while (messages.length < 10_000) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  const lines = messages.reverse().map((message) => {
    const attachments = [...(message.attachments?.values?.() || [])].map((attachment) => attachment.url);
    const content = [message.content, ...attachments].filter(Boolean).join(' ');
    return `[${new Date(message.createdTimestamp).toISOString()}] ${message.author?.tag || message.author?.id || 'Usuário'}: ${content}`;
  });
  const transcript = lines.join('\n').slice(0, 1_500_000) || 'Nenhuma mensagem no ticket.';
  return new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: `ticket-${channel.id}-transcript.txt` });
}

async function handleTicketConfigButton(interaction, store) {
  const actionMatch = interaction.customId.match(/^speak:config:tickets:edit:(panel|category|staff|logs|transcripts|ratings|calls|button|message|identity)$/);
  if (!actionMatch && !['speak:config:tickets:launch', 'speak:config:tickets:test'].includes(interaction.customId)
    && !/^speak:config:tickets:enabled:(true|false)$/.test(interaction.customId)) return false;

  const profile = await store.getActiveProfile(interaction.guildId);
  if (!canConfigure(interaction, profile, 'tickets')) {
    await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
    return true;
  }
  if (actionMatch) {
    await interaction.showModal(ticketConfigModal(profile, actionMatch[1]));
    return true;
  }
  if (interaction.customId.startsWith('speak:config:tickets:enabled:')) {
    profile.ticket.enabled = interaction.customId.endsWith(':true');
    await store.updateActiveProfile(interaction.guildId, (current) => {
      current.ticket.enabled = profile.ticket.enabled;
    });
    await interaction.update({
      content: '🎫 Configuração de Tickets',
      components: ticketConfigControls(profile),
    });
    return true;
  }
  if (interaction.customId === 'speak:config:tickets:test') {
    await interaction.reply({ ...ticketPanelPayload(profile), ...ephemeral() });
    return true;
  }

  if (!profile.ticket.panelChannelId) {
    await interaction.reply({ content: 'Configure o canal do painel antes de lançá-lo.', ...ephemeral() });
    return true;
  }
  const channel = await interaction.guild.channels.fetch(profile.ticket.panelChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: 'O canal configurado para o painel não é um canal de texto válido.', ...ephemeral() });
    return true;
  }
  const panelMessage = await channel.send(ticketPanelPayload(profile));
  await store.updateActiveProfile(interaction.guildId, (current) => {
    current.ticket.panelMessageId = panelMessage.id;
  });
  await interaction.reply({ content: `Painel de Tickets publicado em ${channel}.`, ...ephemeral() });
  return true;
}

async function handleTicketButton(interaction, profile, store = configStore) {
  const ownerId = interaction.channel.topic?.match(/^speak-ticket:(\d+)(?::\d+)?$/)?.[1];
  if (!ownerId) return await interaction.reply({ content: 'Este canal não é um ticket SPEAK válido.', ...ephemeral() });
  const isOwner = interaction.user.id === ownerId;
  const isStaff = isSpeakStaff(interaction.member, profile)
    || hasStaffRole(interaction.member, profile.ticket.staffRoleIds || [])
    || interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
  if (interaction.customId === 'speak:ticket:close') {
    if (!isOwner && !isStaff) {
      await interaction.reply({ content: 'Você não pode fechar este ticket.', ...ephemeral() });
      return;
    }
    await interaction.reply({
      content: 'Tem certeza de que deseja fechar este ticket?',
      components: [new ActionRowBuilder().addComponents(
        button(`speak:ticket:close:confirm:${ownerId}:${interaction.user.id}`, 'Confirmar fechamento', '🔒', ButtonStyle.Danger),
        button(`speak:ticket:close:cancel:${ownerId}:${interaction.user.id}`, 'Cancelar', '↩️'),
      )],
      ...ephemeral(),
    });
    return;
  }
  if (interaction.customId.startsWith('speak:ticket:close:cancel:')) {
    const [, , , , ticketOwnerId, initiatorId] = interaction.customId.split(':');
    if (ticketOwnerId !== ownerId || initiatorId !== interaction.user.id) {
      await interaction.reply({ content: 'Esta confirmação pertence a outra pessoa.', ...ephemeral() });
      return;
    }
    await interaction.update({ content: 'Fechamento cancelado.', components: [] });
    return;
  }
  if (interaction.customId.startsWith('speak:ticket:close:confirm:')) {
    const [, , , , ticketOwnerId, initiatorId] = interaction.customId.split(':');
    if (ticketOwnerId !== ownerId || initiatorId !== interaction.user.id || (!isOwner && !isStaff)) {
      await interaction.reply({ content: 'Esta confirmação pertence a outra pessoa.', ...ephemeral() });
      return;
    }
    let transcript;
    if (profile.ticket.transcriptsEnabled) {
      const transcriptChannel = profile.ticket.transcriptsChannelId
        ? await interaction.guild.channels.fetch(profile.ticket.transcriptsChannelId).catch(() => null)
        : null;
      if (!transcriptChannel?.isTextBased()) {
        await interaction.reply({ content: 'Configure um canal de transcript válido antes de fechar este ticket.', ...ephemeral() });
        return;
      }
      transcript = await createTicketTranscript(interaction.channel);
      await transcriptChannel.send({
        content: `Transcript do ticket ${interaction.channel} (usuário <@${ownerId}>).`,
        files: [transcript],
        allowedMentions: { parse: [] },
      });
    }
    await interaction.channel.permissionOverwrites.edit(ownerId, { ViewChannel: false, SendMessages: false });
    await store.updateActiveProfile(interaction.guildId, (current) => {
      const record = current.ticket.records.find((item) => item.channelId === interaction.channel.id);
      if (record) Object.assign(record, { status: 'closed', closedAt: Date.now(), closedBy: interaction.user.id });
    });
    await interaction.update({ content: profile.ticket.closingMessage || 'Ticket fechado.', components: [] });
    await sendSafeLog(interaction.guild, profile, `Ticket fechado: ${interaction.channel} (usuário <@${ownerId}>).`);
    if (profile.ticket.deleteAfterClose) await interaction.channel.delete().catch(() => {});
    return;
  }
  if (interaction.customId === 'speak:ticket:call') {
    if (!isOwner && !isStaff) {
      await interaction.reply({ content: 'Somente o usuário e a equipe do ticket podem chamar a Staff.', ...ephemeral() });
      return;
    }
    if (profile.ticket.callsEnabled === false) {
      await interaction.reply({ content: 'As chamadas da equipe estão desativadas.', ...ephemeral() });
      return;
    }
    const roleIds = profile.ticket.staffRoleIds || [];
    if (!roleIds.length) {
      await interaction.reply({ content: 'A equipe de atendimento ainda não está configurada.', ...ephemeral() });
      return;
    }
    const cooldown = 5 * 60 * 1000;
    const now = Date.now();
    let coolingDown = false;
    await store.updateActiveProfile(interaction.guildId, (current) => {
      const lastCall = current.ticket.callCooldowns[interaction.channel.id] || 0;
      if (now - lastCall < cooldown) {
        coolingDown = true;
        return;
      }
      current.ticket.callCooldowns[interaction.channel.id] = now;
    });
    if (coolingDown) {
      await interaction.reply({ content: 'A equipe já foi chamada recentemente. Aguarde alguns minutos.', ...ephemeral() });
      return;
    }
    const roleMentions = roleIds.map((id) => `<@&${id}>`).join(' ');
    await interaction.channel.send({
      content: `${roleMentions} Atendimento solicitado por <@${interaction.user.id}>.`,
      allowedMentions: { roles: roleIds, users: [interaction.user.id] },
    });
    await interaction.reply({ content: 'A equipe foi chamada.', ...ephemeral() });
    return;
  }
  if (interaction.customId === 'speak:ticket:support') {
    await interaction.reply({ content: 'Este canal já é seu atendimento SPEAK.', ...ephemeral() });
    return;
  }
  if (interaction.customId === 'speak:ticket:ai') {
    if (!isOwner && !isStaff) {
      await interaction.reply({ content: 'Somente o usuário e a equipe do ticket podem consultar a IA.', ...ephemeral() });
      return;
    }
    if (!profile.ai.enabled) {
      await interaction.reply({ content: 'Estou temporariamente off, chora ai kkk 😭', ...ephemeral() });
      return;
    }
    if (!isAiChannelAllowed(interaction, profile)) {
      await interaction.reply({ content: getFallback(profile.ai), ...ephemeral() });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId('speak:ai:ask')
      .setTitle('Ajuda IA do servidor')
      .addComponents(new ActionRowBuilder().addComponents(
        textField('question', 'Sua dúvida educacional', '', TextInputStyle.Paragraph, true),
      ));
    await interaction.showModal(modal);
    return;
  }
  if (interaction.customId === 'speak:ticket:claim') {
    if (!isStaff) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    await interaction.channel.setTopic(`speak-ticket:${ownerId}:${interaction.user.id}`);
    await interaction.reply({ content: `Ticket assumido por <@${interaction.user.id}>.`, allowedMentions: { users: [interaction.user.id] } });
  }
}

async function handleChatCommand(interaction, store) {
  if (interaction.commandName === 'clear') {
    await handleClearCommand(interaction, store);
    return;
  }
  if (!['cone', 'coneondeficaconfig', 'apoiador'].includes(interaction.commandName)) return;
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Este comando só pode ser usado em um servidor.', ...ephemeral() });
    return;
  }
  const profile = await store.getActiveProfile(interaction.guildId);
  const subcommand = interaction.options.getSubcommand();
  if (interaction.commandName === 'coneondeficaconfig') {
    if (!canConfigure(interaction, profile, 'channels')) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    if (subcommand !== 'add') return;
    const channelId = interaction.options.getString('id', true).trim();
    const channelName = interaction.options.getString('nome', true).trim();
    if (!/^\d{17,20}$/.test(channelId) || !channelName || channelName.length > 100) {
      await interaction.reply({ content: 'Informe um ID de canal válido e um nome de até 100 caracteres.', ...ephemeral() });
      return;
    }
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      await interaction.reply({ content: 'Canal não encontrado neste servidor.', ...ephemeral() });
      return;
    }
    let updated = false;
    await store.updateActiveProfile(interaction.guildId, (current) => {
      const existing = current.general.customChannels.find((entry) => entry.id === channelId);
      if (existing) {
        existing.name = channelName;
        updated = true;
      } else {
        current.general.customChannels.push({ id: channelId, name: channelName });
      }
    });
    await interaction.reply({
      content: `${updated ? 'Canal atualizado' : 'Canal adicionado'}: ${channelName} → <#${channelId}>.`,
      ...ephemeral(),
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (interaction.commandName === 'cone' && ['onde-fica', 'visor'].includes(subcommand)) {
    if (subcommand === 'onde-fica') {
      const channelName = interaction.options.getString('nome')?.trim();
      const content = channelName
        ? getLocationReply(`ondefica ${channelName}`, true, profile) || `Não encontrei o canal **${channelName}**.`
        : getChannelsMessage(profile);
      await interaction.reply({ content, allowedMentions: { parse: [] } });
      return;
    }
    if (subcommand !== 'visor') return;
    const isServerOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdministrator = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
      || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    if (!isServerOwner && !isAdministrator
      && !canAccessAdminArea(interaction.member, interaction.user.id, profile, 'general')) {
      await interaction.reply({ content: 'Você não possui permissão para utilizar este comando.', ...ephemeral() });
      return;
    }
    const targetId = interaction.options.getString('id', true).trim();
    if (!/^\d{17,20}$/.test(targetId)) {
      await interaction.reply({ content: 'Membro não encontrado.', ...ephemeral() });
      return;
    }
    const target = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!target) {
      await interaction.reply({ content: 'Membro não encontrado.', ...ephemeral() });
      return;
    }
    const roles = [...(target.roles?.cache?.values?.() || [])]
      .filter((role) => role.id !== interaction.guild.id)
      .sort((left, right) => right.position - left.position);
    const permissionLabels = [
      [PermissionFlagsBits.Administrator, 'Administrador'],
      [PermissionFlagsBits.ManageGuild, 'Gerenciar servidor'],
      [PermissionFlagsBits.ManageChannels, 'Gerenciar canais'],
      [PermissionFlagsBits.ManageRoles, 'Gerenciar cargos'],
      [PermissionFlagsBits.ManageMessages, 'Gerenciar mensagens'],
      [PermissionFlagsBits.ModerateMembers, 'Moderar membros'],
      [PermissionFlagsBits.KickMembers, 'Expulsar membros'],
      [PermissionFlagsBits.BanMembers, 'Banir membros'],
      [PermissionFlagsBits.ManageWebhooks, 'Gerenciar webhooks'],
      [PermissionFlagsBits.MentionEveryone, 'Mencionar @everyone/@here'],
      [PermissionFlagsBits.ViewAuditLog, 'Ver registro de auditoria'],
    ];
    const permissions = permissionLabels
      .filter(([permission]) => target.permissions?.has?.(permission))
      .map(([, label]) => label);
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.primary)
      .setTitle('👁️ Visor de Membro')
      .addFields(
        { name: '👤 Usuário', value: `${target.displayName || target.user.globalName || target.user.username}\n@${target.user.username}\n<@${target.id}>`, inline: true },
        { name: '🆔 ID', value: target.id, inline: true },
        { name: '📅 Entrada no servidor', value: target.joinedAt ? `<t:${Math.floor(target.joinedAt.getTime() / 1000)}:F>` : 'Indisponível', inline: true },
        { name: '📊 Status', value: ({ online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', offline: 'Offline' })[target.presence?.status] || 'Indisponível', inline: true },
        { name: '🤖 Conta', value: target.user.bot ? 'Bot' : 'Usuário', inline: true },
      );
    const roleLines = roles.map((role) => `• ${role.name}`);
    const roleChunks = [];
    let roleChunk = '';
    for (const line of roleLines) {
      if (roleChunk && `${roleChunk}\n${line}`.length > 900) {
        roleChunks.push(roleChunk);
        roleChunk = '';
      }
      roleChunk = roleChunk ? `${roleChunk}\n${line}` : line;
    }
    if (roleChunk) roleChunks.push(roleChunk);
    const visibleRoleChunks = roleChunks.slice(0, 5);
    const fields = visibleRoleChunks.map((value, index) => ({
      name: index === 0 ? '🏷️ Cargos' : '🏷️ Cargos (continuação)',
      value,
    }));
    if (!fields.length) fields.push({ name: '🏷️ Cargos', value: 'Nenhum cargo além de @everyone.' });
    if (roleChunks.length > visibleRoleChunks.length) {
      const shownRoles = visibleRoleChunks.reduce((count, chunk) => count + chunk.split('\n').length, 0);
      fields.at(-1).value += `\n… mais ${roles.length - shownRoles} cargo(s), limitados pelo tamanho do embed.`;
    }
    fields.push({ name: '🔐 Permissões', value: permissions.join('\n') || 'Nenhuma permissão privilegiada identificada.' });
    embed.addFields(fields);
    await interaction.reply({ embeds: [embed], ...ephemeral(), allowedMentions: { parse: [] } });
    return;
  }
  if (interaction.commandName === 'cone' && subcommand === 'clear') {
    await handleClearCommand(interaction, store);
    return;
  }
  if (interaction.commandName === 'apoiador') {
    if (subcommand !== 'painel') return;
    if (!canConfigure(interaction, profile, 'panel')) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
  }
  if (['up', 'down', 'ver', 'anuncio', 'promocao'].includes(subcommand)) {
    await handleAdminSlashCommand(interaction, store);
    return;
  }
  if (['ping', 'help', 'commands', 'status', 'canais'].includes(subcommand)) {
    const text = subcommand;
    const payload = await dispatchSpeakText(text, {
      format: 'slash',
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      profile,
      ping: interaction.client?.ws?.ping ?? 0,
      availableCustomEmojis: [...(interaction.guild.emojis?.cache?.values?.() || [])]
        .map((emoji) => emoji.toString()),
    });
    await interaction.reply(payload);
    return;
  }
  if (subcommand === 'config') {
    if (!canAccessAnyAdminArea(interaction.member, interaction.user.id, profile)) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    await interaction.reply({ content: 'Configuração administrativa SPEAK', components: configMenu(interaction.user.id), ...ephemeral() });
  } else if (subcommand === 'painel' && ['apoiador', 'cone'].includes(interaction.commandName)) {
    if (!canConfigure(interaction, profile, 'panel')) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    const version = interaction.options.getString?.('versao') || 'normal';
    const archive = profile.workspace?.archive;
    if (version === 'v2' && !archive?.data) {
      await interaction.reply({ content: 'Integre um arquivo ZIP em /cone config → Workspace → Arquivos salvos antes de publicar o painel V2.', ...ephemeral() });
      return;
    }
    const channel = interaction.options.getChannel('canal');
    const panelDescription = [profile.panel.description, profile.panel.information, profile.panel.price]
      .filter(Boolean)
      .join('\n\n');
    const embed = new EmbedBuilder()
      .setTitle(profile.panel.title)
      .setColor(EMBED_COLORS.primary);
    if (panelDescription) embed.setDescription(panelDescription);
    if (profile.panel.imageUrl) embed.setImage(profile.panel.imageUrl);
    if (profile.panel.thumbnailUrl) embed.setThumbnail(profile.panel.thumbnailUrl);
    if (profile.panel.bannerUrl && !profile.panel.imageUrl) embed.setImage(profile.panel.bannerUrl);
    if (version === 'v2') {
      embed.addFields({
        name: profile.workspace.name || 'SPEAK Workspace',
        value: `Projeto ${profile.workspace.language || 'workspace'} disponível para download.`,
      });
    }
    const row = new ActionRowBuilder().addComponents(
      button('speak:payment', profile.panel.buttonLabel, configuredEmoji(profile.emojis.payment || profile.panel.buttonEmoji, '💳'), ButtonStyle.Secondary),
      button('speak:coupon', 'Tenho um cupom', configuredEmoji(profile.emojis.coupon, '🎟️')),
      button('speak:support', profile.panel.supportButtonLabel, configuredEmoji(profile.emojis.support, '❓')),
      button('speak:login', profile.panel.loginButtonLabel, configuredEmoji(profile.emojis.login, '🔐')),
      button('speak:reset', profile.panel.resetButtonLabel, configuredEmoji(profile.emojis.reset, '🔄')),
    );
    const panelMessage = { embeds: [embed], components: [row] };
    if (version === 'v2') {
      panelMessage.files = [new AttachmentBuilder(Buffer.from(archive.data, 'base64'), { name: archive.name })];
    }
    await channel.send(panelMessage);
    await store.updateActiveProfile(interaction.guildId, (current) => {
      current.panel.channelId = channel.id;
    });
    await interaction.reply({ content: `Painel enviado para ${channel}.`, ...ephemeral() });
  } else if (subcommand === 'ticket') {
    await createTicket(interaction, profile, store);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function handlePrefixWorkflow(message, store = configStore, prefix = '!cone') {
  const match = message.content.trim().match(new RegExp(`^${escapeRegex(prefix)}\\s+(config|painel|ticket)(?:\\s+([\\s\\S]+))?$`, 'i'));
  if (!match) return false;
  const command = match[1].toLowerCase();
  let panelChannel = null;
  let version = 'normal';
  if (command === 'painel') {
    const panelArgs = (match[2] || '').trim().match(/^(?:<#(\d{17,20})>|(\d{17,20}))(?:\s+(normal|v2))?$/i);
    if (!panelArgs) {
      await message.reply('Uso: !cone painel <#canal> [normal|v2]');
      return true;
    }
    panelChannel = await message.guild.channels.fetch(panelArgs[1] || panelArgs[2]).catch(() => null);
    version = panelArgs[3]?.toLowerCase() || 'normal';
    if (!panelChannel?.isTextBased?.()) {
      await message.reply('Não encontrei um canal de texto válido para o painel.');
      return true;
    }
  }

  let lastReply;
  const interaction = {
    commandName: 'cone',
    guildId: message.guild.id,
    guild: message.guild,
    channel: message.channel,
    channelId: message.channel.id,
    member: message.member,
    user: message.author,
    client: message.guild.client,
    options: {
      getSubcommand: () => command,
      getChannel: () => panelChannel,
      getString: (name) => name === 'versao' ? version : null,
    },
    reply: async (payload) => {
      const { flags, ...publicPayload } = typeof payload === 'string' ? { content: payload } : payload;
      lastReply = await message.reply({ ...publicPayload, allowedMentions: publicPayload.allowedMentions || { parse: [] } });
      if (flags & 64) {
        const timer = setTimeout(() => lastReply.delete().catch(() => {}), 5000);
        timer.unref?.();
      }
      return lastReply;
    },
  };
  await handleChatCommand(interaction, store);
  return true;
}

async function handleClearCommand(interaction, store, { schedule = setTimeout, now = Date.now, isPrefix = false } = {}) {
  const reply = async (content, isDenial = false) => {
    const response = await interaction.reply({ content, ...(isPrefix ? {} : ephemeral()) });
    if (isPrefix && isDenial && response?.delete) {
      const timer = schedule(() => response.delete().catch(() => {}), 5000);
      timer?.unref?.();
    }
    return response;
  };
  if (!interaction.guildId || !interaction.guild) {
    await reply('Este comando só pode ser usado em um servidor.');
    return;
  }
  const amount = interaction.options.getInteger('numero', true);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    await interaction.reply({ content: 'Informe uma quantidade entre 1 e 100 mensagens.', ...ephemeral() });
    return;
  }
  const profile = await store.getActiveProfile(interaction.guildId);
  if (!canManageSpeak(interaction.member, interaction.user.id, profile)) {
    await reply(STAFF_DENIED_MESSAGE, true);
    return;
  }

  const botMember = interaction.guild.members.me;
  if (!interaction.channel?.messages?.fetch
    || !interaction.channel.permissionsFor?.(botMember)?.has(PermissionFlagsBits.ManageMessages)) {
    await reply('O bot precisa da permissão Gerenciar mensagens neste canal.');
    return;
  }

  let deletedCount;
  try {
    const fetched = await interaction.channel.messages.fetch({ limit: amount });
    const recent = fetched.filter((message) => Number.isFinite(message.createdTimestamp)
      && now() - message.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
    if (recent.size > 1) {
      deletedCount = (await interaction.channel.bulkDelete(recent, true)).size;
    } else if (recent.size === 1) {
      await recent.first().delete();
      deletedCount = 1;
    } else {
      deletedCount = 0;
    }
  } catch (error) {
    const content = error.code === 50013
      ? 'Não foi possível apagar as mensagens. Verifique a permissão Gerenciar mensagens do bot.'
      : 'Não foi possível apagar as mensagens deste canal.';
    await reply(content);
    return;
  }

  const logChannelId = profile.admin.logChannelId || profile.ticket.logsChannelId;
  if (logChannelId) {
    const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
    if (logChannel?.isTextBased()) {
      await logChannel.send({
        content: `Limpeza de mensagens: ${deletedCount}/${amount} apagadas por ${interaction.user.tag || interaction.user.id} em <#${interaction.channelId}>.`,
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
  }

  const confirmation = deletedCount === 1
    ? '🧹 1 mensagem foi apagada.'
    : `🧹 ${deletedCount} mensagens foram apagadas.`;
  await reply(confirmation);
  const confirmationTimer = schedule(() => interaction.deleteReply().catch(() => {}), 5000);
  confirmationTimer?.unref?.();
}

async function handlePrefixClear(message, store = configStore, options = {}, prefix = '!cone') {
  const match = message.content.trim().match(new RegExp(`^${escapeRegex(prefix)}\\s+clear(?:\\s+([\\s\\S]+))?$`, 'i'));
  if (!match) return false;
  let confirmationMessage;
  const interaction = {
    guildId: message.guild?.id,
    guild: message.guild,
    channel: message.channel,
    channelId: message.channel.id,
    member: message.member,
    user: message.author,
    options: { getInteger: () => match[1] === undefined ? Number.NaN : Number(match[1]) },
    reply: async ({ content }) => {
      confirmationMessage = await message.reply({ content, allowedMentions: { parse: [] } });
      return confirmationMessage;
    },
    deleteReply: async () => confirmationMessage?.delete().catch(() => {}),
  };
  await handleClearCommand(interaction, store, { ...options, isPrefix: true });
  return true;
}

async function handleWorkspaceUpload(message, store = configStore) {
  if (message.author.bot || message.webhookId || !message.guild) return false;
  const key = `${message.guild.id}:${message.channel.id}:${message.author.id}`;
  const expiresAt = pendingWorkspaceUploads.get(key);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    pendingWorkspaceUploads.delete(key);
    return false;
  }
  const attachment = [...message.attachments.values()].find((file) => file.name?.toLowerCase().endsWith('.zip'));
  if (!attachment) return false;
  if (attachment.size > MAX_WORKSPACE_ARCHIVE_SIZE) {
    await message.reply('O ZIP excede o limite de 8 MB. Envie um arquivo menor.');
    return true;
  }
  const profile = await store.getActiveProfile(message.guild.id);
  if (!canAccessAdminArea(message.member, message.author.id, profile, 'workspace')) {
    pendingWorkspaceUploads.delete(key);
    const denial = await message.reply({ content: STAFF_DENIED_MESSAGE, allowedMentions: { parse: [] } });
    const timer = setTimeout(() => denial.delete().catch(() => {}), 5000);
    timer.unref?.();
    return true;
  }
  const response = await fetch(attachment.url);
  if (!response.ok) {
    await message.reply('Não consegui baixar o ZIP. Tente enviá-lo novamente.');
    return true;
  }
  const chunks = [];
  let totalSize = 0;
  const reader = response.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.length;
      if (totalSize > MAX_WORKSPACE_ARCHIVE_SIZE) {
        await reader.cancel();
        await message.reply('O ZIP excede o limite de 8 MB. Envie um arquivo menor.');
        return true;
      }
      chunks.push(Buffer.from(value));
    }
  } else {
    const data = Buffer.from(await response.arrayBuffer());
    totalSize = data.length;
    if (totalSize <= MAX_WORKSPACE_ARCHIVE_SIZE) chunks.push(data);
  }
  const data = Buffer.concat(chunks);
  if (data.length > MAX_WORKSPACE_ARCHIVE_SIZE
    || data[0] !== 0x50 || data[1] !== 0x4b || ![0x03, 0x05, 0x07].includes(data[2])) {
    await message.reply('O arquivo não parece ser um ZIP válido ou excede 8 MB.');
    return true;
  }
  pendingWorkspaceUploads.delete(key);
  const token = randomUUID();
  const name = attachment.name.replace(/[^\w.-]/g, '_').slice(0, 100) || 'workspace.zip';
  const archive = { name, size: data.length, data: data.toString('base64') };
  for (const [pendingToken, pending] of pendingWorkspaceArchives) {
    if (pending.expiresAt < Date.now()) pendingWorkspaceArchives.delete(pendingToken);
  }
  pendingWorkspaceArchives.set(token, {
    guildId: message.guild.id,
    userId: message.author.id,
    archive,
    expiresAt: Date.now() + WORKSPACE_UPLOAD_TTL,
  });
  await message.reply({
    content: `ZIP **${name}** recebido. Integre-o para disponibilizar no painel V2.`,
    components: [new ActionRowBuilder().addComponents(
      button(`speak:config:workspace:integrate:${token}`, 'Integrar ao painel SPEAK V2', '📦', ButtonStyle.Success),
    )],
  });
  return true;
}

async function handleComponent(interaction, store) {
  const aiToggle = interaction.customId.match(/^speak:config:ai:(enabled|emojisEnabled):(true|false)$/);
  if (aiToggle) {
    const profile = await store.getActiveProfile(interaction.guildId);
    if (!canConfigure(interaction, profile, 'ai')) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    const [, setting, value] = aiToggle;
    profile.ai[setting] = value === 'true';
    await store.updateActiveProfile(interaction.guildId, (current) => {
      current.ai[setting] = profile.ai[setting];
    });
    await interaction.update({ content: '', components: aiToggleControls(profile) });
    return;
  }
  if (interaction.customId === 'speak:config:section') {
    const section = interaction.values[0];
    const profile = await store.getActiveProfile(interaction.guildId);
    if (section === 'owner' && !isIsekayUser(interaction.user.id)) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    const allowed = section === 'permissions'
      ? isSpeakStaff(interaction.member, profile)
      : canConfigure(interaction, profile, configArea(section));
    if (!allowed) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    if (section === 'plans') {
      await interaction.update({ content: 'Planos SPEAK', components: buildPlanMenu(profile) });
      return;
    }
    if (section === 'links') {
      await interaction.update({
        content: '🔗 Vínculos ainda não está disponível. A configuração por servidor está preservada para uma etapa futura.',
        components: [],
      });
      return;
    }
    if (section === 'channels') {
      await interaction.update({ content: 'Escolha o grupo de canais para configurar.', components: subMenu('channels') });
      return;
    }
    if (section === 'ticket') {
      await interaction.update({ content: '🎫 Configuração de Tickets', components: ticketConfigControls(profile) });
      return;
    }
    if (section === 'ai') {
      await interaction.update({ content: '', components: aiToggleControls(profile) });
      return;
    }
    if (section === 'panel' || section === 'workspace') {
      await interaction.update({ content: 'Escolha as configurações que deseja editar.', components: subMenu(section) });
      return;
    }
    if (section === 'payment') {
      await showConfigModal(interaction, profile, section);
      return;
    }
    await showConfigModal(interaction, profile, section);
    return;
  }
  if (interaction.customId.startsWith('speak:config:sub:')) {
    const [, , , section] = interaction.customId.split(':');
    const profile = await store.getActiveProfile(interaction.guildId);
    if (!canConfigure(interaction, profile, configArea(section))) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    if (section === 'ai') {
      await interaction.update({ content: '', components: aiToggleControls(profile) });
      return;
    }
    if (section === 'payment' && interaction.values[0] === 'provider') {
      const status = paymentService.getStatus();
      const missing = status.missingDocumentation.map((item) => `• ${item}`).join('\n');
      await interaction.update({
        content: `Z.PAY: não configurado. Credenciais presentes: ${status.credentialsPresent ? 'sim' : 'não'}.\nDocumentação oficial necessária:\n${missing}\nNenhuma cobrança ou confirmação será processada.`,
        components: [],
      });
      return;
    }
    if (section === 'workspace' && interaction.values[0] === 'files') {
      const archive = profile.workspace?.archive;
      const content = archive
        ? `ZIP integrado: **${archive.name}**. Envie outro para substituir.`
        : 'Envie um arquivo ZIP para integrar ao workspace e disponibilizar no painel V2.';
      await interaction.update({
        content,
        components: [new ActionRowBuilder().addComponents(
          button('speak:config:workspace:upload', 'Enviar ZIP', '📦', ButtonStyle.Primary),
        )],
      });
      return;
    }
    await showConfigModal(interaction, profile, section, interaction.values[0]);
    return;
  }
  if (interaction.customId === 'speak:config:workspace:upload') {
    const profile = await store.getActiveProfile(interaction.guildId);
    if (!canConfigure(interaction, profile, 'workspace')) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    const key = `${interaction.guildId}:${interaction.channelId}:${interaction.user.id}`;
    pendingWorkspaceUploads.set(key, Date.now() + WORKSPACE_UPLOAD_TTL);
    await interaction.reply({
      content: 'Envie um arquivo .zip neste canal nos próximos 15 minutos. Tamanho máximo: 8 MB.',
      ...ephemeral(),
    });
    return;
  }
  if (interaction.customId.startsWith('speak:config:workspace:integrate:')) {
    const token = interaction.customId.split(':').at(-1);
    const pending = pendingWorkspaceArchives.get(token);
    if (!pending || pending.expiresAt < Date.now()
      || pending.userId !== interaction.user.id
      || pending.guildId !== interaction.guildId) {
      pendingWorkspaceArchives.delete(token);
      await interaction.reply({ content: 'Este ZIP expirou ou não pertence a você. Envie-o novamente pelo SPEAK.', ...ephemeral() });
      return;
    }
    const profile = await store.getActiveProfile(interaction.guildId);
    if (!canConfigure(interaction, profile, 'workspace')) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    await store.updateActiveProfile(interaction.guildId, (current) => {
      current.workspace ??= { name: 'SPEAK Workspace', language: 'typescript', script: '', files: [] };
      current.workspace.archive = pending.archive;
    });
    pendingWorkspaceArchives.delete(token);
    await interaction.update({ content: `**${pending.archive.name}** integrado ao workspace do painel SPEAK V2.`, components: [] });
    return;
  }
  if (interaction.customId.startsWith('speak:config:tickets:')) {
    if (await handleTicketConfigButton(interaction, store)) return;
  }
  if (interaction.customId.startsWith('speak:config:coupons') || interaction.customId.startsWith('speak:coupon:')) {
    const handled = await handleCouponComponent(interaction, store);
    if (handled) return;
  }
  if (interaction.customId === 'speak:config:permissions:area') {
    const profile = await store.getActiveProfile(interaction.guildId);
    if (!isSpeakStaff(interaction.member, profile)) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    const area = interaction.values[0];
    await showConfigModal(interaction, profile, 'permissions', area);
    return;
  }
  if (interaction.customId === 'speak:reset:select') {
    const accountId = interaction.values[0];
    await interaction.update({
      content: 'Confirma o reset somente deste RA? A ação não pode ser desfeita.',
      components: [new ActionRowBuilder().addComponents(
        button(`speak:reset:confirm:${interaction.user.id}:${accountId}`, 'Confirmar', '✅', ButtonStyle.Danger),
        button('speak:reset:cancel', 'Cancelar', '❌'),
      )],
    });
    return;
  }
  if (interaction.customId === 'speak:login:open') {
    await interaction.showModal(loginModal());
    return;
  }
  if (interaction.customId.startsWith('speak:ticket:')) {
    const profile = await store.getActiveProfile(interaction.guildId);
    if (interaction.customId === 'speak:ticket:open') {
      await createTicket(interaction, profile, store);
      return;
    }
    await handleTicketButton(interaction, profile, store);
    return;
  }
  if (['speak:payment', 'speak:coupon', 'speak:support', 'speak:login', 'speak:reset'].includes(interaction.customId)) {
    const profile = await store.getActiveProfile(interaction.guildId);
    await handlePanelButton(interaction, profile, store);
  }
}

async function parseOwnerCommand(interaction, commandText, store) {
  const text = commandText.trim();
  if (!text) throw new Error('Comando vazio.');

  if (/^!cone\s+ver\b/i.test(text)) {
    const match = text.match(/^!cone\s+ver\s+(?:<@!?([0-9]{17,20})>|([0-9]{17,20}))$/i);
    if (!match) throw new Error('Uso: !cone ver <id ou menção>');
    const userId = match[1] || match[2];
    const profile = await store.getActiveProfile(interaction.guildId);
    const guild = interaction.guild;
    const user = await guild.members.fetch(userId).catch(() => null);
    const dm = await interaction.user.createDM().catch(() => null);
    if (!dm) throw new Error('Não consegui abrir sua DM para enviar o histórico.');
    await showUserHistory({ guild, userId, executorId: interaction.user.id, member: interaction.member, reply: (payload) => dm.send(payload) }, store);
    return `Histórico do usuário ${userId} enviado por DM.`;
  }

  if (/^!cone\s+an[úu]ncio\b/i.test(text) || /^!cone\s+anuncio\b/i.test(text)) {
    const match = text.match(/^!cone\s+an[úu]ncio\s+([0-9]{17,20})\s+(.+)$/i);
    if (!match) throw new Error('Uso: !cone anúncio <id do canal> <mensagem>');
    const channelId = match[1];
    const message = match[2].trim();
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) throw new Error('Canal de anúncio inválido.');
    await channel.send({ content: message, allowedMentions: { parse: ['everyone', 'here'] } });
    return `Anúncio enviado para ${channel}.`;
  }

  if (/^!cone\s+promo[çc]ao\b/i.test(text) || /^!cone\s+promocao\b/i.test(text)) {
    const match = text.match(/^!cone\s+promo[çc]ao\s+([0-9]{17,20})\s+(.+)$/i);
    if (!match) throw new Error('Uso: !cone promoção <id do canal> <mensagem>');
    const channelId = match[1];
    const message = match[2].trim();
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) throw new Error('Canal de promoção inválido.');
    await channel.send({ content: message, allowedMentions: { parse: [] } });
    return `Promoção enviada para ${channel}.`;
  }

  const moderation = text.match(/^(kick|ban|mute|unmute|timeout)\s+(?:<@!?([0-9]{17,20})>|([0-9]{17,20}))\s*(.*)$/i);
  if (moderation) {
    const [, action, mentionId, rawId, rest] = moderation;
    const targetId = mentionId || rawId;
    const target = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!target) throw new Error('Usuário não encontrado no servidor.');
    const reason = rest.trim() || 'Ação administrativa do painel Isekay';
    if (/^kick$/i.test(action)) {
      await target.kick(reason);
      return `Usuário ${target.user.tag} foi expulso.`;
    }
    if (/^ban$/i.test(action)) {
      await target.ban({ reason, deleteMessageSeconds: 0 });
      return `Usuário ${target.user.tag} foi banido.`;
    }
    if (/^mute$|^timeout$/i.test(action)) {
      const durationMatch = rest.match(/(\d+)([smhd])/i);
      let ms = 60_000;
      if (durationMatch) {
        const amount = Number(durationMatch[1]);
        const unit = durationMatch[2].toLowerCase();
        const map = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
        ms = amount * (map[unit] || 60_000);
      }
      await target.timeout(ms, reason);
      return `Usuário ${target.user.tag} foi silenciado por ${ms / 1000}s.`;
    }
    if (/^unmute$/i.test(action)) {
      await target.timeout(null, reason);
      return `Silêncio removido de ${target.user.tag}.`;
    }
  }

  throw new Error('Comando não reconhecido. Ex.: !cone ver <id>, !cone anúncio <id do canal> mensagem, kick/ban/mute <id>.');
}

async function handleModal(interaction, store) {
  if (await handleCouponModal(interaction, store)) return;
  if (await handleAdminModal(interaction, store)) return;
  if (interaction.customId === 'speak:config:save:owner:console') {
    if (!isIsekayUser(interaction.user.id)) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    const commandText = interaction.fields.getTextInputValue('ownerCommand');
    try {
      const result = await parseOwnerCommand(interaction, commandText, store);
      await interaction.reply({ content: result, ...ephemeral() });
    } catch (error) {
      await interaction.reply({ content: error.message, ...ephemeral() });
    }
    return;
  }
  if (interaction.customId === 'speak:ai:ask') {
    const profile = await store.getActiveProfile(interaction.guildId);
    const ownerId = interaction.channel?.topic?.match(/^speak-ticket:(\d+)(?::\d+)?$/)?.[1];
    const isOwner = interaction.user.id === ownerId;
    const isStaff = isSpeakStaff(interaction.member, profile)
      || hasStaffRole(interaction.member, profile.ticket.staffRoleIds)
      || interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
    if ((!isOwner && !isStaff) || !ownerId) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    if (!profile.ai.enabled) {
      await interaction.reply({ content: 'Estou temporariamente off, chora ai kkk 😭', ...ephemeral() });
      return;
    }
    if (!isAiChannelAllowed(interaction, profile)) {
      await interaction.reply({ content: getFallback(profile.ai), ...ephemeral() });
      return;
    }
    const question = interaction.fields.getTextInputValue('question').slice(0, 2000);
    const availableCustomEmojis = [...(interaction.guild.emojis?.cache?.values?.() || [])]
      .map((emoji) => emoji.toString());
    const answer = await answerSpeakMessage({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      text: question,
      aiConfig: profile.ai,
      profile,
      availableCustomEmojis,
    });
    await interaction.reply({ content: answer, ...ephemeral() });
    return;
  }
  if (interaction.customId === 'speak:login:submit') {
    if (!accessService.encryptionSecret) {
      await interaction.reply({ content: 'O armazenamento seguro de acesso não está configurado.', ...ephemeral() });
      return;
    }
    const ra = interaction.fields.getTextInputValue('ra').trim();
    const password = interaction.fields.getTextInputValue('password');
    if (!ra || ra.length > 80 || !password || password.length > 256) {
      await interaction.reply({ content: 'RA + UF ou senha inválidos.', ...ephemeral() });
      return;
    }
    const result = await accessService.add(interaction.guildId, interaction.user.id, ra, password);
    const message = result === 'ADDED'
      ? 'Acesso adicionado. Senha armazenada de forma criptografada e não exibida.'
      : result === 'DUPLICATE'
        ? 'Este RA + UF já está ativo na sua conta.'
        : 'Você já possui o máximo de 2 RAs ativos.';
    await interaction.reply({ content: message, ...ephemeral() });
    return;
  }
  if (interaction.customId.startsWith('speak:config:save:')) {
    const [, , , section, subsection] = interaction.customId.split(':');
    const profile = await store.getActiveProfile(interaction.guildId);
    const allowed = section === 'permissions'
      ? isSpeakStaff(interaction.member, profile)
      : canConfigure(interaction, profile, configArea(section));
    if (!allowed) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    await saveConfig(interaction, section, subsection, store);
    return;
  }
  if (interaction.customId.startsWith('speak:config:tickets:save:')) {
    const action = interaction.customId.split(':').at(-1);
    const profile = await store.getActiveProfile(interaction.guildId);
    if (!canConfigure(interaction, profile, 'tickets')) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, ...ephemeral() });
      return;
    }
    await saveTicketConfig(interaction, action, store);
  }
}

async function handleInteraction(interaction, store = configStore) {
  try {
    if (interaction.isChatInputCommand()) {
      await handleChatCommand(interaction, store);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction, store);
    } else if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isRoleSelectMenu()) {
      if (interaction.customId.startsWith('speak:reset:confirm:')) {
        const [, , , userId, accountId] = interaction.customId.split(':');
        if (interaction.user.id !== userId) {
          await interaction.reply({ content: 'Esta confirmação pertence a outro usuário.', ...ephemeral() });
          return;
        }
        const result = await accessService.reset(interaction.guildId, userId, accountId);
        const message = result.status === 'LIMIT'
          ? 'Você atingiu o limite de 2 resets deste mês.'
          : result.status === 'RESET'
            ? `RA removido. Você ainda tem ${result.remaining} reset(s) neste mês.`
            : 'Este RA não está mais ativo.';
        await interaction.update({ content: message, components: [] });
      } else if (interaction.customId === 'speak:reset:cancel') {
        await interaction.update({ content: 'Reset cancelado.', components: [] });
      } else {
        const historyHandled = await handleHistoryComponent(interaction, store);
        if (!historyHandled) {
          const handled = await handleAdminComponent(interaction, store);
          if (!handled) await handleComponent(interaction, store);
        }
      }
    }
  } catch (error) {
    const message = error.message.startsWith('ACCESS_') || error.message.includes('ID inválido')
      || error.message.includes('IDs inválidos') || error.message.includes('URL')
      || error.message.includes('cor deve') || error.message.includes('IA habilitada')
      ? error.message
      : 'Não foi possível concluir a operação. Verifique as permissões e configurações do bot.';
    const response = { content: message, ...ephemeral() };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(() => {});
    else await interaction.reply(response).catch(() => {});
  }
}

module.exports = {
  handleChatCommand,
  handleClearCommand,
  handlePrefixClear,
  handleComponent,
  handleInteraction,
  handleModal,
  handlePanelButton,
  handlePrefixWorkflow,
  handleWorkspaceUpload,
  handleTicketButton,
  configStore,
};