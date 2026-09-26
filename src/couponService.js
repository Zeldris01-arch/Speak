const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { canAccessAdminArea, STAFF_DENIED_MESSAGE } = require('./permissions');
const { EMBED_COLORS } = require('./config/defaults');

function field(id, label, value, style = TextInputStyle.Short, required = false) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (value !== undefined && value !== '') input.setValue(String(value).slice(0, style === TextInputStyle.Paragraph ? 4000 : 100));
  return input;
}

function rows(fields) {
  return fields.map((input) => new ActionRowBuilder().addComponents(input));
}

function parsePlanAmount(price) {
  const value = String(price).replace(/[^\d,.-]/g, '');
  return Number(value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value);
}

function couponMenu(profile) {
  const options = [{ label: 'Criar cupom', value: 'create' }];
  for (const coupon of profile.coupons.slice(0, 24)) {
    options.push({
      label: `${coupon.code} (${coupon.status})`.slice(0, 100),
      value: `manage:${coupon.id}`,
      description: coupon.discountType === 'percent'
        ? `${coupon.discountValue}% OFF`
        : `${coupon.discountValue} de desconto`,
    });
  }
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId('speak:config:coupons')
    .setPlaceholder('Criar ou administrar cupons')
    .addOptions(options))];
}

function couponModal(coupon, creating) {
  const modal = new ModalBuilder()
    .setCustomId(creating ? 'speak:coupon:create' : `speak:coupon:edit:${coupon.id}`)
    .setTitle(creating ? 'Criar cupom SPEAK' : `Editar ${coupon.code}`.slice(0, 45))
    .addComponents(...rows([
      field('code', 'Código', coupon?.code, TextInputStyle.Short, true),
      field('discountType', 'Tipo: percent ou fixed', coupon?.discountType || 'percent', TextInputStyle.Short, true),
      field('discountValue', 'Desconto (percentual ou valor)', coupon?.discountValue, TextInputStyle.Short, true),
      field('startsAt', 'Início ISO 8601 (opcional)', coupon?.startsAt),
      field('expiresAt', 'Expiração ISO 8601 (opcional)', coupon?.expiresAt),
    ]));
  return modal;
}

function couponLimitsModal(coupon) {
  return new ModalBuilder()
    .setCustomId(`speak:coupon:limits:${coupon.id}`)
    .setTitle(`Limites ${coupon.code}`.slice(0, 45))
    .addComponents(...rows([
      field('maxUses', 'Usos totais (0 = sem limite)', coupon.maxUses ?? 0, TextInputStyle.Short, true),
      field('perUserLimit', 'Usos por usuário (0 = sem limite)', coupon.perUserLimit ?? 1, TextInputStyle.Short, true),
      field('allowedPlanIds', 'IDs dos planos (vírgula; vazio = todos)', (coupon.allowedPlanIds ?? []).join(', ')),
      field('singleUse', 'Uso único por usuário (true/false)', String(Boolean(coupon.singleUse)), TextInputStyle.Short, true),
      field('minimumValue', 'Valor mínimo da compra (0 = sem mínimo)', coupon.minimumValue ?? 0, TextInputStyle.Short, true),
    ]));
}

function couponControls(coupon) {
  const state = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`speak:coupon:edit:${coupon.id}`).setLabel('Editar cupom').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`speak:coupon:limits:${coupon.id}`).setLabel('Limites e planos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`speak:coupon:toggle:${coupon.id}`).setLabel(coupon.status === 'active' ? 'Desativar' : 'Ativar')
      .setStyle(coupon.status === 'active' ? ButtonStyle.Danger : ButtonStyle.Success),
  );
  const details = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`speak:coupon:history:${coupon.id}`).setLabel('Histórico').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`speak:coupon:delete:${coupon.id}`).setLabel('Excluir').setStyle(ButtonStyle.Danger),
  );
  return [state, details];
}

function validateCoupon(profile, { code, planId, amount, userId, now = new Date() }) {
  const coupon = profile.coupons.find((entry) => entry.code.toLowerCase() === String(code).trim().toLowerCase());
  if (!coupon || coupon.status !== 'active') return { status: 'UNAVAILABLE' };
  const at = now.getTime();
  if (coupon.startsAt && Date.parse(coupon.startsAt) > at) return { status: 'NOT_STARTED' };
  if (coupon.expiresAt && Date.parse(coupon.expiresAt) <= at) return { status: 'EXPIRED' };
  const allowedPlanIds = coupon.allowedPlanIds ?? [];
  const usages = coupon.usages ?? [];
  if (allowedPlanIds.length && !allowedPlanIds.includes(planId)) return { status: 'PLAN_NOT_ALLOWED' };
  if (Number(amount) < Number(coupon.minimumValue || 0)) return { status: 'MINIMUM_NOT_MET' };
  if (coupon.maxUses > 0 && usages.length >= coupon.maxUses) return { status: 'LIMIT_REACHED' };
  const userUses = usages.filter((usage) => usage.userId === userId).length;
  if (coupon.singleUse && userUses > 0) return { status: 'USER_LIMIT_REACHED' };
  if (coupon.perUserLimit > 0 && userUses >= coupon.perUserLimit) return { status: 'USER_LIMIT_REACHED' };

  const value = Number(coupon.discountValue);
  const gross = Math.round(Number(amount) * 100) / 100;
  const discount = coupon.discountType === 'percent'
    ? Math.round(gross * value) / 100
    : Math.round(value * 100) / 100;
  if (!Number.isFinite(discount) || discount <= 0 || discount > gross) return { status: 'INVALID_DISCOUNT' };
  return { status: 'VALID', couponId: coupon.id, discount, finalAmount: Math.round((gross - discount) * 100) / 100 };
}

async function recordCouponUsage(store, guildId, { couponId, userId, planId, amount, discount, paymentId, at = new Date().toISOString() }) {
  return store.updateActiveProfile(guildId, (profile) => {
    const coupon = profile.coupons.find((entry) => entry.id === couponId && entry.status === 'active');
    if (!coupon) throw new Error('CUPON_NOT_ACTIVE');
    if (coupon.maxUses > 0 && coupon.usages.length >= coupon.maxUses) throw new Error('CUPON_LIMIT_REACHED');
    const userUses = coupon.usages.filter((usage) => usage.userId === userId).length;
    if ((coupon.singleUse && userUses > 0) || (coupon.perUserLimit > 0 && userUses >= coupon.perUserLimit)) {
      throw new Error('CUPON_USER_LIMIT_REACHED');
    }
    const usage = { userId, planId, amount, discount, paymentId, at };
    coupon.usages.push(usage);
    profile.couponHistory.push({ code: coupon.code, planId, userId, discount, paymentId, at });
    return usage;
  });
}

async function handleCouponComponent(interaction, store) {
  if (interaction.customId === 'speak:coupon:apply') {
    const profile = await store.getActiveProfile(interaction.guildId);
    const plans = profile.plans.filter((plan) => plan.status === 'active' && Number.isFinite(parsePlanAmount(plan.price))
      && parsePlanAmount(plan.price) > 0);
    if (!plans.length) {
      await interaction.reply({ content: 'Não há planos com preço disponíveis para validar cupom. Nenhuma compra foi iniciada.', flags: 64 });
      return true;
    }
    const select = new StringSelectMenuBuilder().setCustomId('speak:coupon:apply:plan')
      .setPlaceholder('Selecione o plano para validar o cupom')
      .addOptions(plans.slice(0, 25).map((plan) => ({ label: plan.name.slice(0, 100), value: plan.id })));
    await interaction.reply({ content: 'Selecione um plano para validar o cupom. Isso não inicia um pagamento.',
      components: [new ActionRowBuilder().addComponents(select)], flags: 64 });
    return true;
  }
  if (interaction.customId === 'speak:coupon:apply:plan') {
    const planId = interaction.values[0];
    const modal = new ModalBuilder().setCustomId(`speak:coupon:apply:submit:${planId}`)
      .setTitle('Validar cupom SPEAK')
      .addComponents(...rows([field('code', 'Código do cupom', '', TextInputStyle.Short, true)]));
    await interaction.showModal(modal);
    return true;
  }

  const profile = await store.getActiveProfile(interaction.guildId);
  if (!canAccessAdminArea(interaction.member, interaction.user.id, profile, 'coupons')) {
    await interaction.reply({ content: STAFF_DENIED_MESSAGE, flags: 64 });
    return true;
  }
  if (interaction.customId === 'speak:config:coupons') {
    const value = interaction.values[0];
    if (value === 'create') {
      await interaction.showModal(couponModal(null, true));
      return true;
    }
    const coupon = profile.coupons.find((entry) => entry.id === value.slice('manage:'.length));
    if (!coupon) throw new Error('Cupom não encontrado.');
    const embed = new EmbedBuilder().setTitle(`Cupom ${coupon.code}`).setColor(EMBED_COLORS.primary)
      .setDescription(`${coupon.discountType === 'percent' ? `${coupon.discountValue}%` : coupon.discountValue} OFF · ${coupon.status}`)
      .addFields(
        { name: 'Usos', value: `${coupon.usages.length}${coupon.maxUses ? ` / ${coupon.maxUses}` : ''}`, inline: true },
        { name: 'Expiração', value: coupon.expiresAt || 'Sem expiração', inline: true },
        { name: 'Planos', value: coupon.allowedPlanIds.join(', ') || 'Todos', inline: true },
      );
    await interaction.update({ content: '', embeds: [embed], components: couponControls(coupon) });
    return true;
  }

  const [, , action, couponId] = interaction.customId.split(':');
  const coupon = profile.coupons.find((entry) => entry.id === couponId);
  if (!coupon) throw new Error('Cupom não encontrado.');
  if (action === 'edit') await interaction.showModal(couponModal(coupon, false));
  else if (action === 'limits') await interaction.showModal(couponLimitsModal(coupon));
  else if (action === 'toggle') {
    await store.updateActiveProfile(interaction.guildId, (current) => {
      const item = current.coupons.find((entry) => entry.id === couponId);
      item.status = item.status === 'active' ? 'inactive' : 'active';
      item.updatedAt = new Date().toISOString();
    });
    await interaction.update({ content: `Cupom ${coupon.code} atualizado.`, components: [] });
  } else if (action === 'history') {
    const uses = coupon.usages.slice(-10).map((use) => `${use.at}: <@${use.userId}> · plano ${use.planId} · desconto ${use.discount}`);
    await interaction.reply({ content: uses.join('\n') || 'Nenhum uso registrado.', flags: 64, allowedMentions: { parse: [] } });
  } else if (action === 'delete') {
    await store.updateActiveProfile(interaction.guildId, (current) => {
      const item = current.coupons.find((entry) => entry.id === couponId);
      item.status = 'deleted';
      item.deletedAt = new Date().toISOString();
    });
    await interaction.update({ content: `Cupom ${coupon.code} excluído do uso e preservado no histórico.`, components: [] });
  }
  return true;
}

async function handleCouponModal(interaction, store) {
  if (interaction.customId.startsWith('speak:coupon:apply:submit:')) {
    const planId = interaction.customId.slice('speak:coupon:apply:submit:'.length);
    const profile = await store.getActiveProfile(interaction.guildId);
    const plan = profile.plans.find((entry) => entry.id === planId && entry.status === 'active');
    if (!plan) {
      await interaction.reply({ content: 'Plano indisponível. Nenhum pagamento foi iniciado.', flags: 64 });
      return true;
    }
    const amount = parsePlanAmount(plan.price);
    const validation = validateCoupon(profile, {
      code: interaction.fields.getTextInputValue('code'),
      planId,
      amount,
      userId: interaction.user.id,
    });
    const messages = {
      UNAVAILABLE: 'Cupom não encontrado ou inativo.', NOT_STARTED: 'Esse cupom ainda não está válido.',
      EXPIRED: 'Esse cupom expirou.', PLAN_NOT_ALLOWED: 'Esse cupom não é válido para o plano selecionado.',
      MINIMUM_NOT_MET: 'O valor mínimo exigido pelo cupom não foi atingido.', LIMIT_REACHED: 'O limite total de usos desse cupom foi atingido.',
      USER_LIMIT_REACHED: 'Você já atingiu o limite de uso desse cupom.', INVALID_DISCOUNT: 'O desconto configurado não pode ser aplicado a esse valor.',
    };
    const content = validation.status === 'VALID'
      ? `Cupom válido: desconto ${validation.discount.toFixed(2)}; preço interno após desconto ${validation.finalAmount.toFixed(2)}. Nenhuma compra foi iniciada e o uso não foi consumido.`
      : messages[validation.status] || 'Não foi possível validar o cupom.';
    await interaction.reply({ content, flags: 64 });
    return true;
  }

  const profile = await store.getActiveProfile(interaction.guildId);
  if (!canAccessAdminArea(interaction.member, interaction.user.id, profile, 'coupons')) {
    await interaction.reply({ content: STAFF_DENIED_MESSAGE, flags: 64 });
    return true;
  }
  const values = Object.fromEntries(interaction.fields.fields.map((input) => [input.customId, input.value.trim()]));
  if (interaction.customId === 'speak:coupon:create' || interaction.customId.startsWith('speak:coupon:edit:')) {
    const creating = interaction.customId === 'speak:coupon:create';
    const couponId = creating ? crypto.randomUUID() : interaction.customId.slice('speak:coupon:edit:'.length);
    const code = values.code.toUpperCase();
    const discountValue = Number(values.discountValue);
    if (!/^[A-Z0-9_-]{3,32}$/.test(code) || !['percent', 'fixed'].includes(values.discountType)
      || !Number.isFinite(discountValue) || discountValue <= 0
      || (values.discountType === 'percent' && discountValue > 100)
      || (values.startsAt && !Number.isFinite(Date.parse(values.startsAt)))
      || (values.expiresAt && !Number.isFinite(Date.parse(values.expiresAt)))) {
      throw new Error('Confira o código, o tipo e o valor do desconto e as datas ISO 8601.');
    }
    if (profile.coupons.some((item) => item.code === code && item.id !== couponId)) throw new Error('Esse código de cupom já existe.');
    await store.updateActiveProfile(interaction.guildId, (current) => {
      if (creating) {
        current.coupons.push({
          id: couponId, code, discountType: values.discountType, discountValue,
          status: 'inactive', startsAt: values.startsAt, expiresAt: values.expiresAt,
          maxUses: 0, perUserLimit: 1, allowedPlanIds: [], singleUse: false, minimumValue: 0,
          usages: [], createdAt: new Date().toISOString(), createdBy: interaction.user.id,
        });
      } else {
        const coupon = current.coupons.find((item) => item.id === couponId);
        coupon.code = code;
        coupon.discountType = values.discountType;
        coupon.discountValue = discountValue;
        coupon.startsAt = values.startsAt;
        coupon.expiresAt = values.expiresAt;
        coupon.updatedAt = new Date().toISOString();
      }
    });
    await interaction.reply({ content: 'Cupom salvo inativo. Configure os limites e ative-o quando estiver pronto.', flags: 64 });
    return true;
  }
  if (interaction.customId.startsWith('speak:coupon:limits:')) {
    const couponId = interaction.customId.slice('speak:coupon:limits:'.length);
    const maxUses = Number(values.maxUses);
    const perUserLimit = Number(values.perUserLimit);
    const minimumValue = Number(values.minimumValue);
    if (![maxUses, perUserLimit].every((value) => Number.isInteger(value) && value >= 0)
      || !Number.isFinite(minimumValue) || minimumValue < 0
      || !['true', 'false'].includes(values.singleUse.toLowerCase())) {
      throw new Error('Limites devem ser inteiros não negativos; uso único precisa ser true ou false.');
    }
    const allowedPlanIds = values.allowedPlanIds.split(',').map((id) => id.trim()).filter(Boolean);
    if (allowedPlanIds.some((id) => !profile.plans.some((plan) => plan.id === id))) {
      throw new Error('Há um ID de plano permitido que não existe.');
    }
    await store.updateActiveProfile(interaction.guildId, (current) => {
      const coupon = current.coupons.find((item) => item.id === couponId);
      coupon.maxUses = maxUses;
      coupon.perUserLimit = perUserLimit;
      coupon.minimumValue = minimumValue;
      coupon.singleUse = values.singleUse.toLowerCase() === 'true';
      coupon.allowedPlanIds = allowedPlanIds;
      coupon.updatedAt = new Date().toISOString();
    });
    await interaction.reply({ content: 'Limites do cupom salvos.', flags: 64 });
    return true;
  }
  return false;
}

module.exports = {
  couponMenu,
  handleCouponComponent,
  handleCouponModal,
  parsePlanAmount,
  recordCouponUsage,
  validateCoupon,
};