FROM node:22-alpine

# OpenSSL for Prisma, curl for the health check; apk upgrade pulls OS security fixes
RUN apk upgrade --no-cache && \
    apk add --no-cache openssl curl ca-certificates

WORKDIR /app

# Dependencies (postinstall runs "prisma generate", so the schema is needed first)
COPY package.json package-lock.json ./
COPY prisma ./prisma
# package-lock.json is written by npm 11; npm 10 (bundled with Node 22) rejects it
RUN npm install -g npm@11.6.2 --no-audit --no-fund && \
    npm ci --no-audit --no-fund && \
    npm prune --omit=dev --no-audit --no-fund && \
    npm cache clean --force

COPY src ./src
COPY abi ./abi
COPY tsconfig.json ./

ENV NODE_ENV=production \
    PORT=3001

RUN chown -R node:node /app
USER node

# API + Socket.IO share this port
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

CMD ["node", "--import", "tsx", "src/index.ts"]
