# syntax=docker/dockerfile:1
# Web-App (W1): Website mit Editor (website/dist, in der Build-Stufe gebaut) und Engine-API in EINEM Prozess
# (packages/engine/scripts/web.ts) auf Port 8080 – ein Ursprung, JEV über den Server, der Modell-Schlüssel bleibt im
# Container. Läuft wie lokal über tsx (kein Build-Schritt für den Server: Workspaces exportieren TypeScript-Quellen);
# die Generierung läuft im Worker-Pool (node:worker_threads).
#
#   docker build -t mcda-web .
#   docker run -d -p 8080:8080 -v engine-data:/data -e OPENROUTER_API_KEY mcda-web
#   (Modell-Schlüssel aus der eigenen Shell durchreichen, nie ins Image; ohne Schlüssel: lokaler Klassifikator)
#
# Standard ist der öffentliche Web-Modus (ENGINE_WEB_PUBLIC=1): Website öffentlich, nur POST /v1/interpret ohne
# Anmeldung und nur von der eigenen Seite (bzw. ENGINE_PUBLIC_ORIGINS), NL-Rate-Limit je IP. Kostenbremse ist das
# Tagesbudget ENGINE_WEB_NL_DAILY: mit Modell-Schlüssel ohne Angabe 300/Tag (Startmeldung „publicBudget“). Die
# Origin-Prüfung schützt nur vor fremden Webseiten im Browser, nicht vor curl. Alle übrigen /v1-Routen brauchen
# API-Schlüssel (ohne Schlüssel gesperrt), /healthz zeigt ohne Schlüssel nur { ok, auth: "public" }:
#   -e ENGINE_API_KEYS_FILE=/config/api-keys.txt -v "$PWD/api-keys.txt:/config/api-keys.txt:ro"
#   (Schlüssel erzeugen: npm run keygen -w @mcda/engine -- <name> --file api-keys.txt)
# Hinter einem TLS-Reverse-Proxy (der übliche Betrieb):
#   -e ENGINE_TRUST_PROXY=1 – sonst teilen sich alle Besucher die IP des Proxys und damit EIN Rate-Limit.
#   Port nur für den Proxy veröffentlichen (-p 127.0.0.1:8080:8080 oder internes Netz), sonst ist X-Forwarded-For
#   fälschbar. Der Proxy reicht Host durch und hängt X-Forwarded-For/-Proto an (Einzelheiten: .env.example).
# Nur die Engine-API wie bisher (ohne Website, Port 8787, Schlüssel Pflicht):
#   docker run … -e ENGINE_PORT=8787 -e ENGINE_API_KEYS_FILE=/config/api-keys.txt … mcda-web \
#     node --import tsx packages/engine/scripts/serve.ts
# Weitere Variablen: .env.example (z. B. ENGINE_GENERATE_WORKERS, ENGINE_RATE_NL, ENGINE_NL_API_KEY).

ARG NODE_IMAGE=node:26-bookworm-slim

# Nur die package.json aller Workspaces: Abhängigkeiten werden neu installiert, wenn sich Manifeste ändern, nicht Code.
FROM ${NODE_IMAGE} AS manifests
WORKDIR /src
COPY packages packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=manifests /src/packages packages
# Laufzeit-Abhängigkeiten (tsx, zod, json5, MCP-SDK …) ohne Dev-Werkzeuge; ohne Install-Skripte
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

# Website bauen (npm run web:build): Editor per Vite (Dev-Abhängigkeiten) nach website/dist/editor, Seite daneben.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=manifests /src/packages packages
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY catalog catalog
COPY packages packages
COPY website website
COPY tools/public-support tools/public-support
RUN npm run web:build

# Quellen fürs Laufzeit-Image: Editor und Vorschau laufen nur im Browser (in website/dist gebündelt) → nur Manifeste
FROM ${NODE_IMAGE} AS sources
WORKDIR /src
COPY packages packages
RUN find packages/app packages/viewer -mindepth 1 -maxdepth 1 ! -name package.json -exec rm -rf {} +

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    ENGINE_HOST=0.0.0.0 \
    ENGINE_PORT=8080 \
    ENGINE_WEB_PUBLIC=1 \
    ENGINE_WEB_DIR=/app/website/dist \
    ENGINE_STORE_FILE=/data/projects.sqlite \
    ENGINE_NL_LOG=off
WORKDIR /app
COPY --from=deps --chown=root:root /app/node_modules node_modules
COPY --chown=root:root package.json package-lock.json ./
COPY --chown=root:root catalog catalog
COPY --from=sources --chown=root:root /src/packages packages
COPY --from=build --chown=root:root /app/website/dist website/dist
# Code gehört root und ist nur lesbar; schreiben darf der Server nur in /data (SQLite).
RUN mkdir -p /data /config && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.ENGINE_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# node direkt (PID 1) statt npm/tsx-CLI: SIGTERM erreicht den Server, der sauber herunterfährt (ENGINE_SHUTDOWN_MS).
CMD ["node", "--import", "tsx", "packages/engine/scripts/web.ts"]
