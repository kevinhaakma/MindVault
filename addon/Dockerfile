ARG BUILD_FROM

# ─── Stage 1: build GUI ────────────────────────────────────────────────────
FROM node:20-alpine AS gui-build

WORKDIR /gui
COPY gui/package*.json ./
RUN npm ci
COPY gui/ ./
RUN npm run build

# ─── Stage 2: runtime ──────────────────────────────────────────────────────
FROM ${BUILD_FROM}

RUN apk add --no-cache python3 py3-pip nginx

# Python backend
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt
COPY backend/server.py .

# Built GUI → nginx document root
COPY --from=gui-build /gui/dist /var/www/html

# nginx config
COPY nginx.conf /etc/nginx/http.d/default.conf

# Startup script
COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 80 8765

CMD ["/run.sh"]
