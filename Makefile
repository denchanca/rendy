.PHONY: zd_load zd_build zd_refresh

VENV ?= .venv
PY ?= $(VENV)/bin/python

zd_load:
	$(PY) scripts/zd_load.py

zd_build:
	psql utilization -f scripts/zd_build.sql

zd_refresh:
	psql utilization -f scripts/zd_refresh.sql
