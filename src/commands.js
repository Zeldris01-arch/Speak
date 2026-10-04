const { SlashCommandBuilder, ChannelType } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Apaga mensagens recentes (Staff)')
    .addIntegerOption((option) => option
      .setName('numero')
      .setDescription('Quantidade entre 1 e 100')
      .setMinValue(1)
      .setMaxValue(100)
      .setRequired(true)),
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
      .setName('cone')
      .setDescription('Comandos e ferramentas do Cone')
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
      subcommand.setName('status').setDescription('Mostra o status público do Cone'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('canais').setDescription('Lista os canais do servidor'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('painel')
        .setDescription('Publica o painel configurado do Cone')
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
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('config').setDescription('Abre a configuração administrativa'),
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
        .setDescription('Publica um anúncio sem menções')
        .addStringOption((option) => option.setName('texto').setDescription('Texto do anúncio').setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('promocao')
        .setDescription('Prepara uma promoção para confirmação')
        .addStringOption((option) => option.setName('texto').setDescription('Texto da promoção').setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('ver')
        .setDescription('Consulta o histórico administrativo de um membro (Staff)')
        .addUserOption((option) => option.setName('usuario').setDescription('Membro do servidor').setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('up')
        .setDescription('Concede um acesso configurado a um membro (Staff)')
        .addUserOption((option) => option.setName('usuario').setDescription('Membro que receberá acesso').setRequired(true))
        .addStringOption((option) => option.setName('motivo').setDescription('Motivo da concessão').setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('down')
        .setDescription('Revoga acessos configurados de um membro (Staff)')
        .addUserOption((option) => option.setName('usuario').setDescription('Membro que perderá o acesso').setRequired(true))
        .addStringOption((option) => option.setName('motivo').setDescription('Motivo da revogação').setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName('cone')
    .setDescription('Ferramentas do Cone')
    .addSubcommand((subcommand) =>
      subcommand.setName('onde-fica')
        .setDescription('Lista os canais configurados ou localiza um pelo nome')
        .addStringOption((option) => option
          .setName('nome')
          .setDescription('Nome do canal (opcional)')
          .setMaxLength(100)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('visor')
        .setDescription('Consulta informações públicas de um membro pelo ID')
        .addStringOption((option) => option
          .setName('id')
          .setDescription('ID do membro no servidor')
          .setMinLength(17)
          .setMaxLength(20)
          .setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName('coneondeficaconfig')
    .setDescription('Configuração dos canais exibidos pelo Cone')
    .addSubcommand((subcommand) =>
      subcommand.setName('add')
        .setDescription('Adiciona ou atualiza um canal de busca')
        .addStringOption((option) => option
          .setName('id')
          .setDescription('ID de um canal de texto deste servidor')
          .setMinLength(17)
          .setMaxLength(20)
          .setRequired(true))
        .addStringOption((option) => option
          .setName('nome')
          .setDescription('Nome usado para localizar o canal')
          .setMaxLength(100)
          .setRequired(true)),
    ),
];

const commandData = commands.map((command) => command.toJSON());
const coneRoots = commandData.filter((command) => command.name === 'cone');
const mainCone = coneRoots[0];
const coneTools = coneRoots[1];
const removedSchoolCommands = new Set([
  'ondefica', 'speak', 'saladofuturo', 'cmsp', 'login', 'reset', 'sala-do-futuro',
]);
mainCone.description = 'Comandos e ferramentas do Cone';
mainCone.options = mainCone.options.filter((option) => !removedSchoolCommands.has(option.name));
mainCone.options.push(...coneTools.options);
commandData.splice(commandData.indexOf(coneTools), 1);

module.exports = { commands: commandData };