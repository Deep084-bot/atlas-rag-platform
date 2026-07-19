.PHONY: help setup dev build lint \
        docker-build docker-start docker-stop docker-logs docker-clean \
        docker-dev-start docker-dev-stop docker-dev-logs docker-dev-clean \
        docker-reset docker-pgadmin

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-24s\033[0m %s\n", $$1, $$2}'

# ─── Local Development ──────────────────────────────────────────────────────

setup: ## Install dependencies and copy .env.example
	cp -n .env.example .env 2>/dev/null || true
	npm install

dev: ## Run both frontend and backend in development mode
	npm run dev

build: ## Build frontend for production
	npm run build

lint: ## Run linter (placeholder)
	npm run lint

# ─── Docker Production ──────────────────────────────────────────────────────

docker-build: ## Build all Docker images
	docker compose build

docker-start: ## Start all services in production mode
	docker compose up --build -d

docker-stop: ## Stop all services
	docker compose down

docker-logs: ## Follow logs for all services
	docker compose logs -f

docker-clean: ## Remove all containers, volumes, and images
	docker compose down -v --rmi all

# ─── Docker Development ─────────────────────────────────────────────────────

docker-dev-start: ## Start all services in development mode (hot-reload)
	docker compose -f docker-compose.dev.yml up --build -d

docker-dev-stop: ## Stop development services
	docker compose -f docker-compose.dev.yml down

docker-dev-logs: ## Follow logs for development services
	docker compose -f docker-compose.dev.yml logs -f

docker-dev-clean: ## Remove development containers, volumes, and images
	docker compose -f docker-compose.dev.yml down -v --rmi all

# ─── Docker Utilities ──────────────────────────────────────────────────────

docker-pgadmin: ## Start pgAdmin alongside services (requires profile)
	docker compose --profile tools up -d

docker-reset: ## Full reset: stop and remove all volumes (WARNING: deletes data)
	docker compose down -v
