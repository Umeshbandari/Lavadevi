# LAVADEVI - Multi-Database Finance Tracker

This app uses **Google Sheets as the primary database** with Google Apps Script backend for real-time data synchronization across all modules.

## Architecture Overview

- **Frontend**: React + Vite (local storage + auto-save)
- **Backend**: Google Apps Script (serverless)
- **Database**: Google Sheets (primary persistence)
- **Sync**: Automatic debounced save (700ms) + Manual save button

## Database Tables

The app syncs the following tables to Google Sheets:

| Table | Sheet Name | Purpose |
|-------|-----------|---------|
| Aadhar | `Aadhar` | Aadhar enrollment entries and payments |
| Expenses | `Expenses` | Monthly expense tracking |
| Given Not Given | `GivenNotGiven` | Ledger for given/not-given amounts |
| Aadhar Income | `AadharIncome` | Aadhar income and expense tracking |
| Cash | `Cash` | Daily cash in/out entries |
| Banking | `Banking` | Deposits, withdrawals, and commission details |
| App State | `AppState` | Full state backup with timestamps |

## Setup Instructions

### Step 1: Google Apps Script Setup

1. **Open your Google Sheet** that will store the database
2. Go to **Extensions → Apps Script**
3. Replace the content with [Code.gs](Code.gs) from this repository
4. Update the `SPREADSHEET_ID` constant with your Google Sheet ID:
   ```javascript
   const SPREADSHEET_ID = 'your-sheet-id-here';
   ```
5. Click **Deploy → New Deployment** → Type: **Web App**
   - Execute as: **Me** (your account)
   - Who has access: **Anyone**
6. Copy the deployment URL and save it

### Step 2: Configure Environment Variables

Create or update `.env` file:

```env
VITE_GOOGLE_SHEETS_API_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
VITE_GIVEN_NOT_GIVEN_SHEET_API_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
```

**Note**: Replace `YOUR_DEPLOYMENT_ID` with the ID from your Apps Script deployment URL.

### Step 3: Install Dependencies

```bash
npm install
```

### Step 4: Run Locally

```bash
npm run dev
```

### Step 5: Build for Production

```bash
npm run build
```

## How Data Syncing Works

### Automatic Sync
- Data changes trigger a **700ms debounced save**
- All table data (Aadhar, Expenses, Given Not Given, etc.) syncs automatically
- Status shown in footer: "Sync status: Saving to sheet..." → "Saved to sheet"

### Manual Save
- Click **"💾 Save to Sheets"** button in footer to force immediate save
- Useful when you want instant confirmation or troubleshooting

### Data Flow
1. User edits data in app
2. Changes saved to **localStorage** immediately
3. After 700ms debounce → Apps Script receives POST request
4. Apps Script distributes data to appropriate sheets
5. Full state backup saved to "AppState" sheet

## Google Apps Script Functions

### Main Handler
- `doGet()` - Returns HTML output
- `doPost(e)` - Accepts `{action: 'saveAppState', state: {...}}`

### Save Functions
- `saveAppState(state)` - Main entry point, distributes to all sheets
- `saveTablesByIdToSheets(tablesById)` - Saves custom tables (Aadhar, Cash, Banking, etc.)
- `saveExpensesStateToSheet(expensesState)` - Saves expenses
- `saveAadharIncomeStateToSheet(aadharIncomeState)` - Saves Aadhar income
- `saveGivenNotGivenStateToSheet(givenNotGivenState)` - Saves given/not given ledger
- `saveFullStateBackup(state)` - Backup of complete state with timestamp

## Troubleshooting

### "Sync status: Failed"
1. Check `.env` file has correct `VITE_GOOGLE_SHEETS_API_URL`
2. Verify Apps Script deployment URL is accessible
3. In Apps Script, check **Execution logs** for errors
4. Ensure Apps Script has access to the correct Google Sheet

### No data appearing in Google Sheets
1. Check that sheet names match those in Code.gs:
   - `Aadhar`, `Expenses`, `AadharIncome`, `GivenNotGiven`, `Cash`, `Banking`, `AppState`
2. Manually click **"💾 Save to Sheets"** button to test
3. Check Apps Script execution logs for any errors

### Performance Issues
- The app stores data locally first, so it's responsive even if sync fails
- All data is safe in localStorage until sync succeeds
- Full state backup in `AppState` sheet allows recovery

## Data Recovery

If you need to recover data:
1. Go to the `AppState` sheet in your Google Sheets
2. Find the latest timestamp entry
3. Copy the JSON from the "Data" column
4. The JSON contains the complete app state from that point in time

## Security Notes

- Google Sheets must be shared appropriately for your use case
- Apps Script runs as your account and can access your Google Sheets
- Do not share the deployment URL if you want restricted access
- Consider using Google Sheets row-level permissions for team collaboration

## File Structure

```
.
├── Code.gs              # Google Apps Script backend
├── src/
│   ├── App.jsx         # Main React component
│   ├── App.css         # Styling
│   ├── main.jsx        # Entry point
│   └── assets/         # Images
├── .env                # Environment variables
├── package.json        # Dependencies
└── vite.config.js      # Build configuration
```

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_GOOGLE_SHEETS_API_URL` | Main Apps Script deployment URL | Yes |
| `VITE_GIVEN_NOT_GIVEN_SHEET_API_URL` | Given/Not Given API URL (falls back to main if missing) | No |

---

**Last Updated**: May 8, 2026
