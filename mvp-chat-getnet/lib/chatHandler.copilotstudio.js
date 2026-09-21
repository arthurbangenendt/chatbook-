// Implementação de referência para quando migrarmos de vez para o Microsoft Copilot Studio.
// NÃO está em uso agora (ver lib/chatHandler.js, que hoje fala com OpenClaw + NVIDIA Nemotron
// como solução interina). Para reativar: renomeie este arquivo para chatHandler.js e configure
// COPILOT_STUDIO_TOKEN_ENDPOINT (ver README.md desta pasta).
//
// Fala com o agente "Getnet Process Mapping Agent" do Copilot Studio via Direct Line API
// (https://learn.microsoft.com/microsoft-copilot-studio/publication-connect-bot-to-custom-application).
// A sessão do Direct Line (token/conversationId) fica no Supabase, que é a camada principal
// de persistência do chatbot — não guardamos isso em memória do processo (serverless é stateless).

const COPILOT_STUDIO_TOKEN_ENDPOINT = process.env.COPILOT_STUDIO_TOKEN_ENDPOINT;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DIRECTLINE_BASE = 'https://directline.botframework.com/v3/directline';
const SESSIONS_TABLE = 'chatbot_getnet_directline_sessions';

function assertConfigured() {
  if (!COPILOT_STUDIO_TOKEN_ENDPOINT) {
    const err = new Error('COPILOT_STUDIO_TOKEN_ENDPOINT não configurada no ambiente');
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

async function getStoredSession(sessionId) {
  const url = `${SUPABASE_URL}/rest/v1/${SESSIONS_TABLE}?session_id=eq.${encodeURIComponent(sessionId)}&select=*`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) throw new Error(`Supabase (select sessão) retornou ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function upsertSession(session) {
  const url = `${SUPABASE_URL}/rest/v1/${SESSIONS_TABLE}?on_conflict=session_id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(session),
  });
  if (!res.ok) throw new Error(`Supabase (upsert sessão) retornou ${res.status}`);
}

function toStoredSession(sessionId, { token, expires_in, conversationId }, watermark) {
  return {
    session_id: sessionId,
    conversation_id: conversationId,
    token,
    // margem de 1 min pra evitar usar um token que expira no meio de uma chamada
    expires_at: new Date(Date.now() + expires_in * 1000 - 60000).toISOString(),
    watermark: watermark ?? null,
  };
}

async function createDirectLineSession(sessionId) {
  const res = await fetch(COPILOT_STUDIO_TOKEN_ENDPOINT);
  if (!res.ok) throw new Error(`Token endpoint do Copilot Studio retornou ${res.status}`);
  const data = await res.json();
  const session = toStoredSession(sessionId, data);
  await upsertSession(session);
  return session;
}

async function refreshDirectLineToken(session) {
  const res = await fetch(`${DIRECTLINE_BASE}/tokens/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!res.ok) return null; // token expirado de vez — quem chamou deve criar uma sessão nova
  const data = await res.json();
  const refreshed = {
    ...session,
    token: data.token,
    expires_at: new Date(Date.now() + data.expires_in * 1000 - 60000).toISOString(),
  };
  await upsertSession(refreshed);
  return refreshed;
}

async function ensureSession(sessionId) {
  const existing = await getStoredSession(sessionId);
  if (existing && new Date(existing.expires_at) > new Date()) {
    return existing;
  }
  if (existing) {
    const refreshed = await refreshDirectLineToken(existing);
    if (refreshed) return refreshed;
  }
  return createDirectLineSession(sessionId);
}

function fromIdFor(sessionId) {
  return `getnet-mvp-${sessionId}`;
}

async function sendMessage(session, sessionId, message) {
  const res = await fetch(`${DIRECTLINE_BASE}/conversations/${session.conversation_id}/activities`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'message',
      from: { id: fromIdFor(sessionId) },
      text: message,
    }),
  });
  if (!res.ok) throw new Error(`Falha ao enviar mensagem ao Copilot Studio (${res.status})`);
}

async function waitForReply(session, sessionId, { timeoutMs = 15000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const fromId = fromIdFor(sessionId);
  let watermark = session.watermark;

  while (Date.now() < deadline) {
    const url = new URL(`${DIRECTLINE_BASE}/conversations/${session.conversation_id}/activities`);
    if (watermark) url.searchParams.set('watermark', watermark);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } });
    if (!res.ok) throw new Error(`Falha ao ler respostas do Copilot Studio (${res.status})`);
    const data = await res.json();
    watermark = data.watermark || watermark;

    const botMessages = (data.activities || []).filter(
      (a) => a.type === 'message' && a.from && a.from.id !== fromId
    );
    if (botMessages.length > 0) {
      await upsertSession({ ...session, watermark });
      return botMessages[botMessages.length - 1].text;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('O agente do Copilot Studio não respondeu a tempo');
}

async function handleChat({ message, sessionId }) {
  if (!message || !sessionId) {
    const err = new Error('message e sessionId são obrigatórios');
    err.status = 400;
    throw err;
  }
  assertConfigured();

  try {
    const session = await ensureSession(sessionId);
    await sendMessage(session, sessionId, message);
    const reply = await waitForReply(session, sessionId);
    return { reply };
  } catch (err) {
    err.status = err.status || 502;
    throw err;
  }
}

module.exports = { handleChat };
