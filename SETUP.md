# Household6 Setup Guide

## 1. Firebase Setup

### Create Firebase Project
1. Go to [console.firebase.google.com](https://console.firebase.google.com/)
2. Click "Add Project" → Name it "household6"
3. Click "Create Project"

### Enable Authentication
1. Go to **Build > Authentication** → Click "Get Started"
2. **Sign-in method** tab → Enable **Google**
3. Add your email as support email → Save

### Enable Firestore
1. Go to **Build > Firestore Database**
2. Click "Create database" → **Start in test mode**
3. Select a region → Enable

### Get Config Keys
1. Go to **Project Settings** (gear icon)
2. Scroll to "Your apps" → Click web icon (`</>`)
3. Name it "Household6 Web"
4. Copy the config and paste into `js/firebase-config.js`:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123"
};
```

---

## 2. Google Calendar API

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Select your Firebase project (same project)
3. **APIs & Services > Library** → Search "Google Calendar API" → Enable
4. **APIs & Services > OAuth consent screen**:
   - Choose External
   - App name: "Household6"
   - Add scopes: `calendar` and `calendar.events`
   - Save

---

## 3. OpenRouteService (Free Directions)

1. Go to [openrouteservice.org](https://openrouteservice.org/)
2. Sign up → Go to Dev Dashboard
3. Request a Token (Standard/Free)
4. Paste into `js/reminders.js`:

```javascript
ORS_API_KEY: 'your-key-here',
```

---

## 4. Generate Icons

1. Open `icons/icon-generator.html` in browser
2. Upload your icon image
3. Download all sizes
4. Place in `icons/` folder

---

## 5. Deploy (Firebase Hosting - Free HTTPS)

```bash
npm install -g firebase-tools
cd "/Users/jack/Desktop/Vibe Coding/other projects/household6"
firebase login
firebase init hosting
# Public directory: .
# Single-page app: Yes
firebase deploy
```

Your app will be at `https://your-project.web.app`

---

## 6. Install on iPhone

1. Open your deployed URL in Safari
2. Tap Share → "Add to Home Screen"
3. For voice shortcut: Also add `/pages/voice.html` to home screen
