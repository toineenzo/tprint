FROM node:22-alpine AS frontend

# The repo layout is mirrored (/src/frontend, /src/app) because vite.config.ts
# writes its bundle to ../app/static/dist — the same path it uses locally.
WORKDIR /src/frontend

# Dependencies first, so a source-only change doesn't re-run npm ci.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/src ./src
# `npm run build` type-checks before bundling, so a type error fails the image
# build instead of shipping a broken UI.
RUN npm run build


FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY --from=frontend /src/app/static/dist ./app/static/dist

# Captures the moment this image was actually built (i.e. when Portainer
# last pulled + rebuilt the stack) so the UI can show "last updated". It
# doubles as the cache-buster for the frontend bundle, which is served under
# a fixed, unhashed filename.
RUN date -u +"%Y-%m-%d %H:%M UTC" > /app/build_info.txt

ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
