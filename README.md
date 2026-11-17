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
