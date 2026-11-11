# Capstone Viewer

Capstone Viewer is a local OSINT dashboard for tracking cybersecurity and world events. It brings public feeds into a live map and searchable timeline, with watchlists, a stream wall, and a fullscreen kiosk view. The Windows desktop app can keep collecting in the system tray. Reports and settings are stored locally.

## Run from source

Install Node.js 24 or later, then run these commands from the repository:

```powershell
npm ci
npm start
```

Open [Operations](http://127.0.0.1:8080/ops). On Windows, run `npm run desktop` to open the Electron app. Run `npm test` to check the project.

See [Third-party components](THIRD_PARTY.md) for bundled libraries and data sources.
