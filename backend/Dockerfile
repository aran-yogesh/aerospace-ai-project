# syntax=docker/dockerfile:1.7

# ---- base: slim Python + system libs that OCP (CadQuery) needs at import time ----
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxrender1 libxext6 libsm6 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /usr/local/bin/uv
WORKDIR /app

# ---- deps: runtime deps + CAD stack from prebuilt wheels (cached layer) ----
FROM base AS deps
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra cad \
 && python -c "import cadquery, ocp_tessellate"

# ---- dev: adds pytest/ruff; used by docker-compose for local work and `make test` ----
FROM deps AS dev
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --extra cad
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ---- runtime: production image, non-root ----
FROM deps AS runtime
RUN useradd --create-home --uid 10001 lemma
COPY --chown=lemma:lemma . .
USER lemma
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
