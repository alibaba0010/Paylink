SHELL := /bin/bash

API_HEALTH_URL ?= http://127.0.0.1:8001/health

dev:
	@set -euo pipefail; \
	trap 'kill 0' EXIT; \
	(cd api && npm run dev) & \
	api_pid=$$!; \
	echo "Waiting for API to become ready at $(API_HEALTH_URL)..."; \
	until curl --silent --fail "$(API_HEALTH_URL)" >/dev/null; do \
		if ! kill -0 $$api_pid 2>/dev/null; then \
			echo "API process exited before becoming ready."; \
			exit 1; \
		fi; \
		sleep 1; \
	done; \
	echo "API is ready. Starting frontend..."; \
	(cd frontend && npm run dev) & \
	wait
