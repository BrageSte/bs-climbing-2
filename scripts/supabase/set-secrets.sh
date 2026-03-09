#!/usr/bin/env bash
set -euo pipefail

if ! command -v supabase >/dev/null 2>&1; then
  echo "Missing dependency: supabase CLI" >&2
  exit 1
fi

PROJECT_REF="${1:-${SUPABASE_PROJECT_REF:-}}"
SECRETS_FILE="${2:-}"

if [[ -z "$PROJECT_REF" ]]; then
  echo "Project ref is required." >&2
  echo "Example: $0 your-project-ref path/to/.env.secrets" >&2
  exit 1
fi

if [[ -n "$SECRETS_FILE" ]]; then
  if [[ ! -f "$SECRETS_FILE" ]]; then
    echo "Secrets file not found: $SECRETS_FILE" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
  set +a
fi

if [[ -n "${SUPABASE_URL:-}" || -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "Note: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved in Supabase Edge Functions and are injected automatically." >&2
  echo "This script does not set SUPABASE_* secrets for remote deployments." >&2
fi

REQUIRED_VARS=(
  "STRIPE_SECRET_KEY"
  "RESEND_API_KEY"
  "PUBLIC_SITE_URL"
  "ORDER_STATUS_SECRET"
)

for var_name in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required variable: ${var_name}" >&2
    exit 1
  fi
done

supabase secrets set --project-ref "$PROJECT_REF" \
  "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}" \
  "RESEND_API_KEY=${RESEND_API_KEY}" \
  "PUBLIC_SITE_URL=${PUBLIC_SITE_URL}" \
  "ORDER_STATUS_SECRET=${ORDER_STATUS_SECRET}"

if [[ -n "${PREVIEW_MODEL_TOKEN:-}" ]]; then
  supabase secrets set --project-ref "$PROJECT_REF" \
    "PREVIEW_MODEL_TOKEN=${PREVIEW_MODEL_TOKEN}"
fi

if [[ -n "${STRIPE_WEBHOOK_SECRET:-}" ]]; then
  supabase secrets set --project-ref "$PROJECT_REF" \
    "STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}"
  echo "All secrets updated for project ${PROJECT_REF} (including STRIPE_WEBHOOK_SECRET)."
else
  echo "Core secrets updated for project ${PROJECT_REF}."
  echo "STRIPE_WEBHOOK_SECRET not provided yet. Set it later after creating Stripe webhook endpoint."
fi
