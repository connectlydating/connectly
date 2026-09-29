# Connectly Pro

A professional adults-only dating MVP built with plain HTML/CSS/JS and Supabase.

## Included
- Email/password login and signup
- 18+ signup gate
- Discovery with search, gender and interest filters
- Like / Pass and mutual matches
- Real-time private chat
- Public profile pages inside the app
- Profile comments
- Profile photo + multi-photo gallery
- Lazy-loaded images and lightweight front end
- Block and report
- Last-seen status
- Terms, Privacy & Safety page
- Supabase Storage policies and RLS migration

## IMPORTANT: config.js
Keep your existing working `config.js`. It should contain only the browser-safe Project URL and publishable key:

```js
const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_...";
```

Never put a `sb_secret_...` or `service_role` key in a browser file.

## Supabase
1. Keep your original Connectly V2 SQL already installed.
2. Run `connectly-pro-migration.sql` ONCE in Supabase SQL Editor.
3. Keep Realtime enabled for `messages`; this migration also adds Realtime for profile comments.
4. In Auth URL Configuration, set Site URL and Redirect URL to your GitHub Pages URL, for example:
   `https://YOUR-GITHUB-USERNAME.github.io/connectly/`

## GitHub upload
Replace/add:
- index.html
- style.css
- app.js
- avatar-placeholder.svg
- policy.html
- connectly-pro-migration.sql
- README.md

Keep your existing `config.js`.

## Photo behavior
A new member gets a neutral placeholder. No real person's photo is automatically added. Members choose and upload their own profile photo and optional gallery photos.

## Before public launch
Add a moderation/admin dashboard, email verification policy, rate limiting, abuse detection, account deletion workflow, backups, support contact, stronger age safeguards, image moderation and a jurisdiction-specific privacy/terms review.
