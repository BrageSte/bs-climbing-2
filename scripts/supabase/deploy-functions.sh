#!/usr/bin/env bash
set -euo pipefail

if ! command -v supabase >/dev/null 2>&1; then
  echo "Missing dependency: supabase CLI" >&2
  exit 1
fi

PROJECT_REF="${1:-${SUPABASE_PROJECT_REF:-}}"

if [[ -z "$PROJECT_REF" ]]; then
  echo "Project ref is required." >&2
  echo "Example: $0 your-project-ref" >&2
  exit 1
fi

FUNCTIONS=(
  "create-checkout"
  "stripe-webhook"
  "verify-session"
  "get-checkout-result"
  "get-order-status"
  "send-order-confirmation"
  "validate-promo"
)

for fn_name in "${FUNCTIONS[@]}"; do
  echo "Deploying function: ${fn_name}"
  supabase functions deploy "$fn_name" --project-ref "$PROJECT_REF"
done

echo "All functions deployed to project ${PROJECT_REF}."
