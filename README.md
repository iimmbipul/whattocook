# 🍽️ Meal Planner Web Application

A production-ready Next.js application for managing daily meal plans with Firebase Firestore backend, simple authentication, and a clean mobile-first UI.

## 🚀 Features

- **Authentication**: Google sign-in (verified on the server) for owners and members, phone + PIN for cooks; signed session cookies (see [docs/SECURITY.md](docs/SECURITY.md))
- **Role-Based Access Control**: 
  - **User (House Member)**: Can view and edit today & future meals
  - **Cook (Viewer)**: View-only access to all meals
- **Dashboard**: 
  - View today's and tomorrow's meals side-by-side
  - See meal details (name, image, calories, prep time, ingredients)
  - Call button for quick phone contact with house owner
- **Meal Management**: 
  - Edit upcoming meals with intuitive modal interface
  - Update ingredients, calories, prep time, and more
  - Automatic role/date permission checks
- **Admin Panel**: Easy user creation interface at `/admin`
- **Responsive Design**: Mobile-first UI with Tailwind CSS

## 📋 Prerequisites

- Node.js 18+ and npm
- Firebase project with Firestore database enabled
- Existing `meals` collection with data

## 🔧 Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Firebase

Edit `.env.local` with your Firebase project credentials:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
NEXT_PUBLIC_HOUSE_OWNER_PHONE=+1234567890

# Server-only
SESSION_SECRET=at_least_32_random_characters   # signs session cookies (required in production)
ADMIN_EMAILS=you@example.com                     # Google accounts allowed to use the shared-template/admin tools
CREDENTIAL_PEPPER=optional_random_value          # optional; set once, never change
```

### 3. Set Up Firestore

**Collection: `meals`**
- Document ID: Date in `YYYY-MM-DD` format
- Fields: breakfast, lunch, dinner, etc. (as per schema)

**Collection: `users`**
- Create via `/admin` route or manually:
  ```typescript
  {
    email: string
    passwordHash?: string  // scrypt hash; set by the app, never stored in plaintext
    role: "user" | "cook"
    phoneNumber: string
    createdAt: timestamp
  }
  ```

### 4. Create First User

Two options:

**Option A: Direct in Firestore Console**
1. Go to Firestore in Firebase Console
2. Create `users` collection
3. Add document with fields above

**Option B: Use Admin Page (Recommended)**
1. Start dev server: `npm run dev`
2. Visit: `http://localhost:3000/admin`
3. Fill the form to create users

### 5. Run Application

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

## 🔐 Authentication System

**How It Works:**
1. Owners and members sign in with Google; the server verifies the Firebase ID token
2. Cooks sign in with phone number + PIN (stored as a salted scrypt hash)
3. The session is an HMAC-signed, httpOnly cookie; server actions take the household from it
4. iOS PWAs keep a copy of the signed token in localStorage to restore the cookie

**Security:** see [docs/SECURITY.md](docs/SECURITY.md) — including the remaining step of moving the server to `firebase-admin` and deploying `firestore.rules`.

### Google sign-in on every browser

Google sign-in hands its result back through Firebase's sign-in helper (`/__/auth/handler`). By default the helper lives on `<project>.firebaseapp.com`, a different site from the app. Browsers that block third-party storage can lose the result there: the Google window closes and the page goes back to the sign-in button. These include Safari and iPhone home-screen apps, Brave, Firefox in strict mode, and Chrome with third-party cookies off.

`next.config.ts` proxies `/__/auth/*` and `/__/firebase/*` to `<project>.firebaseapp.com`, so the helper can run on the app's own domain. To turn it on:

1. In Google Cloud Console, go to **APIs & Services → Credentials** and open the OAuth client **Web client (auto created by Google Service)**. Under **Authorized redirect URIs**, add `https://<your-domain>/__/auth/handler`, for example `https://whattocook-amber.vercel.app/__/auth/handler`. Keep the existing firebaseapp.com entry.
2. In Firebase Console, go to **Authentication → Settings → Authorized domains** and check that `<your-domain>` is listed.
3. Set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<your-domain>` (no `https://`) in Vercel Production, then redeploy.

After that, sign-in stays on the app's own site:
- Phones and home-screen web apps sign in on Google's page in the same tab instead of a popup. On phones a popup opens as a separate tab, and the page waiting for it can be unloaded. Computers keep the popup.
- If the browser blocks the popup, the app switches to same-tab sign-in on its own.

Until step 3 is done, the popup works as before. The same goes for any other host that isn't the auth domain, such as preview deployments.

The login page also says what went wrong instead of resetting silently:
- **The Google window closed before sign-in finished.** When the helper is on the app's domain, the page offers **Continue with Google in this tab**.
- **Blocked pop-ups, network problems, and a domain missing from Firebase's authorized list** each get their own message.
- **Apps whose built-in browser Google refuses** show a notice to open the page in Chrome or Safari, with **Copy link** (and **Open in Chrome** on Android). These include Instagram, Facebook, LinkedIn, Snapchat and Android WebViews.

For local testing, `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` (together with `FIREBASE_AUTH_EMULATOR_HOST`) signs in against the Firebase Auth emulator. Never set it in production.

## 📁 Project Structure

```
meal-planner/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout
│   │   ├── page.tsx            # Dashboard
│   │   ├── login/page.tsx      # Login page
│   │   ├── admin/page.tsx      # User management
│   │   └── globals.css
│   ├── components/
│   │   ├── AuthProvider.tsx    # Auth context
│   │   ├── DashboardContent.tsx
│   │   ├── Header.tsx
│   │   ├── MealCard.tsx
│   │   └── EditMealModal.tsx
│   ├── lib/
│   │   ├── firebase.ts         # Firestore init
│   │   ├── firestore.ts        # Meal queries
│   │   ├── auth.ts             # Auth logic
│   │   └── permissions.ts
│   └── types/
│       └── meal.ts
└── .env.local
```

## 🎯 Usage

### Login
1. Visit `http://localhost:3000`
2. Enter email and password
3. Redirects to dashboard

### Create Users
1. Click "⚙️ Admin" in header
2. Fill out user creation form
3. Assign role (User or Cook)
4. Set phone number (optional)

### Manage Meals
1. Dashboard shows today and tomorrow
2. Click "Edit" on any meal (if permitted)
3. Update details in modal
4. Changes saved to Firestore

### Call Feature
- Click "📞 Call" button on any meal card
- Uses phone number from user's Firestore document

## 🛒 Milkbasket auto-order

When a pantry item drops to **Quarter** (low) or **Empty**, the app can add it to your Milkbasket basket. The app's server calls Milkbasket's GraphQL API (`consumerbff.milkbasket.com`) directly, so it works on Vercel.

### Setup

1. Add these environment variables. On Vercel, go to **Settings → Environment Variables**; for local runs, use `.env.local`. Never prefix them with `NEXT_PUBLIC_`.

   ```env
   MILKBASKET_CITY_ID=1              # the cityid header on milkbasket.com requests
   MILKBASKET_HUB_ID=1               # the hubid header
   MILKBASKET_SEARCH_CITY_ID=3       # optional; the cityId variable in milkbasket.com's getSearchProducts request (it can differ from the header); defaults to MILKBASKET_CITY_ID
   MB_HOUSEHOLD_IDS=owner_uid        # households allowed to use this account, comma-separated; Admin → Milkbasket shows yours
   AUTO_ADD_PRICE_LIMIT=150          # optional; items priced below this (₹ per unit) are added without asking
   MILKBASKET_APP_VERSION=9.0.10.0   # optional; change it if Milkbasket starts asking for a newer app version
   ```

   `SESSION_SECRET` must also be set, as it already is for sign-in: the Milkbasket login is encrypted with a key derived from it.
2. Redeploy so the new variables take effect.
3. Give the app its own Milkbasket login:
   - Sign in on milkbasket.com in a **private window**.
   - Press F12, open **Network** and reload. Find the `refreshAuthToken` request (or the sign-in response), and copy its `refreshToken`. Optionally also copy the `authorization` value, without "Bearer".
   - **Close the window without logging out.** The app owns that login from now on: Milkbasket replaces the refresh token each time it is used, so using the same login in a browser would cancel the app's copy.
   - Paste the tokens in **Admin → Milkbasket → Settings → Milkbasket login**.
4. Press **Test connection**. It reads your recent orders and changes nothing. Then turn **Auto-order** on; it starts off.

**The login renews itself.** Milkbasket's login token lasts about a day (`authExpiry` 1440 minutes). The server renews it with the refresh token shortly before it runs out, or when Milkbasket refuses it, and then retries the request.
- Both tokens are kept in Firestore at `milkbasket_auth/account`, encrypted with AES-256-GCM. They are never logged or shown, and security rules keep the browser out.
- Only one renewal runs at a time, because each one replaces the refresh token.
- If renewal fails, for example after logging out of that session, Admin shows a banner and adds pause until you paste a new refresh token.
- If `SESSION_SECRET` changes, the stored login can't be read any more, so paste it again.
- `MILKBASKET_TOKEN` and `MILKBASKET_REFRESH_TOKEN` can still seed the login from the environment. A changed seed replaces the stored login.

### On the Groceries page (owner and members)

Everyone in the household except the cook sees Milkbasket on **Groceries**:

- **Waiting for an OK**: items at or above the price limit, or with no known price. Anyone can change the quantity and Approve or Reject; Admin is not needed.
- **Cart button** on each item in the shopping list: adds it to the Milkbasket basket now, with a quantity you choose, and marks it bought. Items already in the basket or being added show that instead.
  - The dialog shows the linked product with its picture.
  - **Change product** opens a picker. **Search Milkbasket**, the default, shows today's price, MRP and stock, and you can't pick products that are out of stock. **My orders** lists products from your recent orders.
  - If the item isn't linked yet, the picker opens straight away and searches for the item's name.
  - A picked product becomes the item's link from then on. **Save link** changes the link without adding anything.
  - If Milkbasket refuses the add (for example out of stock), the dialog stays open so you can pick another product.
- **Milkbasket tab**: what is in the Milkbasket basket for the next delivery, with pictures and the bill. It is read with `getExtendedBasket` and cached for 3 minutes; **Refresh** reads it again. Change quantities or remove items in the Milkbasket app.

Product pictures come from Milkbasket's own CDN (`static-milkbasket.cdn.jio.com`). Only https addresses on Milkbasket's hosts are kept. They appear in search results, recent orders, the basket, approvals, mappings and activity.

### Mapping items

- **To map** lists pantry items with no Milkbasket product. Items that just ran low are at the top.
- **Map** opens a form: product ID, name (as on Milkbasket), pack size, last known price and default quantity. **Show products from my orders** lists products from your recent orders, with name, size, price and product ID. Picking one fills the form. The list is cached for an hour; **Refresh** fetches it again.
- After an item is mapped, its waiting request moves on: below the limit it is added, otherwise it waits in **Approvals**.
- **Mappings** lists, edits and removes mappings, and turns auto-order on or off per item.

### When an item runs low

| Situation | Result |
| --- | --- |
| Auto-order off, or off for that item | Nothing |
| The item has an open request, or was added in the last 24 hours (a setting) | Nothing |
| Not mapped | `needs_mapping`: it shows in **To map** |
| Price below the limit | Added in the background for tomorrow (a setting); the item is marked **Bought** |
| Price at or above the limit (150 itself included), or unknown | `pending_approval`: **Approve** (the quantity can be changed) or **Reject** |
| The item goes back to Full or Half first | Its approval or mapping request is cancelled |

Failed adds show in **Activity** with Milkbasket's message and a **Retry** button.
- Network errors and HTTP 5xx are retried up to 3 times. A timeout is not retried, because the item may already be in the basket.
- Out of stock, past cutoff and price changes need you. Update the price in **Mappings**, then press **Retry**. If the new price is at or above the limit, the retry goes to approval.
- Nothing is marked bought unless the add succeeded.

Requests are never deleted: each is kept in `households/{hid}/purchase_requests` with its history. `npm test` covers the decisions, the requests sent and Milkbasket's answers with Milkbasket mocked; no test calls the real API. To try the whole flow locally without touching your account, point `MILKBASKET_API_URL` at a mock GraphQL server.

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: Firebase Firestore
- **Auth**: Google (Firebase Auth ID tokens verified server-side) + cook PINs, signed session cookies

## 🚨 Important Notes

- Passwords and PINs are stored as hashes; see [docs/SECURITY.md](docs/SECURITY.md)
- Firestore schema used exactly as provided
- Sessions are signed cookies (with a signed localStorage copy for iOS PWAs)

## 📝 License

MIT

---

**Built with ❤️ using Next.js and Firestore**
