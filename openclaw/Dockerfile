# Roda o Gateway do OpenClaw como servico sempre-ligado (Render, Fly.io, qualquer host Docker).
# Se o comando de instalacao mudar (a doc oficial avisa que isso muda com frequencia),
# confira https://docs.openclaw.ai/install antes de builder isso de novo.
FROM node:20-slim

RUN npm install -g openclaw

WORKDIR /app
COPY openclaw.json ./openclaw.json

ENV OPENCLAW_CONFIG_PATH=/app/openclaw.json
EXPOSE 18789

# Usa $PORT se a plataforma injetar (Render costuma injetar), senao cai no 18789 do config.
CMD ["sh", "-c", "openclaw gateway --port ${PORT:-18789}"]
