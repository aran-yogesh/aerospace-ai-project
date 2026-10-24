COMPOSE := docker compose
CORE    := $(COMPOSE) run --rm --no-deps lemma-core

.DEFAULT_GOAL := help
.PHONY: help up down logs test test-golden golden types migrate lint format build ps desktop-install desktop-dev clean-dev-data e2e e2e-up e2e-down

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

clean-dev-data: .env ## Delete dev-database projects named "Test · ..." and their uploads
	$(COMPOSE) run --rm lemma-core python -m scripts.clean_dev_data

E2E_PORT ?= 18001
E2E_API  := http://localhost:$(E2E_PORT)

e2e-up: .env ## Start an isolated backend on :$(E2E_PORT) with a fresh lemma_e2e database
	-docker rm -f lemma-core-e2e >/dev/null 2>&1
	$(COMPOSE) run -d --rm --name lemma-core-e2e --publish $(E2E_PORT):8000 -e UPLOADS_DIR=/tmp/e2e-uploads \
	  lemma-core sh -c 'export DATABASE_URL="$$(python -m scripts.testdb create e2e)" && exec uvicorn app.main:app --host 0.0.0.0 --port 8000'
	@for i in $$(seq 1 60); do curl -sf $(E2E_API)/health >/dev/null && exit 0; sleep 1; done; echo "e2e backend did not start"; exit 1

e2e-down: ## Stop the e2e backend and drop lemma_e2e
	-docker rm -f lemma-core-e2e >/dev/null 2>&1
	$(CORE) python -m scripts.testdb drop e2e

e2e: e2e-up ## Playwright e2e + console/CSP audit (prod and dev) on an isolated backend
	cd desktop && VITE_API_URL=$(E2E_API) npm run build && VITE_API_URL=$(E2E_API) npm run phase1 \
	  && VITE_API_URL=$(E2E_API) npm run phase1:dev -- --no-shots \
	  && VITE_API_URL=$(E2E_API) npm run phase2 \
	  && VITE_API_URL=$(E2E_API) npm run phase2:dev -- --no-shots; \
	  status=$$?; cd .. && $(MAKE) e2e-down && cd desktop && npm run build >/dev/null; exit $$status

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
