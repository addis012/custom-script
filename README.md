# Meta CAPI Sheet Sync

Reads leads from the `temer crm` Google Sheet and sends them to Meta Conversions
API (dataset `1070481572400054`):

- Sends a **`Lead`** event the first time a row is seen.
- Sends a **`QualifiedLead`** event once `lead_status` becomes `Qualified`.
- Tracks progress in a `meta_sync_status` column it adds to the sheet, so
  re-running the script never double-sends the same event.

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
