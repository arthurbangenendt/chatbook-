const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

async function handleChat({ message, sessionId }) {
  if (!message || !sessionId) {
    const err = new Error('message e sessionId são obrigatórios');
    err.status = 400;
    throw err;
  }

  if (!N8N_WEBHOOK_URL) {
    const err = new Error('N8N_WEBHOOK_URL não configurada no ambiente');
    err.status = 500;
    throw err;
  }

  const response = await fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      userId: 'mvp-tester',
      message,
    }),
  });

  if (!response.ok) {
    const err = new Error(`Webhook do n8n retornou status ${response.status}`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  return { reply: data.reply };
}

module.exports = { handleChat };
