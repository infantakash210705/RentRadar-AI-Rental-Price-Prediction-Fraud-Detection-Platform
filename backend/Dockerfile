# Build context is the repo root (see docker-compose.yml)
FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY db /db
RUN mkdir -p /data/uploads && chown -R node:node /data /app
ENV NODE_ENV=production
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://localhost:4000/api/health || exit 1
# migrate (idempotent) -> create/refresh admin if ADMIN_PASSWORD is set -> start API
CMD ["sh", "-c", "node src/scripts/migrate.js && { [ -z \"$ADMIN_PASSWORD\" ] || node src/scripts/seedAdmin.js; } && node src/server.js"]
