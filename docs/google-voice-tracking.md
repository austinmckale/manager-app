# Google Voice Call Tracking (Practical Setup)

Google Voice does not provide a straightforward public call-log webhook for this app.

Use one of these practical options:

## Option A (Recommended): Owner quick-call intake
- Add calls manually as leads in `/leads` (source = `PHONE_CALL`) during/after call.
- Fastest and most reliable if call volume is moderate.

## Option B: Gmail + Apps Script relay
If Google Voice call events appear in Gmail for your account, use Apps Script to forward parsed call info to:
- `POST /api/leads/intake`
- with `source=phone_call`

### Apps Script skeleton
```javascript
function syncVoiceCallsToFieldFlow() {
  const key = 'YOUR_LEAD_INGEST_API_KEY';
  const endpoint = 'https://your-app.com/api/leads/intake';
  const threads = GmailApp.search('label:voice newer_than:1d');

  threads.forEach((thread) => {
    const msg = thread.getMessages()[0];
    const subject = msg.getSubject();
    const body = msg.getPlainBody();

    const payload = {
      externalRef: 'gmail-' + msg.getId(),
      contactName: subject,
      message: body.slice(0, 1000),
      source: 'phone_call'
    };

    UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-lead-intake-key': key },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  });
}
```

## Option C: Use call-tracking provider
If you need robust call automation, use a provider with webhooks (CallRail/Twilio/Google Ads call extension logs) and post to `/api/leads/intake`.

## Mapping recommendation
- New incoming call -> lead stage `NEW`
- Callback attempted -> `CONTACTED`
- Site visit booked -> `SITE_VISIT_SET`
- Estimate sent (Joist) -> `ESTIMATE_SENT`
- Won/Lost based on Joist status/import
