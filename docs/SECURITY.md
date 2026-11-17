# Authentication & data-access hardening

This branch (`security/auth-hardening`) closes the ways a browser could act as
someone else or reach another household's data **through the app**. One gap is
left open on purpose because it needs a decision from you: the Firestore
database itself is still readable and writable by anyone (see
[Step 2](#step-2--lock-down-the-database-needs-your-decision)).

## What was wrong

| Problem | Effect |
| --- | --- |
| The session cookie `session_user` was plain JSON (`uid`, `role`, `householdId`) and trusted as-is | Edit the cookie → become any user in any household |
| `restoreCookieFromClient(user)` set that cookie from whatever the browser sent | Same, without even editing a cookie |
| `loginWithGoogleEmail(email)` logged in whoever's email the browser sent; Google sign-in was never checked on the server | Log in as any registered user by knowing their email |
| Server actions took `householdId` / `userId` from the browser | Read or change any household's meals, attendance, guests, duties, notifications, diet plan |
| Every export of a `'use server'` file is a public endpoint — including internal helpers such as `getCalendarConnection(uid)` (returns Google refresh tokens), `createNotification`, `resetHouseholdResponsibilities`, `generate30DayPlan` | Call internals directly with any IDs |
| Any household owner could create users in any household, rewrite the shared menu templates, and read/write the whole `users` collection from the admin JSON editor (directly from the browser) | Cross-household takeover by anyone who signs up |
| Passwords and cook PINs stored in plaintext; cook login unthrottled | Leaked database = leaked PINs; 4-digit PINs brute-forceable online |

## What changed

- **Signed sessions.** The new cookie `wtc_session` is an HMAC-SHA256-signed
  token (`src/lib/server/token.ts`, `session.ts`) keyed from the server-only
  `SESSION_SECRET`. Anything edited or forged is treated as logged out. Tokens
  are re-checked against Firestore every 15 minutes (a removed member loses
  access), renew for 30 days of inactivity, and expire 180 days after sign-in.
  The old `session_user` cookie is ignored and deleted.
- **iOS PWA fallback.** Login/refresh return the signed token as
  `user.sessionToken`; the app keeps it in localStorage and calls
  `restoreSession(token)` when cookies are gone. Only tokens the server signed
  are accepted, and the account is re-checked first.
  `restoreCookieFromClient(user)` still exists but only uses `user.sessionToken`.
- **Google sign-in verified on the server.** `loginWithGoogle(idToken)`
  (replaces `loginWithGoogleEmail`) verifies the Firebase ID token's signature
  against Google's keys (no extra dependency) and requires a verified email
  from the `google.com` provider. New users get a 30-minute signed
  "pending sign-up" cookie; `createNewHousehold` / `joinHousehold` take the
  email, name and photo from it, not from the browser.
- **Every server action authorizes from the session**
  (`src/lib/server/guards.ts`). A `householdId` / `userId` argument that
  doesn't match the session is rejected and logged as `[authz] … rejected`;
  signatures are unchanged (the arguments became optional). Within a household:
  cooks are read-only; Skip/Eat and guests are for yourself only; assignees
  must belong to the household; `updateMeal` only accepts meal fields (not
  attendance, responsibility or calendar data) and refuses past dates;
  owner-only: diet change, duty reset, adding/removing people, bulk duties.
  Notification actors are always the signed-in user.
- **Internals are no longer endpoints.** Calendar token storage, responsibility
  redistribution, calendar sync and the Google Calendar client moved to
  server-only modules (`src/lib/server/*`, `import 'server-only'`).
- **App admins.** Shared-template tools, the raw JSON editor, creating owner
  accounts and the credential migration now require a Google-verified account
  listed in `ADMIN_EMAILS`. The JSON editor runs through server actions; it
  never shows `password*`, `pin*`, `googleCalendar` or lockout fields and keeps
  them unchanged on save.
- **Hashed credentials.** Passwords and cook PINs are stored as scrypt hashes
  (`passwordHash`, `pinHash`; optional `CREDENTIAL_PEPPER`). Old plaintext
  values still work once and are replaced on that login; an admin button
  migrates the rest. Five wrong attempts lock an account for 15 minutes.
- **Paid endpoints need a session**: the Groq-backed AI actions and
  `/api/translate`.

## Step 1 — deploy this branch

1. **Vercel environment variables** (Production *and* Preview):
   - `SESSION_SECRET` — required. A random value of at least 32 characters,
     e.g. `openssl rand -base64 48`. Rotating it signs everyone out.
   - `ADMIN_EMAILS` — comma-separated Google emails allowed to use the shared
     template tools, JSON editor and credential migration. Without it those
     tools are unavailable (household tools keep working for owners).
   - `CREDENTIAL_PEPPER` — optional, recommended. Random, set once, never change
     or lose it (peppered hashes can't be checked without it).
   - `GOOGLE_ID_TOKEN_AUDIENCES` — only for the mobile app, see below.
2. **Mobile app (React Native WebView).** The web page no longer trusts the
   email the native side posts. The `nativeGoogleSignIn` event must include
   `idToken`: either a Firebase ID token (`auth().currentUser.getIdToken()`
   with `@react-native-firebase/auth`), or the Google ID token from native
   Google Sign-In — then put that token's audience (the web client ID used by
   the app) in `GOOGLE_ID_TOKEN_AUDIENCES`. Until the app is updated, Google
   sign-in inside the app shows "Please update the app". Cook phone + PIN login
   is unaffected.
3. Deploy. Everyone signs in once more (old cookies are no longer accepted).
4. As an app admin: **Admin → Hash stored passwords & PINs** (shows a count and
   asks before writing).
5. **Do not deploy `firestore.rules` yet** — see Step 2.

## Step 2 — lock down the database (needs your decision)

The server talks to Firestore with the Firebase *client* SDK and no user, so
the security rules must allow unauthenticated access. The web config is public,
so anyone can still read and write every collection directly — including house
PINs, PIN hashes and Google Calendar refresh tokens — bypassing everything above.
Closing that needs server credentials:

1. Add `firebase-admin` and initialise it from a credential:
   - **A. Service-account key** (simplest): create a key for a service account
     with *Cloud Datastore User* (and *Service Account Token Creator* on itself
     for custom tokens), store the JSON base64-encoded as a Vercel env var.
     Long-lived secret — keep it out of logs, rotate it.
   - **B. Workload Identity Federation** with Vercel OIDC (the project already
     has `VERCEL_OIDC_TOKEN`): no stored key, more one-time GCP setup.
2. Port the server's Firestore calls (`auth.ts`, `firestore.ts`,
   `notifications.ts`, `calendarSync.ts`, `adminData.ts`, `src/lib/server/*`,
   and the perf branch's `pageData.ts`) to the admin SDK
   (`db.collection().doc().get()`, `FieldValue.serverTimestamp()` /
   `delete()` / `arrayUnion()`, `count().get()`, …). The admin SDK ignores rules.
3. Notification bell: a `getNotificationsToken()` action returns
   `createCustomToken('wtc:' + uid, { hid: householdId })`; `useNotifications`
   calls `signInWithCustomToken` before `onSnapshot`, and logout signs out.
4. Deploy `firestore.rules` (in this repo): only a live read of your own
   household's notifications, with the `hid` claim; everything else denied.
   Firebase console → Firestore → Rules, or
   `firebase deploy --only firestore:rules`.
5. Optional: Firebase App Check; encrypt calendar refresh tokens at rest.

Best done after the performance branch is merged, since it touches the same
functions.

## Known limits

- `housePin` stays readable by the owner (it is shared to invite members); it is
  only protected once Step 2 is done.
- The lockout can be triggered on purpose to keep a cook out for 15 minutes.
- An owner can pre-register a member by email; whoever signs in with Google as
  that email joins that household (existing design).
- `loginWithEmail` has no UI; it still works for accounts with a password, but
  such sessions never get app-admin rights.
- A cook's PIN can't be edited any more (it's a hash): remove and re-add the
  cook to change it.

## How this was tested

All against local Firebase emulators (project `demo-whattocook`) — no
production data was read or written.

- 16 unit checks: token tamper/forgery, scrypt + legacy + pepper, ID-token
  signature/audience/issuer/expiry/emulator handling.
- 28 end-to-end checks calling the real server actions over HTTP: forged,
  edited and legacy cookies; cross-household reads and writes (household B
  verified unchanged); self-only attendance/guests; assignee checks; role
  limits; admin gating (including password sessions); login, onboarding, join;
  PIN migration, numeric PINs, lockout; refresh/restore/stale/removed sessions;
  credential migration; AI and translate auth.
- In the browser: dashboard, Skip/Eat, guests, meal edit, notification bell
  (read receipts), profile (diet change, duty reset, add cook), cook phone+PIN
  login, logout, iOS-style restore from the stored token, tampered token,
  admin page (editor round-trip keeps secrets; migration button), My Plates,
  non-admin owner view.
- `firestore.rules`: 14 allow/deny probes in the emulator.
- `npx next build --webpack` passes; `eslint` reports 82 problems (49 errors,
  33 warnings), down from 100 (57/43) on `master`; none in new code, no file
  got worse.
