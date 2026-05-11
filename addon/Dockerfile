# Stage 1: build GUI
FROM node:20-alpine AS gui-build

WORKDIR /gui
COPY gui/package*.json ./
RUN npm ci
COPY gui/ ./
RUN npm run build

# Stage 2: runtime
# Use python:3.11-slim (Debian/glibc) — lancedb, fastembed, and onnxruntime
# have no musllinux wheels so the HA Alpine base won't work here.
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx \
 && rm -rf /var/lib/apt/lists/*

# Remove default nginx site so our config is the only one
RUN rm -f /etc/nginx/sites-enabled/default

WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/server.py .

COPY --from=gui-build /gui/dist /var/www/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 80 8765

CMD ["/run.sh"]
