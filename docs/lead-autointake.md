# Auto Lead Intake Setup

Use this to auto-create leads from website forms, phone call tools, and SMS automations.

## Endpoint
- `POST /api/leads/intake`

## Auth
- Header: `x-lead-intake-key: <LEAD_INGEST_API_KEY>`
- Or: `Authorization: Bearer <LEAD_INGEST_API_KEY>`
- Or (for static forms): query param `?key=<LEAD_INGEST_API_KEY>`

## CORS / Website Forms
- Set `LEAD_INGEST_ALLOWED_ORIGINS` to your website origins:
  - Example: `https://yourwebsite.com,https://www.yourwebsite.com`
- Endpoint supports:
  - `application/json`
  - `application/x-www-form-urlencoded`
  - `multipart/form-data`

## Required Config
- `LEAD_INGEST_API_KEY`
- `DEFAULT_ORG_ID` (optional if you pass `orgId` in payload)
- `LEAD_INGEST_ALLOWED_ORIGINS` (recommended)

## Payload (example JSON)
```json
{
  "externalRef": "webform-12345",
  "contactName": "Jane Doe",
  "phone": "555-222-1111",
  "email": "jane@example.com",
  "address": "100 Main St, Austin, TX",
  "serviceType": "Water Damage",
  "source": "website_form",
  "message": "Kitchen leak after storm"
}
```

## Simple HTML form example
```html
<form method="POST" action="https://your-app.com/api/leads/intake?key=YOUR_SECRET">
  <input name="contactName" placeholder="Name" required />
  <input name="phone" placeholder="Phone" required />
  <input name="email" type="email" placeholder="Email" />
  <input name="address" placeholder="Address" />
  <input name="serviceType" placeholder="Service" />
  <input type="hidden" name="source" value="website_form" />
  <textarea name="message" placeholder="Project details"></textarea>
  <button type="submit">Submit</button>
</form>
```

## Source values supported
- `website_form`, `website`, `web`, `form` -> `WEBSITE_FORM`
- `phone`, `call` -> `PHONE_CALL`
- `text`, `sms` -> `TEXT`
- `referral` -> `REFERRAL`
- anything else -> `OTHER`

## Dedupe behavior
- If `externalRef` already exists for the org, request returns existing lead.
- If same `phone` or `email` exists in last 12 hours in open stages, request dedupes.

## Response
```json
{
  "ok": true,
  "deduped": false,
  "leadId": "uuid"
}
```

## Curl test
```bash
curl -X POST http://localhost:3001/api/leads/intake \
  -H "Content-Type: application/json" \
  -H "x-lead-intake-key: set-a-long-random-secret" \
  -d '{
    "contactName":"Test Lead",
    "phone":"555-000-1234",
    "source":"phone_call",
    "serviceType":"Bathroom Remodel"
  }'
```
