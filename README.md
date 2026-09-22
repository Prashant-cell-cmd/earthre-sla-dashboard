# \# EarthRe SLA Monitoring Dashboard

# 

# A full-stack monitoring dashboard built for the EarthRe Full Stack Engineer case study.

# 

# \## Live Demo

# 

# \*\*Frontend:\*\*

# https://earthre-sla-dashboard-bgj.pages.dev

# 

# \*\*API:\*\*

# https://earthre-sla-api.prashant-earthre-sla.workers.dev

# 

# \*\*GitHub:\*\*

# https://github.com/Prashant-cell-cmd/earthre-sla-dashboard

# 

# \## Overview

# 

# The application processes monitoring-check CSV files, validates and normalizes the data, stores the records in Cloudflare D1, and provides a dashboard for monitoring availability, latency, failures, invalid records, and detailed logs.

# 

# \### Data Flow

# 

# ```text

# CSV Upload

# &#x20;   ↓

# React Dashboard

# &#x20;   ↓

# Cloudflare Worker API

# &#x20;   ↓

# Validation \& Normalization

# &#x20;   ↓

# Cloudflare D1

# &#x20;   ↓

# Statistics \& Logs APIs

# &#x20;   ↓

# Monitoring Dashboard

# ```

# 

# \## Architecture

# 

# \### Frontend

# 

# \* React

# \* TypeScript

# \* Vite

# \* Cloudflare Pages

# 

# The frontend provides:

# 

# \* CSV upload

# \* Summary statistics

# \* Availability percentage

# \* Average latency

# \* P95 latency

# \* Success / failed / invalid counts

# \* Date and date-range filtering

# \* Monitoring logs table

# 

# \### Backend

# 

# \* Cloudflare Workers

# \* TypeScript

# \* REST API

# 

# The Worker handles:

# 

# \* CSV parsing

# \* Input validation

# \* Timestamp normalization

# \* Latency normalization

# \* Status-code classification

# \* Duplicate detection

# \* Database insertion

# \* Statistics calculation

# \* Log retrieval

# 

# \### Database

# 

# \* Cloudflare D1

# \* SQLite-compatible SQL database

# 

# The database stores:

# 

# \* Service information

# \* Timestamp

# \* HTTP status code

# \* Latency in milliseconds

# \* Agent

# \* Region

# \* Validity status

# \* Deterministic fingerprint

# \* Record creation time

# 

# \## Data Cleaning \& Quality Findings

# 

# The supplied monitoring datasets contain several data-quality issues.

# 

# \### Timestamp normalization

# 

# The datasets contain both:

# 

# \* ISO timestamp values

# \* Unix timestamp values

# 

# Both formats are normalized to UTC ISO-8601 timestamps before storage.

# 

# \### Latency normalization

# 

# Latency values can use different units.

# 

# \* Milliseconds are stored directly.

# \* Seconds are converted to milliseconds.

# \* Missing latency values are stored as `NULL`.

# \* Negative latency values are treated as invalid and stored as `NULL`.

# \* Non-finite latency values are also stored as `NULL`.

# 

# \### Status codes

# 

# The application handles:

# 

# \* `200` → successful check

# \* `500`, `502`, `503` → failed check

# \* `999` → invalid / unknown status

# 

# Invalid records are retained for auditability rather than silently deleted.

# 

# \### Duplicate records

# 

# Exact duplicate records occur in the supplied datasets.

# 

# A deterministic fingerprint is generated for each record, and the database uses a unique constraint to prevent duplicate storage.

# 

# \## Availability Calculation

# 

# Availability is calculated as:

# 

# ```text

# successful HTTP 200 checks

# \-------------------------------- × 100

# all stored checks

# ```

# 

# Status `999` records are retained but are not counted as successful checks.

# 

# HTTP `500`, `502`, and `503` are counted as failed checks.

# 

# This is an application-level monitoring availability metric and not a provider billing-credit calculation.

# 

# \## Final Production Data

# 

# All five supplied monitoring datasets were uploaded successfully.

# 

# | Dataset | Received | Inserted | Duplicates | Rejected |

# | ------- | -------: | -------: | ---------: | -------: |

# | 9-day   |          |          |            |          |



