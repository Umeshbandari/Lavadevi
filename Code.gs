// Server-side Apps Script for LavaDevi Multi-App
// Uses openById so this script can run from a standalone project

const SPREADSHEET_ID = '12y9xEOtr5AI12Gp8QMUfeOcIyf6ki7HtwalaV51G-e4';
const SHEET_NAMES = {
  aadhar: "Aadhar",
  expenses: "Expenses",
  aadharIncome: "AadharIncome",
  givenNotGiven: "GivenNotGiven",
  cash: "Cash",
  banking: "Banking",
  appState: "AppState" // Backup of full state
};

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('LavaDevi Multi-App')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    
    if (params.action === 'saveAppState') {
      const result = saveAppState(params.state);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ 
      status: 'error', 
      message: error.toString() 
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Main function to save entire app state to multiple sheets
function saveAppState(state) {
  if (!state) {
    return { status: 'error', message: 'No state provided' };
  }

  try {
    // Save individual table data
    if (state.tablesById) {
      saveTablesByIdToSheets(state.tablesById);
    }

    // Save expenses state
    if (state.expensesState) {
      saveExpensesStateToSheet(state.expensesState);
    }

    // Save aadhar income state
    if (state.aadharIncomeState) {
      saveAadharIncomeStateToSheet(state.aadharIncomeState);
    }

    // Save given/not given state
    if (state.givenNotGivenState) {
      saveGivenNotGivenStateToSheet(state.givenNotGivenState);
    }

    // Backup full state
    saveFullStateBackup(state);

    return { status: 'success', message: 'All data saved to Google Sheets' };
  } catch (error) {
    Logger.log('Error in saveAppState: ' + error.toString());
    return { status: 'error', message: error.toString() };
  }
}

// Save tables from tablesById object
function saveTablesByIdToSheets(tablesById) {
  if (!tablesById || typeof tablesById !== 'object') return;

  Object.entries(tablesById).forEach(([tableId, tableData]) => {
    const sheetName = SHEET_NAMES[tableId] || tableId;
    saveTableToSheet(sheetName, tableData, tableId);
  });
}

// Save a single table to its sheet
function saveTableToSheet(sheetName, tableData, tableId) {
  if (!tableData || !tableData.rowsById) return;

  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  
  // Initialize sheet with headers if new
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = getHeadersForTable(tableId, tableData);
    sheet.appendRow(headers);
  }

  // Get existing row count to append (clear and repopulate)
  const existingRows = sheet.getLastRow();
  if (existingRows > 1) {
    sheet.deleteRows(2, existingRows - 1);
  }

  // Convert rows to 2D array
  const rows = convertTableRowsToArray(tableData, tableId);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

// Get appropriate headers based on table type
function getHeadersForTable(tableId, tableData) {
  const baseHeaders = ['ID', 'S.No', 'Date'];
  
  if (tableData && tableData.columns && Array.isArray(tableData.columns)) {
    return ['ID', 'S.No', ...tableData.columns];
  }

  switch(tableId) {
    case 'aadhar':
      return ['ID', 'S.No', 'Date', 'Enrollments', 'Sale', 'Paid amount', 'Bill', 'Total', 'Remaining amount'];
    case 'cash':
      return ['ID', 'S.No', 'Date', 'Type', 'Amount', 'Description'];
    case 'banking':
      return ['ID', 'S.No', 'Date', 'Type', 'Amount', 'Description'];
    default:
      return ['ID', 'S.No', 'Date', 'Type', 'Amount', 'Description'];
  }
}

// Convert table rows object to 2D array for Google Sheets
function convertTableRowsToArray(tableData, tableId) {
  if (!tableData || !tableData.rowsById) return [];

  const rowsById = tableData.rowsById;
  const rowOrder = tableData.rowOrder || Object.keys(rowsById);
  
  return rowOrder
    .map(rowId => {
      const row = rowsById[rowId];
      if (!row) return null;
      
      const arr = [
        row.id || '',
        row.sNo || '',
        row.date || '',
      ];

      // Add columns based on table type
      if (tableData.columns && Array.isArray(tableData.columns)) {
        tableData.columns.forEach(col => {
          arr.push(row[col] || '');
        });
      } else {
        // Fallback: add all non-id, non-date fields
        Object.keys(row)
          .filter(k => !['id', 'sNo', 'date'].includes(k))
          .forEach(k => {
            arr.push(row[k] || '');
          });
      }

      return arr;
    })
    .filter(row => row !== null);
}

// Save expenses state to sheet
function saveExpensesStateToSheet(expensesState) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.expenses);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.expenses);
    sheet.appendRow(['ID', 'S.No', 'Date', 'Item', 'Amount']);
  }

  if (!expensesState || !expensesState.rows) return;

  // Clear existing data
  const existingRows = sheet.getLastRow();
  if (existingRows > 1) {
    sheet.deleteRows(2, existingRows - 1);
  }

  // Add only completed expense rows so blank placeholders are not written to the sheet.
  const rows = expensesState.rows
    .filter(row => String(row?.item ?? '').trim() !== '' && String(row?.amount ?? '').trim() !== '')
    .map((row, index) => [
      row.id || '',
      index + 1,
      row.date || '',
      row.item || '',
      row.amount || ''
    ]);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  }
}

// Save aadhar income state to sheet
function saveAadharIncomeStateToSheet(aadharIncomeState) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.aadharIncome);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.aadharIncome);
    sheet.appendRow(['ID', 'S.No', 'Date', 'Name', 'Type', 'Amount', 'Exclude From Total']);
  }

  if (!aadharIncomeState || !aadharIncomeState.rows) return;

  const headers = ['ID', 'S.No', 'Date', 'Name', 'Type', 'Amount', 'Exclude From Total'];
  const existingHeader = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  const headerMatches = headers.every((header, index) => existingHeader[index] === header);
  if (!headerMatches) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  // Clear existing data
  const existingRows = sheet.getLastRow();
  if (existingRows > 1) {
    sheet.deleteRows(2, existingRows - 1);
  }

  // Add rows
  const rows = aadharIncomeState.rows.map(row => [
    row.id || '',
    row.sNo || '',
    row.date || '',
    row.name || '',
    row.type || 'Income',
    row.amount || '',
    row.excludeFromTotal ? 'TRUE' : 'FALSE'
  ]);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  }
}

// Save given/not given state to sheet
function saveGivenNotGivenStateToSheet(givenNotGivenState) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.givenNotGiven);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.givenNotGiven);
    sheet.appendRow(['ID', 'S.No', 'Date', 'Name', 'Cell No', 'Village', 'Type', 'Amount', 'Total Balance']);
  }

  if (!givenNotGivenState || !givenNotGivenState.rows) return;

  const headers = ['ID', 'S.No', 'Date', 'Name', 'Cell No', 'Village', 'Type', 'Amount', 'Total Balance'];
  const existingHeader = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  const headerMatches = headers.every((header, index) => existingHeader[index] === header);
  if (!headerMatches) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  // Clear existing data
  const existingRows = sheet.getLastRow();
  if (existingRows > 1) {
    sheet.deleteRows(2, existingRows - 1);
  }

  // Add rows
  let runningBalance = 0;
  const rows = givenNotGivenState.rows.map(row => {
    const amount = Number(row.amount) || 0;
    runningBalance += row.type === 'Not Given' ? -amount : amount;

    return [
      row.id || '',
      row.sNo || '',
      row.date || '',
      row.name || '',
      row.cellNo || '',
      row.village || '',
      row.type || '',
      row.amount || '',
      runningBalance,
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 9).setValues(rows);
  }
}

// Backup full state to AppState sheet (for recovery)
function saveFullStateBackup(state) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.appState);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.appState);
    sheet.appendRow(['Timestamp', 'Data']);
  }

  const timestamp = new Date().toISOString();
  const stateJson = JSON.stringify(state);
  
  sheet.appendRow([timestamp, stateJson]);
}

// Generic saver: append rows to any sheet (legacy compatibility)
function saveDataToSheet(sheetName, dataRows) {
  try {
    if (!sheetName) throw new Error('Missing sheetName');
    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

    if (dataRows && dataRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, dataRows.length, dataRows[0].length).setValues(dataRows);
    }
    return "Success";
  } catch (e) {
    throw new Error("Error saving to " + sheetName + ": " + e.message);
  }
}

// Legacy function - Saves Aadhar data into the sheet
function saveAadharData(data) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.aadhar);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.aadhar);
    sheet.appendRow(["DATE","ENROLLMENTS","SALE","PAID","BILL","TOTAL","REMAINING","BILL_SUBMIT_AMT", "BILL_IMAGE_URL"]);
  }

  if (!data || data.length === 0) return "NO_DATA";

  const values = data.map(r => [
    r.date,
    r.enrollments,
    r.sale,
    r.paid,
    r.bill,
    r.total,
    r.remaining,
    r.submitAmt || 0,
    r.imageUrl || ""
  ]);

  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 9).setValues(values);
  return "SUCCESS";
}

// Legacy function - Saves Aadhar Income 2 data
function saveIncome2Data(data) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.aadharIncome) || ss.insertSheet(SHEET_NAMES.aadharIncome);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["SL.NO", "DATE", "NAME", "TYPE", "AMOUNT", "TOTAL BALANCE"]);
  }

  if (!data || data.length === 0) return "NO_DATA";

  const values = data.map(r => [r.sl, r.date, r.name, r.type, r.amount, r.total]);
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 6).setValues(values);
  return "SUCCESS";
}
