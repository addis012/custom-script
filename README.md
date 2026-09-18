# Meta CAPI Sheet Sync

Reads leads from the `temer crm` Google Sheet and sends CRM stage updates to
Meta's **Conversion Leads** integration (dataset `1070481572400054`) — the
format Meta requires for optimizing native Facebook/Instagram Lead Ads
(Instant Forms) toward lead quality, not just form fills.

- Every time a lead's `lead_status` changes to a value that hasn't been sent
  yet (`CREATED`, `Contacted`, `Qualified`, `Converted`, `Lost`, `Schedule`,
  or any other stage text your CRM uses), an event is sent with
  `event_name` set to that exact stage text.
- Each event is matched to the original Facebook lead using the sheet's
  `id` column (Facebook's `lead_id`) — this is a precise match, unlike
  email/phone matching alone, and is what allows Meta to actually optimize
  Lead Ad delivery toward people likely to convert.
- Hashed email, phone, and name are also included alongside `lead_id` to
  further improve event match quality.
- Every event includes `event_source: "crm"` and `lead_event_source` (your
  CRM's name, configurable via `LEAD_EVENT_SOURCE`), as Meta's integration
  requires.
- Tracks progress in a `meta_sync_status` column (a comma-separated list of
  stage names already sent for that row), so re-running the script never
  double-sends the same stage — regardless of what order stages occur in.

## 1. Set up the Google Sheets connection

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or reuse)
   a project and enable the **Google Sheets API**.
2. Create a **Service Account**, then create a JSON key for it and download it.
3. Open your `temer crm` spreadsheet, click **Share**, and share it with the
   service account's email (found in the JSON key as `client_email`) — Viewer
   access is enough for reading, but give **Editor** access since the script
   also writes the `meta_sync_status` column.
4. From the spreadsheet URL, copy the spreadsheet ID:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
5. Note the exact name of the sheet/tab your leads are on (e.g. `Sheet1`).

## 2. Get a Meta Conversions API access token

In Events Manager → your dataset → **Settings** → **Conversions API** →
**Generate access token**. Keep this secret.

## 3. Configure environment variables

Copy `.env.example` to `.env` and fill in:

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=...      # client_email from the JSON key
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=... # private_key from the JSON key, keep the \n's
GOOGLE_SPREADSHEET_ID=...
GOOGLE_SHEET_NAME=Sheet1
META_DATASET_ID=1070481572400054
META_ACCESS_TOKEN=...
META_TEST_EVENT_CODE=                  # optional, only for testing
```

**Important:** the `.env` file (and the JSON key) should never be committed —
`.gitignore` already excludes `.env`.

## 4. Required sheet columns

The script looks these up **by header name** (case-insensitive), regardless of
which columns they're in:

- `id` — Facebook's lead_id (e.g. `l:1762216354822730` — the `l:` prefix is
  stripped automatically before sending)
- `email`
- `full_name`
- `phone_number`
- `lead_status`

It will add a `meta_sync_status` column automatically the first time it runs
if one doesn't already exist.

## 5. Install and run

```bash
npm install
npm run sync
```

Test first: temporarily set `META_TEST_EVENT_CODE` in `.env` to the code shown
in Events Manager's **Test events** tab, run the script, confirm the test
events show up there, then remove the test code before running for real.

## 6. Run it automatically (optional)

A ready-made GitHub Actions workflow is included as `sync-leads.yml`. To use
it:

1. Move it into `.github/workflows/sync-leads.yml` in this repo (GitHub
   requires workflows to live in that exact folder).
2. In the repo's **Settings → Secrets and variables → Actions**, add each
   value from your `.env` file as a repository secret, using the same names
   (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`,
   `GOOGLE_SPREADSHEET_ID`, `GOOGLE_SHEET_NAME`, `META_DATASET_ID`,
   `META_ACCESS_TOKEN`).
3. Commit and push — it will then run every 15 minutes automatically (adjust
   the `cron` schedule in the workflow file if you want a different
   frequency), and you can also trigger it manually from the **Actions** tab.

## Notes on your current data

- Phone numbers in the sheet have a `p:` prefix (e.g. `p:+2519...`) — the
  script strips that and any non-digit characters before hashing, as Meta
  requires digits only.
- `email`, `phone_number`, and name fields are SHA-256 hashed locally before
  being sent, as required by Meta's Conversions API.
