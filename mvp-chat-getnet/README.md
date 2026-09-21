# MVP - Chatbot de Mapeamento (Getnet)

MVP só para testar o fluxo do chat. Não é a aplicação Getnet real - é uma página + uma função
serverless que fala com o **Gateway do OpenClaw** (solução interina, apontada pro modelo
`nvidia/nemotron-3.5-lightning-30b-a3b`) e devolve a resposta. A migração para o **Microsoft
Copilot Studio** fica para depois - a implementação já existe pronta em
`lib/chatHandler.copilotstudio.js`, só não está ativa hoje. O n8n não está em nenhum dos dois
caminhos (ver `../README.md` para o porquê).

## Estrutura

- `index.html` - frontend (uma página, sem framework)
- `api/chat.js` - função serverless da Vercel, chamada pelo frontend em `/api/chat`
- `lib/chatHandler.js` - **ativo hoje**: fala com o Gateway do OpenClaw (ver
  `../openclaw/README.md`) e guarda o histórico da conversa no Supabase
  (`chatbot_getnet_sessions`)
- `lib/chatHandler.copilotstudio.js` - implementação de referência para o Copilot Studio via
  Direct Line API; não está em uso, guardada para quando migrarmos
- `server.js` - servidor local só para rodar isso na sua máquina antes de publicar

## Rodar localmente

1. Copie `.env.example` para `.env`:
   ```
   cp .env.example .env
   ```
2. Preencha as variáveis (ver "Pendente antes de funcionar de verdade" abaixo).
3. Instale o Node 18+ (já vem com `fetch` embutido).
4. Rode:
   ```
   npm run dev
   ```
5. Abra `http://localhost:3000`.

## Publicar na Vercel

1. `npm i -g vercel` (se ainda não tiver a CLI).
2. Dentro da pasta do projeto: `vercel` (primeira vez) ou `vercel --prod` (produção).
3. Em **Project Settings → Environment Variables** na Vercel, adicione as mesmas variáveis
   do `.env` — lembrando que `OPENCLAW_GATEWAY_URL` não pode ser `127.0.0.1` em produção (ver
   `../openclaw/README.md`, seção "Rodando isso em produção").
4. Redeploy depois de adicionar as variáveis, se não tiver sido aplicado automaticamente.

## Pendente antes de funcionar de verdade

1. Instalar e rodar o OpenClaw com o `openclaw/openclaw.json` deste repo (passo a passo em
   `../openclaw/README.md`) — inclui gerar a `NVIDIA_API_KEY` e definir um
   `OPENCLAW_GATEWAY_TOKEN` forte.
2. Preencher `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (a mesma service_role key usada
   pelo n8n antes, não a publishable key) — a tabela `chatbot_getnet_sessions` já existe no
   schema.
