# SPEAK Discord Bot

## Configuração

1. Instale as dependências com `npm install`.
2. Configure `DISCORD_TOKEN`, `DATA_ENCRYPTION_KEY` e `NVIDIA_API_KEY` no ambiente de deploy. `AI_API_KEY` é aceita como alternativa. `ISEKAY_USER_ID` é opcional e concede acesso total ao usuário configurado; `SPEAK_STAFF_ROLE_ID` é opcional e, sem ele, o cargo padrão é Equipe Staff (`1536253284309008445`). Gere a chave de criptografia com `openssl rand -base64 32` e mantenha o mesmo valor após reinicializações; sem ela, o armazenamento de acessos fica desativado.
3. Ative o intent privilegiado **Message Content Intent** na página do bot no Discord Developer Portal.
4. Convide o bot com permissões para visualizar canais, enviar mensagens, incorporar links, gerenciar mensagens, canais e cargos, e usar comandos de aplicação. Mantenha o cargo do bot acima dos cargos de planos.

## Executar

```sh
npm start
```

Ao conectar, um único `REST.put` registra globalmente `/clear` e os subcomandos SPEAK, substituindo o registro anterior e removendo comandos obsoletos. Comandos globais podem levar algum tempo para aparecer no Discord.

Os dados de configuração e acessos ficam em `data/guild-config.json`. As senhas são armazenadas criptografadas; perder ou trocar `DATA_ENCRYPTION_KEY` impede a leitura dos acessos existentes. O bot não cria transcrições de tickets.

## Planos e administração

Em `/speak config` → `🎤 Planos`, crie os planos e configure duração, preço interno, descrição e cargo. Planos novos começam inativos; associe um cargo válido e ative-os. O preço é somente administrativo e não cria checkout nem inicia pagamento.

Configure `Canal de logs admin` em `/speak config` → `📦 Geral` antes de usar `!s up` ou `!s demote`. O bot exige `Manage Roles`, hierarquia acima dos cargos escolhidos e capacidade de gerenciar o membro. Os acessos manuais ficam em `data/guild-config.json`, com `source: manual`; isso não representa confirmação de pagamento. Um verificador executado ao iniciar e a cada minuto marca acessos vencidos e tenta remover seus cargos.

Comandos administrativos, `/speak config` e `/speak painel` exigem o cargo Equipe Staff padrão, um usuário/cargo autorizado em `/speak config` → `🔐 Permissões` ou o usuário configurado em `ISEKAY_USER_ID`. A validação é feita no backend para comandos, botões, selects e modals.

- `!s up <id> <motivo>` abre a seleção de um plano ativo, aplica o cargo e registra início/expiração.
- `!s demote <id> <motivo>` revoga os acessos ativos do membro e remove os cargos associados.
- `!s anúncio <texto>` publica um embed sem processar menções.
- `!s promoção <texto>` exige confirmação entre sem ping, `@everyone`, `@here` e cancelar. Menções em massa também exigem permissão do executor e do bot.
- `!s oi`, `!s help`, `!s commands`, `!s ping`, `!s status`, `!s canais`, `!s ondefica <canal>`, `!s speak`, `!s saladofuturo` e `!s cmsp` são comandos públicos; mensagens naturais com `!s <pergunta>` passam pela IA.
- `!s sala do futuro` (também `!s sala futuro`) e `/speak sala-do-futuro` enviam o mesmo embed branco com botão Link oficial para alunos.
- `!s config`, `!s painel <#canal>`, `!s ticket`, `!s login`, `!s reset`, `!s up`, `!s down`, `!s ver`, `!s anúncio` e `!s promoção` encaminham para os fluxos existentes; o Slash equivalente está listado em `/speak commands`.
- `!s clear <quantidade>` é o atalho de prefixo para `/clear`; ambos usam a mesma validação e apagam a confirmação após cinco segundos.
- `/clear <numero>` apaga de 1 a 100 mensagens recentes e remove a confirmação do bot após cinco segundos. Exige autorização administrativa e a permissão `Gerenciar mensagens` do bot.

As operações UP/DEMOTE só são concluídas se o canal de logs administrativos estiver configurado e acessível ao bot. Senhas, tokens e secrets são redigidos antes de guardar/registrar motivos.

## IA SPEAK

A IA usa NVIDIA NIM em `https://integrate.api.nvidia.com/v1/chat/completions`, com o modelo `z-ai/glm-5.3`; `NVIDIA_API_KEY` é primária e `AI_API_KEY` é aceita como alternativa. Em `/speak config` → `🤖 IA`, os botões ON/OFF controlam IA e emojis personalizados; `/speak config` → `💤 Falas` edita a resposta de desconhecimento. `/speak help` e `/speak commands` são gerados do registro atual de Slash Commands. O assistente cobre as plataformas e os 17 canais centralizados em `src/config/defaults.js`; localização conhecida responde com menção determinística antes da NVIDIA. O contexto recente expira e é limitado; dados sensíveis, tickets privados e credenciais não são enviados à IA.

## Z.PAY

O pagamento Z.PAY não está integrado. Não foi possível identificar uma documentação oficial acessível que confirme endpoints de cobrança, autenticação, payload, consulta de status ou mecanismo/assinatura de webhook para as credenciais `ZPAY_CLIENT_ID` e `ZPAY_CLIENT_SECRET`. Essas variáveis são placeholders e não são lidas pelo bot. Nenhum pagamento é criado ou simulado; a integração exige a documentação oficial correta antes de ser habilitada.

Comandos de mensagem legados mantidos: `?speak` e `?speak ping`.
