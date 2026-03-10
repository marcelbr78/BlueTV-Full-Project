BlueTV Kotlin minimal skeleton

What you get:
- Android (Kotlin) skeleton project compatible with Android Studio.
- Admin screen to set a remote M3U URL and manage simple client list (stored in SharedPreferences).
- Main screen that loads and parses the M3U URL and shows items (name, group).
- Plans screen -> Form screen with required fields + Terms checkbox -> QR screen (placeholder for Bipa sandbox).
- QR generation uses a placeholder payload; you must replace it with an actual Bipa sandbox/live API flow.
- Network: uses OkHttp (sync call for simplicity). Replace with coroutine/async in production.

How to open:
1. Open Android Studio (Giraffe/Hedgehog or newer)
2. File > Open > choose the 'BlueTVApp' folder.
3. Let Gradle sync and download dependencies.
4. Run on a device/emulator (minSdk 24).

IMPORTANT:
- This project is intentionally minimal and demonstrative.
- Replace placeholder payloads and implement server-side verification for real payments.
- For production: implement secure backend, verify Bipa webhooks, do not trust client-side activation.

