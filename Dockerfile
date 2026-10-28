# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Node 20 on a glibc base (Debian bookworm-slim).
# onnxruntime-node ships glibc-only native binaries; the previous alpine (musl)
# base failed at runtime with `Error loading shared library ld-linux-*.so.*`.
# Node major version is unchanged (20).
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# onnxruntime-node ships native runtimes for darwin/linux/win32 on x64+arm64
# (~93 MB). Keep only the native runtime for the *build target* architecture and
# fail the build for unsupported architectures. BuildKit exposes the target as
# TARGETARCH (`amd64`/`arm64`); the package directory names are Node-style
# (`x64`/`arm64`), so map between them. onnxruntime-web (JS/browser) is left
# untouched because @xenova/transformers imports it unconditionally.
ARG TARGETARCH
RUN node -e "\
const fs=require('fs'),path=require('path');\
const map={amd64:'x64',arm64:'arm64'};\
const target=process.env.TARGETARCH||(process.arch==='x64'?'amd64':process.arch==='arm64'?'arm64':'');\
const arch=map[target];\
if(!arch){console.error('Unsupported TARGETARCH \"'+target+'\": onnxruntime-node supports only '+Object.keys(map).join(', '));process.exit(1);}\
const root=path.join(process.cwd(),'node_modules/onnxruntime-node/bin/napi-v3');\
if(!fs.existsSync(root)){console.error('onnxruntime-node native dir not found: '+root);process.exit(1);}\
for(const osName of fs.readdirSync(root)){\
const osDir=path.join(root,osName);\
if(osName==='linux'){for(const a of fs.readdirSync(osDir)){if(a!==arch)fs.rmSync(path.join(osDir,a),{recursive:true,force:true});}}\
else{fs.rmSync(osDir,{recursive:true,force:true});}\
}\
const kept=path.join(root,'linux',arch);\
if(!fs.existsSync(kept)){console.error('Expected native runtime missing after prune: '+kept);process.exit(1);}\
const files=fs.readdirSync(kept);\
if(!files.some(f=>f.endsWith('onnxruntime_binding.node'))||!files.some(f=>/^libonnxruntime\.so/.test(f))){console.error('Native runtime files missing in '+kept+': '+files.join(', '));process.exit(1);}\
console.log('onnxruntime-node kept: linux/'+arch+' (TARGETARCH='+target+')');"

# ---------------------------------------------------------------------------
# Backend runtime. Default provider stays `huggingface`; the EMBEDDING_LOCAL_*
# values below only take effect when EMBEDDING_PROVIDER=local is set explicitly.
# No secrets are baked into any layer.
# ---------------------------------------------------------------------------
FROM base AS backend
WORKDIR /app

COPY server/ ./server/
COPY api/ ./api/
COPY database/ ./database/
COPY scripts/dev/embedding-artifacts.mjs ./scripts/dev/embedding-artifacts.mjs

ENV NODE_ENV=production \
    PORT=8787 \
    EMBEDDING_CACHE_DIR=/app/model-cache \
    EMBEDDING_LOCAL_MODEL=Xenova/bge-small-en-v1.5 \
    EMBEDDING_LOCAL_REVISION=ea104dacec62c0de699686887e3f920caeb4f3e3 \
    EMBEDDING_LOCAL_POOLING=mean \
    EMBEDDING_LOCAL_QUANTIZED=true \
    EMBEDDING_LOCAL_ALLOW_REMOTE=false \
    EMBEDDING_LOCAL_STRICT=true

# Fetch the pinned INT8 model + tokenizer at build time and enforce SHA-256
# checksums from server/embeddings/embeddingManifest.js. The build fails on any
# checksum mismatch, and --check-env fails if env config disagrees with the
# manifest. Runtime startup then needs no network access.
RUN node scripts/dev/embedding-artifacts.mjs --cache-dir /app/model-cache --download --check-env

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8787/api/health || exit 1

CMD ["node", "server/index.js"]

# ---------------------------------------------------------------------------
# Frontend (build stage does not run ONNX, so alpine remains fine here).
# ---------------------------------------------------------------------------
FROM node:20-alpine AS frontend-build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY web/ ./web/
COPY tailwind.config.cjs ./

ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build:web

FROM nginx:alpine AS frontend

COPY --from=frontend-build /app/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
