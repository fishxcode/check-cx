# syntax=docker/dockerfile:1

# ---- 构建阶段 ----
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# 使用 Nitro node-server 预设，产出可长驻运行的 .output/server/index.mjs
ENV DEPLOY_TARGET=docker
RUN pnpm build

# ---- 运行阶段 ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=builder /app/.output ./.output
COPY docker/entrypoint.mjs ./entrypoint.mjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "entrypoint.mjs"]
