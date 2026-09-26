# ============================================================
# Stage 1: Build Web Client SPA (TypeScript + React + Vite)
# ============================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /build

# Copy shared protocol definitions and frontend package specs
COPY shared ./shared
COPY apps/web/package*.json ./apps/web/
RUN cd apps/web && npm install

# Copy web source and build production bundle
COPY apps/web ./apps/web
RUN cd apps/web && npm run build

# ============================================================
# Stage 2: Python 3.12 Production Runtime
# ============================================================
FROM python:3.12-slim AS runner
WORKDIR /app

# Install curl for container health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python backend dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application source
COPY backend ./backend
COPY shared ./shared

# Copy built frontend SPA assets from Stage 1 into apps/web/dist
# FastAPI natively serves these static files for zero-config Web UI
COPY --from=frontend-builder /build/apps/web/dist ./apps/web/dist

# Default network configuration: bind all interfaces
ENV HOST=0.0.0.0
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Docker healthcheck using the lightweight /health endpoint
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://127.0.0.1:${PORT:-8000}/health || exit 1

# Start Uvicorn ASGI server respecting cloud PORT environment variable
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
