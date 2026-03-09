# Bible Show

## Development

Run the app locally with:

```powershell
npm install
npm run dev
```

## Reliable Fullscreen Projector on Windows

Browsers do not reliably allow a normal web page to force fullscreen on load. For a true fullscreen projector window on the second display, use the kiosk launcher:

```powershell
npm run projector:kiosk
```

This opens Chrome or Edge in kiosk mode on the second monitor when available, pointed at:

```text
http://localhost:5173/projector
```

Once that projector window is open, the control panel will detect it and send verses there without opening another popup.
