# Chatbot de Mapeamento - Getnet

MVP do chatbot de mapeamento (n8n + Claude API + Supabase). Ver [LINKS.md](LINKS.md) para
URLs de referencia.

## Estrutura

- `supabase_schema.sql` - schema do banco (tabelas `mapeamentos`, `mapeamentos_pendencias`,
  `chatbot_getnet_sessions`). Ja aplicado no projeto Supabase real.
- `n8n_workflow_chatbot_mapeamento_getnet.json` - workflow completo do n8n, pronto pra importar
  (Workflows -> ... -> Import from File). Ja importado e em configuracao no n8n cloud.
- `mvp-chat-getnet/` - frontend + backend fino (Vercel serverless) so pra testar o chat antes
  de integrar na aplicacao real da Getnet. Ver o README dentro dessa pasta pra rodar local ou
  publicar na Vercel.

## Segredos para recriar (nao estao no git)

Nenhum destes vai pro repositorio - precisa recriar/coletar de novo em qualquer maquina nova:

| Segredo | Onde gerar | Onde usar |
|---|---|---|
| Supabase Access Token (`sbp_...`) | supabase.com/dashboard/account/tokens | `.mcp.json` local, se quiser rodar SQL direto via MCP |
| Senha do banco Postgres | Supabase -> Settings -> Database (ou "Reset database password") | Credencial Postgres dentro dos nodes do n8n |
| Anthropic API Key (`sk-ant-...`) | console.anthropic.com/settings/keys | Credencial "Header Auth" no node "Chamar Claude" do n8n |
| `N8N_WEBHOOK_URL` | Copiar do node Webhook (Production URL) depois de ativar o workflow | `.env` do `mvp-chat-getnet` |

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
