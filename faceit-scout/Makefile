COMPOSE ?= docker compose
SERVICES := web processor postgres
PRIMARY_GOAL := $(firstword $(MAKECMDGOALS))
ARG := $(word 2,$(MAKECMDGOALS))

.PHONY: help setup up build rebuild restart down down-v logs migrate dev-web dev-processor test lint format reset

help:
	@echo "Docker:"
	@echo "  make setup              Create .env and local data folders"
	@echo "  make up                 Start the stack"
	@echo "  make build web          Build one service"
	@echo "  make build all          Build all services"
	@echo "  make rebuild web        Build and recreate one service"
	@echo "  make rebuild all        Build and recreate all services"
	@echo "  make restart web        Recreate one service from the current image"
	@echo "  make restart all        Recreate all services from current images"
	@echo "  make down               Stop the stack"
	@echo "  make down V=1           Stop the stack and remove volumes"
	@echo "  make down-v             Stop the stack and remove volumes"
	@echo "  make logs               Follow compose logs"
	@echo ""
	@echo "Local dev:"
	@echo "  make dev-web            Run the web dev server locally"
	@echo "  make dev-processor      Run the processor locally"
	@echo "  make test               Run processor and web tests"

setup:
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example"; else echo ".env already exists"; fi
	@mkdir -p data/incoming data/processing data/completed data/failed data/decompressed data/temporary
	@echo "Data folders are ready"

up: setup
	$(COMPOSE) up -d --build

build:
ifeq ($(ARG),)
	$(error Usage: make build <web|processor|postgres|all>)
endif
ifeq ($(ARG),all)
	$(COMPOSE) build
else ifneq ($(filter $(ARG),$(SERVICES)),$(ARG))
	$(error Unknown service "$(ARG)". Expected one of: $(SERVICES), all)
else
	$(COMPOSE) build $(ARG)
endif

rebuild:
ifeq ($(ARG),)
	$(error Usage: make rebuild <web|processor|postgres|all>)
endif
ifeq ($(ARG),all)
	$(COMPOSE) up -d --build --force-recreate
else ifneq ($(filter $(ARG),$(SERVICES)),$(ARG))
	$(error Unknown service "$(ARG)". Expected one of: $(SERVICES), all)
else
	$(COMPOSE) up -d --no-deps --build --force-recreate $(ARG)
endif

restart:
ifeq ($(ARG),)
	$(error Usage: make restart <web|processor|postgres|all>)
endif
ifeq ($(ARG),all)
	$(COMPOSE) up -d --force-recreate
else ifneq ($(filter $(ARG),$(SERVICES)),$(ARG))
	$(error Unknown service "$(ARG)". Expected one of: $(SERVICES), all)
else
	$(COMPOSE) up -d --no-deps --force-recreate $(ARG)
endif

down:
ifeq ($(V),1)
	$(COMPOSE) down -v
else
	$(COMPOSE) down
endif

down-v:
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f

migrate:
	cd apps/web && npm run db:migrate

dev-web:
	cd apps/web && npm run dev

dev-processor:
	cd apps/processor && python -m scout_processor.main

test:
	cd apps/processor && pytest
	cd apps/web && npm test

lint:
	cd apps/web && npm run lint

format:
	cd apps/processor && ruff format .

reset: down-v

ifneq ($(filter build rebuild restart,$(PRIMARY_GOAL)),)
ifneq ($(ARG),)
.PHONY: $(ARG)
$(ARG):
	@:
endif
endif
