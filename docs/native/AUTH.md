# Sign-in: what ships now and what must improve

Status as of 2026-11-14. Owner: Jared (native), with Poorav (Supabase project and backend).

## What works today

- iPhone signs in with a Supabase email one-time code (6 digits), or by tapping the emailed link on the iPhone (`spectr://auth-callback`, PKCE-bound to the device that asked).
- Session is stored in Keychain (this device only, not iCloud-synced), refreshed automatically, and cleared on sign-out even when offline.
- Email goes through Resend SMTP from `onboarding@resend.dev`. Limit: 30 emails/hour.
- Dev shortcut: `apps/ios/Scripts/dev-signin-code.sh <email>` prints a code without sending email (uses the secret key from `~/.config/spectr/dev.env`; never shipped).

## Known gaps (must fix before anyone outside the team uses it)

| Gap | Why it matters | Fix |
| --- | --- | --- |
| Resend has no verified domain | Mail only reaches the Resend account owner; nobody else can sign in | Verify a domain in Resend (SPF/DKIM DNS records), send from `auth@<domain>` |
| No account verification beyond email possession | Anyone with an inbox can create an account | Decide policy: invite-only, allow-list, or open sign-up with abuse limits |
| No Sign in with Apple | Expected on iOS; App Store guideline 4.8 if other social logins are added | Paid Apple developer membership + Supabase Apple provider |
| Mac has no user identity | The Mac cannot prove which user it belongs to | Real pairing: one-time code approved on a signed-in iPhone, device credential in Mac Keychain, revocable |
| No server-side session controls | Cannot see or revoke a user's devices | Device list + revoke in backend and both apps |
| Site URL is `http://localhost:3000` | Any link Supabase builds without a redirect lands on a dead page | Set to the production web origin once one exists |
| Default Supabase rate limits and no CAPTCHA | Code requests can be abused to send mail | Enable CAPTCHA (hCaptcha/Turnstile) and tune per-IP limits |
| Sessions never re-verify | A stolen refresh token works until revoked | Shorter refresh lifetime, reuse detection, re-auth for sensitive actions (pairing, unpairing) |
| No account deletion | Required for App Store distribution | In-app delete account flow + backend data deletion |
| Session save failure only shows a note | User must sign in again next launch | Acceptable fallback; log a sanitized diagnostic |

## Tests that exist

`SupabaseAuthClientTests`, `AuthLinkTests` (shared package), `AuthModelTests`, `KeychainCredentialStoreTests` (iOS). Live round trip verified against the real project with throwaway accounts on 2026-11-14 (code, refresh, sign-out, link redirect). A real inbox delivery was confirmed by Jared signing in.
