# MVP - Chatbot de Mapeamento (Getnet)

MVP só para testar o fluxo do chat. Não é a aplicação Getnet real - é uma página + uma função
serverless que repassa a mensagem pro webhook do n8n e devolve a resposta.

## Estrutura

- `index.html` - frontend (uma página, sem framework)
- `api/chat.js` - função serverless da Vercel, chamada pelo frontend em `/api/chat`
- `lib/chatHandler.js` - lógica compartilhada (chama o webhook do n8n)
- `server.js` - servidor local só para rodar isso na sua máquina antes de publicar

## Rodar localmente

1. Copie `.env.example` para `.env` e coloque a URL de produção do seu webhook do n8n:
   ```
   cp .env.example .env
   ```
2. Instale o Node 18+ (já vem com `fetch` embutido).
3. Rode:
   ```
   N8N_WEBHOOK_URL="https://SEU-N8N.app.n8n.cloud/webhook/chatbot-mapeamento" npm run dev
   ```
4. Abra `http://localhost:3000`.

## Publicar na Vercel

1. `npm i -g vercel` (se ainda não tiver a CLI).
2. Dentro da pasta do projeto: `vercel` (primeira vez) ou `vercel --prod` (produção).
3. Em **Project Settings → Environment Variables** na Vercel, adicione `N8N_WEBHOOK_URL`
   com a URL de produção do webhook do n8n (a mesma do `.env`).
4. Redeploy depois de adicionar a variável, se ela não tiver sido aplicada automaticamente.

## Pendente antes de funcionar de verdade

Esse frontend só funciona depois que o workflow do n8n estiver criado, ativado, com as
credenciais do Supabase e da Anthropic configuradas, e com a URL de produção do webhook
copiada para `N8N_WEBHOOK_URL`.
