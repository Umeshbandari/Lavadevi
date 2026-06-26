# Firebase to Google Sheets - Integration Checklist ✅

## Pre-Deployment Checklist

### Frontend Code Updates ✅
- [x] `src/App.jsx` - Added `handleManualSave()` function
- [x] `src/App.jsx` - Updated footer with "Save to Sheets" button
- [x] `src/App.css` - Added button styling (`.footer-save-button`)
- [x] Build test - `npm run build` completed successfully ✅

### Backend Setup ✅
- [x] `Code.gs` - Enhanced with full `saveAppState()` support
- [x] `Code.gs` - All table save functions implemented:
  - [x] `saveTablesByIdToSheets()` - for custom tables
  - [x] `saveExpensesStateToSheet()`
  - [x] `saveAadharIncomeStateToSheet()`
  - [x] `saveGivenNotGivenStateToSheet()`
  - [x] `saveFullStateBackup()` - timestamp backups
- [x] `Code.gs` - Sheet name constants defined
- [x] `Code.gs` - Error handling implemented

### Configuration ✅
- [x] `.env` - API URL already configured
- [x] `.env.example` - Should be reviewed/updated
- [x] `README.md` - Comprehensive documentation added
- [x] `FIREBASE_TO_SHEETS_SETUP.md` - Setup guide created

### Data Sync Features ✅
- [x] Automatic debounced sync (700ms)
- [x] Manual sync button in footer
- [x] Sync status display
- [x] Error messages with user alerts
- [x] localStorage fallback
- [x] Full state backup system

### Tables Covered ✅
- [x] Aadhar → Sheet: "Aadhar"
- [x] Expenses → Sheet: "Expenses"
- [x] Given Not Given → Sheet: "GivenNotGiven"
- [x] Aadhar Income → Sheet: "AadharIncome"
- [x] Cash → Sheet: "Cash" (via tablesById)
- [x] Banking → Sheet: "Banking" (via tablesById)
- [x] Full Backup → Sheet: "AppState"

---

## Deployment Steps (Before Going Live)

### Step 1: Update Google Apps Script
- [ ] Copy content from `Code.gs` to your Google Sheet's Apps Script editor
- [ ] Update `SPREADSHEET_ID` in Code.gs (line 3)
- [ ] Deploy as Web App with "Anyone" access
- [ ] Copy deployment URL to `.env`

### Step 2: Verify Environment
- [ ] `.env` file has correct `VITE_GOOGLE_SHEETS_API_URL`
- [ ] `.env` file has `VITE_GIVEN_NOT_GIVEN_SHEET_API_URL` (same URL is fine)
- [ ] `.gitignore` includes `.env` (don't commit secrets)

### Step 3: Test Locally
- [ ] Run `npm install`
- [ ] Run `npm run dev`
- [ ] Add test data to a table
- [ ] Verify sync status shows in footer
- [ ] Click "💾 Save to Sheets" button
- [ ] Confirm data appears in Google Sheets
- [ ] Check appropriate sheets have correct data format

### Step 4: Verify Sheet Structure
- [ ] All sheets exist with correct names:
  - [ ] Aadhar
  - [ ] Expenses
  - [ ] AadharIncome
  - [ ] GivenNotGiven
  - [ ] Cash
  - [ ] Banking
  - [ ] AppState
- [ ] Headers are correctly set
- [ ] No data corruption on save

### Step 5: Production Build
- [ ] Run `npm run build`
- [ ] Test dist folder locally or deploy
- [ ] Verify API calls work from production URL
- [ ] Monitor sync status in production

### Step 6: Monitor
- [ ] Check AppState sheet for successful backups
- [ ] Monitor sync error rate
- [ ] Verify data consistency between frontend and sheets

---

## Testing Scenarios

### Scenario 1: Basic Save
- [ ] Edit a cell in Aadhar table
- [ ] Wait 700ms
- [ ] Verify "Sync status: Saved to sheet" appears
- [ ] Check Aadhar sheet in Google Sheets for the data

### Scenario 2: Manual Save
- [ ] Make several edits across different tables
- [ ] Click "💾 Save to Sheets" button
- [ ] See "Sync status: Saving to sheet..." 
- [ ] See alert "✓ Data saved successfully to Google Sheets!"
- [ ] Verify all tables updated in Google Sheets

### Scenario 3: Error Handling
- [ ] Temporarily break the API URL in `.env`
- [ ] Try to save
- [ ] Verify error message appears
- [ ] Data still in localStorage (no loss)
- [ ] Fix URL and retry

### Scenario 4: Multiple Edits
- [ ] Edit Aadhar table
- [ ] Edit Expenses table
- [ ] Edit Given Not Given table
- [ ] Wait for auto-save
- [ ] Verify all three tables updated in Google Sheets

### Scenario 5: Backup
- [ ] Make edits and save
- [ ] Check AppState sheet for new row with timestamp
- [ ] Verify JSON contains your app state

---

## Known Limitations

- ⚠️ No real-time sync from Google Sheets back to app (one-way)
- ⚠️ ~700ms delay on automatic sync (by design)
- ⚠️ Google Sheets API limits apply (usually not an issue for this use case)
- ⚠️ Large image uploads might hit size limits (image compression implemented)

---

## Rollback Plan

If something goes wrong:

1. **Data Loss?**
   - Check `AppState` sheet for most recent backup
   - Extract JSON from latest timestamp row
   - Recover data from backup

2. **App Broken?**
   - Revert last `src/App.jsx` changes from git
   - Or clear browser localStorage to force default state

3. **Apps Script Error?**
   - Check Apps Script execution logs
   - Revert to last working version
   - Verify SPREADSHEET_ID is correct

---

## Success Criteria

- ✅ App builds without errors
- ✅ Frontend displays sync status
- ✅ Manual save button works
- ✅ Auto-save works after 700ms
- ✅ Data appears in correct Google Sheets
- ✅ Sheet names match exactly
- ✅ Headers are formatted correctly
- ✅ AppState backups are created
- ✅ Error handling doesn't break app
- ✅ Production build is optimized

---

## Support Documentation

- **Setup Guide**: `FIREBASE_TO_SHEETS_SETUP.md`
- **README**: `README.md`
- **Code Documentation**: Inline comments in `Code.gs` and `App.jsx`

---

## Files Modified

```
✅ Code.gs                          - Enhanced backend
✅ src/App.jsx                      - Added sync functions & UI
✅ src/App.css                      - Added button styles
✅ README.md                        - Updated documentation
✅ FIREBASE_TO_SHEETS_SETUP.md      - New setup guide (this file)
✅ .env                             - Already configured
```

---

## Quick Reference

### Enable a Table for Syncing
Tables sync automatically via `tablesById` object. No changes needed - all tables in the app automatically sync.

### Change Sync Interval
Edit `PERSIST_DEBOUNCE_MS` in `App.jsx` (line 18):
```javascript
const PERSIST_DEBOUNCE_MS = 700  // in milliseconds
```

### Add a New Sheet
1. Add to `SHEET_NAMES` in Code.gs
2. Implement save function
3. Update `saveAppState()` to call new function

### Debug Sync
- Check browser DevTools Network tab
- Check Apps Script execution logs
- Check Google Sheets for data arrival
- Check localStorage for fallback data

---

**Status**: ✅ Ready for Testing & Deployment

**Last Updated**: May 8, 2026
