# Netlify Functions Version

## Project structure

```text
netlify-meeting-notes/
├─ public/
│  └─ index.html
├─ netlify/
│  └─ functions/
│     └─ generate.js
├─ netlify.toml
└─ package.json
```

## Deploy to Netlify

1. Zip the whole project folder or connect it to a Git repo.
2. In Netlify, create a new site from the project.
3. Netlify should read `netlify.toml` automatically.
4. Go to **Site configuration > Environment variables**.
5. Add:
   - `POE_API_KEY` = your Poe API key
   - `POE_MODEL` = a model your Poe account can access, for example `GPT-3.5-Turbo`
6. Redeploy the site.

## Important

- Do not put the Poe API key in the HTML.
- The frontend calls `/.netlify/functions/generate`.
- If Poe returns 402 or subscription errors, switch `POE_MODEL` to another accessible model or upgrade your Poe plan.