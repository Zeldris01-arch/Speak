const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { EMBED_COLORS } = require('./config/defaults');

const SALA_DO_FUTURO_URL = 'https://saladofuturo.educacao.sp.gov.br/login-alunos';

function isSalaDoFuturoCommand(value) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
    .replace(/\s+/g, ' ');
  return ['sala do futuro', 'sala futuro', 'saladofuturo'].includes(normalized);
}

function createSalaDoFuturoPayload() {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.primary)
    .setTitle('📚 Sala do Futuro')
    .setDescription('Para acessar a Sala do Futuro, clique no botão abaixo.');
  const linkButton = new ButtonBuilder()
    .setLabel('Acessar')
    .setEmoji('🔗')
    .setStyle(ButtonStyle.Link)
    .setURL(SALA_DO_FUTURO_URL);
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(linkButton)],
  };
}

module.exports = {
  SALA_DO_FUTURO_URL,
  createSalaDoFuturoPayload,
};