# Email Register — Deployment Guide (A+A+A)

## Files
1. `email-register.js` → save to `netlify/functions/email-register.js`
2. `email-export.js`   → save to `netlify/functions/email-export.js`
3. `landing-modal-snippet.html` → paste before </body> in `public/index.html`

## Setup steps

### 1. Install Netlify Blobs
```
npm install @netlify/blobs
```

### 2. Enable Blobs in Netlify
- Netlify dashboard → Site settings → Integrations → "Netlify Blobs" → Enable
- Free tier: 100 GB storage + 1M reads/month

### 3. Set ADMIN_KEY env var (for CSV export)
- Netlify dashboard → Site settings → Environment variables → Add
- Key: `ADMIN_KEY`
- Value: (any long random string, e.g. `uuid` from https://www.uuidgenerator.net)

### 4. Deploy
```
git add .
git commit -m "Add email register flow (A+A+A)"
git push
```

### 5. Test
- Open landing page → click Starter "Unlock with email" button
- Enter your own email → should see "✓ Starter unlocked"
- Check Umami: Events tab should show `Email Modal Opened` + `Email Registered`
- Open app in same browser → quota pill should show "Starter · 3 left/day"

### 6. Export email list anytime
```
https://your-site.netlify.app/.netlify/functions/email-export?key=YOUR_ADMIN_KEY
```
Downloads CSV.

## Storage structure (Netlify Blobs)
- `email:user@example.com` → { email, plan, createdAt, lastSeenAt, seenCount, fingerprint, ua, ip, verified, source }
- `log:2026-05-04`         → [{ at, email, ip, fp }, ...]
- `ip:1.2.3.4:2026-05-04`  → "3" (rate limit counter, 5/day max)

## Abuse prevention
- Email regex validation
- Domain blocklist (9 disposable domains)
- IP rate limit: 5 registrations/day per IP
- Upsert behavior: same email won't double-count

## Phase 2 (later)
- Add Resend integration to send welcome email
- Magic link verification → set verified=true
- Weekly newsletter drip via Resend
- Export to Google Sheets via Apps Script webhook
