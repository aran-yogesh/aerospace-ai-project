COMPOSE := docker compose
CORE    := $(COMPOSE) run --rm --no-deps lemma-core

.DEFAULT_GOAL := help
.PHONY: help up down logs test test-golden golden types migrate lint format build ps desktop-install desktop-dev

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-16s %s\n",$$1,$$2}'

.env:
	cp .env.example .env
	@echo "Created .env from .env.example"

up: .env ## Build and start lemma-core + lemma-postgres
	$(COMPOSE) up -d --build --wait

down: ## Stop all services (keeps the database volume)
	$(COMPOSE) down

logs: ## Follow service logs
	$(COMPOSE) logs -f

ps: ## Show service status
	$(COMPOSE) ps

build: .env ## Build the backend image
	$(COMPOSE) build lemma-core

test: .env ## Run pytest inside the container (starts Postgres)
	$(COMPOSE) run --rm lemma-core pytest

test-golden: .env ## Run only the golden parser tests, with a results table
	$(COMPOSE) run --rm lemma-core pytest tests/test_parser_golden.py -v

golden: .env ## Regenerate the synthetic golden STEP files + expected JSON
	$(CORE) python /evals/golden/generate.py

types: .env ## Regenerate desktop TypeScript types from the Pydantic schema
	$(CORE) python -m scripts.gen_ts_types /types/geometry.ts

migrate: .env ## Apply Alembic migrations (starts Postgres if needed)
	$(COMPOSE) run --rm lemma-core alembic upgrade head

lint: .env ## Ruff lint + format check (backend), ESLint + color check (desktop)
	$(CORE) sh -c "ruff check . && ruff format --check ."
	cd desktop && npm run lint && npm run lint:colors

format: .env ## Auto-fix ruff lint and format
	$(CORE) sh -c "ruff check --fix . && ruff format ."

desktop-install: ## npm install for the desktop app
	cd desktop && npm install

desktop-dev: ## Run the Electron app in dev mode
	cd desktop && npm run dev
