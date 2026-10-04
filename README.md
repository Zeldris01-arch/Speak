# Cone Discord Bot

## Configuração

1. Instale as dependências com `npm install`.
2. Configure `DISCORD_TOKEN`, `DATA_ENCRYPTION_KEY` e `NVIDIA_API_KEY` no ambiente de deploy. `AI_API_KEY` é aceita como alternativa. `ISEKAY_USER_ID` e `SPEAK_STAFF_ROLE_ID` são opcionais; cargos e permissões devem ser definidos por servidor em `/cone config`. Gere a chave de criptografia com `openssl rand -base64 32` e mantenha o mesmo valor após reinicializações; sem ela, o armazenamento de acessos fica desativado.
3. Ative o intent privilegiado **Message Content Intent** na página do bot no Discord Developer Portal.
4. Convide o bot com permissões para visualizar canais, enviar mensagens, incorporar links, gerenciar mensagens, canais e cargos, e usar comandos de aplicação. Mantenha o cargo do bot acima dos cargos de planos.

## Executar

```sh
npm start
```

Ao conectar, um único `REST.put` registra o grupo `/cone`, `/coneondeficaconfig add`, `/clear` e `/apoiador`. Comandos globais podem levar algum tempo para aparecer no Discord.

Os dados de configuração, prefixo, permissões e Tickets ficam por servidor em `data/guild-config.json`. As senhas são armazenadas criptografadas; perder ou trocar `DATA_ENCRYPTION_KEY` impede a leitura dos acessos existentes. Transcripts de Tickets são enviados ao canal configurado quando habilitados.

O prefixo inicial é `!cone`, pode ser alterado por servidor em `/cone config` → `⌨️ Prefixo` e sempre precisa começar com `!`. O `/cone visor <id>` é restrito a administradores, dono do servidor e usuários/cargos autorizados.

Para habilitar em um servidor novo, configure os IDs de canal por grupo em `/cone config` → `📍 Canais do servidor`; o perfil não reutiliza canais do servidor antigo. Para Tickets, configure categoria, cargos Staff e canais de painel/logs em `/cone config` → `🎫 Tickets`. Transcripts são opcionais e exigem um canal configurado. `/cone config` → `🔗 Vínculos` permanece apenas como preparação, sem integração ativa.

`/cone onde-fica` lista os canais configurados; `/cone onde-fica nome` procura um canal específico. Staff autorizado pode cadastrar ou renomear canais extras com `/coneondeficaconfig add id nome`.

## Planos e administração

Em `/cone config` → `🎤 Planos`, crie os planos e configure duração, preço interno, descrição e cargo. Planos novos começam inativos; associe um cargo válido e ative-os. O preço é somente administrativo e não cria checkout nem inicia pagamento.

Configure `Canal de logs admin` em `/cone config` → `📦 Geral` antes de usar `!cone up` ou `!cone demote`. O bot exige `Manage Roles`, hierarquia acima dos cargos escolhidos e capacidade de gerenciar o membro. Os acessos manuais ficam em `data/guild-config.json`, com `source: manual`; isso não representa confirmação de pagamento. Um verificador executado ao iniciar e a cada minuto marca acessos vencidos e tenta remover seus cargos.

Comandos administrativos, `/cone config` e `/cone painel` exigem Staff/administrador, um usuário/cargo autorizado em `/cone config` → `🔐 Permissões` ou o usuário configurado em `ISEKAY_USER_ID`. A validação é feita no backend para comandos, botões, selects e modals.

- `!cone up <id> <motivo>` abre a seleção de um plano ativo, aplica o cargo e registra início/expiração.
- `!cone demote <id> <motivo>` revoga os acessos ativos do membro e remove os cargos associados.
- `!cone anúncio <texto>` publica um embed sem processar menções.
- `!cone promoção <texto>` exige confirmação entre sem ping, `@everyone`, `@here` e cancelar. Menções em massa também exigem permissão do executor e do bot.
- `!cone help`, `!cone commands`, `!cone ping`, `!cone status`, `!cone canais` e mensagens naturais com `!cone <pergunta>`.
- `!cone config`, `!cone painel <#canal>`, `!cone ticket`, `!cone up`, `!cone down`, `!cone ver`, `!cone anúncio` e `!cone promoção` encaminham para os fluxos existentes.
- `!cone clear <quantidade>` é o atalho de prefixo para `/clear`; ambos usam a mesma validação e apagam a confirmação após cinco segundos.
- `/clear <numero>` apaga de 1 a 100 mensagens recentes e remove a confirmação do bot após cinco segundos. Exige autorização administrativa e a permissão `Gerenciar mensagens` do bot.

As operações UP/DEMOTE só são concluídas se o canal de logs administrativos estiver configurado e acessível ao bot. Senhas, tokens e secrets são redigidos antes de guardar/registrar motivos.

## IA SPEAK

O assistente usa NVIDIA NIM em `https://integrate.api.nvidia.com/v1/chat/completions`, com o modelo `z-ai/glm-5.3`; `NVIDIA_API_KEY` é primária e `AI_API_KEY` é aceita como alternativa. Em `/cone config` → `🤖 IA`, os botões ON/OFF controlam IA e emojis personalizados; `/cone config` → `💤 Falas` edita a resposta de desconhecimento. `/cone help` e `/cone commands` são gerados do registro atual de Slash Commands. Canais podem ser configurados por servidor; dados sensíveis, tickets privados e credenciais não são enviados à IA.

## Z.PAY

O pagamento Z.PAY não está integrado. Não foi possível identificar uma documentação oficial acessível que confirme endpoints de cobrança, autenticação, payload, consulta de status ou mecanismo/assinatura de webhook para as credenciais `ZPAY_CLIENT_ID` e `ZPAY_CLIENT_SECRET`. Essas variáveis são placeholders e não são lidas pelo bot. Nenhum pagamento é criado ou simulado; a integração exige a documentação oficial correta antes de ser habilitada.

