require('dotenv').config();
const { google } = require('googleapis');
const crypto = require('crypto');

const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  GOOGLE_SPREADSHEET_ID,
  GOOGLE_SHEET_NAME,
  META_DATASET_ID,
  META_ACCESS_TOKEN,
  META_TEST_EVENT_CODE,
  LEAD_EVENT_SOURCE
} = process.env;

const SYNC_COLUMN_HEADER = 'meta_sync_status';
// "id" is the Facebook lead_id column (e.g. "l:1762216354822730").
const REQUIRED_HEADERS = ['id', 'email', 'full_name', 'phone_number', 'lead_status'];
const CRM_NAME = LEAD_EVENT_SOURCE || 'Temer CRM';

// --- helpers -----------------------------------------------------------

function sha256(value) {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function cleanPhone(raw) {
  if (!raw) return '';
  return raw.replace(/^p:/i, '').replace(/\D/g, '');
}

function cleanLeadId(raw) {
  if (!raw) return '';
  // strips a prefix like "l:" that this sheet's export format adds,
  // leaving Facebook's raw leadgen_id.
  return raw.replace(/^[a-z]+:/i, '').trim();
}

function parseSentStages(raw) {
  const value = (raw || '').trim();
  if (!value) return new Set();
  return new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
}

function colIndexToLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

async function getSheetsClient() {
  const auth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// Sends a lead-stage event using Meta's CRM Lead Qualification format.
// See: Conversion Leads Integration (Conversions API) — requires lead_id,
// event_source: "crm", and lead_event_source.
async function sendLeadStageEvent(stageName, lead) {
  const userData = {};

  const leadId = cleanLeadId(lead.id);
  if (leadId) userData.lead_id = leadId;
  if (lead.email) userData.em = [sha256(lead.email)];

  const phone = cleanPhone(lead.phone_number);
  if (phone) userData.ph = [sha256(phone)];

  if (lead.full_name) {
    const parts = lead.full_name.trim().split(/\s+/);
    userData.fn = [sha256(parts[0])];
    if (parts.length > 1) userData.ln = [sha256(parts.slice(1).join(' '))];
  }

  const payload = {
    data: [
      {
        event_name: stageName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'system_generated',
        user_data: userData,
        custom_data: {
          event_source: 'crm',
          lead_event_source: CRM_NAME
        }
      }
    ],
    access_token: META_ACCESS_TOKEN
  };

  if (META_TEST_EVENT_CODE) {
    payload.test_event_code = META_TEST_EVENT_CODE;
  }

  const response = await fetch(
    `https://graph.facebook.com/v19.0/${META_DATASET_ID}/events`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Meta CAPI error: ${JSON.stringify(result)}`);
  }

  console.log(`  → Meta response for "${stageName}":`, JSON.stringify(result));
  if (typeof result.events_received === 'number' && result.events_received === 0) {
    console.warn(`  ⚠ Meta accepted the request but events_received was 0 for "${stageName}".`);
  }

  return result;
}

// --- main ----------------------------------------------------------------

async function run() {
  const missingEnv = [
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_SPREADSHEET_ID',
    'GOOGLE_SHEET_NAME',
    'META_DATASET_ID',
    'META_ACCESS_TOKEN'
  ].filter((key) => !process.env[key]);

  if (missingEnv.length) {
    throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  }

  const sheets = await getSheetsClient();

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SPREADSHEET_ID,
    range: GOOGLE_SHEET_NAME
  });

  const rows = data.values || [];
  if (rows.length === 0) {
    console.log('Sheet is empty.');
    return;
  }

  const headers = rows[0].map((h) => (h || '').trim().toLowerCase());
  const colIndex = {};
  headers.forEach((h, i) => { colIndex[h] = i; });

  const missingHeaders = REQUIRED_HEADERS.filter((h) => !(h in colIndex));
  if (missingHeaders.length) {
    throw new Error(`Sheet is missing required columns: ${missingHeaders.join(', ')}`);
  }

  // Create the tracking column if it doesn't exist yet.
  let syncColIndex = colIndex[SYNC_COLUMN_HEADER];
  if (syncColIndex === undefined) {
    syncColIndex = headers.length;
    const letter = colIndexToLetter(syncColIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SPREADSHEET_ID,
      range: `${GOOGLE_SHEET_NAME}!${letter}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[SYNC_COLUMN_HEADER]] }
    });
    console.log(`Added tracking column '${SYNC_COLUMN_HEADER}' at column ${letter}`);
  }

  let stagesSent = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const id = row[colIndex.id];
    const email = row[colIndex.email];
    const fullName = row[colIndex.full_name];
    const phoneNumber = row[colIndex.phone_number];
    const leadStatus = (row[colIndex.lead_status] || '').trim();
    const sentStages = parseSentStages(row[syncColIndex]);

    if (!id && !email && !phoneNumber) continue; // nothing to identify this lead by
    if (!leadStatus) continue; // no stage to report yet
    if (sentStages.has(leadStatus)) continue; // this exact stage was already sent

    const lead = { id, email, full_name: fullName, phone_number: phoneNumber };
    const rowNumber = i + 1;
    const syncCellRange = `${GOOGLE_SHEET_NAME}!${colIndexToLetter(syncColIndex)}${rowNumber}`;

    try {
      await sendLeadStageEvent(leadStatus, lead);
      sentStages.add(leadStatus);
      stagesSent++;
      console.log(`Row ${rowNumber}: sent "${leadStatus}" stage event`);

      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SPREADSHEET_ID,
        range: syncCellRange,
        valueInputOption: 'RAW',
        requestBody: { values: [[Array.from(sentStages).join(',')]] }
      });
    } catch (err) {
      console.error(`Row ${rowNumber}: failed —`, err.message);
    }
  }

  console.log(`Done. Stage events sent: ${stagesSent}.`);
}

run().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
