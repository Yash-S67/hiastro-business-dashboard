// Public, non-secret runtime config for the dashboard front-end.
// Set the API base URL to your deployed dashboard API service (render.yaml) to
// enable live date selection, the natural-language query box, and auto-refresh.
window.HIASTRO_DASHBOARD_API_BASE_URL = window.HIASTRO_DASHBOARD_API_BASE_URL || "";

// Optional shared token. When the API service sets DASHBOARD_API_TOKEN, put the
// same value here so the published site can reach the token-gated endpoints.
// This is sent to your own API only; it is NOT a database or model credential.
window.HIASTRO_DASHBOARD_API_TOKEN = window.HIASTRO_DASHBOARD_API_TOKEN || "";
