# Arkitekten (processritaren) – EN avbild, två processer:
#   webben och bryggan:  CMD (standard)                     – :5173
#   flödestjänsten:      tsx server/flodestjanst.mts, PORT=8200
#                        – eller i samma container: ARK_FLODESTJANST_PORT=8200
#                          (där två tjänster inte kan dela disk, t.ex. Render)
# Innehållet (processer, visualiseringar, AI-brevlådan) ligger i volymen /data.
# Inga nycklar byggs in: allt kommer ur miljön när containern startar.

# ── Bygge ──────────────────────────────────────────────────────────────────────
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ── Drift ──────────────────────────────────────────────────────────────────────
FROM node:24-slim AS runtime

# Release-arbetsflödet skickar taggen (t.ex. 0.1.0); den syns i /health.
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="Arkitekten (processritaren)" \
      org.opencontainers.image.licenses="EUPL-1.2" \
      org.opencontainers.image.version="${APP_VERSION}"

ENV NODE_ENV=production \
    ARK_VERSION=${APP_VERSION} \
    PORT=5173 \
    FLOWS_DIR=/data/flows \
    RAMAR_DIR=/data/ramar \
    STILAR_DIR=/data/stilar \
    ARK_KONTON=/data/konton.json \
    ARK_DIR=/data/ark

WORKDIR /app
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/dist dist
# Servern kör TypeScript direkt (tsx) och delar modulerna i src/ med appen.
COPY package.json tsconfig.json ./
COPY src src
COPY server server
# Exempelpaketen: npx tsx server/innehallspaket.mts import exempel
COPY innehallspaket innehallspaket

COPY docker/start.sh /usr/local/bin/ark-start
RUN mkdir -p /data && chown node:node /data
# Ingen USER: docker/start.sh går över till node själv, efter att ha gett node
# en disk som monterats som root (Render). Med user: i compose körs den som den.
VOLUME /data
EXPOSE 5173 8200

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5173)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["ark-start"]
CMD ["node_modules/.bin/tsx", "server/arkitekten.mts"]
