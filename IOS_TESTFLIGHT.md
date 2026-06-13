# Getting hüm onto TestFlight

The web app is now wrapped in a native iOS shell with **Capacitor**. The React code
is unchanged — iOS loads the same built assets inside a `WKWebView` and calls your
live backend over HTTPS. This guide covers everything from here to a TestFlight build.

- **App name:** hüm
- **Bundle identifier:** `rocks.hum.app` (permanent — must match App Store Connect)
- **iOS project:** `frontend/ios/App/App.xcodeproj`

---

## One-time prerequisites

### 1. Apple Developer Program ($99/year)
Enroll at <https://developer.apple.com/programs/enroll/>. Approval is usually a few
hours but can take ~a day. **Nothing reaches TestFlight without this.**

### 2. Full Xcode (not just Command Line Tools)
Install **Xcode** from the Mac App Store (~10 GB). Then point the toolchain at it:
```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

### 3. CocoaPods — already installed (v1.16.2) ✅

---

## Before every iOS build: set your backend URL

The iOS app runs from `capacitor://localhost`, so it **cannot** reach
`http://localhost:3001`. It must call your live Render backend over HTTPS.

Edit **`frontend/.env.ios`** and replace the placeholder with your real Render URL
(the same value as `VITE_API_URL` in your Vercel project settings):
```
VITE_API_URL=https://your-real-backend.onrender.com
```
This file is used **only** by the iOS build (`--mode ios`); it never touches the
Vercel web build.

---

## Build + open in Xcode

From `frontend/`:
```bash
npm run ios:open
```
This builds the web assets (iOS mode), syncs them into the native project, and opens
Xcode. (Under the hood: `build:ios` → `cap sync ios` → `cap open ios`.)

If you only want to rebuild/sync without opening Xcode: `npm run ios:sync`.

---

## In Xcode: signing

1. Select the **App** target → **Signing & Capabilities**.
2. **Team:** pick your Apple Developer team (sign in with your Apple ID under
   Xcode → Settings → Accounts if it's not listed).
3. Leave **Automatically manage signing** checked — Xcode creates the certificate
   and provisioning profile for you.
4. Confirm **Bundle Identifier** is `rocks.hum.app`.

---

## Create the app record in App Store Connect

1. Go to <https://appstoreconnect.apple.com> → **Apps** → **+** → **New App**.
2. Platform **iOS**, name **hüm**, primary language, and **Bundle ID** `rocks.hum.app`
   (it appears in the dropdown after signing once in Xcode).
3. SKU: any unique string, e.g. `hum-ios-001`.

---

## Archive and upload

1. In Xcode, set the run destination to **Any iOS Device (arm64)** (not a simulator —
   simulators can't be archived for upload).
2. **Product → Archive.** Wait for the build.
3. In the Organizer window that opens: **Distribute App → TestFlight (Internal Testing
   Only)** (or App Store Connect) → **Upload**.
4. After upload, the build appears in App Store Connect → your app → **TestFlight** in
   a few minutes (status “Processing”, then ready).

---

## TestFlight testers

- **Internal testers** (up to 100, must be in your App Store Connect team): available
  almost immediately, no Apple review. Easiest for you + close testers.
- **External testers** (up to 10,000, via email or a public link): require a quick
  **Beta App Review** (usually < a day). Needed for wider testing.

Add testers under **TestFlight → Internal/External Testing**. They install the
**TestFlight** app from the App Store and accept your invite.

---

## ⚠️ The thing to test first: the microphone

The humming feature uses `getUserMedia` + `MediaRecorder` inside the WKWebView. The
mic permission string is already set (`NSMicrophoneUsageDescription` in
`Info.plist`). On first hum, iOS shows the mic permission prompt — **allow it**.

Test this on a **real device** as early as possible (the Simulator has no real mic).
The app already prefers `audio/mp4` / `audio/aac` (the formats iOS supports), so it
should work on iOS 14.3+. If recording fails, that's the first place to look.

---

## When you change the web app later

Any time you edit the React code, re-run `npm run ios:sync` (or `ios:open`) to copy
the new build into the native project, then archive again. The native shell itself
rarely changes.

---

## App Store note (later, not for TestFlight)

TestFlight beta review is lenient. The **public App Store** review is stricter about
"just a website in a webview" (Guideline 4.2) — hüm's microphone/song-ID feature is a
genuine native hook that helps, but plan for possible back-and-forth when you submit
for public release. That's a separate step from TestFlight.
