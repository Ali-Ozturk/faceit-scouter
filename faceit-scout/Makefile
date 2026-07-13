.PHONY: up down logs migrate web processor test lint format reset

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

migrate:
	cd apps/web && npm run db:migrate

web:
	cd apps/web && npm run dev

processor:
	cd apps/processor && python -m scout_processor.main

test:
	cd apps/processor && pytest
	cd apps/web && npm test

lint:
	cd apps/web && npm run lint

format:
	cd apps/processor && ruff format .

reset:
	docker compose down -v
