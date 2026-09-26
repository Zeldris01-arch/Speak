const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { canAccessAdminArea, canManageSpeak, isSpeakStaff, STAFF_DENIED_MESSAGE } = require('./permissions');
const { EMBED_COLORS } = require('./config/defaults');

const ACTION_TTL_MS = 15 * 60 * 1000;
const grantLocks = new Set();
const promotionLocks = new Set();
const PLAN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const SECRET_PATTERN = /\b(password|senha|token|secret|api[\s_-]?key|client[\s_-]?secret)\b\s*[:=]\s*[^\s,;]+/gi;
const RA_PATTERN = /\b(?:RA\s*[:#]?\s*)?\d{5,}\s*[-/]?\s*[A-Z]{2}\b/gi;

function safeText(value, maxLength = 1000) {
  return String(value).replace(/\0/g, '').replace(SECRET_PATTERN, '[dado sensível removido]')
    .replace(RA_PATTERN, '[RA removido]').slice(0, maxLength);
}

function textField(id, label, value, style = TextInputStyle.Short, required = true) {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (value !== undefined && value !== '') field.setValue(String(value).slice(0, style === TextInputStyle.Paragraph ? 4000 : 100));
  return field;
}

function optionValue(value) {
  return value.slice(0, 100);
}

function planMenu(profile) {
  const options = [{ label: 'Criar plano', value: 'create', description: 'Adicionar um novo plano SPEAK' }];
  for (const plan of profile.plans.slice(0, 24)) {
    options.push({
      label: `${plan.name} (${plan.status})`.slice(0, 100),
      value: optionValue(`manage:${plan.id}`),
      description: `${plan.durationDays} dias · ${plan.price || 'sem preço definido'}`.slice(0, 100),
    });
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId('speak:config:plans')
    .setPlaceholder('Criar ou administrar um plano')
    .addOptions(options);
  return [new ActionRowBuilder().addComponents(select)];
}

function planControls(plan) {
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`speak:plan:role:${plan.id}`)
    .setPlaceholder('Selecionar cargo do plano')
    .setMinValues(1)
    .setMaxValues(1);
  const statusLabel = plan.status === 'active' ? 'Desativar plano' : 'Ativar plano';
  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`speak:plan:edit:${plan.id}`).setLabel('Editar plano').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`speak:plan:toggle:${plan.id}`).setLabel(statusLabel).setStyle(
      plan.status === 'active' ? ButtonStyle.Danger : ButtonStyle.Success,
    ),
  );
  return [new ActionRowBuilder().addComponents(roleSelect), actions];
}

function planModal(plan, creating) {
  const fields = creating
    ? [
      textField('id', 'ID único (a-z, 0-9, _ ou -)', ''),
      textField('name', 'Nome do plano', ''),
      textField('durationDays', 'Duração em dias', ''),
      textField('price', 'Preço interno, sem checkout', ''),
      textField('description', 'Descrição', '', TextInputStyle.Paragraph),
    ]
    : [
      textField('name', 'Nome do plano', plan.name),
      textField('durationDays', 'Duração em dias', plan.durationDays),
      textField('price', 'Preço interno, sem checkout', plan.price, TextInputStyle.Short, false),
      textField('description', 'Descrição', plan.description, TextInputStyle.Paragraph, false),
    ];
  const modal = new ModalBuilder()
    .setCustomId(creating ? 'speak:config:plan:create' : `speak:config:plan:edit:${plan.id}`)
    .setTitle(creating ? 'Criar plano SPEAK' : `Editar ${plan.name}`.slice(0, 45))
    .addComponents(fields.map((field) => new ActionRowBuilder().addComponents(field)));
  return modal;
}

function canManageRole(guild, role) {
  const botMember = guild.members.me;
  return Boolean(role && botMember
    && role.id !== guild.id
    && !role.managed
    && botMember.permissions.has(PermissionFlagsBits.ManageRoles)
    && role.editable
    && role.comparePositionTo(botMember.roles.highest) < 0);
}

function canManageTarget(guild, member) {
  return Boolean(member && guild.members.me && member.manageable);
}

async function adminLogChannel(guild, profile) {
  if (!profile.admin.logChannelId) throw new Error('Configure primeiro o canal de logs administrativos em /speak config → Geral.');
  const channel = await guild.channels.fetch(profile.admin.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) {
    throw new Error('O canal de logs administrativos está inválido ou o bot não pode enviar mensagens nele.');
  }
  return channel;
}

async function sendAdminLog(guild, profile, title, fields, timestamp = new Date()) {
  const channel = await adminLogChannel(guild, profile);
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(EMBED_COLORS.primary)
    .setTimestamp(timestamp)
    .addFields(fields.map(([name, value]) => ({ name, value: safeText(value, 1024) || '—', inline: true })));
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function recordAdminAudit(store, guildId, entry) {
  const at = entry.at || new Date().toISOString();
  await store.updateActiveProfile(guildId, (profile) => {
    profile.staffActions.push({
      ...entry,
      reason: entry.reason ? safeText(entry.reason, 500) : undefined,
      text: entry.text ? safeText(entry.text, 1000) : undefined,
      at,
    });
  });
  return at;
}

async function recordRoleChange(store, guildId, entry) {
  const at = entry.at || new Date().toISOString();
  await store.updateActiveProfile(guildId, (profile) => {
    profile.roleHistory ??= [];
    const previous = [...profile.roleHistory].reverse().find((event) => event.userId === entry.userId
      && event.roleId === entry.roleId && event.action === entry.action
      && Math.abs(Date.parse(at) - Date.parse(event.at)) <= 10_000);
    if (previous) {
      if (entry.source !== 'discord-role-update' && previous.source === 'discord-role-update') {
        Object.assign(previous, entry, { at });
      }
      return;
    }
    profile.roleHistory.push({ ...entry, at });
  });
}

function logFields({ userId, executorId, planName, roleId, reason, startedAt, expiresAt, timestamp }) {
  return [
    ['Usuário', `<@${userId}> (${userId})`],
    ['Executor', `<@${executorId}> (${executorId})`],
    ['Plano', planName],
    ['Cargo', `<@&${roleId}> (${roleId})`],
    ['Motivo', reason],
    ['Início', startedAt],
    ['Expiração', expiresAt],
    ['Horário', timestamp],
  ];
}

async function fetchMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

async function savePendingAction(store, guildId, actionId, action) {
  await store.updateActiveProfile(guildId, (profile) => {
    const cutoff = Date.now() - ACTION_TTL_MS;
    profile.admin.pendingActions = Object.fromEntries(
      Object.entries(profile.admin.pendingActions ?? {}).filter(([, pending]) => Date.parse(pending.createdAt) > cutoff),
    );
    profile.admin.pendingActions[actionId] = action;
  });
}

async function getPendingAction(store, guildId, actionId) {
  const profile = await store.getActiveProfile(guildId);
  const action = profile.admin.pendingActions?.[actionId];
  if (!action || Date.now() - Date.parse(action.createdAt) > ACTION_TTL_MS) return null;
  return { profile, action };
}

async function removePendingAction(store, guildId, actionId) {
  await store.updateActiveProfile(guildId, (profile) => {
    delete profile.admin.pendingActions[actionId];
  });
}

async function upsertPlan(interaction, store, creating, planId = '') {
  const profile = await store.getActiveProfile(interaction.guildId);
  if (!canAccessAdminArea(interaction.member, interaction.user.id, profile, 'plans')) {
    await interaction.reply({ content: STAFF_DENIED_MESSAGE, flags: 64 });
    return;
  }
  const values = Object.fromEntries(interaction.fields.fields.map((field) => [field.customId, field.value.trim()]));
  const id = creating ? values.id : planId;
  const durationDays = Number(values.durationDays);
  if (!PLAN_ID_PATTERN.test(id) || !values.name || values.name.length > 80
    || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650
    || (values.price && values.price.length > 40)
    || (values.description && values.description.length > 1000)) {
    throw new Error('Confira o ID, nome, duração (1–3650 dias), preço e descrição do plano.');
  }
  if (creating && profile.plans.some((plan) => plan.id.toLowerCase() === id.toLowerCase())) {
    throw new Error('Já existe um plano com esse ID.');
  }
  if (creating && profile.plans.length >= 24) throw new Error('O limite administrativo é de 24 planos.');

  await store.updateActiveProfile(interaction.guildId, (current) => {
    if (creating) {
      current.plans.push({
        id,
        name: values.name,
        durationDays,
        price: values.price,
        description: values.description,
        roleId: '',
        status: 'inactive',
      });
      return;
    }
    const plan = current.plans.find((item) => item.id === id);
    if (!plan) throw new Error('Plano não encontrado.');
    plan.name = values.name;
    plan.durationDays = durationDays;
    plan.price = values.price;
    plan.description = values.description;
  });

  const saved = await store.getActiveProfile(interaction.guildId);
  const plan = saved.plans.find((item) => item.id === id);
  await interaction.reply({
    content: `Plano ${plan.name} salvo como ${plan.status}. Selecione o cargo e ative-o quando estiver pronto.`,
    components: planControls(plan),
    flags: 64,
  });
}

async function createAdminAnnouncement(channel, text, settings = {}) {
  const embed = new EmbedBuilder()
    .setTitle(`${settings.emoji ? `${settings.emoji} ` : ''}${settings.title || 'SPEAK'}`)
    .setDescription(safeText(text, 4000))
    .setColor(EMBED_COLORS.primary)
    .setTimestamp();
  if (settings.imageUrl) embed.setImage(settings.imageUrl);
  if (settings.footer) embed.setFooter({ text: safeText(settings.footer, 2000) });
  return channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function startPromotion({ guild, channel, author }, store, text, settings = {}) {
  const actionId = crypto.randomUUID();
  await savePendingAction(store, guild.id, actionId, {
    type: 'promotion',
    executorId: author.id,
    text: safeText(text, 4000),
    settings,
    createdAt: new Date().toISOString(),
    channelId: channel.id,
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`speak:admin:promo:${actionId}:none`).setLabel('Sem ping').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`speak:admin:promo:${actionId}:everyone`).setLabel('@everyone').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`speak:admin:promo:${actionId}:here`).setLabel('@here').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`speak:admin:promo:${actionId}:cancel`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
  );
  await channel.send({
    content: 'Escolha como publicar a promoção. Por padrão, nenhum ping será enviado.',
    components: [row],
    allowedMentions: { parse: [] },
  });
  return actionId;
}

function accessHistoryText(access) {
  const source = access.source === 'manual' ? 'UP manual' : access.source || 'outro';
  const lines = [
    `Plano: ${safeText(access.planName || access.planId, 80)}`,
    `Início: ${access.startedAt || '—'}`,
    `Expiração: ${access.expiresAt || '—'}`,
    `Status: ${access.status}`,
    `Origem: ${source}`,
  ];
  if (access.source === 'manual') lines.push(`Staff: <@${access.executorId}>`, `Motivo: ${safeText(access.reason || '—', 300)}`);
  if (access.revokedAt) lines.push(`Removido: ${access.revokedAt}`, `Motivo da revogação: ${safeText(access.revokeReason || '—', 300)}`);
  if (access.expiredAt) lines.push(`Expirado: ${access.expiredAt}`);
  lines.push(`Cargo: <@&${access.roleId}>`);
  return lines.join('\n');
}

const HISTORY_SECTIONS = [
  ['overview', 'Resumo'], ['plans', 'Planos/acessos'], ['roles', 'Cargos SPEAK'],
  ['payments', 'Pagamentos'], ['coupons', 'Cupons'], ['resets', 'Resets'], ['staff', 'Ações Staff'],
];

function historyRecords(profile, userId) {
  const accesses = profile.accesses.filter((entry) => entry.userId === userId)
    .sort((left, right) => Date.parse(right.startedAt || 0) - Date.parse(left.startedAt || 0));
  const roleHistory = (profile.roleHistory || []).filter((entry) => entry.userId === userId)
    .sort((left, right) => Date.parse(right.at || 0) - Date.parse(left.at || 0));
  const resets = profile.resetHistory.filter((entry) => entry.userId === userId)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const payments = profile.paymentHistory.filter((entry) => entry.userId === userId)
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));
  const coupons = profile.couponHistory.filter((entry) => entry.userId === userId)
    .sort((left, right) => Date.parse(right.at || 0) - Date.parse(left.at || 0));
  const staffActions = profile.staffActions.filter((entry) => entry.userId === userId || entry.targetId === userId)
    .sort((left, right) => Date.parse(right.at || 0) - Date.parse(left.at || 0));
  const now = Date.now();
  const activeAccesses = accesses.filter((entry) => entry.status === 'active'
    && (!entry.expiresAt || Date.parse(entry.expiresAt) > now));
  const currentMonth = new Date();
  const resetsThisMonth = resets.filter((entry) => entry.month === currentMonth.getUTCMonth() + 1
    && entry.year === currentMonth.getUTCFullYear()).length;
  return {
    accesses, roleHistory, resets, payments, coupons, staffActions, activeAccesses, resetsThisMonth,
    pages: {
      plans: accesses.map((access) => accessHistoryText({
        ...access,
        status: access.status === 'active' && access.expiresAt && Date.parse(access.expiresAt) <= now
          ? 'expired' : access.status,
      })),
      roles: roleHistory.map((entry) => [
        `${entry.action === 'granted' ? 'Concedido' : 'Removido'} · ${safeText(entry.roleName || entry.roleId, 100)}`,
        `Data: ${entry.at || '—'} · Origem: ${safeText(entry.source || 'não informada', 100)}`,
        `Executor: ${entry.executorId ? `<@${entry.executorId}>` : 'não registrado'} · Motivo: ${safeText(entry.reason || '—', 250)}`,
      ].join('\n')),
      payments: payments.map((entry) => {
        const coupon = profile.coupons.find((item) => item.id === entry.couponId);
        return `Pagamento: ${safeText(entry.paymentId || 'ID indisponível', 100)} · plano ${safeText(entry.planName || entry.planId || '—', 100)} · valor ${safeText(entry.amount ?? '—', 40)} · status ${safeText(entry.status || '—', 40)} · data ${entry.createdAt || '—'}${entry.couponId ? ` · cupom ${safeText(coupon?.code || entry.couponId, 50)}` : ''}`;
      }),
      coupons: coupons.map((entry) => `Cupom: ${safeText(entry.code || '—', 80)} · plano ${safeText(entry.planId || '—', 80)} · usado em ${entry.at || '—'} · desconto ${safeText(entry.discount ?? '—', 40)}`),
      resets: resets.map((entry) => `Data: ${entry.at || '—'} · mês/ano ${String(entry.month || '—').padStart(2, '0')}/${entry.year || '—'} · uso ${entry.usedInMonth ?? '—'}/2`),
      staff: staffActions.map((entry) => `${safeText(entry.type || 'Ação', 80)} · ${entry.at || '—'} · Staff: ${entry.executorId ? `<@${entry.executorId}>` : 'não registrado'} · motivo: ${safeText(entry.reason || '—', 250)}`),
    },
  };
}

function historyPayload({ guildId, userId, executorId, user, targetMember, profile, section = 'overview', page = 0 }) {
  const history = historyRecords(profile, userId);
  const selected = HISTORY_SECTIONS.some(([key]) => key === section) ? section : 'overview';
  const entries = history.pages[selected] || [];
  const pageSize = 6;
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(Math.max(0, page), pageCount - 1);
  const embed = new EmbedBuilder().setTitle('Histórico SPEAK').setColor(EMBED_COLORS.primary).setTimestamp();

  if (selected === 'overview') {
    const currentRoleIds = new Set(targetMember?.roles?.cache?.map?.((role) => role.id) || []);
    const currentWithRole = history.activeAccesses.filter((entry) => currentRoleIds.has(entry.roleId));
    const targetName = targetMember?.displayName || user?.globalName || 'Não disponível';
    const username = user?.tag || user?.username || 'Não disponível';
    embed.addFields(
      { name: '👤 INFORMAÇÕES DO USUÁRIO', value: `Nome: ${safeText(targetName, 150)}\nUsername: ${safeText(username, 150)}\nID: ${userId}\nEntrada: ${targetMember?.joinedAt?.toISOString() || 'Não disponível'}` },
      { name: '🎤 HISTÓRICO SPEAK', value: history.accesses.length
        ? `Já teve acesso registrado: Sim\nAcesso atual: ${currentWithRole.length ? 'Sim' : 'Não'}\nPlano atual: ${currentWithRole.map((entry) => safeText(entry.planName || entry.planId, 80)).join(', ') || 'Nenhum'}\nAcessos registrados vigentes: ${history.activeAccesses.length}`
        : 'Já teve acesso registrado: Não há registro de acesso.' },
      { name: '🔐 CREDENCIAIS', value: profile.accounts[userId]?.entries?.length
        ? 'RA: cadastrada\nSenha: protegida'
        : 'Nenhuma credencial cadastrada.' },
    );
    if (!history.accesses.length && !history.roleHistory.length) {
      embed.addFields({ name: 'Histórico', value: '📭 Nenhum histórico SPEAK encontrado.' });
    }
    if (!entries.length) embed.setFooter({ text: 'Selecione uma categoria para consultar os registros completos.' });
  } else {
    const start = currentPage * pageSize;
    const pageEntries = entries.slice(start, start + pageSize);
    embed.setDescription(`**${HISTORY_SECTIONS.find(([key]) => key === selected)[1]}** · ${entries.length} registro(s) · página ${currentPage + 1}/${pageCount}`);
    if (selected === 'resets') {
      const now = new Date();
      embed.addFields({ name: 'Uso no mês atual', value: `${history.resetsThisMonth}/2 · ${String(now.getUTCMonth() + 1).padStart(2, '0')}/${now.getUTCFullYear()}` });
    }
    if (pageEntries.length) {
      for (let index = 0; index < pageEntries.length; index += 2) {
        const value = pageEntries.slice(index, index + 2).map((entry) => safeText(entry, 500)).join('\n\n');
        embed.addFields({ name: `Registros ${start + index + 1}–${start + index + Math.min(2, pageEntries.length - index)}`, value: value.slice(0, 1024) });
      }
    } else if (selected === 'roles' && history.accesses.length) {
      embed.addFields({ name: 'Cargos', value: 'Nenhuma alteração de cargo foi registrada. A captura de eventos é válida a partir desta versão.' });
    } else {
      embed.addFields({ name: 'Histórico', value: 'Nenhum registro encontrado.' });
    }
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`speak:history:select:${guildId}:${userId}:${executorId}`)
    .setPlaceholder('Navegar pelo histórico')
    .addOptions(HISTORY_SECTIONS.map(([value, label]) => ({ label, value, default: value === selected })));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`speak:history:page:${guildId}:${userId}:${executorId}:${selected}:${currentPage - 1}`)
      .setLabel('Anterior').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`speak:history:page:${guildId}:${userId}:${executorId}:${selected}:${currentPage + 1}`)
      .setLabel('Próxima').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= pageCount - 1),
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), buttons], allowedMentions: { parse: [] } };
}

async function showUserHistory({ guild, userId, executorId, member: executorMember, reply }, store) {
  if (!isSpeakStaff(executorMember)) {
    await reply({ content: STAFF_DENIED_MESSAGE, allowedMentions: { parse: [] } });
    return false;
  }
  const profile = await store.getActiveProfile(guild.id);
  const targetMember = await fetchMember(guild, userId);
  const user = targetMember?.user ?? await guild.client.users.fetch(userId).catch(() => null);
  const queriedAt = new Date().toISOString();
  await store.updateActiveProfile(guild.id, (current) => {
    current.staffActions.push({ type: 'VER', userId, executorId, at: queriedAt, reason: 'Consulta de histórico' });
  });
  await sendAdminLog(guild, profile, 'SPEAK · CONSULTA', [
    ['Staff', `<@${executorId}> (${executorId})`],
    ['Usuário consultado', `<@${userId}> (${userId})`],
    ['Horário', queriedAt],
  ]).catch(() => {});
  await reply(historyPayload({ guildId: guild.id, userId, executorId, user, targetMember, profile }));
}

async function handleHistoryComponent(interaction, store) {
  if (!interaction.customId.startsWith('speak:history:')) return false;
  const parts = interaction.customId.split(':');
  const isSelect = parts[2] === 'select';
  const [guildId, userId, executorId] = parts.slice(3, 6);
  if (interaction.user.id !== executorId) {
    await interaction.reply({ content: 'Esta navegação pertence a outro Staff.', flags: 64 });
    return true;
  }
  const guild = interaction.guild ?? await interaction.client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    await interaction.reply({ content: 'O servidor do histórico não está disponível.', flags: 64 });
    return true;
  }
  const executorMember = interaction.member ?? await guild.members.fetch(executorId).catch(() => null);
  if (!isSpeakStaff(executorMember)) {
    await interaction.reply({ content: STAFF_DENIED_MESSAGE, flags: 64 });
    return true;
  }
  const section = isSelect ? interaction.values[0] : parts[6];
  const page = isSelect ? 0 : Number(parts[7]);
  const profile = await store.getActiveProfile(guildId);
  const targetMember = await fetchMember(guild, userId);
  const user = targetMember?.user ?? await guild.client.users.fetch(userId).catch(() => null);
  await interaction.update(historyPayload({ guildId, userId, executorId, user, targetMember, profile, section, page }));
  return true;
}

async function handleAdminMessage(message, store) {
  if (message.author.bot || message.webhookId || !message.guild) return false;
  const match = message.content.trim().match(/^!s\s+(up|down|demote|ver|anúncio|anuncio|promoção|promocao)\s+([\s\S]+)$/iu);
  if (!match) return false;

  let command = match[1].toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (command === 'down') command = 'demote';
  const args = match[2].trim();
  return executeAdminCommand(message, command, args, store);
}

async function executeAdminCommand(message, command, args, store) {
  const profile = await store.getActiveProfile(message.guild.id);
  const area = command === 'up' || command === 'demote' || command === 'ver'
    ? null
    : command === 'anuncio' ? 'announcements' : 'promotions';
  const allowed = area
    ? canAccessAdminArea(message.member, message.author.id, profile, area)
    : canManageSpeak(message.member, message.author.id, profile);
  if (!allowed) {
    const denial = await message.reply({ content: STAFF_DENIED_MESSAGE, allowedMentions: { parse: [] } });
    if (denial?.deletable) {
      const timer = setTimeout(() => denial.delete().catch(() => {}), 5000);
      timer.unref?.();
    }
    return true;
  }

  if (command === 'ver') {
    const targetMatch = args.match(/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/);
    if (!targetMatch) {
      await message.reply({ content: 'Uso: !s ver <ID ou menção do usuário>', allowedMentions: { parse: [] } });
      return true;
    }
    const targetId = targetMatch[1] || targetMatch[2];
    const dm = await message.author.createDM().catch(() => null);
    if (!dm) {
      await message.reply({ content: 'Não consegui abrir sua DM. Ative mensagens diretas para receber o histórico.', allowedMentions: { parse: [] } });
      return true;
    }
    await showUserHistory({ guild: message.guild, userId: targetId,
      executorId: message.author.id, member: message.member, reply: (payload) => dm.send(payload) }, store);
    await message.reply({ content: `Enviei o histórico de <@${targetId}> por mensagem direta.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (command === 'anuncio') {
    if (!args || args.length > 4000) {
      await message.reply({ content: 'Informe um texto de até 4000 caracteres.', allowedMentions: { parse: [] } });
      return true;
    }
    await createAdminAnnouncement(message.channel, args, profile.announcements);
    await recordAdminAudit(store, message.guild.id, {
      type: 'ANNOUNCEMENT', userId: message.author.id, executorId: message.author.id,
      channelId: message.channel.id, text: args,
    });
    return true;
  }

  if (command === 'promocao') {
    if (!args || args.length > 4000) {
      await message.reply({ content: 'Informe um texto de até 4000 caracteres.', allowedMentions: { parse: [] } });
      return true;
    }
    await startPromotion(message, store, args, profile.promotions);
    return true;
  }

  const targetMatch = args.match(/^(\d{17,20})\s+([\s\S]+)$/);
  if (!targetMatch) {
    await message.reply({
      content: `Uso: !s ${command} <ID do usuário> <motivo>`,
      allowedMentions: { parse: [] },
    });
    return true;
  }
  const [, targetId, rawReason] = targetMatch;
  const reason = safeText(rawReason.trim(), 500);
  if (!reason) {
    await message.reply({ content: 'Informe um motivo.', allowedMentions: { parse: [] } });
    return true;
  }
  await adminLogChannel(message.guild, profile);
  const target = await fetchMember(message.guild, targetId);
  if (!target) {
    await message.reply({ content: 'Não encontrei esse membro neste servidor.', allowedMentions: { parse: [] } });
    return true;
  }

  if (command === 'demote') {
    const activeAccesses = profile.accesses.filter((access) => access.userId === targetId && access.status === 'active');
    if (!activeAccesses.length) {
      await message.reply({ content: 'Esse membro não possui acessos SPEAK ativos.', allowedMentions: { parse: [] } });
      return true;
    }
    if (!canManageTarget(message.guild, target)) throw new Error('O bot não pode gerenciar os cargos deste membro por hierarquia.');
    const roles = await Promise.all([...new Set(activeAccesses.map((access) => access.roleId))]
      .map((roleId) => message.guild.roles.fetch(roleId).catch(() => null)));
    if (roles.some((role) => !canManageRole(message.guild, role))) {
      throw new Error('O bot precisa de Manage Roles e hierarquia acima de todos os cargos associados.');
    }
    const timestamp = new Date().toISOString();
    const roleIds = [...new Set(activeAccesses.map((access) => access.roleId))];
    const heldRoleIds = roleIds.filter((roleId) => target.roles.cache.has(roleId));
    if (heldRoleIds.length) await target.roles.remove(heldRoleIds, 'SPEAK manual access revocation');
    try {
      await store.updateActiveProfile(message.guild.id, (current) => {
        for (const access of current.accesses) {
          if (access.userId === targetId && access.status === 'active') {
            access.status = 'revoked';
            access.revokedAt = timestamp;
            access.revokedBy = message.author.id;
            access.revokeReason = reason;
          }
        }
        current.staffActions.push({
          type: 'DEMOTE', userId: targetId, executorId: message.author.id,
          planIds: activeAccesses.map((access) => access.planId), reason, at: timestamp,
        });
      });
      for (const roleId of heldRoleIds) {
        const role = roles.find((entry) => entry?.id === roleId);
        await recordRoleChange(store, message.guild.id, {
          userId: targetId, roleId, roleName: role?.name || roleId, action: 'removed',
          source: 'DEMOTE manual', executorId: message.author.id, reason, at: timestamp,
        });
      }
      const removedPlans = activeAccesses.map((access) => `${access.planName}: <@&${access.roleId}> (${access.roleId})`).join('\n');
      await sendAdminLog(message.guild, profile, 'SPEAK · DEMOTE', [
        ['Usuário', `<@${targetId}> (${targetId})`],
        ['Executor', `<@${message.author.id}> (${message.author.id})`],
        ['Planos/cargos removidos', removedPlans],
        ['Motivo', reason],
        ['Horário', timestamp],
      ]);
    } catch (error) {
      if (heldRoleIds.length) await target.roles.add(heldRoleIds, 'Rollback after SPEAK revocation failure').catch(() => {});
      await store.updateActiveProfile(message.guild.id, (current) => {
        for (const access of current.accesses) {
          if (access.userId === targetId && access.revokedAt === timestamp) {
            access.status = 'active';
            delete access.revokedAt;
            delete access.revokedBy;
            delete access.revokeReason;
          }
        }
      }).catch(() => {});
      throw error;
    }
    await message.reply({ content: `Acessos SPEAK de <@${targetId}> revogados.`, allowedMentions: { parse: [] } });
    return true;
  }

  const plans = profile.plans.filter((plan) => plan.status === 'active' && plan.roleId);
  const eligiblePlans = plans.filter((plan) => canManageRole(message.guild, message.guild.roles.cache.get(plan.roleId)));
  if (!eligiblePlans.length) {
    await message.reply({ content: 'Não há planos ativos com cargo gerenciável pelo bot.', allowedMentions: { parse: [] } });
    return true;
  }
  const actionId = crypto.randomUUID();
  await savePendingAction(store, message.guild.id, actionId, {
    type: 'up',
    executorId: message.author.id,
    targetId,
    reason,
    createdAt: new Date().toISOString(),
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(`speak:admin:up:${actionId}`)
    .setPlaceholder('Selecione o plano a conceder')
    .addOptions(eligiblePlans.slice(0, 25).map((plan) => ({
      label: plan.name.slice(0, 100),
      value: plan.id,
      description: `${plan.durationDays} dias · ${plan.description || plan.price || 'Plano SPEAK'}`.slice(0, 100),
    })));
  await message.channel.send({
    content: `Concessão manual solicitada para <@${targetId}>. Somente quem iniciou pode escolher o plano.`,
    components: [new ActionRowBuilder().addComponents(select)],
    allowedMentions: { parse: [] },
  });
  return true;
}

async function handleAdminSlashCommand(interaction, store) {
  const command = interaction.options.getSubcommand();
  if (!['up', 'down', 'ver', 'anuncio', 'promocao'].includes(command)) return false;
  const target = interaction.options.getUser?.('usuario');
  const text = interaction.options.getString?.('texto');
  const reason = interaction.options.getString?.('motivo');
  const args = command === 'ver'
    ? target?.id || ''
    : command === 'anuncio' || command === 'promocao'
      ? text || ''
      : `${target?.id || ''} ${reason || ''}`.trim();
  const interactionReply = async (payload) => {
    const response = typeof payload === 'string' ? { content: payload } : payload;
    if (interaction.deferred || interaction.replied) return interaction.followUp({ ...response, flags: 64 });
    return interaction.reply({ ...response, flags: 64 });
  };
  const message = {
    author: interaction.user,
    member: interaction.member,
    guild: interaction.guild,
    content: `!s ${command} ${args}`,
    reply: interactionReply,
    channel: {
      id: interaction.channelId,
      send: (payload) => interaction.reply(payload),
    },
  };
  const canonicalCommand = command === 'down' ? 'demote' : command;
  return executeAdminCommand(message, canonicalCommand, args, store);
}

async function grantPlan(interaction, store, actionId, planId) {
  const pending = await getPendingAction(store, interaction.guildId, actionId);
  if (!pending || pending.action.type !== 'up') throw new Error('Esta solicitação expirou. Execute !s up novamente.');
  const lockKey = `${interaction.guildId}:${pending.action.targetId}:${planId}`;
  const actionLockKey = `${interaction.guildId}:action:${actionId}`;
  if (grantLocks.has(lockKey) || grantLocks.has(actionLockKey)) throw new Error('Esta concessão já está sendo processada.');
  grantLocks.add(lockKey);
  grantLocks.add(actionLockKey);
  try {
    const currentPending = await getPendingAction(store, interaction.guildId, actionId);
    if (!currentPending || currentPending.action.type !== 'up') throw new Error('Esta solicitação já foi concluída.');
    await applyPlanGrant(interaction, store, actionId, planId, currentPending);
  } finally {
    grantLocks.delete(lockKey);
    grantLocks.delete(actionLockKey);
  }
}

async function applyPlanGrant(interaction, store, actionId, planId, pending) {
  const { profile, action } = pending;
  if (interaction.user.id !== action.executorId
    || !canManageSpeak(interaction.member, interaction.user.id, profile)) {
    await interaction.reply({ content: 'Você não pode concluir esta solicitação.', flags: 64 });
    return;
  }
  const plan = profile.plans.find((item) => item.id === planId && item.status === 'active');
  if (!plan || !plan.roleId) throw new Error('O plano não está ativo ou não possui cargo configurado.');
  const target = await fetchMember(interaction.guild, action.targetId);
  if (!canManageTarget(interaction.guild, target)) throw new Error('O bot não pode gerenciar este membro por hierarquia.');
  const role = await interaction.guild.roles.fetch(plan.roleId).catch(() => null);
  if (!canManageRole(interaction.guild, role)) {
    throw new Error('O bot precisa de Manage Roles e hierarquia acima do cargo selecionado.');
  }
  if (profile.accesses.some((access) => access.userId === action.targetId
    && access.planId === plan.id && access.status === 'active')) {
    throw new Error('Esse membro já possui um acesso ativo a este plano.');
  }

  const timestamp = new Date();
  const startedAt = timestamp.toISOString();
  const expiresAt = new Date(timestamp.getTime() + plan.durationDays * 24 * 60 * 60 * 1000).toISOString();
  const accessId = crypto.randomUUID();
  const alreadyHadRole = target.roles.cache.has(role.id);
  await target.roles.add(role, 'SPEAK manual access grant');
  try {
    await store.updateActiveProfile(interaction.guildId, (current) => {
      current.accesses.push({
        id: accessId,
        userId: action.targetId,
        planId: plan.id,
        planName: plan.name,
        roleId: role.id,
        startedAt,
        expiresAt,
        status: 'active',
        source: 'manual',
        executorId: action.executorId,
        reason: action.reason,
        createdAt: startedAt,
      });
      current.staffActions.push({
        type: 'UP', userId: action.targetId, executorId: action.executorId,
        planId: plan.id, roleId: role.id, reason: action.reason, at: startedAt,
      });
    });
    if (!alreadyHadRole) {
      await recordRoleChange(store, interaction.guildId, {
        userId: action.targetId, roleId: role.id, roleName: role.name, action: 'granted',
        source: 'UP manual', executorId: action.executorId, reason: action.reason, at: startedAt,
      });
    }
    await removePendingAction(store, interaction.guildId, actionId);
    await sendAdminLog(interaction.guild, profile, 'SPEAK · UP', logFields({
      userId: action.targetId,
      executorId: action.executorId,
      planName: plan.name,
      roleId: role.id,
      reason: action.reason,
      startedAt,
      expiresAt,
      timestamp: startedAt,
    }), timestamp);
  } catch (error) {
    if (!alreadyHadRole) await target.roles.remove(role, 'Rollback after SPEAK grant failure').catch(() => {});
    await store.updateActiveProfile(interaction.guildId, (current) => {
      current.accesses = current.accesses.filter((access) => access.id !== accessId);
      current.admin.pendingActions[actionId] = action;
    }).catch(() => {});
    throw error;
  }
  await interaction.update({ content: `Plano ${plan.name} concedido; expira em ${expiresAt}.`, components: [] });
}

async function handlePromotion(interaction, store, actionId, choice) {
  const lockKey = `${interaction.guildId}:${actionId}`;
  if (promotionLocks.has(lockKey)) {
    await interaction.reply({ content: 'Esta publicação já está sendo processada.', flags: 64 });
    return;
  }
  promotionLocks.add(lockKey);
  try {
    await publishPromotion(interaction, store, actionId, choice);
  } finally {
    promotionLocks.delete(lockKey);
  }
}

async function publishPromotion(interaction, store, actionId, choice) {
  const pending = await getPendingAction(store, interaction.guildId, actionId);
  if (!pending || pending.action.type !== 'promotion') throw new Error('Esta confirmação expirou. Execute !s promoção novamente.');
  const { profile, action } = pending;
  if (interaction.user.id !== action.executorId
    || !canAccessAdminArea(interaction.member, interaction.user.id, profile, 'promotions')) {
    await interaction.reply({ content: 'Você não pode concluir esta publicação.', flags: 64 });
    return;
  }
  if (!['none', 'everyone', 'here', 'cancel'].includes(choice)) return;
  if (choice === 'cancel') {
    await removePendingAction(store, interaction.guildId, actionId);
    await interaction.update({ content: 'Publicação cancelada.', components: [] });
    return;
  }

  const mention = choice === 'everyone' ? '@everyone' : choice === 'here' ? '@here' : '';
  if (mention && !interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone)) {
    await interaction.reply({ content: 'Você não tem permissão para usar menções em massa.', flags: 64 });
    return;
  }
  if (mention && !interaction.guild.members.me.permissions.has(PermissionFlagsBits.MentionEveryone)) {
    await interaction.reply({ content: 'O bot não tem permissão para usar menções em massa.', flags: 64 });
    return;
  }
  const channel = await interaction.guild.channels.fetch(action.channelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('O canal da publicação não está disponível.');
  const embed = new EmbedBuilder()
    .setTitle(action.settings?.title || 'SPEAK · Promoção')
    .setDescription(action.text)
    .setColor(EMBED_COLORS.primary)
    .setTimestamp();
  if (action.settings?.imageUrl) embed.setImage(action.settings.imageUrl);
  if (action.settings?.footer) embed.setFooter({ text: safeText(action.settings.footer, 2000) });
  await removePendingAction(store, interaction.guildId, actionId);
  try {
    await channel.send({
      content: mention,
      embeds: [embed],
      allowedMentions: { parse: mention ? ['everyone'] : [] },
    });
    await recordAdminAudit(store, interaction.guildId, {
      type: 'PROMOTION', executorId: action.executorId, channelId: channel.id,
      mention: choice, text: action.text,
    });
  } catch (error) {
    await savePendingAction(store, interaction.guildId, actionId, action).catch(() => {});
    throw error;
  }
  await interaction.update({ content: `Promoção publicada${mention ? ` com ${mention}` : ' sem ping'}.`, components: [] });
}

async function handleAdminComponent(interaction, store) {
  if (interaction.customId.startsWith('speak:config:plan:')) {
    const [, , , action, planId] = interaction.customId.split(':');
    const profile = await store.getActiveProfile(interaction.guildId);
    if (!canAccessAdminArea(interaction.member, interaction.user.id, profile, 'plans')) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, flags: 64 });
      return true;
    }
    if (action === 'create') {
      await interaction.showModal(planModal(null, true));
      return true;
    }
    if (action === 'edit') {
      const plan = profile.plans.find((item) => item.id === planId);
      if (!plan) throw new Error('Plano não encontrado.');
      await interaction.showModal(planModal(plan, false));
      return true;
    }
  }
  if (interaction.customId === 'speak:config:plans') {
    const profile = await store.getActiveProfile(interaction.guildId);
    if (!canAccessAdminArea(interaction.member, interaction.user.id, profile, 'plans')) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, flags: 64 });
      return true;
    }
    const choice = interaction.values[0];
    if (choice === 'create') {
      await interaction.showModal(planModal(null, true));
      return true;
    }
    if (choice.startsWith('manage:')) {
      const planId = choice.slice('manage:'.length);
      const plan = profile.plans.find((item) => item.id === planId);
      if (!plan) throw new Error('Plano não encontrado.');
      await interaction.update({
        content: `**${plan.name}** · ${plan.durationDays} dias · ${plan.price || 'preço não definido'} · ${plan.status}${plan.roleId ? ` · <@&${plan.roleId}>` : ''}\n${plan.description || 'Sem descrição.'}`,
        components: planControls(plan),
        allowedMentions: { parse: [] },
      });
      return true;
    }
  }
  if (interaction.customId.startsWith('speak:plan:role:')) {
    const planId = interaction.customId.slice('speak:plan:role:'.length);
    const profile = await store.getActiveProfile(interaction.guildId);
    if (!canAccessAdminArea(interaction.member, interaction.user.id, profile, 'plans')) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, flags: 64 });
      return true;
    }
    const role = interaction.roles.first();
    if (!canManageRole(interaction.guild, role)) {
      await interaction.reply({ content: 'Cargo inválido: o bot precisa de Manage Roles e estar acima dele. @everyone e cargos gerenciados não são permitidos.', flags: 64 });
      return true;
    }
    await store.updateActiveProfile(interaction.guildId, (current) => {
      const plan = current.plans.find((item) => item.id === planId);
      if (!plan) throw new Error('Plano não encontrado.');
      plan.roleId = role.id;
    });
    await interaction.update({ content: `Cargo <@&${role.id}> associado ao plano.`, components: [], allowedMentions: { parse: [] } });
    return true;
  }
  if (interaction.customId.startsWith('speak:plan:toggle:')) {
    const planId = interaction.customId.slice('speak:plan:toggle:'.length);
    const profile = await store.getActiveProfile(interaction.guildId);
    if (!canAccessAdminArea(interaction.member, interaction.user.id, profile, 'plans')) {
      await interaction.reply({ content: STAFF_DENIED_MESSAGE, flags: 64 });
      return true;
    }
    const plan = profile.plans.find((item) => item.id === planId);
    if (!plan) throw new Error('Plano não encontrado.');
    const nextStatus = plan.status === 'active' ? 'inactive' : 'active';
    if (nextStatus === 'active') {
      const role = await interaction.guild.roles.fetch(plan.roleId).catch(() => null);
      if (!canManageRole(interaction.guild, role)) throw new Error('Associe um cargo gerenciável pelo bot antes de ativar o plano.');
    }
    await store.updateActiveProfile(interaction.guildId, (current) => {
      current.plans.find((item) => item.id === planId).status = nextStatus;
    });
    await interaction.update({
      content: `Plano ${plan.name} ${nextStatus === 'active' ? 'ativado' : 'desativado'}.`,
      components: planControls({ ...plan, status: nextStatus }),
      allowedMentions: { parse: [] },
    });
    return true;
  }
  if (interaction.customId.startsWith('speak:admin:up:')) {
    const actionId = interaction.customId.slice('speak:admin:up:'.length);
    await grantPlan(interaction, store, actionId, interaction.values[0]);
    return true;
  }
  if (interaction.customId.startsWith('speak:admin:promo:')) {
    const [, , , actionId, choice] = interaction.customId.split(':');
    await handlePromotion(interaction, store, actionId, choice);
    return true;
  }
  return false;
}

async function handleAdminModal(interaction, store) {
  if (interaction.customId === 'speak:config:plan:create') {
    await upsertPlan(interaction, store, true);
    return true;
  }
  if (interaction.customId.startsWith('speak:config:plan:edit:')) {
    const planId = interaction.customId.slice('speak:config:plan:edit:'.length);
    await upsertPlan(interaction, store, false, planId);
    return true;
  }
  return false;
}

module.exports = {
  createAdminAnnouncement,
  handleAdminComponent,
  handleAdminMessage,
  handleAdminSlashCommand,
  handleAdminModal,
  handleHistoryComponent,
  recordAdminAudit,
  showUserHistory,
  sendAdminLog,
  startPromotion,
  buildPlanMenu: planMenu,
  canManageRole,
  canManageTarget,
};