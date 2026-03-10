# Bible Show

## Development

Run the app locally with:

```powershell
npm install
npm run dev
```

## Cloud Backend

This project uses Supabase Authentication and Supabase for per-user data sync.

Per signed-in user, the app stores:

- Bible translations
- Songs
- Media
- Presentation library
- Presentation queue
- Themes
- Settings

### Supabase Setup

1. Install dependencies:

```powershell
npm install
```

2. In the Supabase SQL editor, run [supabase-schema.sql](supabase-schema.sql).

3. Optionally move the project URL and publishable key into local env vars using [.env.example](.env.example).

### Supabase Layout

- `public.user_workspace_documents`
- `public.user_translations`
- `public.user_translation_chunks`

Workspace documents store JSON payloads for:

- `settings`
- `songs`
- `media`
- `themes`
- `presentations`
- `presentation-library`

### Live Sync

The control panel currently polls Supabase for workspace changes and translations so updates made on one signed-in device appear on another without a manual refresh.

### Security

The included [supabase-schema.sql](supabase-schema.sql) enables row-level security and scopes all rows to the currently authenticated Supabase user via `auth.uid()`.

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
