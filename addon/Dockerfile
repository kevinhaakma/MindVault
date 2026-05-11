# Stage 1: build GUI
FROM node:20-alpine AS gui-build

WORKDIR /gui
COPY gui/package*.json ./
RUN npm ci
COPY gui/ ./
RUN npm run build

# Stage 2: runtime — single process (uvicorn serves GUI + API)
FROM python:3.11-slim

WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/server.py .

COPY --from=gui-build /gui/dist /var/www/html

COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 8765

CMD ["/run.sh"]
