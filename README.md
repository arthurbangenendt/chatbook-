# Chatbot de Mapeamento - Getnet

MVP do chatbot de mapeamento. Arquitetura atual (interina): **OpenClaw + modelo NVIDIA
Nemotron (`nemotron-3.5-lightning-30b-a3b`) + Supabase**. O destino final é o **Microsoft
Copilot Studio** (agente "Getnet Process Mapping Agent"), mas ele só entra em produção depois
que o agente estiver criado/publicado no tenant da Getnet — enquanto isso, o OpenClaw segura
o chat funcionando. Ver [docs/MIGRATION_ANALYSIS.md](docs/MIGRATION_ANALYSIS.md) para a
análise completa da migração e [LINKS.md](LINKS.md) para URLs de referência.

## Estrutura

- `supabase_schema.sql` - schema do banco: `mapeamentos`, `mapeamentos_pendencias`,
  `chatbot_getnet_sessions` (já aplicado no projeto Supabase real - é onde o OpenClaw guarda
  o histórico de conversa hoje) e `chatbot_getnet_directline_sessions` (reservada para quando
  o Copilot Studio entrar; ainda não usada).
- `openclaw/` - config do OpenClaw (`openclaw.json`) usado como "cérebro" interino do chat,
  com as skills de execução (shell/filesystem/Docker/browser) explicitamente desligadas, mais
  o `Dockerfile` pra rodar o Gateway como serviço sempre-ligado. Ver `openclaw/README.md` para
  instalar local ou publicar na Render (pra outras pessoas conseguirem usar o chat, não só a
  sua máquina).
- `render.yaml` - Blueprint da Render que sobe o Gateway do OpenClaw (`openclaw/Dockerfile`)
  como serviço público. O `mvp-chat-getnet` continua na Vercel — só o Gateway precisa de um
  host sempre-ligado.
- `mvp-chat-getnet/` - frontend + backend fino (Vercel serverless). Hoje fala com o Gateway do
  OpenClaw (`lib/chatHandler.js`); a versão que fala com o Copilot Studio via Direct Line já
  está pronta em `lib/chatHandler.copilotstudio.js`, só não está ativa. Ver o README dentro
  dessa pasta pra rodar local ou publicar na Vercel.
- `n8n_workflow_chatbot_mapeamento_getnet.json` - workflow do n8n da arquitetura original
  (n8n + Anthropic). **Não está em nenhum dos caminhos atuais** — fica só como
  referência/histórico; se algum dia surgir uma integração sem substituto, o n8n volta como
  ferramenta pontual (nunca como banco de dados ou orquestrador principal — ver seção 9 do
  `MIGRATION_ANALYSIS.md`).

## Segredos para recriar (nao estao no git)

Nenhum destes vai pro repositorio - precisa recriar/coletar de novo em qualquer maquina nova:

| Segredo | Onde gerar | Onde usar |
|---|---|---|
| Supabase Access Token (`sbp_...`) | supabase.com/dashboard/account/tokens | `.mcp.json` local, se quiser rodar SQL direto via MCP |
| Supabase Service Role Key | Supabase -> Settings -> API | `SUPABASE_SERVICE_ROLE_KEY` no `.env` do `mvp-chat-getnet` |
| `NVIDIA_API_KEY` | build.nvidia.com -> pagina do modelo -> "Generate API Key" | Ambiente onde o OpenClaw roda (`openclaw/openclaw.json` referencia via `${NVIDIA_API_KEY}`) |
| `OPENCLAW_GATEWAY_TOKEN` | Voce mesmo gera (token forte qualquer) | Ambiente do OpenClaw **e** `.env` do `mvp-chat-getnet` (tem que ser o mesmo valor) |
| Senha do banco Postgres | Supabase -> Settings -> Database (ou "Reset database password") | Só necessária se algo voltar a acessar o Postgres direto (ex.: n8n, se reativado) |
| Anthropic API Key (`sk-ant-...`) | console.anthropic.com/settings/keys | Só necessária se o workflow n8n (arquitetura original) for reativado |
| `COPILOT_STUDIO_TOKEN_ENDPOINT` | Copilot Studio -> agente -> Channels -> Mobile app -> Token Endpoint | Só necessária quando migrarmos pra `lib/chatHandler.copilotstudio.js` |

## Setup do MCP da Supabase (opcional, so se for mexer no schema via Claude Code)

Crie um `.mcp.json` na raiz do projeto (fica de fora do git):

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=leivixtixejvzvlqudpo"],
      "env": { "SUPABASE_ACCESS_TOKEN": "sbp_seu_token_aqui" }
    }
  }
}
```

Precisa de Node.js instalado (`node -v` pra conferir). Depois de criar o arquivo, reinicie a
sessao do Claude Code nessa pasta.
