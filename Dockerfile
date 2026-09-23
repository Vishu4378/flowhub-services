# ---- build stage: install all deps and compile TypeScript ----
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.9.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- runtime stage: only production deps + compiled output ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@11.9.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
