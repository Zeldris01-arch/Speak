const { SlashCommandBuilder, ChannelType } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('apoiador')
    .setDescription('Painel comercial e de compras')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('painel')
        .setDescription('Publica o painel de compras e apoio')
        .addChannelOption((option) => option
          .setName('canal')
          .setDescription('Canal que receberá o painel')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true))
        .addStringOption((option) => option
          .setName('versao')
          .setDescription('Versão do painel')
          .addChoices(
            { name: 'Normal', value: 'normal' },
            { name: 'V2 com workspace', value: 'v2' },
          )),
    ),
  new SlashCommandBuilder()
    .setName('shu')
    .setDescription('Comandos gerais do SHU')
    .addSubcommand((subcommand) =>
      subcommand.setName('oi').setDescription('Converse com a IA educacional'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('ping').setDescription('Verifica se o bot está online'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('help').setDescription('Mostra os comandos principais'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('commands').setDescription('Lista todos os comandos registrados'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('Mostra o status público do SPEAK'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('canais').setDescription('Lista os canais do servidor'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('ondefica')
        .setDescription('Localiza o canal de uma plataforma')
        .addStringOption((option) => option.setName('nome').setDescription('Nome da plataforma ou área').setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('speak').setDescription('Informações sobre a plataforma SPEAK'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('saladofuturo').setDescription('Informações e acesso à Sala do Futuro'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('cmsp').setDescription('Informações sobre o CMSP'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('config').setDescription('Abre a configuração administrativa'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('login').setDescription('Abre a interface privada de acesso SPEAK'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('reset').setDescription('Gerencia seus acessos SPEAK'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('ticket').setDescription('Abre um ticket de atendimento'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('clear')
        .setDescription('Apaga mensagens recentes (Staff)')
        .addIntegerOption((option) => option
          .setName('numero')
          .setDescription('Quantidade entre 1 e 100')
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('anuncio')
        .setDescription('Publica um anúncio SPEAK sem menções')
        .addStringOption((option) => option.setName('texto').setDescription('Texto do anúncio').setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('promocao')
        .setDescription('Prepara uma promoção SPEAK para confirmação')
        .addStringOption((option) => option.setName('texto').setDescription('Texto da promoção').setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('ver')
        .setDescription('Consulta histórico SPEAK de um membro (Staff)')
        .addUserOption((option) => option.setName('usuario').setDescription('Membro do servidor').setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('sala-do-futuro').setDescription('Acessa a Sala do Futuro para alunos'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('up')
        .setDescription('Concede acesso SPEAK a um membro (Staff)')
        .addUserOption((option) => option.setName('usuario').setDescription('Membro que receberá acesso').setRequired(true))
        .addStringOption((option) => option.setName('motivo').setDescription('Motivo da concessão').setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('down')
        .setDescription('Revoga acessos SPEAK de um membro (Staff)')
        .addUserOption((option) => option.setName('usuario').setDescription('Membro que perderá o acesso').setRequired(true))
        .addStringOption((option) => option.setName('motivo').setDescription('Motivo da revogação').setRequired(true)),
    ),
].map((command) => command.toJSON());

module.exports = { commands };