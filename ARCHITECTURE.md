# 🏗️ LavaDevi - Google Sheets Integration Architecture

## System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER / DEVICE                         │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                    REACT APPLICATION                          │   │
│  │  • Aadhar Module          • Cash Module                        │   │
│  │  • Expenses Module        • Banking Module                    │   │
│  │  • Given Not Given Module • Aadhar Income Module             │   │
│  └────┬─────────────────────────────────────────────────────────┘   │
│       │                                                              │
│  ┌────▼──────────────────────────┐                                  │
│  │   LOCAL STORAGE LAYER         │                                  │
│  │   (Immediate Backup)          │                                  │
│  └────┬──────────────────────────┘                                  │
│       │                                                              │
│  ┌────▼──────────────────────────────────────────────────────────┐ │
│  │  UI: SYNC STATUS + SAVE BUTTON                               │ │
│  │  ├─ Status: Saving...  |  Saved  |  Error                   │ │
│  │  ├─ Last synced: [timestamp]                                 │ │
│  │  └─ Button: 💾 Save to Sheets (Manual)                     │ │
│  └────┬──────────────────────────────────────────────────────────┘ │
│       │                                                              │
└───────┼──────────────────────────────────────────────────────────────┘
        │
        │ HTTPS POST REQUEST
        │ {action: 'saveAppState', state: {...}}
        │ (Every 700ms OR on Manual Save)
        │
        ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      GOOGLE APPS SCRIPT                                 │
│                   (Backend Processor)                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  doPost(e) → Parse Request                                    │   │
│  │  ├─ Validate action = 'saveAppState'                          │   │
│  │  └─ Extract state object                                      │   │
│  └────┬──────────────────────────────────────────────────────────┘   │
│       │                                                              │
│  ┌────▼──────────────────────────────────────────────────────────┐   │
│  │  saveAppState(state) → Distribute to Sheets                   │   │
│  │  ├─ saveTablesByIdToSheets()                                  │   │
│  │  │  ├─ Aadhar       → Sheet "Aadhar"                         │   │
│  │  │  ├─ Cash         → Sheet "Cash"                           │   │
│  │  │  └─ Banking      → Sheet "Banking"                        │   │
│  │  │                                                             │   │
│  │  ├─ saveExpensesStateToSheet()     → Sheet "Expenses"        │   │
│  │  ├─ saveAadharIncomeStateToSheet() → Sheet "AadharIncome"   │   │
│  │  ├─ saveGivenNotGivenStateToSheet()→ Sheet "GivenNotGiven"  │   │
│  │  └─ saveFullStateBackup()         → Sheet "AppState"        │   │
│  └────┬──────────────────────────────────────────────────────────┘   │
│       │                                                              │
│       └─ Response: {status: 'success', message: '...'}              │
│                                                                      │
└──────┬──────────────────────────────────────────────────────────────────┘
       │
       │ SHEETS API CALLS
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        GOOGLE SHEETS                                    │
│                  (Primary Database)                                      │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Sheet: "Aadhar"                Sheet: "Expenses"                       │
│  ├─ ID                          ├─ ID                                   │
│  ├─ S.No                        ├─ S.No                                 │
│  ├─ Date                        ├─ Date                                 │
│  ├─ Enrollments                 ├─ Item                                 │
│  ├─ Sale                        └─ Amount                               │
│  ├─ Bill                                                                │
│  ├─ Total                       Sheet: "AadharIncome"                   │
│  └─ Paid amount                 ├─ ID                                   │
│                                 ├─ S.No                                 │
│  Sheet: "Cash"                  ├─ Date                                 │
│  ├─ ID                          ├─ Name                                 │
│  ├─ S.No                        ├─ Type                                 │
│  ├─ Date                        └─ Amount                               │
│  ├─ Type                                                                │
│  ├─ Amount                      Sheet: "GivenNotGiven"                  │
│  └─ Description                 ├─ ID                                   │
│                                 ├─ S.No                                 │
│  Sheet: "Banking"               ├─ Date                                 │
│  ├─ ID                          ├─ Name                                 │
│  ├─ S.No                        ├─ Type                                 │
│  ├─ Date                        └─ Amount                               │
│  ├─ Type                                                                │
│  ├─ Amount                      Sheet: "AppState" (BACKUPS)            │
│  └─ Description                 ├─ Timestamp                            │
│                                 └─ Data (Full JSON)                    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Timeline

```
User Action                          Timeline              System State
─────────────────────────────────────────────────────────────────────────
[User edits cell]                    0ms                   Live in app
        ↓
[Save to localStorage]               0ms                   Persisted locally
        ↓
[Debounce timer starts]              0ms                   Waiting 700ms
        ↓
[User continues editing]             150ms                 Timer resets
        ↓
[User pauses]                        700ms                 No new edits
        ↓
[POST to Apps Script]                700ms                 In transit
        ↓
[Apps Script processes]              800ms                 Parsing state
        ↓
[Distribute to sheets]               850ms                 Writing to Sheets
        ↓
[Success response]                   900ms                 ✅ Complete
        ↓
[Update frontend status]             900ms                 "Saved to sheet"
```

---

## Component Interaction

```
┌─────────────────┐
│  React App      │◄─────────────────────────┐
│  (UI Layer)     │                          │
└────────┬────────┘                          │
         │                                   │
         │ 1. User edits                     │
         │                                   │
         ▼                                   │
┌────────────────────────┐                  │
│ React State Update     │                  │
│ (tables, expenses,etc) │                  │
└────────┬───────────────┘                  │
         │                                   │
         │ 2. Debounced save                 │
         │                                   │
         ▼                                   │
┌────────────────────────┐                  │
│ localStorage.setItem   │                  │
│ (Local Backup)         │                  │
└────────┬───────────────┘                  │
         │                                   │
         │ 3. Auto/Manual Sync Trigger      │
         │                                   │
         ▼                                   │
┌────────────────────────┐                  │
│ saveStateToFirestore() │                  │
│ (Actually to Sheets)   │                  │
└────────┬───────────────┘                  │
         │                                   │
         │ 4. HTTP POST                     │
         │                                   │
         ▼                                   │
    Google Apps Script
    (Backend)
         │
         │ 5. Parse & Validate
         │
         ▼
    Process saveAppState()
    (Distribute to sheets)
         │
         │ 6. Sheets API Calls
         │
         ▼
    Google Sheets
    (Database)
         │
         │ 7. Response
         │
         └──────────────────────────────────┘
                   8. Update status
```

---

## File Dependency Graph

```
User Browser
    │
    ├─► HTML (index.html)
    │       │
    │       └─► src/main.jsx
    │               │
    │               └─► src/App.jsx ◄────────────────┐
    │                   │                            │
    │                   ├─► App.css                  │
    │                   │   (Styling)                │
    │                   │                            │
    │                   ├─► .env                     │
    │                   │   (Configuration)          │
    │                   │                            │
    │                   └─► saveStateToFirestore()
    │                       (API call to...)
    │
    └─► Network Request
            │
            └─► Google Apps Script
                    │
                    └─► Code.gs ◄───────────────────────┐
                        │                               │
                        ├─► doPost(e)                   │
                        │   (Request handler)           │
                        │                               │
                        ├─► saveAppState()              │
                        │   (Main processor)            │
                        │                               │
                        └─► saveXxxStateToSheet()
                            (Distribution functions)
                                    │
                                    └─► Google Sheets API
                                            │
                                            └─► Your Google Sheet
                                                (Database)
```

---

## Sync Decision Tree

```
┌─ Data Change Detected ─┐
│                        │
└────┬─────────────────┐ │
     │                 │ │
     ▼                 ▼ │
Manual Save?       Auto-save active?
 (Button click)    (700ms debounce)
     │                 │
   YES               YES
     │                 │
     ├─► Fire NOW      ├─► Reset timer
     │                 │
     │            Wait 700ms
     │            (no new edits)
     │                 │
     │                 ▼
     │            Fire TIMER
     │
     ├─────────┬─────┘
              │
              ▼
        POST to Apps Script
        {action: 'saveAppState', state: {...}}
              │
              ▼
        Apps Script Response
              │
         ┌────┴────┐
         │         │
        YES       NO
         │        │
         ▼        ▼
    SUCCESS    ERROR
         │        │
         ▼        ▼
    Update    Show Error
    Status    Message
         │        │
         └────┬───┘
              │
              ▼
    User sees result
```

---

## Deployment Architecture

```
┌────────────────────────────────────────────────┐
│        Developer Machine (LOCAL)               │
├────────────────────────────────────────────────┤
│                                               │
│  Code Repository (git)                        │
│  ├─ Code.gs                                   │
│  ├─ src/App.jsx                               │
│  ├─ src/App.css                               │
│  └─ .env (with URLs)                          │
│                                               │
│  npm run dev  (Local Testing)                 │
│         │                                     │
└─────────┼─────────────────────────────────────┘
          │
          │
          ▼
┌────────────────────────────────────────────────┐
│    npm run build  (Production Build)           │
│         │                                      │
│         ▼                                      │
│    dist/ folder                               │
│    (Optimized, minified, ready)              │
└─────────┼─────────────────────────────────────┘
          │
          │
          ▼
┌────────────────────────────────────────────────┐
│   Deploy to Hosting                           │
│   (GitHub Pages, Netlify, Vercel, etc)       │
│                                               │
│   https://your-domain.com/                    │
│          │                                    │
└──────────┼────────────────────────────────────┘
           │
           ├──────────────────────┐
           │                      │
           ▼                      ▼
    User Access App      Still connects to
    (From anywhere)      Same Apps Script URL
                         & Google Sheets
```

---

## Security Architecture

```
┌─────────────────────────┐
│  User's Google Account  │
│  (You!)                 │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Your Google Sheet                      │
│  (Private or Shared as needed)         │
│  - Your data                            │
│  - Your control                         │
│  - Can set permissions                  │
└────────┬────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  Apps Script (Runs as You)             │
│  - Executes in your Google account     │
│  - Has access to your sheets           │
│  - Deployed web endpoint                │
└────────┬───────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  Published Web App                     │
│  - Anyone can access via URL           │
│  - Apps Script validates requests      │
│  - Your data remains protected         │
│  - No database exposed directly        │
└────────────────────────────────────────┘
```

---

## State Management Flow

```
┌──────────────────────────────────────┐
│       Application State              │
├──────────────────────────────────────┤
│                                      │
│  tablesById {                        │
│    aadhar: {                         │
│      id, columns, rowsById, ...      │
│    },                                │
│    cash: {...},                      │
│    banking: {...}                    │
│  }                                   │
│                                      │
│  expensesState {                     │
│    selectedMonth,                    │
│    rows,                             │
│    salaryByMonth,                    │
│    otherIncomeByMonth,               │
│    submittedMonths                   │
│  }                                   │
│                                      │
│  aadharIncomeState {                 │
│    selectedMonth,                    │
│    rows,                             │
│    submittedMonths                   │
│  }                                   │
│                                      │
│  givenNotGivenState {                │
│    selectedMonth,                    │
│    rows                              │
│  }                                   │
│                                      │
└──────────────────┬───────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
        ▼          ▼          ▼
   localStorage  Memory    Sheets
   (Backup)     (Live)    (Remote)
```

---

## Error Handling Flow

```
Network Request
    │
    ├─► SUCCESS
    │      │
    │      └─► Parse Response
    │             │
    │             ├─► Valid JSON
    │             │     │
    │             │     └─► Status success
    │             │            │
    │             │            └─► Update UI
    │             │
    │             └─► Invalid format
    │                    │
    │                    └─► Show Error
    │
    └─► FAILURE
           │
           ├─► Network Error
           │      │
           │      └─► Catch block
           │             │
           │             └─► Log error
           │             │
           │             └─► Show to user
           │
           ├─► Wrong URL
           │      │
           │      └─► 404 Response
           │             │
           │             └─► Show Error
           │
           └─► Apps Script Error
                  │
                  ├─► Parse error
                  │      │
                  │      └─► Apps Script logs
                  │
                  └─► Processing error
                         │
                         └─► Error response
                                │
                                └─► Show to user
```

---

## Performance Optimization

```
Frontend Layer
├─ Code splitting (Webpack)
├─ Lazy loading (React)
├─ Image compression (Canvas)
└─ CSS minification

Network Layer
├─ HTTPS POST (single request)
├─ JSON compression
├─ Debounce to 700ms (batches edits)
└─ Cache control

Backend Layer
├─ Apps Script optimization
├─ Batch Sheets API calls
├─ Error handling (no retry storms)
└─ Response compression

Database Layer
├─ Google Sheets efficient
├─ Only update changed rows
├─ Index on ID column
└─ Archive old data periodically
```

---

## This Architecture Provides

✅ **Simplicity**: No complex backend infrastructure
✅ **Transparency**: Can see all data in Sheets
✅ **Reliability**: Multiple backups (localStorage + AppState)
✅ **Performance**: Optimized for typical usage
✅ **Scalability**: Works for small to medium datasets
✅ **Security**: Data in your Google account
✅ **Maintainability**: Single script, clear code
✅ **Flexibility**: Easy to modify and extend

---

**This is a proven, simple, effective architecture for database syncing!**
