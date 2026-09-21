# OpenClaw - solução interina (antes do Copilot Studio)

Enquanto o agente "Getnet Process Mapping Agent" não está publicado no Microsoft Copilot
Studio (ver [../docs/MIGRATION_ANALYSIS.md](../docs/MIGRATION_ANALYSIS.md)), o chatbot usa o
[OpenClaw](https://github.com/openclaw/openclaw) apontado para o modelo
`nvidia/nemotron-3.5-lightning-30b-a3b` (NVIDIA NIM) como "cérebro" temporário.

## Decisão de segurança importante

O `openclaw.json` deste diretório **desliga explicitamente** as skills de execução do
OpenClaw (shell, filesystem, Docker, browser automation) via `skills.allowBundled: []`
(modo whitelist, nada habilitado por padrão) + `skills.entries` redundante. O agente só
conversa - ele não deve ganhar nenhuma dessas skills enquanto estiver recebendo mensagens de
usuários (risco de prompt injection virar execução de comando no servidor). Se algum dia
precisar de uma skill específica (ex.: consultar o Supabase), ela deve ser uma skill
customizada e restrita, nunca as skills genéricas de sistema.

## Instalar e rodar

1. Instale o OpenClaw seguindo o guia oficial: https://docs.openclaw.ai (o pacote/instalador
   muda com frequência - siga a versão mais recente da doc oficial, não fixe num comando
   específico aqui).
2. Gere sua chave da API da NVIDIA em https://build.nvidia.com (o print que você mandou já
   mostra o botão "Generate API Key" na página do modelo `nemotron-3.5-lightning-30b-a3b`).
3. Exporte as variáveis de ambiente antes de rodar o OpenClaw:
   ```
   export NVIDIA_API_KEY="sua-chave-nvidia-aqui"
   export OPENCLAW_GATEWAY_TOKEN="gere-um-token-forte-aqui"
   export OPENCLAW_CONFIG_PATH="$(pwd)/openclaw/openclaw.json"
   ```
4. Rode o OpenClaw (o comando exato depende da versão instalada - confira `openclaw --help`
   ou a doc oficial; em geral é algo como `openclaw gateway start` ou só `openclaw`).
5. Confirme que o Gateway subiu e responde no endpoint OpenAI-compatível:
   ```
   curl -sS http://127.0.0.1:18789/v1/chat/completions \
     -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"model":"openclaw:main","messages":[{"role":"user","content":"oi"}]}'
   ```

## Rodando isso em produção (pra todo mundo usar, não só sua máquina)

O backend do MVP (`mvp-chat-getnet`) roda como função serverless na Vercel e faz uma chamada
HTTP pro Gateway do OpenClaw. A Vercel **não serve** pra hospedar o Gateway em si (funções
serverless não mantêm um processo ligado o tempo todo) - por isso ele precisa de um serviço à
parte, sempre ligado. Usamos a Render pra isso.

### Deploy na Render

1. No [dashboard da Render](https://dashboard.render.com), escolha **New → Blueprint** e
   aponte pro repositório do GitHub (`render.yaml` na raiz já descreve o serviço).
2. Quando pedir os valores de `NVIDIA_API_KEY` e `OPENCLAW_GATEWAY_TOKEN`, cole os mesmos
   valores que você usa localmente (gere um `OPENCLAW_GATEWAY_TOKEN` forte se ainda não tiver
   um).
3. Espere o build (`openclaw/Dockerfile`) terminar. A Render vai dar uma URL tipo
   `https://openclaw-gateway-getnet.onrender.com` - é ela que vai em `OPENCLAW_GATEWAY_URL`.
4. Teste com `curl` (mesmo formato do passo 5 acima, trocando `127.0.0.1:18789` pela URL da
   Render, sem porta - a Render já serve em HTTPS na 443):
   ```
   curl -sS https://openclaw-gateway-getnet.onrender.com/v1/chat/completions \
     -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"model":"openclaw:main","messages":[{"role":"user","content":"oi"}]}'
   ```
5. Na Vercel (Project Settings → Environment Variables do `mvp-chat-getnet`), defina
   `OPENCLAW_GATEWAY_URL=https://openclaw-gateway-getnet.onrender.com` e
   `OPENCLAW_GATEWAY_TOKEN` com o mesmo valor usado na Render. Redeploy.

Depois disso, qualquer pessoa que abrir a URL da Vercel consegue conversar com o chatbot -
não depende mais da sua máquina estar ligada.

**Atenção**: o `render.yaml` deste repo já pede um plano pago (`1c-2g`) porque o tier
gratuito da Render costuma "dormir" o serviço depois de um tempo sem uso (a primeira
mensagem depois de um tempo parado demora bem mais pra responder, porque o container precisa
religar) - ruim numa apresentação ao vivo. Se quiser testar no tier gratuito antes de pagar
por algo, troque o plano na tela de configuração do serviço, no dashboard da Render, depois
do import do Blueprint.

## Variáveis de ambiente usadas por `openclaw.json`

| Variável | Onde é usada |
|---|---|
| `NVIDIA_API_KEY` | Autenticação com `integrate.api.nvidia.com` (provider `nvidia-nim`) |
| `OPENCLAW_GATEWAY_TOKEN` | Token do Gateway HTTP do OpenClaw - o mesmo valor vai em `mvp-chat-getnet/.env` |
