// Solução interina (antes do Copilot Studio - ver chatHandler.copilotstudio.js e
// ../openclaw/README.md): fala com o Gateway do OpenClaw, que roda apontado pro modelo
// nvidia/nemotron-3.5-lightning-30b-a3b (config em ../openclaw/openclaw.json).
// O histórico da conversa fica no Supabase (chatbot_getnet_sessions), a mesma tabela que já
// existia para a arquitetura n8n - Supabase continua sendo a camada principal de persistência.

const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID || 'main';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SESSIONS_TABLE = 'chatbot_getnet_sessions';
const HISTORY_LIMIT = 20;

const SYSTEM_PROMPT =
  'Você é o assistente de mapeamento do sistema da Getnet. Seu papel é ajudar usuários ' +
  'internos a consultar e entender o status de mapeamento de terminais/equipamentos. ' +
  'Responda de forma direta e objetiva, em português. Se não souber algo, diga que não tem ' +
  'essa informação em vez de inventar.';

function assertConfigured() {
  if (!OPENCLAW_GATEWAY_TOKEN) {
    const err = new Error('OPENCLAW_GATEWAY_TOKEN não configurada no ambiente');
    err.status = 500;
    throw err;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const err = new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas no ambiente');
    err.status = 500;
    throw err;
  }
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function getHistory(sessionId) {
  const url =
    `${SUPABASE_URL}/rest/v1/${SESSIONS_TABLE}?session_id=eq.${encodeURIComponent(sessionId)}` +
    `&select=role,content&order=created_at.asc&limit=${HISTORY_LIMIT}`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) throw new Error(`Supabase (histórico) retornou ${res.status}`);
  return res.json();
}

async function saveTurn(sessionId, userId, role, content) {
  const url = `${SUPABASE_URL}/rest/v1/${SESSIONS_TABLE}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({ session_id: sessionId, user_id: userId, role, content }),
  });
  if (!res.ok) throw new Error(`Supabase (salvar mensagem) retornou ${res.status}`);
}

async function askOpenClaw(messages) {
  const res = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': OPENCLAW_AGENT_ID,
    },
    body: JSON.stringify({
      model: `openclaw:${OPENCLAW_AGENT_ID}`,
      messages,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Gateway do OpenClaw retornou ${res.status}`);
  const data = await res.json();
  const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return reply || 'Não consegui gerar uma resposta agora.';
}

async function handleChat({ message, sessionId }) {
  if (!message || !sessionId) {
    const err = new Error('message e sessionId são obrigatórios');
    err.status = 400;
    throw err;
  }
  assertConfigured();

  try {
    const userId = 'mvp-tester';
    const history = await getHistory(sessionId);
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map((row) => ({ role: row.role, content: row.content })),
      { role: 'user', content: message },
    ];

    const reply = await askOpenClaw(messages);

    await saveTurn(sessionId, userId, 'user', message);
    await saveTurn(sessionId, userId, 'assistant', reply);

    return { reply };
  } catch (err) {
    err.status = err.status || 502;
    throw err;
  }
}

module.exports = { handleChat };
