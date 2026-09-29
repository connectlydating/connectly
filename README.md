# Connectly

Real backend-ready dating MVP using Supabase.

## Setup
1. Create a free project at Supabase.
2. Open SQL Editor and run `supabase.sql`.
3. Open Project Settings -> API.
4. Copy Project URL and anon public key into `config.js`.
5. Do NOT use the service_role/secret key in `config.js`.
6. Upload all files to a public GitHub repository and enable GitHub Pages.
7. Open the GitHub Pages URL.

## Supabase Auth
For testing, you can disable email confirmation in Authentication settings, or leave it enabled and verify the signup email.

## Real-time chat
Messages are stored in `messages`. Supabase Realtime listens for INSERT events, so both participants can see new messages without refreshing.

## Before a public launch
This is an MVP, not a finished dating service. Add:
- verified email/phone and stronger age controls
- image upload and moderation
- admin moderation dashboard
- abuse/spam rate limits
- robust report handling
- account deletion and data export
- privacy policy and terms
- secure content filtering
- production error handling and backups
- payment system if offering premium features
