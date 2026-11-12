#!/usr/bin/env bash
# Run in Google Cloud Shell while signed in to the orbiter-ai administrator account.
set -euo pipefail
vertex_project="${VERTEX_SETUP_PROJECT:-orbiter-ai}"
vertex_team="${VERTEX_SETUP_TEAM:-kosmos42}"
vertex_app="${VERTEX_SETUP_APP:-kosmos}"
vertex_pool=orbiter-vercel
vertex_provider=kosmos-production
vertex_account=orbiter-vertex
vertex_subject="owner:${vertex_team}:project:${vertex_app}:environment:production"

command -v gcloud >/dev/null || { echo 'Google Cloud Shell에서 실행하세요.' >&2; exit 1; }
[[ "$vertex_project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ && "$vertex_team" =~ ^[a-z0-9-]+$ && "$vertex_app" =~ ^[a-z0-9-]+$ ]] || exit 1
vertex_number="$(gcloud projects describe "$vertex_project" --format='value(projectNumber)')"
[[ "$vertex_number" =~ ^[0-9]+$ ]] || exit 1
[[ "$(gcloud billing projects describe "$vertex_project" --format='value(billingEnabled)')" == True ]] || { echo '프로젝트 결제 계정을 먼저 연결하세요.' >&2; exit 1; }

gcloud services enable aiplatform.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$vertex_project"
if ! gcloud iam service-accounts describe "${vertex_account}@${vertex_project}.iam.gserviceaccount.com" --project="$vertex_project" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$vertex_account" --display-name='Orbiter Vertex runtime' --project="$vertex_project"
fi
vertex_email="${vertex_account}@${vertex_project}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$vertex_project" --member="serviceAccount:${vertex_email}" --role=roles/aiplatform.user --condition=None --quiet >/dev/null
if ! gcloud iam workload-identity-pools describe "$vertex_pool" --location=global --project="$vertex_project" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$vertex_pool" --location=global --display-name='Orbiter Vercel' --project="$vertex_project"
fi
vertex_resource="projects/${vertex_number}/locations/global/workloadIdentityPools/${vertex_pool}/providers/${vertex_provider}"
# Custom-audience Vercel tokens always use the team issuer, independent of project issuer mode.
if gcloud iam workload-identity-pools providers describe "$vertex_provider" --workload-identity-pool="$vertex_pool" --location=global --project="$vertex_project" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$vertex_provider" --workload-identity-pool="$vertex_pool" --location=global --project="$vertex_project" --issuer-uri="https://oidc.vercel.com/${vertex_team}" --allowed-audiences="https://iam.googleapis.com/${vertex_resource}" --attribute-mapping='google.subject=assertion.sub' --attribute-condition="assertion.sub == '${vertex_subject}'"
else
  gcloud iam workload-identity-pools providers create-oidc "$vertex_provider" --workload-identity-pool="$vertex_pool" --location=global --project="$vertex_project" --issuer-uri="https://oidc.vercel.com/${vertex_team}" --allowed-audiences="https://iam.googleapis.com/${vertex_resource}" --attribute-mapping='google.subject=assertion.sub' --attribute-condition="assertion.sub == '${vertex_subject}'"
fi
gcloud iam service-accounts add-iam-policy-binding "$vertex_email" --project="$vertex_project" --role=roles/iam.workloadIdentityUser --member="principal://iam.googleapis.com/projects/${vertex_number}/locations/global/workloadIdentityPools/${vertex_pool}/subject/${vertex_subject}" --quiet >/dev/null

cat <<VARS
# Vercel kosmos → Production 환경 변수 (비밀값 없음)
GOOGLE_VERTEX_PROJECT=${vertex_project}
GOOGLE_VERTEX_LOCATION=global
VERTEX_AUTH_MODE=wif
GOOGLE_VERTEX_WIF_PROVIDER=${vertex_resource}
GOOGLE_VERTEX_SERVICE_ACCOUNT=${vertex_email}
# Model Garden에서 사용 가능한 모델 ID를 확인해 추가:
# VERTEX_GEMINI_MODEL=...
# VERTEX_CLAUDE_MODEL=...
# 선택: VERTEX_SEARCH_MODEL=... (없으면 Gemini 기본 모델)
VARS
