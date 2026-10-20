---
paths:
  - "core/klaviyo_profiles.js"
  - "core/sql/klaviyo_profiles_v1.sql"
---

# Klaviyo profile sync — privacy guardrails

Our data → Klaviyo profile properties (`stk_*`), daily bulk import from `mart.v_klaviyo_profiles_v1`.

- Own key `API.Klaviyo.PROFILES_API_KEY` (Profiles + Lists scopes only). The events sync is separate and stays in `core/utils.js`.
- **Sends no amounts and no kennitala.** Keep it that way.
- **Only emails Klaviyo already knows** are sent, unless `SETTINGS.KLAVIYO_PROFILE_SYNC_INCLUDE_NEW=true`. Consent for new emails is unresolved — do not flip that default or widen the set without the user's decision.
