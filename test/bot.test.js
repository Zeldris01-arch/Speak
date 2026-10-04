const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');

const { commands } = require('../src/commands');
const { AccessService } = require('../src/accessService');
const { askSpeak, buildSafeServerContext, createConversationStore, FALLBACK_MESSAGE, getFallback, NIM_CHAT_COMPLETIONS_URL } = require('../src/aiService');
const { answerSpeakMessage, OFFLINE_MESSAGE } = require('../src/conversationService');
const { dispatchSpeakText, createCommandsMessage } = require('../src/speakCommandService');
const { SERVER_CHANNELS } = require('../src/config/defaults');
const { sweepExpirations } = require('../src/accessExpirationService');
const { createSalaDoFuturoPayload, SALA_DO_FUTURO_URL } = require('../src/salaDoFuturoService');
const { validateCoupon, recordCouponUsage, handleCouponModal, handleCouponComponent } = require('../src/couponService');
const {
  canManageRole,
  handleAdminComponent,
  handleAdminMessage,
  handleAdminModal,
} = require('../src/adminService');
const { ConfigStore } = require('../src/database/configStore');
const {
  handleChatCommand,
  handleClearCommand,
  handleComponent,
  handleInteraction,
  handleModal,
  handlePanelButton,
  handlePrefixClear,
  handlePrefixWorkflow,
  handleWorkspaceUpload,
  handleTicketButton,
} = require('../src/interactionHandler');
const { isIsekayUser, isSpeakStaff } = require('../src/permissions');

process.env.SPEAK_STAFF_ROLE_ID ||= '1536253284309008445';
const TEST_CHANNEL_IDS = Object.fromEntries(Object.keys(SERVER_CHANNELS).map((key, index) => [
  key,
  String(10000000000000000n + BigInt(index)),
]));

async function createStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'speak-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new ConfigStore(path.join(directory, 'guild-config.json'));
}

function interactionBase(overrides = {}) {
  const staffRoleId = process.env.SPEAK_STAFF_ROLE_ID || '1536253284309008445';
  return {
    guildId: 'guild-1',
    user: { id: 'user-1', username: 'Test User' },
    member: { roles: { cache: new Map([[staffRoleId, { id: staffRoleId }]]) } },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.ManageGuild },
    guild: { roles: { everyone: { id: 'everyone' } }, channels: {} },
    options: { getSubcommand: () => '', getChannel: () => null },
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    ...overrides,
  };
}

function adminGuildFixture({ manageableRolePosition = 10, mentionEveryone = true, authorized = true } = {}) {
  const guildId = '11111111111111111';
  const executorId = '22222222222222222';
  const targetId = '33333333333333333';
  const logChannelId = '44444444444444444';
  const planRoleId = '55555555555555555';
  const botHighestRole = { id: '66666666666666666', position: 100 };
  const planRole = {
    id: planRoleId,
    position: manageableRolePosition,
    managed: false,
    editable: manageableRolePosition < botHighestRole.position,
    comparePositionTo: (other) => manageableRolePosition - other.position,
  };
  const roles = new Map([[planRole.id, planRole]]);
  const roleIds = new Set();
  const target = {
    id: targetId,
    manageable: true,
    roles: {
      cache: { has: (id) => roleIds.has(id) },
      add: async (value) => {
        for (const role of Array.isArray(value) ? value : [value]) roleIds.add(typeof role === 'string' ? role : role.id);
      },
      remove: async (value) => {
        for (const role of Array.isArray(value) ? value : [value]) roleIds.delete(typeof role === 'string' ? role : role.id);
      },
    },
  };
  const logMessages = [];
  const channelMessages = [];
  const channel = {
    id: logChannelId,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload) => { logMessages.push(payload); return payload; },
  };
  const commandChannel = {
    id: '77777777777777777',
    isTextBased: () => true,
    send: async (payload) => { channelMessages.push(payload); return payload; },
  };
  const guild = {
    id: guildId,
    members: {
      me: {
        manageable: true,
        permissions: { has: (permission) => permission === PermissionFlagsBits.ManageRoles
          || (mentionEveryone && permission === PermissionFlagsBits.MentionEveryone) },
        roles: { highest: botHighestRole },
      },
      fetch: async (id) => id === targetId ? target : null,
    },
    roles: {
      cache: roles,
      fetch: async (id) => roles.get(id) ?? null,
    },
    channels: {
      fetch: async (id) => id === logChannelId ? channel : id === commandChannel.id ? commandChannel : null,
    },
  };
  const member = {
    permissions: { has: (permission) => authorized && permission === PermissionFlagsBits.ManageGuild },
    roles: { cache: authorized ? new Map([[process.env.SPEAK_STAFF_ROLE_ID || '1536253284309008445',
      { id: process.env.SPEAK_STAFF_ROLE_ID || '1536253284309008445' }]]) : new Map() },
  };
  const author = { id: executorId, bot: false };
  const message = (content) => ({
    content,
    author,
    member,
    guild,
    channel: commandChannel,
    reply: async (payload) => { channelMessages.push(payload); return payload; },
  });
  const component = (customId, overrides = {}) => interactionBase({
    customId,
    guildId,
    guild,
    user: { id: executorId },
    member,
    memberPermissions: {
      has: (permission) => (authorized && permission === PermissionFlagsBits.ManageGuild)
        || (mentionEveryone && permission === PermissionFlagsBits.MentionEveryone),
    },
    roles: { first: () => planRole },
    update: async (payload) => { component.payload = payload; },
    reply: async (payload) => { component.payload = payload; },
    ...overrides,
  });
  return {
    guildId,
    executorId,
    targetId,
    logChannelId,
    planRole,
    roleIds,
    target,
    guild,
    member,
    channelMessages,
    logMessages,
    message,
    component,
  };
}

test('registra comandos do Cone sem raízes Shu/Speak ou subcomandos escolares', () => {
  const commandNames = commands.map((command) => command.name);
  assert.equal(new Set(commandNames).size, commandNames.length);
  assert.equal(commandNames.includes('shu'), false);
  assert.equal(commandNames.includes('speak'), false);
  const coneCommand = commands.find((command) => command.name === 'cone');
  const registered = coneCommand.options.map((option) => option.name);
  for (const expected of [
    'ping', 'help', 'commands', 'status', 'canais', 'config', 'painel', 'ticket',
    'clear', 'anuncio', 'promocao', 'ver', 'up', 'down', 'onde-fica', 'visor',
  ]) assert.ok(registered.includes(expected), `/${expected} está registrado`);
  for (const removed of ['oi', 'ondefica', 'speak', 'saladofuturo', 'cmsp', 'login', 'reset', 'sala-do-futuro']) {
    assert.equal(registered.includes(removed), false, `/${removed} não está registrado`);
  }
  assert.equal(new Set(registered).size, registered.length);
  const clearCommand = commands.find((command) => command.name === 'clear');
  assert.equal(clearCommand.options[0].name, 'numero');
  assert.equal(clearCommand.options[0].min_value, 1);
  assert.equal(clearCommand.options[0].max_value, 100);
});

test('o botão da Sala do Futuro aponta para o novo link da Zonde', () => {
  assert.equal(SALA_DO_FUTURO_URL, 'https://zondesystems.netlify.app');
  const payload = createSalaDoFuturoPayload();
  assert.equal(payload.components[0].components[0].data.url, 'https://zondesystems.netlify.app');
});

test('/cone visor aplica permissões e mostra somente informações públicas do membro', async (t) => {
  const store = await createStore(t);
  const cone = commands.find((command) => command.name === 'cone');
  const visorCommand = cone.options.find((option) => option.name === 'visor');
  assert.equal(visorCommand.options[0].name, 'id');
  const memberId = '12345678901234567';
  let fetchCount = 0;
  const roles = new Map([
    ['guild-1', { id: 'guild-1', name: '@everyone', position: 0 }],
    ['role-1', { id: 'role-1', name: 'Equipe', position: 5 }],
    ['role-2', { id: 'role-2', name: 'Moderador', position: 10 }],
  ]);
  const target = {
    id: memberId,
    displayName: 'Nome de Exibição',
    joinedAt: new Date('2025-01-02T03:04:05Z'),
    presence: { status: 'online' },
    user: { id: memberId, username: 'usuario', globalName: 'Nome Global', bot: false },
    roles: { cache: roles },
    permissions: { has: (permission) => permission === PermissionFlagsBits.ManageMessages },
  };
  const guild = {
    id: 'guild-1',
    ownerId: 'server-owner',
    members: { fetch: async (id) => { fetchCount += 1; return id === memberId ? target : null; } },
  };
  const makeInteraction = (id, { authorized = false, member = { roles: { cache: new Map() } } } = {}) => {
    const interaction = interactionBase({
      commandName: 'cone',
      guild,
      member,
      memberPermissions: { has: (permission) => authorized && permission === PermissionFlagsBits.Administrator },
      isChatInputCommand: () => true,
      options: { getSubcommand: () => 'visor', getString: () => id },
      reply: async (payload) => { interaction.payload = payload; },
    });
    return interaction;
  };

  const denied = makeInteraction(memberId);
  await handleChatCommand(denied, store);
  assert.equal(denied.payload.content, 'Você não possui permissão para utilizar este comando.');
  assert.equal(fetchCount, 0);

  const invalid = makeInteraction('abc', { authorized: true });
  await handleChatCommand(invalid, store);
  assert.equal(invalid.payload.content, 'Membro não encontrado.');
  assert.equal(fetchCount, 0);

  const visor = makeInteraction(memberId, { authorized: true });
  await handleChatCommand(visor, store);
  const embed = visor.payload.embeds[0].toJSON();
  const embedText = embed.fields.map((field) => `${field.name}\n${field.value}`).join('\n');
  assert.equal(embed.title, '👁️ Visor de Membro');
  assert.match(embedText, /@usuario/);
  assert.match(embedText, new RegExp(memberId));
  assert.match(embedText, /Moderador/);
  assert.match(embedText, /Equipe/);
  assert.doesNotMatch(embedText, /@everyone/);
  assert.match(embedText, /Online/);
  assert.match(embedText, /Gerenciar mensagens/);

  const missing = makeInteraction('12345678901234568', { authorized: true });
  await handleChatCommand(missing, store);
  assert.equal(missing.payload.content, 'Membro não encontrado.');
});

test('/cone onde-fica lista e busca canais cadastrados por staff em cada servidor', async (t) => {
  const store = await createStore(t);
  const coneCommand = commands.find((command) => command.name === 'cone');
  assert.ok(coneCommand.options.some((option) => option.name === 'onde-fica'));
  assert.ok(commands.some((command) => command.name === 'coneondeficaconfig'
    && command.options.some((option) => option.name === 'add')));

  const channelId = '12345678901234567';
  const textChannel = { id: channelId, isTextBased: () => true };
  const guild = { id: 'guild-1', channels: { fetch: async (id) => id === channelId ? textChannel : null } };
  const addChannel = interactionBase({
    commandName: 'coneondeficaconfig',
    guild,
    options: {
      getSubcommand: () => 'add',
      getString: (name) => name === 'id' ? channelId : 'Sala de Reforço',
    },
    reply: async (payload) => { addChannel.payload = payload; },
  });
  await handleChatCommand(addChannel, store);
  assert.match(addChannel.payload.content, /Canal adicionado/);
  assert.equal((await new ConfigStore(store.filePath).getActiveProfile('guild-1')).general.customChannels[0].name, 'Sala de Reforço');

  const findChannel = interactionBase({
    commandName: 'cone',
    guild,
    options: { getSubcommand: () => 'onde-fica', getString: () => 'sala de reforço' },
    reply: async (payload) => { findChannel.payload = payload; },
  });
  await handleChatCommand(findChannel, store);
  assert.equal(findChannel.payload.content, `📍 Sala de Reforço fica aqui: <#${channelId}>`);

  for (const name of ['Sala do Futuro', 'CMSP']) {
    const removedLegacyLocation = interactionBase({
      commandName: 'cone',
      guild,
      options: { getSubcommand: () => 'onde-fica', getString: () => name },
      reply: async (payload) => { removedLegacyLocation.payload = payload; },
    });
    await handleChatCommand(removedLegacyLocation, store);
    assert.equal(removedLegacyLocation.payload.content, `Não encontrei o canal **${name}**.`);
  }

  const listChannels = interactionBase({
    commandName: 'cone',
    guild,
    options: { getSubcommand: () => 'onde-fica', getString: () => null },
    reply: async (payload) => { listChannels.payload = payload; },
  });
  await handleChatCommand(listChannels, store);
  assert.ok(listChannels.payload.content.includes(`Sala de Reforço → <#${channelId}>`));

  const unauthorized = interactionBase({
    commandName: 'coneondeficaconfig',
    guild,
    member: { roles: { cache: new Map() } },
    memberPermissions: { has: () => false },
    options: { getSubcommand: () => 'add', getString: () => channelId },
    reply: async (payload) => { unauthorized.payload = payload; },
  });
  await handleChatCommand(unauthorized, store);
  assert.equal(unauthorized.payload.content, 'Isso é para staff, sai daqui kkk');
  assert.equal((await store.getActiveProfile('another-guild')).general.customChannels.length, 0);
});

test('catálogo de canais mantém metadados sem IDs globais', async (t) => {
  assert.equal(Object.keys(SERVER_CHANNELS).length, 17);
  assert.ok(Object.values(SERVER_CHANNELS).every((channel) => !('id' in channel)));
  const profile = await (await createStore(t)).getActiveProfile('new-guild');
  assert.ok(Object.values(profile.general.channelIds).every((id) => id === ''));
});

test('o proprietário é carregado somente pela variável ISEKAY_USER_ID', () => {
  const previous = process.env.ISEKAY_USER_ID;
  process.env.ISEKAY_USER_ID = '11111111111111111';
  try {
    assert.equal(isIsekayUser('11111111111111111'), true);
    assert.equal(isSpeakStaff({ id: '11111111111111111' }), true);
  } finally {
    if (previous === undefined) delete process.env.ISEKAY_USER_ID;
    else process.env.ISEKAY_USER_ID = previous;
  }
});

test('workspace recebe ZIP e publica o arquivo no painel V2', async (t) => {
  const store = await createStore(t);
  const previousOwner = process.env.ISEKAY_USER_ID;
  process.env.ISEKAY_USER_ID = '11111111111111111';
  t.after(() => {
    if (previousOwner === undefined) delete process.env.ISEKAY_USER_ID;
    else process.env.ISEKAY_USER_ID = previousOwner;
  });
  const ownerId = process.env.ISEKAY_USER_ID;
  const section = interactionBase({
    customId: 'speak:config:section',
    user: { id: ownerId },
    values: ['workspace'],
    isStringSelectMenu: () => true,
    update: async (payload) => { section.payload = payload; },
  });
  await handleComponent(section, store);
  assert.equal(section.payload.components[0].components[0].data.custom_id, 'speak:config:sub:workspace');

  const filesMenu = interactionBase({
    customId: 'speak:config:sub:workspace',
    user: { id: ownerId },
    values: ['files'],
    isStringSelectMenu: () => true,
    update: async (payload) => { filesMenu.payload = payload; },
  });
  await handleComponent(filesMenu, store);
  assert.equal(filesMenu.payload.components[0].components[0].data.custom_id, 'speak:config:workspace:upload');

  const uploadStart = interactionBase({
    customId: 'speak:config:workspace:upload',
    user: { id: ownerId },
    channelId: 'upload-channel',
    reply: async (payload) => { uploadStart.payload = payload; },
  });
  await handleComponent(uploadStart, store);
  const uploadMessage = {
    author: { id: ownerId, bot: false },
    member: {},
    guild: { id: 'guild-1' },
    channel: { id: 'upload-channel' },
    attachments: new Map([['zip', {
      name: 'project.zip', size: 4,
      url: 'data:application/zip;base64,UEsDBA==',
    }]]),
    reply: async (payload) => { uploadMessage.payload = payload; },
  };
  assert.equal(await handleWorkspaceUpload(uploadMessage, store), true);
  const integrateId = uploadMessage.payload.components[0].components[0].data.custom_id;
  const integrate = interactionBase({
    customId: integrateId,
    user: { id: ownerId },
    update: async (payload) => { integrate.payload = payload; },
  });
  await handleComponent(integrate, store);
  assert.match(integrate.payload.content, /integrado ao workspace/);
  assert.equal((await store.getActiveProfile('guild-1')).workspace.archive.name, 'project.zip');

  let sentPanel;
  const panel = interactionBase({
    commandName: 'cone',
    user: { id: ownerId },
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => 'painel',
      getChannel: () => ({ id: 'panel', send: async (payload) => { sentPanel = payload; } }),
      getString: () => 'v2',
    },
    reply: async (payload) => { panel.payload = payload; },
  });
  await handleChatCommand(panel, store);
  assert.equal(sentPanel.files[0].name, 'project.zip');
  assert.equal(sentPanel.embeds[0].data.fields[0].name, 'SPEAK Workspace');
});

test('perfis persistidos antes dos planos recebem defaults sem perder configuração', async (t) => {
  const store = await createStore(t);
  await fs.writeFile(store.filePath, JSON.stringify({
    '11111111111111111': {
      activeProfileId: 'speak',
      profiles: { speak: { name: 'Legado', panel: { title: 'Painel legado' } } },
    },
  }));
  const profile = await store.getActiveProfile('11111111111111111');
  assert.equal(profile.name, 'Legado');
  assert.equal(profile.panel.title, 'Painel legado');
  assert.deepEqual(profile.plans, []);
  assert.deepEqual(profile.accesses, []);
  assert.deepEqual(profile.admin.pendingActions, {});
});

test('todos os formulários de configuração produzem campos válidos para o Discord', async (t) => {
  const store = await createStore(t);
  const cases = [
    ['speak:config:section', 'general'],
    ['speak:config:section', 'payment'],
    ['speak:config:section', 'speakRole'],
    ['speak:config:section', 'ai'],
    ['speak:config:section', 'permissions'],
    ['speak:config:sub:panel', 'content'],
    ['speak:config:sub:panel', 'appearance'],
    ['speak:config:sub:panel', 'labels'],
    ['speak:config:sub:ticket', 'settings'],
    ['speak:config:sub:ticket', 'identity'],
    ['speak:config:sub:ai', 'settings'],
    ['speak:config:sub:ai', 'knowledge'],
  ];

  for (const [customId, value] of cases) {
    const interaction = interactionBase({
      customId,
      values: [value],
      isStringSelectMenu: () => true,
      showModal: async (modal) => { interaction.modal = modal; },
      update: async (payload) => { interaction.updatePayload = payload; },
    });
    await handleComponent(interaction, store);
    if (customId === 'speak:config:section' && value === 'ai') {
      assert.equal(interaction.updatePayload.components.length, 2);
      assert.deepEqual(interaction.updatePayload.components.map((row) => row.components.length), [2, 2]);
      assert.deepEqual(interaction.updatePayload.components.flatMap((row) => row.components.map((item) => item.data.custom_id)), [
        'speak:config:ai:enabled:true', 'speak:config:ai:enabled:false',
        'speak:config:ai:emojisEnabled:true', 'speak:config:ai:emojisEnabled:false',
      ]);
      continue;
    }
    if (customId === 'speak:config:sub:ai') {
      assert.equal(interaction.updatePayload.components.flatMap((row) => row.components).length, 4);
      continue;
    }
    if (customId === 'speak:config:section' && ['panel', 'ticket', 'ai', 'permissions'].includes(value)) {
      const expectedId = value === 'permissions' ? 'speak:config:permissions:area' : `speak:config:sub:${value}`;
      assert.equal(interaction.updatePayload.components[0].components[0].data.custom_id, expectedId);
      continue;
    }
    assert.ok(interaction.modal, `${customId}:${value} deve abrir um modal`);
    for (const row of interaction.modal.components) {
      const label = row.components[0].data.label;
      assert.ok(label.length <= 45, `label acima do limite: ${label}`);
    }
  }
});

test('configuração abre menus/modais, publica painel e mantém dados no armazenamento', async (t) => {
  const store = await createStore(t);
  const configReply = interactionBase({
    commandName: 'cone',
    isChatInputCommand: () => true,
    options: { getSubcommand: () => 'config' },
    reply: async (payload) => { configReply.payload = payload; },
  });
  await handleInteraction(configReply, store);
  assert.equal(configReply.payload.components[0].components[0].data.custom_id, 'speak:config:section');

  const sectionSelect = interactionBase({
    customId: 'speak:config:section',
    values: ['ticket'],
    isStringSelectMenu: () => true,
    update: async (payload) => { sectionSelect.payload = payload; },
  });
  await handleInteraction(sectionSelect, store);
  assert.equal(sectionSelect.payload.components[0].components[0].data.custom_id, 'speak:config:tickets:edit:panel');

  const ticketSettings = interactionBase({
    customId: 'speak:config:tickets:edit:category',
    isButton: () => true,
    showModal: async (modal) => { ticketSettings.modal = modal; },
  });
  await handleComponent(ticketSettings, store);
  assert.equal(ticketSettings.modal.data.custom_id, 'speak:config:tickets:save:category');

  const ticketSettingsSubmit = interactionBase({
    customId: 'speak:config:tickets:save:category',
    isModalSubmit: () => true,
    fields: { fields: { map: (callback) => [
      { customId: 'categoryId', value: '12345678901234567' },
    ].map(callback) } },
    reply: async (payload) => { ticketSettingsSubmit.payload = payload; },
  });
  await handleModal(ticketSettingsSubmit, store);
  assert.equal(ticketSettingsSubmit.payload.content, 'Configuração de Tickets salva.');
  const ticketLogsSubmit = interactionBase({
    customId: 'speak:config:tickets:save:logs',
    isModalSubmit: () => true,
    fields: { fields: { map: (callback) => [
      { customId: 'logsChannelId', value: '23456789012345678' },
    ].map(callback) } },
    reply: async (payload) => { ticketLogsSubmit.payload = payload; },
  });
  await handleModal(ticketLogsSubmit, store);
  const ticketStaffSubmit = interactionBase({
    customId: 'speak:config:tickets:save:staff',
    isModalSubmit: () => true,
    fields: { fields: { map: (callback) => [
      { customId: 'staffRoleIds', value: '34567890123456789' },
    ].map(callback) } },
    reply: async (payload) => { ticketStaffSubmit.payload = payload; },
  });
  await handleModal(ticketStaffSubmit, store);
  const ticketMessageSubmit = interactionBase({
    customId: 'speak:config:tickets:save:message',
    isModalSubmit: () => true,
    fields: { fields: { map: (callback) => [
      { customId: 'initialMessage', value: 'Central de atendimento.' },
      { customId: 'closingMessage', value: 'Atendimento encerrado.' },
    ].map(callback) } },
    reply: async (payload) => { ticketMessageSubmit.payload = payload; },
  });
  await handleModal(ticketMessageSubmit, store);
  const adminLogsSubmit = interactionBase({
    customId: 'speak:config:save:general:settings',
    isModalSubmit: () => true,
    fields: { fields: { map: (callback) => [
      { customId: 'adminLogChannelId', value: '45678901234567890' },
    ].map(callback) } },
    reply: async (payload) => { adminLogsSubmit.payload = payload; },
  });
  await handleModal(adminLogsSubmit, store);
  assert.equal((await store.getActiveProfile('guild-1')).admin.logChannelId, '45678901234567890');
  const configuredTicket = await store.getActiveProfile('guild-1');
  assert.equal(configuredTicket.ticket.categoryId, '12345678901234567');
  assert.equal(configuredTicket.ticket.logsChannelId, '23456789012345678');
  assert.deepEqual(configuredTicket.ticket.staffRoleIds, ['34567890123456789']);
  assert.equal(configuredTicket.ticket.initialMessage, 'Central de atendimento.');
  assert.equal(configuredTicket.ticket.closingMessage, 'Atendimento encerrado.');

  let sentPanel;
  const targetChannel = { id: 'text-channel', send: async (payload) => { sentPanel = payload; } };
  const panelCommand = interactionBase({
    commandName: 'cone',
    isChatInputCommand: () => true,
    options: { getSubcommand: () => 'painel', getChannel: () => targetChannel },
    reply: async (payload) => { panelCommand.payload = payload; },
  });
  await handleChatCommand(panelCommand, store);
  assert.equal(sentPanel.components[0].components.length, 5);
  assert.deepEqual(sentPanel.components[0].components.map((component) => component.data.custom_id), [
    'speak:payment', 'speak:coupon', 'speak:support', 'speak:login', 'speak:reset',
  ]);
  assert.deepEqual(
    sentPanel.components[0].components.map((component) => component.data.style),
    Array(5).fill(ButtonStyle.Secondary),
  );

  const restartedStore = new ConfigStore(store.filePath);
  const savedProfile = await restartedStore.getActiveProfile('guild-1');
  assert.equal(savedProfile.panel.channelId, 'text-channel');
  assert.equal(savedProfile.ticket.categoryId, '12345678901234567');
  assert.equal(savedProfile.ticket.logsChannelId, '23456789012345678');
  assert.equal(savedProfile.admin.logChannelId, '45678901234567890');
});

test('prefixo configurável exige !, persiste por servidor e Vínculos permanece reservado', async (t) => {
  const store = await createStore(t);
  assert.deepEqual((await store.getActiveProfile('guild-1')).ticket.staffRoleIds, []);
  const prefixMenu = interactionBase({
    customId: 'speak:config:section',
    values: ['prefix'],
    isStringSelectMenu: () => true,
    showModal: async (modal) => { prefixMenu.modal = modal; },
  });
  await handleComponent(prefixMenu, store);
  assert.equal(prefixMenu.modal.data.custom_id, 'speak:config:save:prefix:settings');

  const submitPrefix = async (value) => {
    const interaction = interactionBase({
      customId: 'speak:config:save:prefix:settings',
      isModalSubmit: () => true,
      fields: { fields: { map: (callback) => [{ customId: 'prefix', value }].map(callback) } },
      reply: async (payload) => { interaction.payload = payload; },
    });
    return { interaction, result: await handleModal(interaction, store) };
  };
  await submitPrefix('!cone');
  assert.equal((await new ConfigStore(store.filePath).getActiveProfile('guild-1')).general.prefix, '!cone');
  assert.equal((await store.getActiveProfile('another-guild')).general.prefix, '!cone');
  await assert.rejects(() => submitPrefix('?c'), /deve começar com !/);
  await assert.rejects(() => submitPrefix('cone'), /deve começar com !/);

  const channelsSection = interactionBase({
    customId: 'speak:config:section',
    values: ['channels'],
    isStringSelectMenu: () => true,
    update: async (payload) => { channelsSection.payload = payload; },
  });
  await handleComponent(channelsSection, store);
  assert.equal(channelsSection.payload.components[0].components[0].data.custom_id, 'speak:config:sub:channels');
  const platformsModal = interactionBase({
    customId: 'speak:config:sub:channels',
    values: ['platforms'],
    isStringSelectMenu: () => true,
    showModal: async (modal) => { platformsModal.modal = modal; },
  });
  await handleComponent(platformsModal, store);
  assert.equal(platformsModal.modal.data.custom_id, 'speak:config:save:channels:platforms');
  const channelsSubmit = interactionBase({
    customId: 'speak:config:save:channels:platforms',
    isModalSubmit: () => true,
    fields: { fields: { map: (callback) => [
      { customId: 'channel_speak', value: TEST_CHANNEL_IDS.speak },
    ].map(callback) } },
    reply: async (payload) => { channelsSubmit.payload = payload; },
  });
  await handleModal(channelsSubmit, store);
  assert.equal((await new ConfigStore(store.filePath).getActiveProfile('guild-1')).general.channelIds.speak, TEST_CHANNEL_IDS.speak);
  const configuredLocation = await dispatchSpeakText('onde fica speak?', {
    profile: await store.getActiveProfile('guild-1'), format: 'prefix', guildId: 'guild-1',
  });
  assert.equal(configuredLocation.content, `🎤 SPEAK fica aqui: <#${TEST_CHANNEL_IDS.speak}>`);
  const unconfigured = await dispatchSpeakText('onde fica matific?', {
    profile: await store.getActiveProfile('another-guild'), format: 'prefix', guildId: 'another-guild',
  });
  assert.match(unconfigured.content, /ainda não foi configurado neste servidor/);

  const createMessage = (content) => {
    const message = {
      content,
      author: { id: 'staff-user', username: 'staff' },
      member: { roles: { cache: new Map([[process.env.SPEAK_STAFF_ROLE_ID || '1536253284309008445', { id: process.env.SPEAK_STAFF_ROLE_ID || '1536253284309008445' }]]) } },
      guild: { id: 'guild-1', channels: { fetch: async () => null } },
      channel: { id: 'source-channel' },
      reply: async (payload) => { message.replyPayload = payload; },
    };
    return message;
  };
  const configuredPrefixMessage = createMessage('!cone ticket');
  assert.equal(await handlePrefixWorkflow(configuredPrefixMessage, store, '!cone'), true);
  assert.match(configuredPrefixMessage.replyPayload.content, /categoria de tickets/);
  assert.equal(await handlePrefixWorkflow(createMessage('cone ticket'), store, '!cone'), false);
  assert.equal(await handlePrefixWorkflow(createMessage('?cone ticket'), store, '!cone'), false);
  assert.equal(await handlePrefixWorkflow(createMessage('!s ticket'), store, '!cone'), false);

  const linksMenu = interactionBase({
    customId: 'speak:config:section',
    values: ['links'],
    isStringSelectMenu: () => true,
    update: async (payload) => { linksMenu.payload = payload; },
  });
  await handleComponent(linksMenu, store);
  assert.match(linksMenu.payload.content, /ainda não está disponível/i);
});

test('!cone config e !cone painel reutilizam o handler autorizado do Slash', async (t) => {
  const store = await createStore(t);
  const unauthorizedConfig = interactionBase({
    user: { id: 'ordinary-user' },
    member: { roles: { cache: new Map() } },
    commandName: 'cone',
    options: { getSubcommand: () => 'config' },
    isChatInputCommand: () => true,
    reply: async (payload) => { unauthorizedConfig.payload = payload; },
  });
  await handleChatCommand(unauthorizedConfig, store);
  assert.equal(unauthorizedConfig.payload.content, 'Isso é para staff, sai daqui kkk');
  assert.equal(unauthorizedConfig.payload.flags, 64);
  assert.equal(unauthorizedConfig.payload.components, undefined);

  const staffRoleId = process.env.SPEAK_STAFF_ROLE_ID || '1536253284309008445';
  const panelChannel = {
    id: '77777777777777777',
    isTextBased: () => true,
    send: async (payload) => { panelChannel.payload = payload; },
  };
  const baseGuild = {
    id: 'guild-1',
    channels: { fetch: async (id) => id === panelChannel.id ? panelChannel : null },
  };
  const staffMember = { roles: { cache: new Map([[staffRoleId, { id: staffRoleId }]]) } };
  const replies = [];
  const staffMessage = (content, member = staffMember) => ({
    content,
    author: { id: 'staff-user', username: 'staff' },
    member,
    guild: baseGuild,
    channel: { id: 'source-channel' },
    reply: async (payload) => {
      const message = { ...payload, delete: async () => {} };
      replies.push(message);
      return message;
    },
  });

  assert.equal(await handlePrefixWorkflow(staffMessage('!cone config'), store), true);
  assert.equal(replies[0].components[0].components[0].data.custom_id, 'speak:config:section');
  assert.equal(await handlePrefixWorkflow(staffMessage('!cone painel <#77777777777777777>'), store), true);
  assert.equal(panelChannel.payload.embeds[0].data.color, 0xffffff);

  await handlePrefixWorkflow(staffMessage('!cone config', { roles: { cache: new Map() } }), store);
  assert.equal(replies.at(-1).content, 'Isso é para staff, sai daqui kkk');
});

test('configurações operacionais e base confiável da IA persistem após reiniciar o armazenamento', async (t) => {
  const store = await createStore(t);
  const fields = [
    { customId: 'enabled', value: 'true' },
    { customId: 'channelId', value: '12345678901234567' },
    { customId: 'fallbackMessage', value: 'Resposta encaminhada à equipe.' },
    { customId: 'model', value: 'z-ai/glm-5.3' },
    { customId: 'instructions', value: 'Use tom cordial.' },
  ];
  const settingsSubmit = interactionBase({
    customId: 'speak:config:save:ai:settings',
    isModalSubmit: () => true,
    fields: { fields: { map: (callback) => fields.map(callback) } },
    reply: async (payload) => { settingsSubmit.payload = payload; },
  });
  await handleModal(settingsSubmit, store);

  const knowledgeSubmit = interactionBase({
    customId: 'speak:config:save:ai:knowledge',
    isModalSubmit: () => true,
    fields: { fields: { map: (callback) => [ { customId: 'knowledge', value: 'Acesso pelo portal SPEAK.' } ].map(callback) } },
    reply: async (payload) => { knowledgeSubmit.payload = payload; },
  });
  await handleModal(knowledgeSubmit, store);

  const profile = await new ConfigStore(store.filePath).getActiveProfile('guild-1');
  assert.equal(profile.ai.enabled, true);
  assert.equal(profile.ai.channelId, '12345678901234567');
  assert.equal(profile.ai.fallbackMessage, 'Resposta encaminhada à equipe.');
  assert.equal(profile.ai.model, 'z-ai/glm-5.3');
  assert.equal(profile.ai.instructions, 'Use tom cordial.');
  assert.equal(profile.ai.knowledge, 'Acesso pelo portal SPEAK.');
});

test('ticket fica privado para usuário/equipe e o fechamento remove acesso do usuário', async (t) => {
  const store = await createStore(t);
  const staffRoleId = '34567890123456789';
  const requesterId = '12345678901234567';
  await store.updateActiveProfile('guild-1', (profile) => {
    profile.ticket.categoryId = '12345678901234567';
    profile.ticket.staffRoleIds = [staffRoleId];
    profile.ai.enabled = true;
    profile.ai.knowledge = 'O acesso é realizado pelo portal SPEAK.';
  });
  let createOptions;
  let ticketMessage;
  const ticketChannel = {
    id: 'ticket-channel',
    parentId: '12345678901234567',
    send: async (message) => { ticketMessage = message; },
    permissionOverwrites: { edit: async (id, permissions) => { ticketChannel.closed = { id, permissions }; } },
    topic: `speak-ticket:${requesterId}`,
  };
  const guild = {
    roles: { everyone: { id: 'everyone' } },
    channels: {
      fetch: async () => ({ id: '12345678901234567', type: ChannelType.GuildCategory }),
      create: async (options) => { createOptions = options; return ticketChannel; },
    },
  };
  const supportButton = interactionBase({
    customId: 'speak:support',
    user: { id: requesterId, username: 'Test User' },
    guild,
    client: { user: { id: 'bot-user' } },
    isButton: () => true,
    reply: async (payload) => { supportButton.payload = payload; },
  });
  await handlePanelButton(supportButton, await store.getActiveProfile('guild-1'), store);

  const requesterPermissions = createOptions.permissionOverwrites.find((overwrite) => overwrite.id === requesterId);
  const staffPermissions = createOptions.permissionOverwrites.find((overwrite) => overwrite.id === staffRoleId);
  const publicPermissions = createOptions.permissionOverwrites.find((overwrite) => overwrite.id === 'everyone');
  assert.ok(requesterPermissions.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(staffPermissions.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(publicPermissions.deny.includes(PermissionFlagsBits.ViewChannel));
  assert.equal(createOptions.parent, '12345678901234567');
  assert.equal(ticketMessage.components[0].components.length, 3);
  assert.equal(ticketMessage.components[1].components.length, 4);

  const aiButton = interactionBase({
    customId: 'speak:ticket:ai',
    user: { id: requesterId, username: 'Test User' },
    channel: ticketChannel,
    channelId: 'ticket-channel',
    isButton: () => true,
    showModal: async (modal) => { aiButton.modal = modal; },
  });
  await handleTicketButton(aiButton, await store.getActiveProfile('guild-1'));
  assert.equal(aiButton.modal.data.custom_id, 'speak:ai:ask');

  const closeButton = interactionBase({
    customId: 'speak:ticket:close',
    user: { id: requesterId, username: 'Test User' },
    guild,
    channel: ticketChannel,
    isButton: () => true,
    update: async (payload) => { closeButton.payload = payload; },
    reply: async (payload) => { closeButton.errorPayload = payload; },
  });
  await handleTicketButton(closeButton, await store.getActiveProfile('guild-1'));
  assert.equal(ticketChannel.closed, undefined);
  assert.match(closeButton.errorPayload.content, /tem certeza/i);
  const confirmId = closeButton.errorPayload.components[0].components[0].data.custom_id;
  const confirmClose = interactionBase({
    customId: confirmId,
    user: { id: requesterId, username: 'Test User' },
    guild,
    channel: ticketChannel,
    isButton: () => true,
    update: async (payload) => { confirmClose.payload = payload; },
    reply: async (payload) => { confirmClose.errorPayload = payload; },
  });
  await handleTicketButton(confirmClose, await store.getActiveProfile('guild-1'), store);
  assert.deepEqual(ticketChannel.closed, {
    id: requesterId,
    permissions: { ViewChannel: false, SendMessages: false },
  });
  assert.equal(confirmClose.payload.content, 'Este ticket foi fechado pela equipe.');
});

test('painel de Tickets publica, evita duplicidade, chama Staff e gera transcript ao fechar', async (t) => {
  const store = await createStore(t);
  const requesterId = '12345678901234567';
  const staffRoleId = '34567890123456789';
  const categoryId = '45678901234567890';
  const panelChannelId = '56789012345678901';
  const transcriptChannelId = '67890123456789012';
  const logsChannelId = '78901234567890123';
  await store.updateActiveProfile('guild-1', (profile) => {
    profile.ticket.categoryId = categoryId;
    profile.ticket.panelChannelId = panelChannelId;
    profile.ticket.staffRoleIds = [staffRoleId];
    profile.ticket.transcriptsEnabled = true;
    profile.ticket.transcriptsChannelId = transcriptChannelId;
    profile.ticket.logsChannelId = logsChannelId;
  });

  let panelPayload;
  let ticketCreates = 0;
  const panelChannel = {
    id: panelChannelId,
    isTextBased: () => true,
    send: async (payload) => { panelPayload = payload; return { id: 'panel-message' }; },
  };
  const transcriptPosts = [];
  const transcriptChannel = {
    id: transcriptChannelId,
    isTextBased: () => true,
    send: async (payload) => { transcriptPosts.push(payload); },
  };
  const logPosts = [];
  const logsChannel = {
    id: logsChannelId,
    isTextBased: () => true,
    send: async (payload) => { logPosts.push(payload); },
  };
  const transcriptMessages = new Map([['message-1', {
    id: 'message-1',
    createdTimestamp: Date.parse('2025-02-03T04:05:06Z'),
    author: { tag: 'requester#0001' },
    content: 'Preciso de ajuda.',
    attachments: new Map(),
  }]]);
  transcriptMessages.last = () => [...transcriptMessages.values()].at(-1);
  const ticketChannel = {
    id: 'ticket-channel',
    parentId: categoryId,
    topic: `speak-ticket:${requesterId}`,
    send: async (payload) => { ticketChannel.lastPayload = payload; },
    messages: { fetch: async () => transcriptMessages },
    permissionOverwrites: { edit: async (id, permissions) => { ticketChannel.closed = { id, permissions }; } },
  };
  const category = { id: categoryId, type: ChannelType.GuildCategory };
  const guild = {
    id: 'guild-1',
    roles: { everyone: { id: 'everyone' } },
    channels: {
      cache: { find: () => null },
      fetch: async (id) => ({
        [categoryId]: category,
        [panelChannelId]: panelChannel,
        [transcriptChannelId]: transcriptChannel,
        [logsChannelId]: logsChannel,
        'ticket-channel': ticketChannel,
      })[id] || null,
      create: async (options) => { ticketCreates += 1; ticketChannel.options = options; return ticketChannel; },
    },
  };
  const staffId = process.env.SPEAK_STAFF_ROLE_ID;
  const staffMember = { roles: { cache: new Map([[staffId, { id: staffId }]]) } };
  const launch = interactionBase({
    customId: 'speak:config:tickets:launch',
    guild,
    member: staffMember,
    isButton: () => true,
    reply: async (payload) => { launch.payload = payload; },
  });
  await handleComponent(launch, store);
  assert.equal(launch.payload.content, `Painel de Tickets publicado em ${panelChannel}.`);
  assert.equal(panelPayload.components[0].components[0].data.custom_id, 'speak:ticket:open');
  assert.equal((await store.getActiveProfile('guild-1')).ticket.panelMessageId, 'panel-message');

  const ticketSection = interactionBase({
    customId: 'speak:config:section', values: ['ticket'],
    isStringSelectMenu: () => true,
    update: async (payload) => { ticketSection.payload = payload; },
  });
  await handleComponent(ticketSection, store);
  assert.deepEqual(ticketSection.payload.components.map((row) => row.components.length), [5, 5, 4]);

  const openTicket = async () => {
    const interaction = interactionBase({
      customId: 'speak:ticket:open',
      user: { id: requesterId, username: 'requester' },
      guild,
      client: { user: { id: 'bot-user' } },
      isButton: () => true,
      reply: async (payload) => { interaction.payload = payload; },
    });
    await handleInteraction(interaction, store);
    return interaction;
  };
  const opened = await openTicket();
  assert.equal(ticketCreates, 1);
  assert.equal(ticketChannel.options.parent, categoryId);
  assert.ok(ticketChannel.options.permissionOverwrites.some((overwrite) => overwrite.id === staffRoleId));
  assert.equal(opened.payload.content, `Seu ticket foi criado: ${ticketChannel}`);
  const duplicate = await openTicket();
  assert.match(duplicate.payload.content, /já possui um ticket aberto/);
  assert.equal(ticketCreates, 1);

  const callStaff = interactionBase({
    customId: 'speak:ticket:call',
    user: { id: requesterId },
    guild,
    channel: ticketChannel,
    isButton: () => true,
    reply: async (payload) => { callStaff.payload = payload; },
  });
  await handleTicketButton(callStaff, await store.getActiveProfile('guild-1'), store);
  assert.deepEqual(ticketChannel.lastPayload.allowedMentions.roles, [staffRoleId]);
  assert.equal(callStaff.payload.content, 'A equipe foi chamada.');
  const cooldownCall = interactionBase({
    customId: 'speak:ticket:call',
    user: { id: requesterId },
    guild,
    channel: ticketChannel,
    isButton: () => true,
    reply: async (payload) => { cooldownCall.payload = payload; },
  });
  await handleTicketButton(cooldownCall, await store.getActiveProfile('guild-1'), store);
  assert.match(cooldownCall.payload.content, /recentemente/);

  const close = interactionBase({
    customId: 'speak:ticket:close',
    user: { id: requesterId },
    guild,
    channel: ticketChannel,
    isButton: () => true,
    reply: async (payload) => { close.payload = payload; },
  });
  await handleTicketButton(close, await store.getActiveProfile('guild-1'), store);
  const closeConfirm = interactionBase({
    customId: close.payload.components[0].components[0].data.custom_id,
    user: { id: requesterId },
    guild,
    channel: ticketChannel,
    isButton: () => true,
    update: async (payload) => { closeConfirm.payload = payload; },
  });
  await handleTicketButton(closeConfirm, await store.getActiveProfile('guild-1'), store);
  assert.equal(transcriptPosts.length, 1);
  assert.match(transcriptPosts[0].files[0].name, /ticket-channel-transcript/);
  assert.deepEqual(ticketChannel.closed, { id: requesterId, permissions: { ViewChannel: false, SendMessages: false } });
  assert.equal((await store.getActiveProfile('guild-1')).ticket.records[0].status, 'closed');
  assert.ok(logPosts.some((payload) => /Ticket fechado/.test(payload.content)));
});

test('acessos limitam duplicidade e quantidade; reset seletivo e contador sobrevivem a reinício', async (t) => {
  const store = await createStore(t);
  let access = new AccessService(store, 'test-encryption-key');
  assert.equal(await access.add('guild-1', 'user-1', '123456-SP', 'PASSWORD_SENTINEL'), 'ADDED');
  assert.equal(await access.add('guild-1', 'user-1', '998877-RJ', 'secret-two'), 'ADDED');
  assert.equal(await access.add('guild-1', 'user-1', '123456-sp', 'secret-three'), 'DUPLICATE');
  assert.equal(await access.add('guild-1', 'user-1', '777777-MG', 'secret-four'), 'LIMIT');

  let accounts = await access.list('guild-1', 'user-1');
  assert.equal((await access.reset('guild-1', 'user-1', accounts[0].id)).status, 'RESET');
  assert.deepEqual((await access.list('guild-1', 'user-1')).map((account) => account.ra), ['998877-RJ']);
  assert.equal(await access.add('guild-1', 'user-1', '777777-MG', 'secret-four'), 'ADDED');

  access = new AccessService(new ConfigStore(store.filePath), 'test-encryption-key');
  assert.equal((await access.getResetStatus('guild-1', 'user-1')).remaining, 1);
  accounts = await access.list('guild-1', 'user-1');
  assert.equal((await access.reset('guild-1', 'user-1', accounts[0].id)).status, 'RESET');
  accounts = await access.list('guild-1', 'user-1');
  assert.equal((await access.reset('guild-1', 'user-1', accounts[0].id)).status, 'LIMIT');

  access = new AccessService(new ConfigStore(store.filePath), 'test-encryption-key');
  assert.equal((await access.getResetStatus('guild-1', 'user-1')).remaining, 0);
  const persisted = await fs.readFile(store.filePath, 'utf8');
  assert.equal(persisted.includes('PASSWORD_SENTINEL'), false);
});

test('IA usa NVIDIA NIM com contexto educacional, protege dados e mantém fallback obrigatório', async () => {
  const previousAiKey = process.env.AI_API_KEY;
  const previousNvidiaKey = process.env.NVIDIA_API_KEY;
  process.env.AI_API_KEY = 'test-only-key';
  delete process.env.NVIDIA_API_KEY;
  try {
    let request;
    const fakeFetch = async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Veja o canal da plataforma correspondente.' } }] }) };
    };
    const config = {
      enabled: true,
      model: 'z-ai/glm-5.3',
      knowledge: 'O acesso à plataforma é feito pelo portal SPEAK.',
      fallbackMessage: 'Fallback da equipe.',
    };
    assert.equal(await askSpeak('Como funciona a Matific?', config, fakeFetch), 'Veja o canal da plataforma correspondente.');
    assert.equal(request.url, NIM_CHAT_COMPLETIONS_URL);
    assert.equal(request.options.headers.Authorization, 'Bearer test-only-key');
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.model, 'z-ai/glm-5.3');
    assert.match(payload.messages[0].content, /Sala do Futuro/);
    assert.match(payload.messages[0].content, /CMSP/);
    assert.match(payload.messages[0].content, /Matific/);
    assert.doesNotMatch(payload.messages[0].content, /<#[0-9]{17,20}>/);

    process.env.NVIDIA_API_KEY = 'nvidia-primary-key';
    await askSpeak('Como funciona o SPEAK?', config, fakeFetch);
    assert.equal(request.options.headers.Authorization, 'Bearer nvidia-primary-key');
    delete process.env.NVIDIA_API_KEY;
    delete process.env.AI_API_KEY;
    process.env.NVIDIA_API_KEY = 'legacy-test-key';
    await askSpeak('Como funciona o SPEAK?', config, fakeFetch);
    assert.equal(request.options.headers.Authorization, 'Bearer legacy-test-key');
    process.env.AI_API_KEY = 'test-only-key';

    let called = false;
    const fetchSpy = async () => {
      called = true;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Oi! Como posso ajudar?' } }] }) };
    };
    assert.equal(await askSpeak('Minha senha: secret-value. Como acesso o SPEAK?', config, fetchSpy), 'Fallback da equipe.');
    let sensitiveRequestSent = false;
    const sensitiveFetch = async () => { sensitiveRequestSent = true; };
    assert.equal(await askSpeak('Minha senha é confidential-value', config, sensitiveFetch), 'Fallback da equipe.');
    assert.equal(await askSpeak('Meu contato é aluno@example.com', config, sensitiveFetch), 'Fallback da equipe.');
    assert.equal(sensitiveRequestSent, false);
    assert.equal(await askSpeak('Uma pergunta sem resposta conhecida', config, async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Não tenho certeza.' } }] }),
    })), 'Fallback da equipe.');
    assert.equal(await askSpeak('Olá, tudo bem?', { ...config, knowledge: '' }, fetchSpy), 'Oi! Como posso ajudar?');
    assert.equal(called, true);
  } finally {
    if (previousAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousAiKey;
    if (previousNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousNvidiaKey;
  }
});

test('fallback padrão é editável, respeitado e nunca ecoa uma credencial', () => {
  assert.equal(FALLBACK_MESSAGE, 'Amigo, não sei responder isso KKK 😭 Procure a equipe responsável pelo atendimento.');
  assert.equal(getFallback({ fallbackMessage: 'Resposta personalizada.' }), 'Resposta personalizada.');
  assert.equal(getFallback({ fallbackMessage: 'senha: valor-secreto' }), FALLBACK_MESSAGE);
});

test('contexto da IA usa somente os canais configurados no perfil do servidor', () => {
  const configuredContext = buildSafeServerContext({
    general: { channelIds: { speak: TEST_CHANNEL_IDS.speak } },
  });
  assert.match(configuredContext, new RegExp(`<#${TEST_CHANNEL_IDS.speak}>: SPEAK`));
  assert.doesNotMatch(buildSafeServerContext({ general: { channelIds: {} } }), /<#[0-9]{17,20}>/);
});

test('controles IA salvam estado e IA desligada não chama o modelo', async (t) => {
  const store = await createStore(t);
  const select = interactionBase({
    customId: 'speak:config:section',
    values: ['ai'],
    isStringSelectMenu: () => true,
    update: async (payload) => { select.payload = payload; },
  });
  await handleComponent(select, store);
  assert.equal(select.payload.components.flatMap((row) => row.components).length, 4);

  const aiOff = interactionBase({
    customId: 'speak:config:ai:enabled:false',
    update: async (payload) => { aiOff.payload = payload; },
  });
  await handleComponent(aiOff, store);
  assert.equal((await store.getActiveProfile('guild-1')).ai.enabled, false);

  const aiOn = interactionBase({
    customId: 'speak:config:ai:enabled:true',
    update: async (payload) => { aiOn.payload = payload; },
  });
  await handleComponent(aiOn, store);
  assert.equal((await new ConfigStore(store.filePath).getActiveProfile('guild-1')).ai.enabled, true);

  const emojisOff = interactionBase({
    customId: 'speak:config:ai:emojisEnabled:false',
    update: async (payload) => { emojisOff.payload = payload; },
  });
  await handleComponent(emojisOff, store);
  assert.equal((await new ConfigStore(store.filePath).getActiveProfile('guild-1')).ai.emojisEnabled, false);

  const emojisOn = interactionBase({
    customId: 'speak:config:ai:emojisEnabled:true',
    update: async (payload) => { emojisOn.payload = payload; },
  });
  await handleComponent(emojisOn, store);
  assert.equal((await store.getActiveProfile('guild-1')).ai.emojisEnabled, true);

  let nvidiaCalls = 0;
  const answer = await answerSpeakMessage({
    guildId: 'guild-1', channelId: 'channel-1', userId: 'user-1', text: 'Como funciona CMSP?',
    aiConfig: { enabled: false }, ask: async () => { nvidiaCalls += 1; },
  });
  assert.equal(answer, OFFLINE_MESSAGE);
  assert.equal(nvidiaCalls, 0);
});

test('/clear bloqueia usuários não autorizados com resposta ephemeral antes de buscar mensagens', async (t) => {
  const store = await createStore(t);
  const previousOwner = process.env.ISEKAY_USER_ID;
  process.env.ISEKAY_USER_ID = '99999999999999999';
  t.after(() => {
    if (previousOwner === undefined) delete process.env.ISEKAY_USER_ID;
    else process.env.ISEKAY_USER_ID = previousOwner;
  });
  let fetched = false;
  const interaction = interactionBase({
    user: { id: '22222222222222222' },
    member: { roles: { cache: new Map() } },
    commandName: 'clear',
    options: { getInteger: () => 20 },
    guild: { members: { me: {} }, channels: {} },
    channel: { messages: { fetch: async () => { fetched = true; } } },
    reply: async (payload) => { interaction.payload = payload; },
  });
  await handleClearCommand(interaction, store);
  assert.equal(interaction.payload.content, 'Isso é para staff, sai daqui kkk');
  assert.equal(interaction.payload.flags, 64);
  assert.equal(fetched, false);
});

test('!cone clear usa a mesma autorização e apaga a resposta de negação após cinco segundos', async (t) => {
  const store = await createStore(t);
  let deleted = false;
  let timer;
  let replyPayload;
  const message = {
    content: '!cone clear 10',
    author: { id: 'ordinary-user' },
    member: { roles: { cache: new Map() } },
    guild: { id: 'guild-1', members: { me: {} } },
    channel: {
      id: 'channel-1',
      messages: { fetch: async () => { assert.fail('não pode buscar mensagens sem autorização'); } },
    },
    reply: async (payload) => {
      replyPayload = payload;
      return {
      delete: async () => { deleted = true; },
      };
    },
  };
  assert.equal(await handlePrefixClear(message, store, {
    schedule: (callback, delay) => { timer = { callback, delay, unref() {} }; return timer; },
  }), true);
  assert.equal(replyPayload.content, 'Isso é para staff, sai daqui kkk');
  assert.equal(timer.delay, 5000);
  await timer.callback();
  assert.equal(deleted, true);
});

test('canais, localização, status e help usam o catálogo real e evitam NVIDIA em intenções determinísticas', async () => {
  let nvidiaCalls = 0;
  const context = {
    format: 'prefix', guildId: 'g', channelId: 'c', userId: 'u', ping: 42,
    profile: { ai: { enabled: true }, ticket: { categoryId: '' }, general: { channelIds: TEST_CHANNEL_IDS } },
    ask: async () => { nvidiaCalls += 1; return 'resposta da IA'; },
  };
  const channelMessage = await dispatchSpeakText('canais', context);
  for (const id of Object.values(TEST_CHANNEL_IDS)) {
    assert.ok(channelMessage.content.includes(`<#${id}>`));
    assert.equal(channelMessage.content.replaceAll(`<#${id}>`, '').includes(id), false);
  }
  assert.match((await dispatchSpeakText('status', context)).content, /IA: ON/);
  assert.match((await dispatchSpeakText('ping', context)).content, /🏓 Pong!.*42 ms/);

  const help = await dispatchSpeakText('help', context);
  const commandOutput = await dispatchSpeakText('commands', context);
  assert.match(help.content, /📍 Canais/);
  assert.match(commandOutput.content, /!cone clear <quantidade>/);
  assert.match(commandOutput.content, /!cone up <usuário> <motivo>/);
  assert.match(commandOutput.content, /!cone ticket/);
  const slashHelp = createCommandsMessage('slash');
  for (const option of commands.find((command) => command.name === 'cone').options) {
    assert.ok(slashHelp.includes(`/cone ${option.name}`), `help slash inclui /cone ${option.name}`);
  }
  assert.equal(nvidiaCalls, 0);
});

test('localizador resolve variações sem chamar IA e consultas como oi bb continuam conversacionais', async () => {
  let nvidiaCalls = 0;
  const context = {
    format: 'prefix', guildId: 'location-guild', channelId: 'location-channel', userId: 'location-user',
    profile: { ai: { enabled: true, fallbackMessage: FALLBACK_MESSAGE }, general: { channelIds: TEST_CHANNEL_IDS } },
    ask: async (question) => { nvidiaCalls += 1; return `Resposta natural para: ${question}`; },
  };
  const locations = [
    ['mano onde fica o speak?', `🎤 SPEAK fica aqui: <#${TEST_CHANNEL_IDS.speak}>`],
    ['onde fica speake', `🎤 SPEAK fica aqui: <#${TEST_CHANNEL_IDS.speak}>`],
    ['onde fica speek?', `🎤 SPEAK fica aqui: <#${TEST_CHANNEL_IDS.speak}>`],
    ['onde fica a matific?', `🧮 Matific fica aqui: <#${TEST_CHANNEL_IDS.matific}>`],
    ['qual é o canal da mathfic', `🧮 Matific fica aqui: <#${TEST_CHANNEL_IDS.matific}>`],
    ['onde está a redação?', `📝 Redação fica aqui: <#${TEST_CHANNEL_IDS.essays}>`],
    ['onde vejo o boletim', `📊 Boletim fica aqui: <#${TEST_CHANNEL_IDS.reportCard}>`],
    ['onde ficam as apostilas', `📚 Apostilas fica aqui: <#${TEST_CHANNEL_IDS.handouts}>`],
    ['onde faço minhas atividades?', `📋 Tarefas fica aqui: <#${TEST_CHANNEL_IDS.tasks}>`],
    ['me manda o canal do chat de ajuda', `💬 Ajuda IA fica aqui: <#${TEST_CHANNEL_IDS.aiHelp}>`],
  ];
  for (const [question, expected] of locations) {
    assert.equal((await dispatchSpeakText(question, context)).content, expected);
  }
  assert.equal(nvidiaCalls, 0);
  assert.equal((await dispatchSpeakText('oi bb', context)).content, 'Resposta natural para: oi bb');
  assert.equal(nvidiaCalls, 1);

  const naturalQuestions = [
    'oi', 'tudo bem?', 'quem é você?', 'pode me ajudar?', 'não estou conseguindo entrar',
    'como funciona o speak?',
  ];
  for (const question of naturalQuestions) {
    const result = await dispatchSpeakText(question, context);
    assert.equal(result.content, `Resposta natural para: ${question}`);
  }
  assert.equal(nvidiaCalls, naturalQuestions.length + 1);
});

test('/cone onde-fica usa a mesma localização determinística do prefixo', async (t) => {
  const store = await createStore(t);
  await store.updateActiveProfile('guild-1', (profile) => {
    profile.general.channelIds = { ...profile.general.channelIds, ...TEST_CHANNEL_IDS };
  });
  const direct = await dispatchSpeakText('onde fica a redação?', {
    format: 'prefix', guildId: 'guild-1', channelId: 'channel-1', userId: 'user-1',
    profile: { ai: { enabled: true }, general: { channelIds: TEST_CHANNEL_IDS } },
  });
  const slash = interactionBase({
    commandName: 'cone',
    client: { ws: { ping: 15 } },
    options: {
      getSubcommand: () => 'onde-fica',
      getString: () => 'redacao',
    },
    reply: async (payload) => { slash.payload = payload; },
  });
  await handleChatCommand(slash, store);
  assert.equal(slash.payload.content, direct.content);
  assert.equal(slash.payload.content, `📝 Redação fica aqui: <#${TEST_CHANNEL_IDS.essays}>`);
});

test('subcommands públicos slash usam o dispatcher compartilhado e respondem uma vez', async (t) => {
  const store = await createStore(t);
  await store.updateActiveProfile('guild-1', (profile) => { profile.ai.enabled = true; });
  const previousKey = process.env.NVIDIA_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.NVIDIA_API_KEY = 'test-nim-key';
  let aiRequests = 0;
  globalThis.fetch = async () => {
    aiRequests += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Resposta natural da IA.' } }] }) };
  };
  t.after(() => {
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  });

  const names = ['ping', 'help', 'commands', 'status', 'canais'];
  for (const name of names) {
    const text = name;
    const expected = await dispatchSpeakText(text, {
      format: 'slash', guildId: 'guild-1', channelId: 'channel-1', userId: 'user-1',
      profile: await store.getActiveProfile('guild-1'), ping: 50,
    });
    let replyCount = 0;
    const interaction = interactionBase({
      commandName: 'cone',
      client: { ws: { ping: 50 } },
      options: {
        getSubcommand: () => name,
        getString: () => 'matific',
      },
      reply: async (payload) => { replyCount += 1; interaction.payload = payload; },
    });
    await handleChatCommand(interaction, store);
    const normalize = (payload) => ({
      content: payload.content,
      embeds: payload.embeds?.map((embed) => embed.toJSON()),
      components: payload.components?.map((component) => component.toJSON()),
    });
    assert.deepEqual(normalize(interaction.payload), normalize(expected), name);
    assert.equal(replyCount, 1, `${name} deve responder uma vez`);
  }
  assert.equal(aiRequests, 0);
});

test('fala da IA não soube responder é editável e persiste em Falas', async (t) => {
  const store = await createStore(t);
  const section = interactionBase({
    customId: 'speak:config:section',
    values: ['phrases'],
    isStringSelectMenu: () => true,
    showModal: async (modal) => { section.modal = modal; },
  });
  await handleComponent(section, store);
  assert.equal(section.modal.data.custom_id, 'speak:config:save:phrases:settings');
  const modal = interactionBase({
    customId: 'speak:config:save:phrases:settings',
    isModalSubmit: () => true,
    fields: { fields: { map: (callback) => [
      { customId: 'fallbackMessage', value: 'Sem certeza, procure o suporte.' },
    ].map(callback) } },
    reply: async (payload) => { modal.payload = payload; },
  });
  await handleModal(modal, store);
  const restarted = await new ConfigStore(store.filePath).getActiveProfile('guild-1');
  assert.equal(getFallback(restarted.ai), 'Sem certeza, procure o suporte.');
});

test('conversas iniciais vão à IA, histórico permanece limitado e IA OFF não chama NVIDIA', async () => {
  let nvidiaCalls = 0;
  const answer = await answerSpeakMessage({
    guildId: 'greeting-guild', channelId: 'greeting-channel', userId: 'greeting-user',
    text: 'oi', aiConfig: { enabled: true }, ask: async (question) => {
      nvidiaCalls += 1;
      return `Saudação conversacional: ${question}`;
    },
  });
  assert.equal(answer, 'Saudação conversacional: oi');
  assert.equal(nvidiaCalls, 1);
  assert.equal(OFFLINE_MESSAGE, 'Estou temporariamente off, chora ai kkk 😭');

  let currentTime = 0;
  const conversations = createConversationStore({ maxMessages: 4, maxConversations: 2, ttlMs: 10, now: () => currentTime });
  conversations.append('first', 'pergunta 1', 'resposta 1');
  conversations.append('first', 'pergunta 2', 'resposta 2');
  conversations.append('first', 'pergunta 3', 'resposta 3');
  assert.equal(conversations.get('first').length, 4);
  conversations.append('second', 'pergunta', 'resposta');
  conversations.append('third', 'pergunta', 'resposta');
  assert.deepEqual(conversations.get('first'), []);
  currentTime = 11;
  assert.deepEqual(conversations.get('third'), []);
});

test('/clear apaga dentro do limite, registra log e remove confirmação em cinco segundos', async (t) => {
  const store = await createStore(t);
  await store.updateActiveProfile('guild-1', (profile) => { profile.admin.logChannelId = 'log-channel'; });
  const now = Date.now();
  const selected = [
    { createdTimestamp: now - 1000 },
    { createdTimestamp: now - 2000 },
    { createdTimestamp: now - 15 * 24 * 60 * 60 * 1000 },
  ];
  let bulkCount = 0;
  let logPayload;
  let timer;
  let confirmationDeleted = false;
  const logChannel = { isTextBased: () => true, send: async (payload) => { logPayload = payload; } };
  const interaction = interactionBase({
    commandName: 'clear',
    channelId: 'command-channel',
    options: { getInteger: () => 20 },
    guild: {
      members: { me: {} },
      channels: { fetch: async () => logChannel },
    },
    channel: {
      permissionsFor: () => ({ has: (permission) => permission === PermissionFlagsBits.ManageMessages }),
      messages: {
        fetch: async ({ limit }) => {
          assert.equal(limit, 20);
          return { filter: (predicate) => {
            const filtered = selected.filter(predicate);
            return { size: filtered.length, first: () => filtered[0] };
          } };
        },
      },
      bulkDelete: async (messages, filterOld) => {
        bulkCount = messages.size;
        assert.equal(filterOld, true);
        return { size: 1 };
      },
    },
    reply: async (payload) => { interaction.payload = payload; },
    deleteReply: async () => { confirmationDeleted = true; },
  });

  await handleClearCommand(interaction, store, {
    now: () => now,
    schedule: (callback, delay) => {
      timer = { callback, delay, unref() {} };
      return timer;
    },
  });
  assert.equal(bulkCount, 2);
  assert.equal(interaction.payload.content, '🧹 1 mensagem foi apagada.');
  assert.match(logPayload.content, /1\/20 apagadas/);
  assert.equal(timer.delay, 5000);
  await timer.callback();
  assert.equal(confirmationDeleted, true);
});

test('planos são criados/editados pela interface e só ativam com cargo gerenciável', async (t) => {
  const store = await createStore(t);
  const fixture = adminGuildFixture();
  const makeModal = (customId, values) => {
    const modal = interactionBase({
      customId,
      guildId: fixture.guildId,
      user: { id: fixture.executorId },
      member: fixture.member,
      fields: { fields: { map: (callback) => values.map(([fieldId, value]) => callback({ customId: fieldId, value })) } },
    });
    modal.reply = async (payload) => { modal.payload = payload; };
    return modal;
  };

  const planCreate = makeModal('speak:config:plan:create', [
    ['id', 'speak30'], ['name', 'SPEAK 30D'], ['durationDays', '30'],
    ['price', 'R$ 49,90'], ['description', 'Acesso de 30 dias'],
  ]);
  const plansSection = fixture.component('speak:config:section', {
    values: ['plans'],
    update: async (payload) => { plansSection.payload = payload; },
  });
  await handleComponent(plansSection, store);
  assert.equal(plansSection.payload.components[0].components[0].data.custom_id, 'speak:config:plans');
  const createChoice = fixture.component('speak:config:plans', {
    values: ['create'],
    showModal: async (modal) => { createChoice.modal = modal; },
  });
  await handleAdminComponent(createChoice, store);
  assert.equal(createChoice.modal.data.custom_id, 'speak:config:plan:create');
  assert.equal(await handleAdminModal(planCreate, store), true);
  assert.equal(planCreate.payload.components[0].components[0].data.custom_id, 'speak:plan:role:speak30');

  const planEdit = makeModal('speak:config:plan:edit:speak30', [
    ['name', 'SPEAK 60D'], ['durationDays', '60'], ['price', 'R$ 79,90'], ['description', 'Acesso de 60 dias'],
  ]);
  await handleAdminModal(planEdit, store);
  const roleSelect = fixture.component('speak:plan:role:speak30', {
    roles: { first: () => fixture.planRole },
    update: async (payload) => { roleSelect.payload = payload; },
  });
  await handleAdminComponent(roleSelect, store);
  const toggle = fixture.component('speak:plan:toggle:speak30');
  await handleAdminComponent(toggle, store);

  const saved = await new ConfigStore(store.filePath).getActiveProfile(fixture.guildId);
  assert.deepEqual(saved.plans[0], {
    id: 'speak30', name: 'SPEAK 60D', durationDays: 60, price: 'R$ 79,90',
    description: 'Acesso de 60 dias', roleId: fixture.planRole.id, status: 'active',
  });
  assert.equal(canManageRole(fixture.guild, { ...fixture.planRole, id: fixture.guildId }), false);
  assert.equal(canManageRole(fixture.guild, { ...fixture.planRole, position: 101, editable: false }), false);
});

test('Staff cria e configura cupons; aplicação valida limites sem consumir uso', async (t) => {
  const store = await createStore(t);
  await store.updateActiveProfile('guild-1', (profile) => {
    profile.plans.push({ id: 'speak30', name: 'SPEAK 30D', durationDays: 30, price: 'R$ 49,90', roleId: 'role-30', status: 'active' });
  });
  const createValues = [
    ['code', 'SPEAK10'], ['discountType', 'percent'], ['discountValue', '10'],
    ['startsAt', ''], ['expiresAt', '2026-09-30T23:59:59.000Z'],
  ];
  const create = interactionBase({
    customId: 'speak:coupon:create',
    isModalSubmit: () => true,
    fields: { fields: { map: (callback) => createValues.map(([customId, value]) => callback({ customId, value })) } },
    reply: async (payload) => { create.payload = payload; },
  });
  assert.equal(await handleCouponModal(create, store), true);
  let profile = await store.getActiveProfile('guild-1');
  const coupon = profile.coupons[0];
  assert.equal(coupon.status, 'inactive');
  assert.equal(coupon.createdBy, create.user.id);

  const limits = interactionBase({
    customId: `speak:coupon:limits:${coupon.id}`,
    isModalSubmit: () => true,
    fields: { fields: { map: (callback) => [
      { customId: 'maxUses', value: '2' }, { customId: 'perUserLimit', value: '1' },
      { customId: 'allowedPlanIds', value: 'speak30' }, { customId: 'singleUse', value: 'true' },
      { customId: 'minimumValue', value: '20' },
    ].map(callback) } },
    reply: async (payload) => { limits.payload = payload; },
  });
  await handleCouponModal(limits, store);
  const toggle = interactionBase({
    customId: `speak:coupon:toggle:${coupon.id}`,
    isButton: () => true,
    update: async (payload) => { toggle.payload = payload; },
  });
  await handleCouponComponent(toggle, store);
  profile = await store.getActiveProfile('guild-1');
  assert.equal(profile.coupons[0].status, 'active');
  assert.equal(profile.coupons[0].maxUses, 2);
  assert.equal(profile.coupons[0].perUserLimit, 1);
  assert.deepEqual(profile.coupons[0].allowedPlanIds, ['speak30']);

  const input = { code: 'speak10', planId: 'speak30', amount: 49.9, userId: 'buyer-1', now: new Date('2026-09-26T12:00:00Z') };
  const valid = validateCoupon(profile, input);
  assert.deepEqual({ status: valid.status, discount: valid.discount, finalAmount: valid.finalAmount },
    { status: 'VALID', discount: 4.99, finalAmount: 44.91 });
  assert.equal(validateCoupon(profile, { ...input, planId: 'other' }).status, 'PLAN_NOT_ALLOWED');
  assert.equal(validateCoupon(profile, { ...input, amount: 10 }).status, 'MINIMUM_NOT_MET');
  assert.equal(validateCoupon(profile, { ...input, now: new Date('2026-10-01T00:00:00Z') }).status, 'EXPIRED');
  assert.equal(profile.coupons[0].usages.length, 0);

  await store.updateActiveProfile('guild-1', (current) => {
    current.coupons[0].usages.push({ userId: 'buyer-1', planId: 'speak30', discount: 4.99, at: '2026-09-26T12:00:00Z' });
  });
  profile = await store.getActiveProfile('guild-1');
  assert.equal(validateCoupon(profile, input).status, 'USER_LIMIT_REACHED');
});

test('!cone up seleciona plano, aplica cargo, persiste expiração manual e registra log', async (t) => {
  const store = await createStore(t);
  const fixture = adminGuildFixture();
  await store.updateActiveProfile(fixture.guildId, (profile) => {
    profile.admin.logChannelId = fixture.logChannelId;
    profile.plans.push({ id: 'speak30', name: 'SPEAK 30D', durationDays: 30, price: 'R$ 49,90',
      description: 'Acesso', roleId: fixture.planRole.id, status: 'active' });
  });

  assert.equal(await handleAdminMessage(fixture.message(`!cone up ${fixture.targetId} correção manual`), store), true);
  const selectPayload = fixture.channelMessages.at(-1);
  assert.equal(selectPayload.components[0].components[0].data.custom_id.startsWith('speak:admin:up:'), true);
  const actionSelect = fixture.component(selectPayload.components[0].components[0].data.custom_id, {
    values: ['speak30'],
    update: async (payload) => { actionSelect.payload = payload; },
  });
  await handleAdminComponent(actionSelect, store);

  assert.equal(fixture.roleIds.has(fixture.planRole.id), true);
  const saved = await new ConfigStore(store.filePath).getActiveProfile(fixture.guildId);
  const access = saved.accesses[0];
  assert.equal(access.userId, fixture.targetId);
  assert.equal(access.planId, 'speak30');
  assert.equal(access.roleId, fixture.planRole.id);
  assert.equal(access.status, 'active');
  assert.equal(access.source, 'manual');
  assert.equal(Date.parse(access.expiresAt) - Date.parse(access.startedAt), 30 * 24 * 60 * 60 * 1000);
  assert.equal(fixture.logMessages.length, 1);
  assert.match(fixture.logMessages[0].embeds[0].data.title, /UP/);
  assert.deepEqual(fixture.logMessages[0].allowedMentions.parse, []);
});

test('!cone demote revoga acessos, remove cargos e registra motivo sem segredos', async (t) => {
  const store = await createStore(t);
  const fixture = adminGuildFixture();
  fixture.roleIds.add(fixture.planRole.id);
  await store.updateActiveProfile(fixture.guildId, (profile) => {
    profile.admin.logChannelId = fixture.logChannelId;
    profile.accesses.push({ id: 'active-1', userId: fixture.targetId, planId: 'speak30',
      planName: 'SPEAK 30D', roleId: fixture.planRole.id, startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 100000).toISOString(), status: 'active' });
  });

  await handleAdminMessage(fixture.message(`!cone demote ${fixture.targetId} senha:secret-value ajuste`), store);
  assert.equal(fixture.roleIds.has(fixture.planRole.id), false);
  const saved = await new ConfigStore(store.filePath).getActiveProfile(fixture.guildId);
  assert.equal(saved.accesses[0].status, 'revoked');
  assert.equal(saved.accesses[0].revokedBy, fixture.executorId);
  assert.equal(fixture.logMessages.length, 1);
  const logged = JSON.stringify(fixture.logMessages[0].embeds[0].data);
  assert.match(logged, /dado sensível removido/);
  assert.equal(logged.includes('secret-value'), false);
});

test('anúncio não executa menções e promoção respeita sem ping/everyone/here/cancelamento', async (t) => {
  const store = await createStore(t);
  const fixture = adminGuildFixture();
  await store.updateActiveProfile(fixture.guildId, (profile) => { profile.admin.logChannelId = fixture.logChannelId; });

  await handleAdminMessage(fixture.message('!cone anúncio @everyone atendimento SPEAK aberto'), store);
  const announcement = fixture.channelMessages.at(-1);
  assert.match(announcement.embeds[0].data.description, /@everyone/);
  assert.deepEqual(announcement.allowedMentions.parse, []);

  const slashAnnouncement = fixture.component('slash-announcement', {
    commandName: 'cone',
    channelId: 'command-channel',
    options: {
      getSubcommand: () => 'anuncio',
      getString: () => 'Aviso pelo comando slash',
    },
    reply: async (payload) => { slashAnnouncement.payload = payload; },
  });
  await handleChatCommand(slashAnnouncement, store);
  assert.equal(slashAnnouncement.payload.embeds[0].data.description, 'Aviso pelo comando slash');
  assert.equal(slashAnnouncement.payload.embeds[0].data.color, 0xffffff);

  for (const [choice, expectedMention] of [['none', ''], ['everyone', '@everyone'], ['here', '@here']]) {
    await handleAdminMessage(fixture.message('!cone promoção SPEAK com @everyone no texto'), store);
    const control = fixture.channelMessages.at(-1);
    assert.deepEqual(control.allowedMentions.parse, []);
    const customId = control.components[0].components.find((button) => button.data.custom_id.endsWith(`:${choice}`)).data.custom_id;
    const confirmation = fixture.component(customId, {
      memberPermissions: { has: (permission) => permission === PermissionFlagsBits.ManageGuild
        || permission === PermissionFlagsBits.MentionEveryone },
      update: async (payload) => { confirmation.payload = payload; },
    });
    const priorPublications = fixture.channelMessages.filter((payload) => payload.embeds?.[0]?.data?.title === 'SPEAK · Promoção').length;
    await handleAdminComponent(confirmation, store);
    const promotions = fixture.channelMessages.filter((payload) => payload.embeds?.[0]?.data?.title === 'SPEAK · Promoção');
    assert.equal(promotions.length, priorPublications + 1);
    assert.equal(promotions.at(-1).content, expectedMention);
    assert.deepEqual(promotions.at(-1).allowedMentions.parse, expectedMention ? ['everyone'] : []);
  }

  await handleAdminMessage(fixture.message('!cone promoção campanha para cancelar'), store);
  const cancelControl = fixture.channelMessages.at(-1);
  const cancelId = cancelControl.components[0].components.find((button) => button.data.custom_id.endsWith(':cancel')).data.custom_id;
  const cancel = fixture.component(cancelId, { update: async (payload) => { cancel.payload = payload; } });
  const countBeforeCancel = fixture.channelMessages.filter((payload) => payload.embeds?.[0]?.data?.title === 'SPEAK · Promoção').length;
  await handleAdminComponent(cancel, store);
  assert.equal(cancel.payload.content, 'Publicação cancelada.');
  assert.equal(fixture.channelMessages.filter((payload) => payload.embeds?.[0]?.data?.title === 'SPEAK · Promoção').length, countBeforeCancel);
});

test('usuário sem permissão não usa comandos administrativos e menção em massa exige autorização', async (t) => {
  const store = await createStore(t);
  const fixture = adminGuildFixture({ authorized: false });
  const handled = await handleAdminMessage(fixture.message('!cone anúncio privado'), store);
  assert.equal(handled, true);
  assert.equal(fixture.channelMessages[0].content, 'Isso é para staff, sai daqui kkk');
  assert.equal(fixture.channelMessages.some((payload) => payload.embeds), false);

  const authorized = adminGuildFixture({ mentionEveryone: false });
  await store.updateActiveProfile(authorized.guildId, (profile) => {
    profile.admin.logChannelId = authorized.logChannelId;
  });
  await handleAdminMessage(authorized.message('!cone promoção teste de permissão'), store);
  const control = authorized.channelMessages.at(-1);
  const customId = control.components[0].components.find((button) => button.data.custom_id.endsWith(':everyone')).data.custom_id;
  const confirm = authorized.component(customId, { update: async () => {}, reply: async (payload) => { confirm.payload = payload; } });
  await handleAdminComponent(confirm, store);
  assert.match(confirm.payload.content, /permissão para usar menções/);
  assert.equal(authorized.channelMessages.some((payload) => payload.embeds?.[0]?.data?.title === 'SPEAK · Promoção'), false);

  const inaccessible = adminGuildFixture({ manageableRolePosition: 101 });
  assert.equal(canManageRole(inaccessible.guild, inaccessible.planRole), false);
});

test('expiração persiste após reiniciar e mantém cargo compartilhado enquanto houver outro acesso', async (t) => {
  const store = await createStore(t);
  const fixture = adminGuildFixture();
  const now = new Date('2026-09-26T12:00:00.000Z');
  fixture.roleIds.add(fixture.planRole.id);
  await store.updateActiveProfile(fixture.guildId, (profile) => {
    profile.admin.logChannelId = fixture.logChannelId;
    profile.accesses.push(
      { id: 'expired', userId: fixture.targetId, planId: 'p1', planName: 'Plano antigo', roleId: fixture.planRole.id,
        expiresAt: '2026-09-26T11:59:00.000Z', status: 'active' },
      { id: 'still-active', userId: fixture.targetId, planId: 'p2', planName: 'Plano atual', roleId: fixture.planRole.id,
        expiresAt: '2026-10-26T12:00:00.000Z', status: 'active' },
    );
  });
  const client = { guilds: { cache: new Map([[fixture.guildId, fixture.guild]]) } };
  assert.equal(await sweepExpirations(client, store, now), 1);
  assert.equal(fixture.roleIds.has(fixture.planRole.id), true);
  let saved = await new ConfigStore(store.filePath).getActiveProfile(fixture.guildId);
  assert.equal(saved.accesses.find((access) => access.id === 'expired').status, 'expired');

  await store.updateActiveProfile(fixture.guildId, (profile) => {
    profile.accesses.find((access) => access.id === 'still-active').expiresAt = '2026-09-26T11:00:00.000Z';
  });
  assert.equal(await sweepExpirations(client, store, now), 1);
  assert.equal(fixture.roleIds.has(fixture.planRole.id), false);
  saved = await new ConfigStore(store.filePath).getActiveProfile(fixture.guildId);
  assert.equal(saved.accesses.find((access) => access.id === 'still-active').status, 'expired');
  assert.equal(saved.accesses.find((access) => access.id === 'still-active').expirationRoleRemoved, true);
});