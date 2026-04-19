import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import './App.css'
import lavaLogo from './assets/lava.jpg'
import aadharCardImage from './assets/Aadhar.png'
import { db } from './firebase'

const STORAGE_KEY_MULTI = 'lavadevi-multi-sheet-v1'
const STORAGE_KEY_LEGACY = 'lavadevi-sheet-v1'
const STORAGE_KEY_EXPENSES = 'lavadevi-expenses-v4'
const STORAGE_KEY_AADHAR_INCOME = 'lavadevi-aadhar-income-v1'
const LEGACY_EXPENSES_STORAGE_KEYS = ['lavadevi-expenses-v1', 'lavadevi-expenses-v2', 'lavadevi-expenses-v3']
const FIRESTORE_COLLECTION = 'appState'
const FIRESTORE_DOC_ID = 'main'
const PERSIST_DEBOUNCE_MS = 700

const DEFAULT_COLUMNS = ['Type', 'Amount', 'Description']
const EMPTY_LIST = []

const AADHAR_COLUMNS = ['Enrollments', 'Sale', 'Bill', 'Total', 'Paid amount', 'Remaining amount']
const REMOVED_TABLE_IDS = ['personal', 'shop']

const BUILTIN_TABLES = [
  { id: 'aadhar', name: 'Aadhar' },
]

const HOME_FEATURE_CARDS = [
  {
    id: 'aadhar',
    name: 'Aadhar',
    description: 'Manage Operator entry, HO view, and Bill summaries.',
  },
  {
    id: 'expenses',
    name: 'Expenses',
    description: 'Track month-wise expense entries by item, amount, and date.',
  },
  {
    id: 'aadhar-income',
    name: 'Aadhar Income',
    description: 'Track month-wise aadhar income and expense entries.',
  },
  {
    id: 'banking',
    name: 'Banking',
    description: 'Capture deposits, withdrawals, and commission details.',
  },
  {
    id: 'reports',
    name: 'Reports',
    description: 'Consolidated summary cards and exports across features.',
  },
]

let pdfToolsPromise
let xlsxModulePromise

async function loadPdfTools() {
  if (!pdfToolsPromise) {
    pdfToolsPromise = Promise.all([import('jspdf'), import('jspdf-autotable')]).then(
      ([pdfModule, autoTableModule]) => ({
        jsPDF: pdfModule.jsPDF,
        autoTable: autoTableModule.default,
      }),
    )
  }

  return pdfToolsPromise
}

async function loadXlsxModule() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import('xlsx')
  }

  return xlsxModulePromise
}

// ----------------------------------------------------------------------
// Image Compression Utility to prevent Firestore 1MB limits
// ----------------------------------------------------------------------
function compressImageFile(file, maxWidth = 800, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width)
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = event.target.result
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

// ----------------------------------------------------------------------
// Firestore Safeguard to strip massive strings (legacy uncompressed images)
// ----------------------------------------------------------------------
function stripOversizedStrings(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(stripOversizedStrings);

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    // 500KB limit for any single string to avoid breaking Firestore
    if (typeof value === 'string' && value.length > 500000) {
      console.warn(`Stripped massive string on key: ${key}. Firestore has a 1MB document limit.`);
      result[key] = ''; // Drop the massive string to save the rest of the DB
    } else if (typeof value === 'object') {
      result[key] = stripOversizedStrings(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function sanitizeData(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function normalizeColumns(columns, tableId = null) {
  if (tableId === 'aadhar') {
    return AADHAR_COLUMNS
  }
  const source = Array.isArray(columns) && columns.length > 0 ? columns : DEFAULT_COLUMNS
  const extras = source.filter((column) => !DEFAULT_COLUMNS.includes(column))
  return [...DEFAULT_COLUMNS, ...extras]
}

function getRequiredColumns(columns, tableId = null) {
  if (tableId === 'aadhar') {
    return columns.filter((column) => column !== 'Remaining amount')
  }
  return columns.filter((column) => column !== 'Description')
}

function normalizeDateValue(value) {
  if (!value) {
    return new Date().toISOString().slice(0, 10)
  }

  if (/^\d{4}-\d{2}$/.test(value)) {
    return `${value}-01`
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  return new Date().toISOString().slice(0, 10)
}

function createRow(columns, serialNo) {
  const row = {
    id: crypto.randomUUID(),
    sNo: serialNo,
    date: new Date().toISOString().slice(0, 10),
  }

  columns.forEach((column) => {
    if (column === 'Amount') {
      row[column] = ''
      return
    }
    if (column === 'Type') {
      row[column] = 'Expenditure'
      return
    }
    if (column === 'Enrollments' || column === 'Sale' || column === 'Bill' || column === 'Total' || column === 'Paid amount' || column === 'Remaining amount') {
      row[column] = ''
      return
    }
    row[column] = ''
  })

  return row
}

function createExpenseRow(serialNo, dateValue = new Date().toISOString().slice(0, 10)) {
  return {
    id: crypto.randomUUID(),
    sNo: serialNo,
    item: '',
    amount: '',
    date: normalizeDateValue(dateValue),
  }
}

function normalizeExpenseRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [createExpenseRow(1)]
  }

  return rows.map((row, index) => ({
    id: row?.id || crypto.randomUUID(),
    sNo: index + 1,
    item: String(row?.item ?? ''),
    amount: String(row?.amount ?? ''),
    date: normalizeDateValue(row?.date),
  }))
}

function getInitialExpensesState() {
  const fallbackMonth = new Date().toISOString().slice(0, 7)
  const fallback = {
    selectedMonth: fallbackMonth,
    rows: [createExpenseRow(1, `${fallbackMonth}-01`)],
    salaryByMonth: {},
    otherIncomeByMonth: {},
    submittedMonths: {},
  }

  LEGACY_EXPENSES_STORAGE_KEYS.forEach((legacyKey) => {
    localStorage.removeItem(legacyKey)
  })

  const raw = localStorage.getItem(STORAGE_KEY_EXPENSES)
  if (!raw) {
    return fallback
  }

  try {
    const parsed = JSON.parse(raw)
    const selectedMonth = /^\d{4}-\d{2}$/.test(parsed?.selectedMonth)
      ? parsed.selectedMonth
      : fallbackMonth

    return {
      selectedMonth,
      rows: normalizeExpenseRows(parsed?.rows),
      salaryByMonth: parsed?.salaryByMonth && typeof parsed.salaryByMonth === 'object' ? parsed.salaryByMonth : {},
      otherIncomeByMonth: parsed?.otherIncomeByMonth && typeof parsed.otherIncomeByMonth === 'object' ? parsed.otherIncomeByMonth : {},
      submittedMonths: parsed?.submittedMonths && typeof parsed.submittedMonths === 'object' ? parsed.submittedMonths : {},
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY_EXPENSES)
    return fallback
  }
}

function createAadharIncomeRow(serialNo, dateValue = new Date().toISOString().slice(0, 10)) {
  return {
    id: crypto.randomUUID(),
    sNo: serialNo,
    date: normalizeDateValue(dateValue),
    name: '',
    type: 'Income',
    amount: '',
  }
}

function normalizeAadharIncomeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [createAadharIncomeRow(1)]
  }

  return rows.map((row, index) => ({
    id: row?.id || crypto.randomUUID(),
    sNo: index + 1,
    date: normalizeDateValue(row?.date),
    name: String(row?.name ?? ''),
    type: row?.type === 'Expense' ? 'Expense' : 'Income',
    amount: String(row?.amount ?? ''),
  }))
}

function getInitialAadharIncomeState() {
  const fallbackMonth = new Date().toISOString().slice(0, 7)
  const fallback = {
    selectedMonth: fallbackMonth,
    rows: [createAadharIncomeRow(1, `${fallbackMonth}-01`)],
    submittedMonths: {},
  }

  const raw = localStorage.getItem(STORAGE_KEY_AADHAR_INCOME)
  if (!raw) {
    return fallback
  }

  try {
    const parsed = JSON.parse(raw)
    const selectedMonth = /^\d{4}-\d{2}$/.test(parsed?.selectedMonth)
      ? parsed.selectedMonth
      : fallbackMonth

    return {
      selectedMonth,
      rows: normalizeAadharIncomeRows(parsed?.rows),
      submittedMonths: parsed?.submittedMonths && typeof parsed.submittedMonths === 'object' ? parsed.submittedMonths : {},
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY_AADHAR_INCOME)
    return fallback
  }
}

function getNextMonthKey(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return null
  }

  const [yearText, monthText] = monthKey.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null
  }

  const nextDate = new Date(year, month, 1)
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`
}

function createTable(name, isBuiltIn = false, fixedId = null) {
  const isAadhar = fixedId === 'aadhar'
  const columns = isAadhar ? AADHAR_COLUMNS : [...DEFAULT_COLUMNS]
  const rowColumns = isAadhar ? ['Date', ...AADHAR_COLUMNS] : DEFAULT_COLUMNS
  return {
    id: fixedId || crypto.randomUUID(),
    name,
    isBuiltIn,
    lockedMonths: [],
    lockedDates: [],
    monthPayments: {},
    yearPayments: {},
    columns,
    rows: [createRow(rowColumns, 1)],
  }
}

function normalizeRows(rows, columns) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [createRow(columns, 1)]
  }

  return rows.map((row, index) => {
    const normalized = {
      id: row.id || crypto.randomUUID(),
      sNo: index + 1,
      date: normalizeDateValue(row.date),
    }

    columns.forEach((column) => {
      if (column === 'Type') {
        normalized[column] = row[column] ?? 'Expenditure'
        return
      }
      normalized[column] = row[column] ?? ''
    })

    return normalized
  })
}

function buildFallbackState() {
  const tables = BUILTIN_TABLES.map((table) => createTable(table.name, true, table.id))
  return {
    activeTableId: tables[0].id,
    tables,
  }
}

function normalizePersistedState(rawState) {
  const fallback = buildFallbackState()
  const source = rawState && typeof rawState === 'object' ? rawState : {}
  const parsedTables = Array.isArray(source.tables)
    ? source.tables.filter((table) => !REMOVED_TABLE_IDS.includes(table?.id))
    : EMPTY_LIST

  const tables = parsedTables.map((table, index) => {
    const columns = normalizeColumns(table.columns, table.id)
    const isBuiltIn = BUILTIN_TABLES.some((builtin) => builtin.id === table.id)
    const lockedMonths = Array.isArray(table.lockedMonths) ? table.lockedMonths : []
    const lockedDates = Array.isArray(table.lockedDates) ? table.lockedDates : []
    const monthPayments = table.monthPayments && typeof table.monthPayments === 'object' ? table.monthPayments : {}
    const yearPayments = table.yearPayments && typeof table.yearPayments === 'object' ? table.yearPayments : {}

    return {
      id: table.id || `table-${index + 1}`,
      name: table.name || `Table ${index + 1}`,
      isBuiltIn,
      lockedMonths,
      lockedDates,
      monthPayments,
      yearPayments,
      columns,
      rows: normalizeRows(table.rows, columns),
    }
  })

  BUILTIN_TABLES.forEach((builtin) => {
    if (!tables.some((table) => table.id === builtin.id)) {
      tables.push(createTable(builtin.name, true, builtin.id))
    }
  })

  if (tables.length === 0) {
    return fallback
  }

  const activeTableExists = tables.some((table) => table.id === source.activeTableId)
  return {
    activeTableId: activeTableExists ? source.activeTableId : tables[0].id,
    tables,
  }
}

function sanitizeFirestoreValue(value) {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return null
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (Array.isArray(item)) {
          return JSON.stringify(item.map((nestedItem) => sanitizeFirestoreValue(nestedItem)))
        }
        return sanitizeFirestoreValue(item)
      })
      .filter((item) => item !== undefined)
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()]
        .map(([key, item]) => [String(key), sanitizeFirestoreValue(item)])
        .filter(([, item]) => item !== undefined),
    )
  }

  if (value instanceof Set) {
    return [...value]
      .map((item) => sanitizeFirestoreValue(item))
      .filter((item) => item !== undefined)
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return undefined
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    const isPlain = prototype === Object.prototype || prototype === null
    if (!isPlain) {
      return undefined
    }

    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, sanitizeFirestoreValue(item)])
        .filter(([, item]) => item !== undefined),
    )
  }

  return undefined
}

function serializeTableForFirestore(table) {
  const rows = Array.isArray(table.rows) ? table.rows : []
  const lockedMonths = Array.isArray(table.lockedMonths) ? table.lockedMonths : []
  const lockedDates = Array.isArray(table.lockedDates) ? table.lockedDates : []
  const columns = Array.isArray(table.columns) ? table.columns : []

  const safeRowsById = Object.fromEntries(
    rows
      .map((row) => {
        const safeRow = Object.fromEntries(
          Object.entries(row || {})
            .map(([key, item]) => [key, sanitizeFirestoreValue(item)])
            .filter(([, item]) => item !== undefined),
        )

        return [row?.id, safeRow]
      })
      .filter(([rowId]) => rowId !== undefined),
  )

  return {
    id: sanitizeFirestoreValue(table.id) ?? '',
    name: sanitizeFirestoreValue(table.name) ?? '',
    isBuiltIn: Boolean(table.isBuiltIn),
    columnsByKey: Object.fromEntries(
      columns
        .map((column, index) => [String(index), sanitizeFirestoreValue(column)])
        .filter(([, column]) => column !== undefined),
    ),
    lockedMonthsByKey: Object.fromEntries(
      lockedMonths
        .map((month) => [String(month), true])
        .filter(([monthKey]) => monthKey !== 'undefined'),
    ),
    lockedDatesByKey: Object.fromEntries(
      lockedDates
        .map((date) => [String(date), true])
        .filter(([dateKey]) => dateKey !== 'undefined'),
    ),
    monthPayments: sanitizeFirestoreValue(table.monthPayments) || {},
    yearPayments: sanitizeFirestoreValue(table.yearPayments) || {},
    rowOrderByKey: Object.fromEntries(
      rows
        .map((row, index) => [String(index), sanitizeFirestoreValue(row?.id)])
        .filter(([, rowId]) => rowId !== undefined),
    ),
    rowsById: safeRowsById,
  }
}

function serializeStateForFirestore(state) {
  const tables = Array.isArray(state.tables) ? state.tables : EMPTY_LIST
  const tablesById = new Map(
    tables
      .filter((table) => table?.id !== undefined)
      .map((table) => [table.id, serializeTableForFirestore(table)]),
  )

  return {
    schemaVersion: 2,
    activeTableId: state.activeTableId ?? '',
    tablesById: Object.fromEntries(tablesById),
  }
}

async function saveStateToFirestore(state) {
  const stateRef = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC_ID)
  const serializedState = serializeStateForFirestore(state)
  const cleanTablesById = sanitizeData(serializedState.tablesById || {})
  
  const rawPayload = {
    ...serializedState,
    tablesById: cleanTablesById,
    updatedAt: new Date().toISOString(),
  }

  // 1. Deep clone to drop proxies or undefined values
  const cleanPayload = JSON.parse(JSON.stringify(rawPayload))
  
  // 2. Strip oversized base64 images that break Firestore
  const safePayload = stripOversizedStrings(cleanPayload)

  await setDoc(stateRef, safePayload, { merge: true })
  console.log('Firestore save successful:', safePayload)
}

function deserializeTableFromFirestore(tableId, storedTable) {
  const sourceTable = storedTable && typeof storedTable === 'object' ? storedTable : {}
  const columns = Array.isArray(sourceTable.columns)
    ? normalizeColumns(sourceTable.columns, tableId)
    : normalizeColumns(Object.values(sourceTable.columnsByKey || {}), tableId)
  const rowsById = sourceTable.rowsById && typeof sourceTable.rowsById === 'object' ? sourceTable.rowsById : {}
  const rowOrder = Array.isArray(sourceTable.rowOrder)
    ? sourceTable.rowOrder
    : Object.values(sourceTable.rowOrderByKey || {})
  const orderedRows = rowOrder.map((rowId) => rowsById[rowId]).filter(Boolean)
  const lockedMonths = Array.isArray(sourceTable.lockedMonths)
    ? sourceTable.lockedMonths
    : Object.keys(sourceTable.lockedMonthsByKey || {})
  const lockedDates = Array.isArray(sourceTable.lockedDates)
    ? sourceTable.lockedDates
    : Object.keys(sourceTable.lockedDatesByKey || {})

  return {
    id: tableId,
    name: sourceTable.name || tableId,
    isBuiltIn: Boolean(sourceTable.isBuiltIn || BUILTIN_TABLES.some((builtin) => builtin.id === tableId)),
    lockedMonths,
    lockedDates,
    monthPayments: sourceTable.monthPayments && typeof sourceTable.monthPayments === 'object' ? sourceTable.monthPayments : {},
    yearPayments: sourceTable.yearPayments && typeof sourceTable.yearPayments === 'object' ? sourceTable.yearPayments : {},
    columns,
    rows: normalizeRows(orderedRows, columns),
  }
}

function deserializeFirestoreState(rawState) {
  const source = rawState && typeof rawState === 'object' ? rawState : {}

  if (Array.isArray(source.tables)) {
    return normalizePersistedState(source)
  }

  const tablesById = source.tablesById && typeof source.tablesById === 'object' ? source.tablesById : {}
  const tables = Object.entries(tablesById)
    .filter(([tableId]) => !REMOVED_TABLE_IDS.includes(tableId))
    .map(([tableId, storedTable]) => deserializeTableFromFirestore(tableId, storedTable))

  BUILTIN_TABLES.forEach((builtin) => {
    if (!tables.some((table) => table.id === builtin.id)) {
      tables.push(createTable(builtin.name, true, builtin.id))
    }
  })

  if (tables.length === 0) {
    return buildFallbackState()
  }

  const activeTableExists = tables.some((table) => table.id === source.activeTableId)
  return {
    activeTableId: activeTableExists ? source.activeTableId : tables[0].id,
    tables,
  }
}

function getInitialState() {
  const fallback = buildFallbackState()

  const multiRaw = localStorage.getItem(STORAGE_KEY_MULTI)
  if (multiRaw) {
    try {
      return normalizePersistedState(JSON.parse(multiRaw))
    } catch {
      localStorage.removeItem(STORAGE_KEY_MULTI)
    }
  }

  const legacyRaw = localStorage.getItem(STORAGE_KEY_LEGACY)
  if (legacyRaw) {
    try {
      const parsedLegacy = JSON.parse(legacyRaw)
      const columns = normalizeColumns(parsedLegacy.columns)
      const legacyRows = normalizeRows(parsedLegacy.rows, columns)
      const tables = BUILTIN_TABLES.map((table) => createTable(table.name, true, table.id))

      tables[0] = {
        ...tables[0],
        columns,
        rows: legacyRows,
        lockedMonths: [],
        lockedDates: [],
        monthPayments: {},
        yearPayments: {},
      }

      return {
        activeTableId: tables[0].id,
        tables,
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY_LEGACY)
    }
  }

  return fallback
}

function formatMonth(date) {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown'
  }
  return parsed.toLocaleDateString('en-IN', {
    month: 'short',
    year: '2-digit',
  })
}

function toDate(value) {
  if (!value) {
    return null
  }

  const normalizedValue = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value
  const parsed = new Date(normalizedValue)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

function getMonthDates(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(monthValue)) {
    return EMPTY_LIST
  }

  const [yearText, monthText] = monthValue.split('-')
  const year = Number(yearText)
  const month = Number(monthText)

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return EMPTY_LIST
  }

  const daysInMonth = new Date(year, month, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, '0')
    return `${monthValue}-${day}`
  })
}

function getFinancialYearStartYear(dateValue) {
  const parsed = toDate(dateValue)
  if (!parsed) {
    return new Date().getFullYear()
  }
  const month = parsed.getMonth() + 1
  return month >= 4 ? parsed.getFullYear() : parsed.getFullYear() - 1
}

function formatMonthKey(monthKey) {
  const parsed = toDate(`${monthKey}-01`)
  if (!parsed) {
    return monthKey
  }
  return parsed.toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  })
}

function formatFinancialYear(startYear) {
  return `FY ${startYear}-${String(startYear + 1).slice(-2)}`
}

function formatRupees(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return '0'
  }
  return String(Math.round(numeric))
}

function getDateMonthKey(dateValue) {
  const parsed = toDate(dateValue)
  if (!parsed) {
    return null
  }
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`
}

function isZeroValue(value) {
  const trimmed = String(value ?? '').trim()
  if (trimmed === '') {
    return false
  }
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) && numeric === 0
}

function isAllColumnsZero(row, tableColumns) {
  if (!Array.isArray(tableColumns) || tableColumns.length === 0) {
    return false
  }
  return tableColumns.every((column) => isZeroValue(row[column]))
}

function sortRowsByDate(rows, shouldSort = true) {
  if (!shouldSort) {
    return rows
  }

  return [...rows].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

function createMonthRowMap(rows, monthValue) {
  const monthDates = getMonthDates(monthValue)
  const monthRowMap = new Map()

  rows
    .filter((row) => row.date?.slice(0, 7) === monthValue)
    .forEach((row) => {
      if (monthRowMap.has(row.date)) {
        const previousRow = monthRowMap.get(row.date)
        monthRowMap.set(row.date, {
          ...previousRow,
          ...row,
          id: previousRow.id,
        })
        return
      }
      monthRowMap.set(row.date, row)
    })

  return monthDates.map((date) => monthRowMap.get(date) || null).filter(Boolean)
}

function isAadharRowComplete(row, tableColumns) {
  if (!row?.date?.trim()) {
    return false
  }

  return getRequiredColumns(tableColumns, 'aadhar').every((column) => String(row[column] ?? '').trim() !== '')
}

function getAmount(row) {
  const raw = Number(row.Amount)
  return Number.isFinite(raw) ? raw : 0
}

function getSignedAmount(row) {
  const amount = getAmount(row)
  return row.Type === 'Income' ? amount : -amount
}

function App() {
  const [initialState] = useState(() => getInitialState())
  const [initialExpensesState] = useState(() => getInitialExpensesState())
  const [initialAadharIncomeState] = useState(() => getInitialAadharIncomeState())
  const persistTimeoutRef = useRef(null)
  const latestStateRef = useRef({
    activeTableId: initialState.activeTableId,
    tables: initialState.tables,
  })

  const [trendFilter, setTrendFilter] = useState('all')
  const [tables, setTables] = useState(initialState.tables)
  const [activeTableId, setActiveTableId] = useState(initialState.activeTableId)
  const [newTableName, setNewTableName] = useState('')
  const [exportStartDate, setExportStartDate] = useState('')
  const [exportEndDate, setExportEndDate] = useState('')
  const [aadharMode, setAadharMode] = useState('entry')
  const [entryMonth, setEntryMonth] = useState(new Date().toISOString().slice(0, 7))
  const [viewMonth, setViewMonth] = useState(new Date().toISOString().slice(0, 7))
  const [viewFy, setViewFy] = useState(String(getFinancialYearStartYear(new Date().toISOString().slice(0, 10))))
  const [firestoreReady, setFirestoreReady] = useState(false)
  const [selectedFeature, setSelectedFeature] = useState(null)
  const [expenseMonth, setExpenseMonth] = useState(initialExpensesState.selectedMonth)
  const [expenseViewFy, setExpenseViewFy] = useState(String(getFinancialYearStartYear(new Date().toISOString().slice(0, 10))))
  const [expenseRows, setExpenseRows] = useState(initialExpensesState.rows)
  const [salaryByMonth, setSalaryByMonth] = useState(initialExpensesState.salaryByMonth || {})
  const [otherIncomeByMonth, setOtherIncomeByMonth] = useState(initialExpensesState.otherIncomeByMonth || {})
  const [submittedExpenseMonths, setSubmittedExpenseMonths] = useState(initialExpensesState.submittedMonths || {})
  const [expenseMode, setExpenseMode] = useState('entry')
  const [aadharIncomeMonth, setAadharIncomeMonth] = useState(initialAadharIncomeState.selectedMonth)
  const [aadharIncomeRows, setAadharIncomeRows] = useState(initialAadharIncomeState.rows)
  const [submittedAadharIncomeMonths, setSubmittedAadharIncomeMonths] = useState(initialAadharIncomeState.submittedMonths || {})
  const [aadharIncomeMode, setAadharIncomeMode] = useState('entry')
  const [aadharIncomeViewFy, setAadharIncomeViewFy] = useState(String(getFinancialYearStartYear(new Date().toISOString().slice(0, 10))))

  useEffect(() => {
    latestStateRef.current = {
      activeTableId,
      tables,
    }
  }, [activeTableId, tables])

  useEffect(() => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current)
    }

    persistTimeoutRef.current = window.setTimeout(() => {
      const snapshot = latestStateRef.current

      try {
        localStorage.setItem(STORAGE_KEY_MULTI, JSON.stringify(snapshot))
      } catch (error) {
        console.error('Failed to persist local data:', error)
      }

      if (firestoreReady) {
        saveStateToFirestore(snapshot).catch((error) => {
          console.error('Failed to save data to Firebase:', error)
        })
      }
    }, PERSIST_DEBOUNCE_MS)

    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current)
      }
    }
  }, [activeTableId, firestoreReady, tables])

  useEffect(() => {
    const flushPersistedState = () => {
      const snapshot = latestStateRef.current

      try {
        localStorage.setItem(STORAGE_KEY_MULTI, JSON.stringify(snapshot))
      } catch (error) {
        console.error('Failed to persist local data:', error)
      }
    }

    window.addEventListener('pagehide', flushPersistedState)
    return () => {
      window.removeEventListener('pagehide', flushPersistedState)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_EXPENSES,
        JSON.stringify({
          selectedMonth: expenseMonth,
          rows: expenseRows,
          salaryByMonth,
          otherIncomeByMonth,
          submittedMonths: submittedExpenseMonths,
        }),
      )
    } catch (error) {
      console.error('Failed to persist expenses data:', error)
    }
  }, [expenseMonth, expenseRows, otherIncomeByMonth, salaryByMonth, submittedExpenseMonths])

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_AADHAR_INCOME,
        JSON.stringify({
          selectedMonth: aadharIncomeMonth,
          rows: aadharIncomeRows,
          submittedMonths: submittedAadharIncomeMonths,
        }),
      )
    } catch (error) {
      console.error('Failed to persist aadhar income data:', error)
    }
  }, [aadharIncomeMonth, aadharIncomeRows, submittedAadharIncomeMonths])

  useEffect(() => {
    let isMounted = true

    async function loadRemoteState() {
      try {
        const stateRef = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC_ID)
        const snapshot = await getDoc(stateRef)

        if (!isMounted) {
          return
        }

        if (snapshot.exists()) {
          const remoteState = deserializeFirestoreState(snapshot.data())
          setTables(remoteState.tables)
          setActiveTableId(remoteState.activeTableId)
          localStorage.setItem(STORAGE_KEY_MULTI, JSON.stringify(remoteState))
        } else {
          await saveStateToFirestore(initialState)
        }
      } catch (error) {
        console.error('Failed to initialize data in Firebase:', error)
      } finally {
        if (isMounted) {
          setFirestoreReady(true)
        }
      }
    }

    loadRemoteState()

    return () => {
      isMounted = false
    }
  }, [initialState])

  const activeTable = useMemo(() => {
    return tables.find((table) => table.id === activeTableId) || tables[0]
  }, [activeTableId, tables])

  const rows = activeTable?.rows || EMPTY_LIST
  const columns = activeTable?.columns || EMPTY_LIST
  const lockedMonths = Array.isArray(activeTable?.lockedMonths) ? activeTable.lockedMonths : EMPTY_LIST
  const lockedDates = Array.isArray(activeTable?.lockedDates) ? activeTable.lockedDates : EMPTY_LIST
  const lockedDateSet = useMemo(() => new Set(lockedDates), [lockedDates])
  const monthPayments = activeTable?.monthPayments && typeof activeTable.monthPayments === 'object'
    ? activeTable.monthPayments
    : {}
  const yearPayments = activeTable?.yearPayments && typeof activeTable.yearPayments === 'object'
    ? activeTable.yearPayments
    : {}
  const isAadharTable = activeTable?.id === 'aadhar'
  const currentDate = new Date().toISOString().slice(0, 10)
  const currentMonth = currentDate.slice(0, 7)
  const showExportControls = !isAadharTable || aadharMode === 'view'
  const isViewMode = isAadharTable && aadharMode === 'view'
  const isBillMode = isAadharTable && aadharMode === 'bill'
  const selectedMonthKey = isViewMode ? viewMonth : entryMonth
  const hasLockedDateInViewMonth = isAadharTable && rows.some(
    (row) => row.date?.slice(0, 7) === viewMonth && lockedDateSet.has(row.date),
  )
  const isViewMonthSubmitted = !isAadharTable || lockedMonths.includes(viewMonth) || hasLockedDateInViewMonth
  const entryMonthLocked = isAadharTable && lockedMonths.includes(entryMonth)
  const selectedMonthLocked = isAadharTable && lockedMonths.includes(selectedMonthKey)
  const selectedMonthPayment = monthPayments[selectedMonthKey] || {}
  const selectedYearKey = String(viewFy)
  const selectedYearPayment = yearPayments[selectedYearKey] || {}

  const visibleRows = useMemo(() => {
    if (!isAadharTable) {
      return rows
    }

    if (aadharMode === 'bill') {
      return EMPTY_LIST
    }

    if (aadharMode === 'entry') {
      return createMonthRowMap(rows, entryMonth)
    }

    if (!isViewMonthSubmitted) {
      return EMPTY_LIST
    }

    return rows
      .filter((row) => row.date?.slice(0, 7) === viewMonth && lockedDateSet.has(row.date))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }, [aadharMode, entryMonth, isAadharTable, isViewMonthSubmitted, lockedDateSet, rows, viewMonth])

  const monthBillTotal = useMemo(() => {
    if (!isAadharTable) {
      return 0
    }

    return visibleRows.reduce((sum, row) => sum + (Number(row.Bill) || 0), 0)
  }, [isAadharTable, visibleRows])

  const monthRemainingTotal = useMemo(() => {
    if (!isAadharTable) {
      return 0
    }

    return visibleRows.reduce((sum, row) => sum + (Number(row['Remaining amount']) || 0), 0)
  }, [isAadharTable, visibleRows])

  const monthNetBaseTotal = monthBillTotal + monthRemainingTotal
  const monthNetPaidTotal =
    (selectedMonthPayment.billSubmitted ? monthBillTotal : 0) +
    (selectedMonthPayment.remainingSubmitted ? monthRemainingTotal : 0)
  const monthNetTotal = monthNetBaseTotal - monthNetPaidTotal

  const monthTotals = useMemo(() => {
    const totals = {}

    columns.forEach((column) => {
      const rawValues = visibleRows.map((row) => String(row[column] ?? '').trim()).filter((value) => value !== '')
      if (rawValues.length === 0) {
        totals[column] = '-'
        return
      }

      const allNumeric = rawValues.every((value) => Number.isFinite(Number(value)))
      if (!allNumeric) {
        totals[column] = '-'
        return
      }

      const total = rawValues.reduce((sum, value) => sum + Number(value), 0)
      totals[column] = Number.isInteger(total) ? String(total) : total.toFixed(2)
    })

    return totals
  }, [columns, visibleRows])

  const fyOptions = useMemo(() => {
    if (!isAadharTable || (aadharMode !== 'view' && aadharMode !== 'bill')) {
      return EMPTY_LIST
    }

    const years = new Set([getFinancialYearStartYear(new Date().toISOString().slice(0, 10))])
    rows.forEach((row) => {
      if (row.date) {
        years.add(getFinancialYearStartYear(row.date))
      }
    })

    const sortedYears = [...years].sort((a, b) => a - b)
    if (sortedYears.length === 0) {
      return []
    }

    const firstYear = sortedYears[0]
    const lastYear = sortedYears[sortedYears.length - 1]
    const expandedYears = []
    for (let year = firstYear; year <= lastYear; year += 1) {
      expandedYears.push(year)
    }

    return expandedYears.reverse()
  }, [aadharMode, isAadharTable, rows])

  const hoFySummaryRows = useMemo(() => {
    if (!isViewMode) {
      return EMPTY_LIST
    }

    const fyStart = Number(viewFy)
    if (!Number.isFinite(fyStart)) {
      return EMPTY_LIST
    }

    const monthKeys = Array.from({ length: 12 }, (_, index) => {
      const monthNumber = ((index + 3) % 12) + 1
      const year = index < 9 ? fyStart : fyStart + 1
      return `${year}-${String(monthNumber).padStart(2, '0')}`
    })

    return monthKeys.map((monthKey) => {
      const monthRows = rows.filter((row) => row.date?.slice(0, 7) === monthKey && lockedDateSet.has(row.date))
      const enrollments = monthRows.reduce((sum, row) => sum + (Number(row.Enrollments) || 0), 0)
      const sale = monthRows.reduce((sum, row) => sum + (Number(row.Sale) || 0), 0)
      const currentRowPaidAmount = monthRows.reduce((sum, row) => sum + (Number(row['Paid amount']) || 0), 0)
      const paymentDetailEntries = Object.entries(monthPayments).flatMap(([sourceMonthKey, payment]) => {
        if (!payment || typeof payment !== 'object') {
          return EMPTY_LIST
        }

        const entries = []
        const sourceMonthRows = rows.filter(
          (row) => row.date?.slice(0, 7) === sourceMonthKey && lockedDateSet.has(row.date),
        )

        const billPaidMonth = getDateMonthKey(payment.billPaidDate)
        if (payment.billSubmitted && billPaidMonth === monthKey) {
          const sourceBillTotal = sourceMonthRows.reduce((sum, row) => sum + (Number(row.Bill) || 0), 0)
          entries.push({
            amount: sourceBillTotal,
            date: payment.billPaidDate,
          })
        }

        const remainingPaidMonth = getDateMonthKey(payment.remainingPaidDate)
        if (payment.remainingSubmitted && remainingPaidMonth === monthKey) {
          const sourceRemainingTotal = sourceMonthRows.reduce(
            (sum, row) => sum + (Number(row['Remaining amount']) || 0),
            0,
          )
          entries.push({
            amount: sourceRemainingTotal,
            date: payment.remainingPaidDate,
          })
        }

        return entries
      })

      const paymentDetailTotal = paymentDetailEntries.reduce((sum, entry) => sum + entry.amount, 0)

      return {
        month: monthKey,
        enrollments,
        sale,
        paidAmount: currentRowPaidAmount + paymentDetailTotal,
        remaining: sale - (currentRowPaidAmount + paymentDetailTotal),
      }
    })
  }, [isViewMode, lockedDateSet, monthPayments, rows, viewFy])

  const hoFyYearTotals = useMemo(() => {
    return hoFySummaryRows.reduce(
      (totals, item) => ({
        enrollments: totals.enrollments + item.enrollments,
        sale: totals.sale + item.sale,
        paidAmount: totals.paidAmount + item.paidAmount,
        remaining: totals.remaining + item.remaining,
      }),
      {
        enrollments: 0,
        sale: 0,
        paidAmount: 0,
        remaining: 0,
      },
    )
  }, [hoFySummaryRows])

  const billFySummaryRows = useMemo(() => {
    if (!isBillMode) {
      return EMPTY_LIST
    }

    const fyStart = Number(viewFy)
    if (!Number.isFinite(fyStart)) {
      return EMPTY_LIST
    }

    const monthKeys = Array.from({ length: 12 }, (_, index) => {
      const monthNumber = ((index + 3) % 12) + 1
      const year = index < 9 ? fyStart : fyStart + 1
      return `${year}-${String(monthNumber).padStart(2, '0')}`
    })

    const totalsByMonth = new Map()

    rows.forEach((row) => {
      const monthKey = row.date?.slice(0, 7)
      if (!monthKey) {
        return
      }

      const current = totalsByMonth.get(monthKey) || { operatorBill: 0 }
      const billValue = Number(row.Bill) || 0

      current.operatorBill += billValue

      totalsByMonth.set(monthKey, current)
    })

    return monthKeys.map((month) => {
      const totals = totalsByMonth.get(month) || { operatorBill: 0 }
      return {
        month,
        operatorBill: totals.operatorBill,
      }
    })
  }, [isBillMode, rows, viewFy])

  const billFyYearTotal = useMemo(() => {
    return billFySummaryRows.reduce((sum, row) => sum + row.operatorBill, 0)
  }, [billFySummaryRows])

  const hoNetAmount = selectedYearPayment.remainingSubmitted ? 0 : hoFyYearTotals.remaining

  const expenseManualRows = useMemo(() => {
    return expenseRows.filter((row) => !row.autoDeficitFrom)
  }, [expenseRows])

  const expenseMonthSummaryByMonth = useMemo(() => {
    const monthSet = new Set([
      ...expenseManualRows.map((row) => row.date?.slice(0, 7)).filter(Boolean),
      ...Object.keys(salaryByMonth || {}),
      ...Object.keys(otherIncomeByMonth || {}),
    ])

    const sortedMonths = [...monthSet]
      .filter((monthKey) => /^\d{4}-\d{2}$/.test(monthKey))
      .sort((a, b) => a.localeCompare(b))

    let carryForward = 0
    const summary = {}

    sortedMonths.forEach((monthKey) => {
      const monthRows = expenseManualRows.filter((row) => row.date?.slice(0, 7) === monthKey)
      const monthTotal = monthRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
      const salaryIncome = Number(salaryByMonth[monthKey] || 0)
      const otherIncome = Number(otherIncomeByMonth[monthKey] || 0)
      const totalIncome = salaryIncome + otherIncome
      const carryFromPrevious = carryForward
      const carryLabel = carryFromPrevious > 0 ? 'Surplus' : carryFromPrevious < 0 ? 'Deficit' : ''
      const carryAmount = Math.abs(carryFromPrevious)
      const balance = totalIncome - monthTotal + carryFromPrevious
      const isSubmitted = Boolean(submittedExpenseMonths[monthKey])

      summary[monthKey] = {
        monthTotal,
        totalIncome,
        carryFromPrevious,
        carryLabel,
        carryAmount,
        balance,
        submitted: isSubmitted,
      }

      carryForward = isSubmitted ? balance : 0
    })

    return summary
  }, [expenseManualRows, otherIncomeByMonth, salaryByMonth, submittedExpenseMonths])

  const visibleExpenseRows = useMemo(() => {
    const monthRows = expenseManualRows
      .filter((row) => row.date?.slice(0, 7) === expenseMonth)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    return monthRows.map((row, index) => ({
      ...row,
      sNo: index + 1,
    }))
  }, [expenseManualRows, expenseMonth])

  const expenseMonthTotal = useMemo(() => {
    return visibleExpenseRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  }, [visibleExpenseRows])

  const expenseMonthTotalIncome = Number(
    expenseMonthSummaryByMonth[expenseMonth]?.totalIncome
      ?? ((Number(salaryByMonth[expenseMonth] || 0)) + (Number(otherIncomeByMonth[expenseMonth] || 0))),
  )
  const expenseMonthCarryLabel = String(expenseMonthSummaryByMonth[expenseMonth]?.carryLabel || '')
  const expenseMonthCarryAmount = Number(expenseMonthSummaryByMonth[expenseMonth]?.carryAmount || 0)
  const expenseMonthSignedCarry = Number(expenseMonthSummaryByMonth[expenseMonth]?.carryFromPrevious || 0)
  const expenseMonthBalance = Number(
    expenseMonthSummaryByMonth[expenseMonth]?.balance
      ?? (expenseMonthTotalIncome - expenseMonthTotal + expenseMonthSignedCarry),
  )
  const isExpenseMonthSubmitted = Boolean(submittedExpenseMonths[expenseMonth])
  const isExpenseViewMode = expenseMode === 'view'

  const expenseViewFyOptions = useMemo(() => {
    const years = new Set([getFinancialYearStartYear(new Date().toISOString().slice(0, 10))])
    Object.keys(expenseMonthSummaryByMonth).forEach((monthKey) => {
      years.add(getFinancialYearStartYear(`${monthKey}-01`))
    })
    return [...years].sort((a, b) => b - a)
  }, [expenseMonthSummaryByMonth])

  const expenseViewFyRows = useMemo(() => {
    const fyStart = Number(expenseViewFy)
    if (!Number.isFinite(fyStart)) {
      return EMPTY_LIST
    }

    const monthKeys = Array.from({ length: 12 }, (_, index) => {
      const monthNumber = ((index + 3) % 12) + 1
      const year = index < 9 ? fyStart : fyStart + 1
      return `${year}-${String(monthNumber).padStart(2, '0')}`
    })

    return monthKeys
      .filter((monthKey) => Boolean(submittedExpenseMonths[monthKey]) && expenseMonthSummaryByMonth[monthKey])
      .map((monthKey) => ({
        month: monthKey,
        totalExpenses: Number(expenseMonthSummaryByMonth[monthKey]?.monthTotal || 0),
        balance: Number(expenseMonthSummaryByMonth[monthKey]?.balance || 0),
      }))
  }, [expenseMonthSummaryByMonth, expenseViewFy, submittedExpenseMonths])

  const visibleAadharIncomeRows = useMemo(() => {
    const monthRows = aadharIncomeRows
      .filter((row) => row.date?.slice(0, 7) === aadharIncomeMonth)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    return monthRows.map((row, index) => ({
      ...row,
      sNo: index + 1,
      type: row.type === 'Expense' ? 'Expense' : 'Income',
    }))
  }, [aadharIncomeMonth, aadharIncomeRows])

  const aadharIncomeSummaryByMonth = useMemo(() => {
    const monthKeys = new Set([aadharIncomeMonth])
    aadharIncomeRows.forEach((row) => {
      const monthKey = getDateMonthKey(row.date)
      if (monthKey) {
        monthKeys.add(monthKey)
      }
    })
    Object.keys(submittedAadharIncomeMonths || {}).forEach((monthKey) => {
      if (/^\d{4}-\d{2}$/.test(monthKey)) {
        monthKeys.add(monthKey)
      }
    })

    const orderedMonths = [...monthKeys].sort((a, b) => a.localeCompare(b))
    let runningCarry = 0

    return orderedMonths.reduce((summary, monthKey) => {
      const monthRows = aadharIncomeRows.filter((row) => getDateMonthKey(row.date) === monthKey)
      const totalIncome = monthRows
        .filter((row) => row.type !== 'Expense')
        .reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
      const totalExpenditure = monthRows
        .filter((row) => row.type === 'Expense')
        .reduce((sum, row) => sum + (Number(row.amount) || 0), 0)

      const carryFromPrevious = runningCarry
      const balance = totalIncome - totalExpenditure + carryFromPrevious
      const isSubmitted = Boolean(submittedAadharIncomeMonths[monthKey])

      summary[monthKey] = {
        totalIncome,
        totalExpenditure,
        carryFromPrevious,
        carryLabel: carryFromPrevious >= 0 ? 'Surplus' : 'Deficit',
        carryAmount: Math.abs(carryFromPrevious),
        balance,
        submitted: isSubmitted,
      }

      runningCarry = isSubmitted ? balance : 0
      return summary
    }, {})
  }, [aadharIncomeMonth, aadharIncomeRows, submittedAadharIncomeMonths])

  const aadharIncomeMonthTotalIncome = Number(aadharIncomeSummaryByMonth[aadharIncomeMonth]?.totalIncome || 0)
  const aadharIncomeMonthTotalExpenditure = Number(aadharIncomeSummaryByMonth[aadharIncomeMonth]?.totalExpenditure || 0)
  const aadharIncomeMonthCarryLabel = String(aadharIncomeSummaryByMonth[aadharIncomeMonth]?.carryLabel || 'Surplus')
  const aadharIncomeMonthCarryAmount = Number(aadharIncomeSummaryByMonth[aadharIncomeMonth]?.carryAmount || 0)
  const aadharIncomeMonthSignedCarry = Number(aadharIncomeSummaryByMonth[aadharIncomeMonth]?.carryFromPrevious || 0)
  const aadharIncomeMonthBalance = Number(
    aadharIncomeSummaryByMonth[aadharIncomeMonth]?.balance
      ?? (aadharIncomeMonthTotalIncome - aadharIncomeMonthTotalExpenditure + aadharIncomeMonthSignedCarry),
  )
  const isAadharIncomeMonthSubmitted = Boolean(submittedAadharIncomeMonths[aadharIncomeMonth])
  const isAadharIncomeViewMode = aadharIncomeMode === 'view'

  const aadharIncomeViewFyOptions = useMemo(() => {
    const years = new Set([getFinancialYearStartYear(new Date().toISOString().slice(0, 10))])
    Object.keys(aadharIncomeSummaryByMonth).forEach((monthKey) => {
      years.add(getFinancialYearStartYear(`${monthKey}-01`))
    })
    return [...years].sort((a, b) => b - a)
  }, [aadharIncomeSummaryByMonth])

  const aadharIncomeViewFyRows = useMemo(() => {
    const fyStart = Number(aadharIncomeViewFy)
    if (!Number.isFinite(fyStart)) {
      return EMPTY_LIST
    }

    const monthKeys = Array.from({ length: 12 }, (_, index) => {
      const monthNumber = ((index + 3) % 12) + 1
      const year = index < 9 ? fyStart : fyStart + 1
      return `${year}-${String(monthNumber).padStart(2, '0')}`
    })

    return monthKeys
      .filter((monthKey) => Boolean(submittedAadharIncomeMonths[monthKey]) && aadharIncomeSummaryByMonth[monthKey])
      .map((monthKey) => ({
        month: monthKey,
        totalIncome: Number(aadharIncomeSummaryByMonth[monthKey]?.totalIncome || 0),
        totalExpenditure: Number(aadharIncomeSummaryByMonth[monthKey]?.totalExpenditure || 0),
        balance: Number(aadharIncomeSummaryByMonth[monthKey]?.balance || 0),
      }))
  }, [aadharIncomeSummaryByMonth, aadharIncomeViewFy, submittedAadharIncomeMonths])

  useEffect(() => {
    setExpenseRows((previousRows) => {
      const manualRows = previousRows.filter((row) => !row.autoDeficitFrom)
      if (manualRows.length === previousRows.length) {
        return previousRows
      }

      return manualRows.map((row, index) => ({
        ...row,
        sNo: index + 1,
      }))
    })
  }, [])

  useEffect(() => {
    if (!isAadharTable || aadharMode !== 'entry') {
      return
    }

    const monthDates = getMonthDates(entryMonth)
    if (monthDates.length === 0) {
      return
    }

    const existingMonthRows = createMonthRowMap(rows, entryMonth)
    const existingMonthRowCount = rows.filter((row) => row.date?.slice(0, 7) === entryMonth).length
    if (existingMonthRows.length === monthDates.length && existingMonthRowCount === monthDates.length) {
      return
    }

    updateActiveTable((table) => {
      const rowColumns = table.id === 'aadhar' ? ['Date', ...table.columns] : table.columns
      const entryRows = monthDates.map((date, index) => {
        const existingRow = existingMonthRows.find((row) => row.date === date)
        if (existingRow) {
          return existingRow
        }

        const newRow = createRow(rowColumns, index + 1)
        newRow.date = date
        return newRow
      })

      const mergedRows = [
        ...table.rows.filter((row) => row.date?.slice(0, 7) !== entryMonth),
        ...entryRows,
      ]
      const normalizedRows = sortRowsByDate(mergedRows).map((row, index) => ({ ...row, sNo: index + 1 }))

      return {
        ...table,
        rows: normalizedRows,
      }
    })
  }, [aadharMode, entryMonth, isAadharTable, rows])

  function commitStateChange(nextTables, nextActiveTableId = activeTableId) {
    setTables(nextTables)
    setActiveTableId(nextActiveTableId)
  }

  function updateActiveTable(applyChanges) {
    const nextTables = tables.map((table) => {
      if (table.id !== activeTableId) {
        return table
      }
      return applyChanges(table)
    })

    commitStateChange(nextTables, activeTableId)
  }

  function updateCell(rowId, key, value) {
    updateActiveTable((table) => ({
      ...table,
      rows: sortRowsByDate(table.rows.map((row) => {
        if (row.id !== rowId) {
          return row
        }

        if (table.id === 'aadhar' && aadharMode === 'view') {
          return row
        }

        if (table.id === 'aadhar' && aadharMode === 'entry') {
          const rowDate = toDate(row.date)
          if (rowDate && rowDate.getDay() === 0) {
            return row
          }
        }

        if (table.id === 'aadhar' && Array.isArray(table.lockedMonths) && table.lockedMonths.includes(row.date?.slice(0, 7))) {
          return row
        }

        if (table.id === 'aadhar' && Array.isArray(table.lockedDates) && table.lockedDates.includes(row.date)) {
          return row
        }

        let updatedRow = { ...row, [key]: value }

        if (table.id === 'aadhar') {
          const sale = Number(updatedRow.Sale) || 0
          const bill = Number(updatedRow.Bill) || 0
          updatedRow.Total = sale - bill

          const total = updatedRow.Total
          const paid = Number(updatedRow['Paid amount']) || 0
          updatedRow['Remaining amount'] = total - paid
        }

        return updatedRow
      }), key === 'date'),
    }))
  }

  function toggleDateLock(dateValue, shouldLock) {
    if (!isAadharTable || !dateValue || aadharMode !== 'entry') {
      return
    }

    updateActiveTable((table) => {
      const previous = Array.isArray(table.lockedDates) ? table.lockedDates : []
      const next = shouldLock
        ? [...new Set([...previous, dateValue])]
        : previous.filter((lockedDate) => lockedDate !== dateValue)

      return {
        ...table,
        lockedDates: next.sort((a, b) => a.localeCompare(b)),
      }
    })
  }

  function updateExpenseCell(rowId, key, value) {
    setExpenseRows((previousRows) => previousRows.map((row) => {
      if (row.id !== rowId) {
        return row
      }
      if (row.autoDeficitFrom) {
        return row
      }
      return {
        ...row,
        [key]: value,
      }
    }))
  }

  function updateExpenseSalary(monthKey, value) {
    setSalaryByMonth((previous) => ({
      ...previous,
      [monthKey]: value,
    }))
  }

  function updateExpenseOtherIncome(monthKey, value) {
    setOtherIncomeByMonth((previous) => ({
      ...previous,
      [monthKey]: value,
    }))
  }

  function updateAadharIncomeCell(rowId, key, value) {
    setAadharIncomeRows((previousRows) => previousRows.map((row) => {
      if (row.id !== rowId) {
        return row
      }
      return {
        ...row,
        [key]: value,
      }
    }))
  }

  function addAadharIncomeRow() {
    setAadharIncomeRows((previousRows) => {
      const next = [...previousRows, createAadharIncomeRow(previousRows.length + 1, `${aadharIncomeMonth}-01`)]
      return next.map((row, index) => ({ ...row, sNo: index + 1 }))
    })
  }

  function submitAadharIncomeMonth() {
    setSubmittedAadharIncomeMonths((previous) => ({
      ...previous,
      [aadharIncomeMonth]: true,
    }))
  }

  function unlockAadharIncomeMonth() {
    setSubmittedAadharIncomeMonths((previous) => {
      const next = { ...previous }
      delete next[aadharIncomeMonth]
      return next
    })
  }

  function submitExpenseMonth() {
    setSubmittedExpenseMonths((previous) => ({
      ...previous,
      [expenseMonth]: true,
    }))
  }

  function unlockExpenseMonth() {
    setSubmittedExpenseMonths((previous) => {
      const next = { ...previous }
      delete next[expenseMonth]
      return next
    })
  }

  function addExpenseRow() {
    setExpenseRows((previousRows) => {
      const next = [...previousRows, createExpenseRow(previousRows.length + 1, `${expenseMonth}-01`)]
      return next.map((row, index) => ({ ...row, sNo: index + 1 }))
    })
  }

  function updateMonthPayment(field, value) {
    if (!isAadharTable || !selectedMonthKey) {
      return
    }

    updateActiveTable((table) => {
      const currentPayments = table.monthPayments && typeof table.monthPayments === 'object'
        ? table.monthPayments
        : {}
      const currentMonthPayment = currentPayments[selectedMonthKey] || {}

      return {
        ...table,
        monthPayments: {
          ...currentPayments,
          [selectedMonthKey]: {
            ...currentMonthPayment,
            [field]: value,
          },
        },
      }
    })
  }

  function updateYearPayment(field, value) {
    if (!isAadharTable || !selectedYearKey) {
      return
    }

    updateActiveTable((table) => {
      const currentPayments = table.yearPayments && typeof table.yearPayments === 'object'
        ? table.yearPayments
        : {}
      const currentYearPayment = currentPayments[selectedYearKey] || {}

      return {
        ...table,
        yearPayments: {
          ...currentPayments,
          [selectedYearKey]: {
            ...currentYearPayment,
            [field]: value,
          },
        },
      }
    })
  }

  // UPDATED: Now compresses the image before saving
  async function handlePaymentFileChange(target, file) {
    if (!file) {
      return
    }
    updateMonthPayment(`${target}ImageName`, file.name)
    try {
      const compressedBase64 = await compressImageFile(file)
      updateMonthPayment(`${target}ImageData`, compressedBase64)
    } catch (err) {
      console.error('Compression failed', err)
    }
  }

  // UPDATED: Now compresses the image before saving
  async function handleYearPaymentFileChange(target, file) {
    if (!file) {
      return
    }
    updateYearPayment(`${target}ImageName`, file.name)
    try {
      const compressedBase64 = await compressImageFile(file)
      updateYearPayment(`${target}ImageData`, compressedBase64)
    } catch (err) {
      console.error('Compression failed', err)
    }
  }

  function submitMonthPayment(target) {
    if (!isAadharTable || isViewMode || selectedMonthLocked) {
      return
    }

    const isBill = target === 'bill'
    const checkedField = isBill ? 'billPaid' : 'remainingPaid'
    const dateField = isBill ? 'billPaidDate' : 'remainingPaidDate'
    const imageField = isBill ? 'billImageData' : 'remainingImageData'
    const submittedField = isBill ? 'billSubmitted' : 'remainingSubmitted'
    const alreadySubmitted = Boolean(selectedMonthPayment[submittedField])

    if (alreadySubmitted) {
      return
    }

    if (!selectedMonthPayment[checkedField]) {
      window.alert('Please check the paid checkbox before submitting.')
      return
    }

    if (!selectedMonthPayment[dateField]) {
      window.alert('Please select the paid date before submitting.')
      return
    }

    if (!selectedMonthPayment[imageField]) {
      window.alert('Please upload the bill photo before submitting.')
      return
    }

    updateMonthPayment(submittedField, true)
  }

  function submitYearPayment(target) {
    if (!isAadharTable || !isViewMode || !selectedYearKey) {
      return
    }

    if (target !== 'remaining') {
      return
    }

    const checkedField = 'remainingPaid'
    const dateField = 'remainingPaidDate'
    const imageField = 'remainingImageData'
    const submittedField = 'remainingSubmitted'
    const alreadySubmitted = Boolean(selectedYearPayment[submittedField])

    if (alreadySubmitted) {
      return
    }

    if (!selectedYearPayment[checkedField]) {
      window.alert('Please check the paid checkbox before submitting.')
      return
    }

    if (!selectedYearPayment[dateField]) {
      window.alert('Please select the paid date before submitting.')
      return
    }

    if (!selectedYearPayment[imageField]) {
      window.alert('Please upload the bill photo before submitting.')
      return
    }

    updateYearPayment(submittedField, true)
  }

  function submitEntryMonth() {
    if (!isAadharTable) {
      return
    }

    if (entryMonthLocked) {
      return
    }

    const shouldSubmit = window.confirm(`Submit ${entryMonth}? After submission, this month will be locked.`)
    if (!shouldSubmit) {
      return
    }

    updateActiveTable((table) => {
      const previous = Array.isArray(table.lockedMonths) ? table.lockedMonths : []
      if (previous.includes(entryMonth)) {
        return table
      }
      return {
        ...table,
        lockedMonths: [...previous, entryMonth].sort((a, b) => a.localeCompare(b)),
      }
    })
  }

  function unlockEntryMonth() {
    if (!isAadharTable || !entryMonthLocked) {
      return
    }

    const shouldUnlock = window.confirm(`Unlock ${entryMonth}? You can edit this month again.`)
    if (!shouldUnlock) {
      return
    }

    updateActiveTable((table) => {
      const previous = Array.isArray(table.lockedMonths) ? table.lockedMonths : []
      const previousPayments = table.monthPayments && typeof table.monthPayments === 'object'
        ? table.monthPayments
        : {}
      const { [entryMonth]: _removedMonthPayment, ...remainingPayments } = previousPayments

      return {
        ...table,
        lockedMonths: previous.filter((month) => month !== entryMonth),
        monthPayments: remainingPayments,
      }
    })
  }

  function getFilteredRowsByDate(tableRows, startDate, endDate) {
    if (!startDate && !endDate) {
      return tableRows
    }
    return tableRows.filter((row) => {
      const rowDate = row.date
      if (!rowDate) return false
      if (startDate && rowDate < startDate) return false
      if (endDate && rowDate > endDate) return false
      return true
    })
  }

  async function exportToPDF() {
    const baseRows = isAadharTable ? visibleRows : rows
    const filteredRows = getFilteredRowsByDate(baseRows, exportStartDate, exportEndDate)
    if (filteredRows.length === 0) {
      window.alert('No data to export for the selected date range.')
      return
    }
    const { jsPDF, autoTable } = await loadPdfTools()
    const doc = new jsPDF()
    const tableName = activeTable?.name || 'Table'
    doc.setFontSize(18)
    doc.text(tableName, 14, 22)
    if (exportStartDate || exportEndDate) {
      doc.setFontSize(10)
      let dateRangeText = 'Date Range: '
      if (exportStartDate && exportEndDate) {
        dateRangeText += `${exportStartDate} to ${exportEndDate}`
      } else if (exportStartDate) {
        dateRangeText += `From ${exportStartDate}`
      } else if (exportEndDate) {
        dateRangeText += `Until ${exportEndDate}`
      }
      doc.text(dateRangeText, 14, 30)
    }
    const headers = ['Date', ...columns]
    const data = filteredRows.map((row) => {
      return [
        row.date || '',
        ...columns.map((col) => row[col] || ''),
      ]
    })
    autoTable(doc, {
      head: [headers],
      body: data,
      startY: exportStartDate || exportEndDate ? 35 : 30,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [41, 128, 185] },
    })
    doc.save(`${tableName}_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  async function exportToExcel() {
    const baseRows = isAadharTable ? visibleRows : rows
    const filteredRows = getFilteredRowsByDate(baseRows, exportStartDate, exportEndDate)
    if (filteredRows.length === 0) {
      window.alert('No data to export for the selected date range.')
      return
    }
    const XLSX = await loadXlsxModule()
    const tableName = activeTable?.name || 'Table'
    const data = filteredRows.map((row) => {
      return {
        'Date': row.date || '',
        ...columns.reduce((acc, col) => {
          acc[col] = row[col] || ''
          return acc
        }, {}),
      }
    })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, tableName)
    XLSX.writeFile(wb, `${tableName}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  async function exportSelectedMonthToPDF() {
    if (!isAadharTable || isViewMode || !selectedMonthKey) {
      return
    }

    const monthRows = rows
      .filter((row) => row.date?.slice(0, 7) === selectedMonthKey)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    if (monthRows.length === 0) {
      window.alert('No month data to export.')
      return
    }

    const { jsPDF, autoTable } = await loadPdfTools()
    const doc = new jsPDF()
    const tableName = activeTable?.name || 'Table'
    doc.setFontSize(16)
    doc.text(`${tableName} - ${selectedMonthKey}`, 14, 20)

    const headers = ['Date', ...columns]
    const data = monthRows.map((row) => [
      row.date || '',
      ...columns.map((col) => row[col] || ''),
    ])

    autoTable(doc, {
      head: [headers],
      body: data,
      startY: 26,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [41, 128, 185] },
    })

    doc.save(`${tableName}_${selectedMonthKey}_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  async function exportSelectedMonthToExcel() {
    if (!isAadharTable || isViewMode || !selectedMonthKey) {
      return
    }

    const monthRows = rows
      .filter((row) => row.date?.slice(0, 7) === selectedMonthKey)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    if (monthRows.length === 0) {
      window.alert('No month data to export.')
      return
    }

    const XLSX = await loadXlsxModule()
    const tableName = activeTable?.name || 'Table'
    const data = monthRows.map((row) => ({
      Date: row.date || '',
      ...columns.reduce((acc, col) => {
        acc[col] = row[col] || ''
        return acc
      }, {}),
    }))

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, selectedMonthKey)
    XLSX.writeFile(wb, `${tableName}_${selectedMonthKey}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  async function exportFyToPDF() {
    if (!isAadharTable || !isViewMode) {
      return
    }

    if (hoFySummaryRows.length === 0) {
      window.alert('No FY data to export.')
      return
    }

    const { jsPDF, autoTable } = await loadPdfTools()
    const doc = new jsPDF()
    const fyLabel = formatFinancialYear(Number(viewFy))

    doc.setFontSize(16)
    doc.text(`Aadhar HO Summary - ${fyLabel}`, 14, 20)

    const headers = ['Month', 'Enrollments', 'Total Sale', 'Paid Amount', 'HO Remaining']
    const body = hoFySummaryRows.map((item) => ([
      formatMonthKey(item.month),
      item.enrollments.toFixed(2),
      item.sale.toFixed(2),
      item.paidAmount.toFixed(2),
      item.remaining.toFixed(2),
    ]))

    body.push([
      'Year Total',
      hoFyYearTotals.enrollments.toFixed(2),
      hoFyYearTotals.sale.toFixed(2),
      hoFyYearTotals.paidAmount.toFixed(2),
      hoFyYearTotals.remaining.toFixed(2),
    ])

    autoTable(doc, {
      head: [headers],
      body,
      startY: 26,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [41, 128, 185] },
    })

    doc.save(`Aadhar_HO_${fyLabel}_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  async function exportFyToExcel() {
    if (!isAadharTable || !isViewMode) {
      return
    }

    if (hoFySummaryRows.length === 0) {
      window.alert('No FY data to export.')
      return
    }

    const XLSX = await loadXlsxModule()
    const fyLabel = formatFinancialYear(Number(viewFy))
    const data = hoFySummaryRows.map((item) => ({
      Month: formatMonthKey(item.month),
      Enrollments: Number(item.enrollments.toFixed(2)),
      'Total Sale': Number(item.sale.toFixed(2)),
      'Paid Amount': Number(item.paidAmount.toFixed(2)),
      'HO Remaining': Number(item.remaining.toFixed(2)),
    }))

    data.push({
      Month: 'Year Total',
      Enrollments: Number(hoFyYearTotals.enrollments.toFixed(2)),
      'Total Sale': Number(hoFyYearTotals.sale.toFixed(2)),
      'Paid Amount': Number(hoFyYearTotals.paidAmount.toFixed(2)),
      'HO Remaining': Number(hoFyYearTotals.remaining.toFixed(2)),
    })

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'HO Summary')
    XLSX.writeFile(wb, `Aadhar_HO_${fyLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function openFeature(featureId) {
    if (featureId === 'aadhar' || featureId === 'expenses' || featureId === 'aadhar-income') {
      setSelectedFeature(featureId)
      return
    }

    window.alert('This feature card will be enabled soon.')
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="top-nav-inner">
          <div className="brand">
            <img src={lavaLogo} alt="లావాదేవి logo" className="brand-logo" />
          </div>
        </div>
      </header>

      <section className="page">
        {selectedFeature === null ? (
          <>
            <div className="feature-card-grid">
              {HOME_FEATURE_CARDS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className={card.id === 'aadhar' || card.id === 'expenses' || card.id === 'aadhar-income' ? 'feature-card active' : 'feature-card'}
                  onClick={() => openFeature(card.id)}
                >
                  {card.id === 'aadhar' && (
                    <img src={aadharCardImage} alt="Aadhar" className="feature-card-image" />
                  )}
                  <h3>{card.name}</h3>
                  {card.id !== 'aadhar' && card.id !== 'expenses' && card.id !== 'aadhar-income' && <span className="feature-badge">Coming Soon</span>}
                </button>
              ))}
            </div>
          </>
        ) : selectedFeature === 'aadhar' ? (
          <>
            <div className="feature-page-head">
              <button
                type="button"
                className="back-home-btn"
                onClick={() => setSelectedFeature(null)}
              >
                Home
              </button>
              <h2>Aadhar</h2>
            </div>

          {isAadharTable && (
            <div className="panel mode-panel">
              <div className="mode-toggle" role="tablist" aria-label="Aadhar mode">
                <button
                  type="button"
                  className={aadharMode === 'entry' ? 'mode-btn active' : 'mode-btn'}
                  onClick={() => setAadharMode('entry')}
                >
                  Operator
                </button>
                <button
                  type="button"
                  className={aadharMode === 'view' ? 'mode-btn active' : 'mode-btn'}
                  onClick={() => setAadharMode('view')}
                >
                  HO
                </button>
                <button
                  type="button"
                  className={aadharMode === 'bill' ? 'mode-btn active' : 'mode-btn'}
                  onClick={() => setAadharMode('bill')}
                >
                  Bill
                </button>
              </div>

              {aadharMode === 'entry' ? (
                <div className="mode-month-stack">
                  <div className="mode-month-field">
                    <label htmlFor="entry-month">Select Month:</label>
                    <input
                      id="entry-month"
                      type="month"
                      value={entryMonth}
                      onChange={(event) => setEntryMonth(event.target.value)}
                    />
                  </div>
                  <div className="month-amount-stack">
                    <div className="month-net-total">
                      <span>నికర మొత్తం</span>
                      <strong>₹{formatRupees(monthNetTotal)}</strong>
                    </div>
                  </div>
                </div>
              ) : aadharMode === 'view' ? (
                <div className="mode-month-stack">
                  <div className="mode-month-field">
                    <label htmlFor="view-fy">FY:</label>
                    <select
                      id="view-fy"
                      value={viewFy}
                      onChange={(event) => setViewFy(event.target.value)}
                    >
                      {fyOptions.map((year) => (
                        <option key={year} value={String(year)}>
                          {formatFinancialYear(year)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="month-amount-stack">
                    <div className="month-ho-total">
                      <span>HO నికర మొత్తం</span>
                      <strong>₹{formatRupees(hoNetAmount)}</strong>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mode-month-stack">
                  <div className="mode-month-field">
                    <label htmlFor="bill-fy">FY:</label>
                    <select
                      id="bill-fy"
                      value={viewFy}
                      onChange={(event) => setViewFy(event.target.value)}
                    >
                      {fyOptions.map((year) => (
                        <option key={year} value={String(year)}>
                          {formatFinancialYear(year)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="month-amount-stack">
                    <div className="month-bill-total">
                      <span>Bill FY Total</span>
                      <strong>₹{formatRupees(billFyYearTotal)}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {showExportControls && !isViewMode && (
            <div className="export-section">
              <h3>Export Data</h3>
              <div className="export-layout">
                <div className="export-buttons">
                  <button type="button" onClick={exportToPDF} className="export-pdf">
                    Export PDF
                  </button>
                  <button type="button" onClick={exportToExcel} className="export-excel">
                    Export Excel
                  </button>
                </div>

                <div className="date-box">
                  <div className="date-filters">
                    <div className="date-field">
                      <label>From Date:</label>
                      <input
                        type="date"
                        value={exportStartDate}
                        onChange={(e) => setExportStartDate(e.target.value)}
                      />
                    </div>
                    <div className="date-field">
                      <label>To Date:</label>
                      <input
                        type="date"
                        value={exportEndDate}
                        onChange={(e) => setExportEndDate(e.target.value)}
                      />
                    </div>
                  </div>

                  {(exportStartDate || exportEndDate) && (
                    <p className="date-range-display">
                      Showing data from{' '}
                      {exportStartDate || 'beginning'}:{' '}
                      {exportEndDate || 'today'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {isAadharTable && isBillMode && (
            <div className="panel bill-summary-card">
              <div className="panel-head bill-card-head">
                <h2>Bill Card</h2>
                <p className="mode-hint">Month wise total bill for selected FY.</p>
              </div>

              {billFySummaryRows.length === 0 ? (
                <p className="mode-hint">No bill data available yet.</p>
              ) : (
                <div className="fy-summary-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Total Bill</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billFySummaryRows.map((item) => (
                        <tr key={`bill-${item.month}`}>
                          <td>{formatMonthKey(item.month)}</td>
                          <td>₹{formatRupees(item.operatorBill)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="fy-total-row">
                        <td>Year Total</td>
                        <td>₹{formatRupees(billFyYearTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {isAadharTable && isViewMode ? (
          <div className="panel ho-summary-panel">
            <div className="fy-summary-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Enrollments</th>
                    <th>Total Sale</th>
                    <th>Paid Amount</th>
                    <th>HO Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {hoFySummaryRows.map((item) => (
                    <tr key={item.month}>
                      <td>{formatMonthKey(item.month)}</td>
                      <td>{item.enrollments.toFixed(2)}</td>
                      <td>₹{formatRupees(item.sale)}</td>
                      <td>₹{formatRupees(item.paidAmount)}</td>
                      <td>₹{formatRupees(item.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="fy-total-row">
                    <td>Year Total</td>
                    <td>{hoFyYearTotals.enrollments.toFixed(2)}</td>
                    <td>₹{formatRupees(hoFyYearTotals.sale)}</td>
                    <td>₹{formatRupees(hoFyYearTotals.paidAmount)}</td>
                    <td>₹{formatRupees(hoFyYearTotals.remaining)}</td>
                  </tr>
                  <tr className="month-payment-row year-payment-row">
                    <td className="month-payment-label" colSpan={4}>
                      Year Payment Details
                      <div className="export-buttons">
                        <button type="button" onClick={exportFyToPDF} className="export-pdf">
                          Export FY PDF
                        </button>
                        <button type="button" onClick={exportFyToExcel} className="export-excel">
                          Export FY Excel
                        </button>
                      </div>
                    </td>
                    <td className="month-payment-cell">
                      <label className="payment-inline-check">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedYearPayment.remainingPaid)}
                          disabled={!isViewMode || Boolean(selectedYearPayment.remainingSubmitted)}
                          onChange={(event) => updateYearPayment('remainingPaid', event.target.checked)}
                        />
                        Remaining Paid
                      </label>
                      <input
                        type="date"
                        value={selectedYearPayment.remainingPaidDate || ''}
                        disabled={!isViewMode || Boolean(selectedYearPayment.remainingSubmitted)}
                        onChange={(event) => updateYearPayment('remainingPaidDate', event.target.value)}
                      />
                      <input
                        type="file"
                        accept="image/*"
                        disabled={!isViewMode || Boolean(selectedYearPayment.remainingSubmitted)}
                        onChange={(event) => handleYearPaymentFileChange('remaining', event.target.files?.[0])}
                      />
                      <button
                        type="button"
                        className="payment-submit-btn"
                        disabled={!isViewMode || Boolean(selectedYearPayment.remainingSubmitted)}
                        onClick={() => submitYearPayment('remaining')}
                      >
                        {selectedYearPayment.remainingSubmitted ? 'Submitted' : 'Submit Remaining Payment'}
                      </button>
                      {selectedYearPayment.remainingImageName && (
                        <span className="payment-file-name">{selectedYearPayment.remainingImageName}</span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          ) : !isBillMode ? (
          <div className={aadharMode === 'view' ? 'sheet-wrap view-mode' : 'sheet-wrap'}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                  {isAadharTable && aadharMode === 'entry' && <th>Lock Date</th>}
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + (isAadharTable && aadharMode === 'entry' ? 2 : 1)} className="empty-row">
                      {isViewMode && !isViewMonthSubmitted
                        ? 'This month is not submitted yet. Submit it in Entry mode to view and export.'
                        : 'No records found for this month.'}
                    </td>
                  </tr>
                )}

                {visibleRows.map((row) => {
                  const parsedDate = toDate(row.date)
                  const isSunday = parsedDate ? parsedDate.getDay() === 0 : false
                  const isEntrySundayLocked = isAadharTable && aadharMode === 'entry' && isSunday
                  const isDateLocked = isAadharTable && lockedDateSet.has(row.date)
                  const isRowLocked = isAadharTable && (lockedMonths.includes(row.date?.slice(0, 7)) || isDateLocked)
                  const isZeroRow = isAadharTable && aadharMode === 'entry' && isAllColumnsZero(row, columns)
                  const rowClassName = `${isSunday ? 'sunday-row ' : ''}${isRowLocked ? 'locked-row ' : ''}${isZeroRow ? 'zero-row' : ''}`.trim()

                  return (
                  <tr key={row.id} className={rowClassName}>
                    <td>
                      <input
                        type="date"
                        value={row.date || ''}
                        className={row.date === currentDate ? 'today-date' : ''}
                        readOnly={(isAadharTable && aadharMode === 'entry') || isRowLocked || isEntrySundayLocked}
                        onChange={(event) => updateCell(row.id, 'date', event.target.value)}
                        required
                      />
                    </td>
                    {columns.map((column) => (
                      <td key={`${row.id}-${column}`}>
                        {column === 'Type' ? (
                          <select
                            value={row[column] ?? 'Expenditure'}
                            disabled={isViewMode || isRowLocked || isEntrySundayLocked}
                            onChange={(event) => updateCell(row.id, column, event.target.value)}
                            required
                          >
                            <option value="Expenditure">Expenditure</option>
                            <option value="Income">Income</option>
                          </select>
                        ) : column === 'Remaining amount' || column === 'Total' ? (
                          <input
                            type="text"
                            value={row[column] ?? ''}
                            readOnly
                            className="calculated"
                          />
                        ) : (
                          <input
                            type="text"
                            inputMode={column === 'Amount' || column === 'Enrollments' || column === 'Sale' || column === 'Bill' || column === 'Paid amount' ? 'decimal' : 'text'}
                            value={row[column] ?? ''}
                            readOnly={isViewMode || isRowLocked || isEntrySundayLocked}
                            className={
                              !isViewMode && !isRowLocked && !isEntrySundayLocked && column !== 'Description' && String(row[column] ?? '').trim() === ''
                                ? 'required-missing'
                                : ''
                            }
                            required={column !== 'Description'}
                            onChange={(event) => {
                              if (column === 'Amount' || column === 'Enrollments' || column === 'Sale' || column === 'Bill' || column === 'Paid amount') {
                                const nextValue = event.target.value
                                if (!/^\d*\.?\d*$/.test(nextValue)) {
                                  return
                                }
                                updateCell(row.id, column, nextValue)
                                return
                              }
                              updateCell(row.id, column, event.target.value)
                            }}
                          />
                        )}
                      </td>
                    ))}
                    {isAadharTable && aadharMode === 'entry' && (
                      <td>
                        <input
                          type="checkbox"
                          checked={isDateLocked}
                          disabled={isEntrySundayLocked || !row.date}
                          onChange={(event) => toggleDateLock(row.date, event.target.checked)}
                          aria-label={`Lock ${row.date}`}
                        />
                      </td>
                    )}
                  </tr>
                  )
                })}
              </tbody>
              {visibleRows.length > 0 && (
                <tfoot>
                  <tr className="month-total-row">
                    <td className="month-total-label">Month Total</td>
                    {columns.map((column) => (
                      <td key={`total-${column}`} className="month-total-cell">{monthTotals[column] ?? '-'}</td>
                    ))}
                    {isAadharTable && aadharMode === 'entry' && (
                      <td className="month-total-cell">-</td>
                    )}
                  </tr>
                  <tr className="month-payment-row">
                    <td className="month-payment-label">
                      Month Payment Details
                      {!isViewMode && (
                        <div className="export-buttons">
                          <button type="button" onClick={exportSelectedMonthToPDF} className="export-pdf">
                            Export Month PDF
                          </button>
                          <button type="button" onClick={exportSelectedMonthToExcel} className="export-excel">
                            Export Month Excel
                          </button>
                        </div>
                      )}
                    </td>
                    {columns.map((column) => {
                      if (column === 'Bill') {
                        return (
                          <td key="payment-bill" className="month-payment-cell">
                            <label className="payment-inline-check">
                              <input
                                type="checkbox"
                                checked={Boolean(selectedMonthPayment.billPaid)}
                                disabled={isViewMode || selectedMonthLocked || Boolean(selectedMonthPayment.billSubmitted)}
                                onChange={(event) => updateMonthPayment('billPaid', event.target.checked)}
                              />
                              Bill Paid
                            </label>
                            <input
                              type="date"
                              value={selectedMonthPayment.billPaidDate || ''}
                              disabled={isViewMode || selectedMonthLocked || Boolean(selectedMonthPayment.billSubmitted)}
                              onChange={(event) => updateMonthPayment('billPaidDate', event.target.value)}
                            />
                            <input
                              type="file"
                              accept="image/*"
                              disabled={isViewMode || selectedMonthLocked || Boolean(selectedMonthPayment.billSubmitted)}
                              onChange={(event) => handlePaymentFileChange('bill', event.target.files?.[0])}
                            />
                            {!isViewMode && (
                              <button
                                type="button"
                                className="payment-submit-btn"
                                disabled={selectedMonthLocked || Boolean(selectedMonthPayment.billSubmitted)}
                                onClick={() => submitMonthPayment('bill')}
                              >
                                {selectedMonthPayment.billSubmitted ? 'Submitted' : 'Submit Bill Payment'}
                              </button>
                            )}
                            {selectedMonthPayment.billImageName && (
                              <span className="payment-file-name">{selectedMonthPayment.billImageName}</span>
                            )}
                          </td>
                        )
                      }

                      if (column === 'Remaining amount') {
                        return (
                          <td key="payment-remaining" className="month-payment-cell">
                            <label className="payment-inline-check">
                              <input
                                type="checkbox"
                                checked={Boolean(selectedMonthPayment.remainingPaid)}
                                disabled={isViewMode || selectedMonthLocked || Boolean(selectedMonthPayment.remainingSubmitted)}
                                onChange={(event) => updateMonthPayment('remainingPaid', event.target.checked)}
                              />
                              Remaining Paid
                            </label>
                            <input
                              type="date"
                              value={selectedMonthPayment.remainingPaidDate || ''}
                              disabled={isViewMode || selectedMonthLocked || Boolean(selectedMonthPayment.remainingSubmitted)}
                              onChange={(event) => updateMonthPayment('remainingPaidDate', event.target.value)}
                            />
                            <input
                              type="file"
                              accept="image/*"
                              disabled={isViewMode || selectedMonthLocked || Boolean(selectedMonthPayment.remainingSubmitted)}
                              onChange={(event) => handlePaymentFileChange('remaining', event.target.files?.[0])}
                            />
                            {!isViewMode && (
                              <button
                                type="button"
                                className="payment-submit-btn"
                                disabled={selectedMonthLocked || Boolean(selectedMonthPayment.remainingSubmitted)}
                                onClick={() => submitMonthPayment('remaining')}
                              >
                                {selectedMonthPayment.remainingSubmitted ? 'Submitted' : 'Submit Remaining Payment'}
                              </button>
                            )}
                            {selectedMonthPayment.remainingImageName && (
                              <span className="payment-file-name">{selectedMonthPayment.remainingImageName}</span>
                            )}
                          </td>
                        )
                      }

                      return <td key={`payment-empty-${column}`} className="month-payment-empty">-</td>
                    })}
                    {isAadharTable && aadharMode === 'entry' && (
                      <td className="month-payment-empty">-</td>
                    )}
                  </tr>
                </tfoot>
              )}
            </table>
            {showExportControls && (exportStartDate || exportEndDate) && (
              <div className="table-footer">
                <span>
                  Date Filter: {exportStartDate || 'Beginning'} to {exportEndDate || 'Today'}
                </span>
              </div>
            )}
          </div>
          ) : null}

          {isAadharTable && aadharMode === 'entry' && (
            <div className="mode-submit-wrap table-end-submit">
              <button
                type="button"
                className="submit-month-btn"
                onClick={submitEntryMonth}
                disabled={entryMonthLocked}
              >
                {entryMonthLocked ? 'Month Submitted' : 'Submit Month'}
              </button>
              <span className={entryMonthLocked ? 'mode-lock-badge locked' : 'mode-lock-badge'}>
                {entryMonthLocked ? 'Locked' : 'Unlocked'}
              </span>
              {entryMonthLocked && (
                <button
                  type="button"
                  className="unlock-month-btn"
                  onClick={unlockEntryMonth}
                >
                  Unlock Month
                </button>
              )}
            </div>
          )}
          </>
        ) : selectedFeature === 'expenses' ? (
          <>
            <div className="feature-page-head">
              <button
                type="button"
                className="back-home-btn"
                onClick={() => setSelectedFeature(null)}
              >
                Home
              </button>
              <h2>Expenses</h2>
            </div>

            <div className="panel expenses-panel">
              <div className="mode-toggle" role="tablist" aria-label="Expenses mode">
                <button
                  type="button"
                  className={expenseMode === 'entry' ? 'mode-btn active' : 'mode-btn'}
                  onClick={() => setExpenseMode('entry')}
                >
                  Entry
                </button>
                <button
                  type="button"
                  className={expenseMode === 'view' ? 'mode-btn active' : 'mode-btn'}
                  onClick={() => setExpenseMode('view')}
                >
                  View
                </button>
              </div>

              {isExpenseViewMode ? (
                <div className="expenses-view-stack">
                  <div className="expenses-controls">
                    <div className="mode-month-field">
                      <label htmlFor="expenses-view-fy">FY:</label>
                      <select
                        id="expenses-view-fy"
                        value={expenseViewFy}
                        onChange={(event) => setExpenseViewFy(event.target.value)}
                      >
                        {expenseViewFyOptions.map((year) => (
                          <option key={year} value={String(year)}>
                            {formatFinancialYear(year)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="sheet-wrap expenses-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Total Expenses</th>
                          <th>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenseViewFyRows.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="empty-row">No submitted months in selected FY.</td>
                          </tr>
                        ) : (
                          expenseViewFyRows.map((row) => (
                            <tr key={row.month}>
                              <td>{formatMonthKey(row.month)}</td>
                              <td>₹{formatRupees(row.totalExpenses)}</td>
                              <td className={row.balance < 0 ? 'expense-balance-negative' : 'expense-balance-positive'}>
                                ₹{formatRupees(row.balance)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <>
                  <div className="expenses-controls">
                    <div className="mode-month-field">
                      <label htmlFor="expenses-month">Select Month:</label>
                      <input
                        id="expenses-month"
                        type="month"
                        value={expenseMonth}
                        onChange={(event) => setExpenseMonth(event.target.value)}
                      />
                    </div>
                    <button type="button" className="submit-month-btn" onClick={addExpenseRow} disabled={isExpenseMonthSubmitted}>
                      +
                    </button>
                  </div>

                  <div className="sheet-wrap expenses-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>S.No</th>
                          <th>Item</th>
                          <th>Amount</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleExpenseRows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="empty-row">No expenses for this month. Add a row to begin.</td>
                          </tr>
                        ) : (
                          visibleExpenseRows.map((row) => (
                            <tr key={row.id}>
                              <td>{row.sNo}</td>
                              <td>
                                <input
                                  type="text"
                                  value={row.item}
                                  readOnly={isExpenseViewMode || isExpenseMonthSubmitted || Boolean(row.autoDeficitFrom)}
                                  onChange={(event) => updateExpenseCell(row.id, 'item', event.target.value)}
                                />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={row.amount}
                                  readOnly={isExpenseViewMode || isExpenseMonthSubmitted || Boolean(row.autoDeficitFrom)}
                                  onChange={(event) => {
                                    if (isExpenseViewMode || isExpenseMonthSubmitted || row.autoDeficitFrom) {
                                      return
                                    }
                                    const nextValue = event.target.value
                                    if (!/^\d*\.?\d*$/.test(nextValue)) {
                                      return
                                    }
                                    updateExpenseCell(row.id, 'amount', nextValue)
                                  }}
                                  placeholder="0.00"
                                />
                              </td>
                              <td>
                                <input
                                  type="date"
                                  value={row.date}
                                  readOnly={isExpenseViewMode || isExpenseMonthSubmitted || Boolean(row.autoDeficitFrom)}
                                  onChange={(event) => updateExpenseCell(row.id, 'date', event.target.value)}
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {visibleExpenseRows.length > 0 && (
                        <tfoot>
                          <tr className="month-total-row">
                            <td colSpan={2} className="month-total-label expenses-lowercase-label">Salary</td>
                            <td className="month-total-cell">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={salaryByMonth[expenseMonth] ?? ''}
                                readOnly={isExpenseViewMode || isExpenseMonthSubmitted}
                                onChange={(event) => {
                                  if (isExpenseViewMode || isExpenseMonthSubmitted) {
                                    return
                                  }
                                  const nextValue = event.target.value
                                  if (!/^\d*\.?\d*$/.test(nextValue)) {
                                    return
                                  }
                                  updateExpenseSalary(expenseMonth, nextValue)
                                }}
                                placeholder="0"
                              />
                            </td>
                            <td className="month-total-cell">-</td>
                          </tr>
                          <tr className="month-total-row">
                            <td colSpan={2} className="month-total-label expenses-lowercase-label">Other income</td>
                            <td className="month-total-cell">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={otherIncomeByMonth[expenseMonth] ?? ''}
                                readOnly={isExpenseViewMode || isExpenseMonthSubmitted}
                                onChange={(event) => {
                                  if (isExpenseViewMode || isExpenseMonthSubmitted) {
                                    return
                                  }
                                  const nextValue = event.target.value
                                  if (!/^\d*\.?\d*$/.test(nextValue)) {
                                    return
                                  }
                                  updateExpenseOtherIncome(expenseMonth, nextValue)
                                }}
                                placeholder="0"
                              />
                            </td>
                            <td className="month-total-cell">-</td>
                          </tr>
                          <tr className="month-total-row salary-row">
                            <td colSpan={2} className="month-total-label expenses-lowercase-label">Month total</td>
                            <td className="month-total-cell">₹{formatRupees(expenseMonthTotal)}</td>
                            <td className="month-total-cell">-</td>
                          </tr>
                          {expenseMonthCarryAmount > 0 && (
                            <tr className={expenseMonthCarryLabel === 'Surplus' ? 'month-total-row bank-balance-row' : 'month-total-row deficit-expense-row'}>
                              <td colSpan={2} className="month-total-label expenses-lowercase-label">{expenseMonthCarryLabel}</td>
                              <td className="month-total-cell">₹{formatRupees(expenseMonthCarryAmount)}</td>
                              <td className="month-total-cell">-</td>
                            </tr>
                          )}
                          <tr className={expenseMonthBalance < 0 ? 'month-total-row balance-row deficit' : 'month-total-row balance-row'}>
                            <td colSpan={2} className="month-total-label expenses-lowercase-label">Balance</td>
                            <td className="month-total-cell">₹{formatRupees(expenseMonthBalance)}</td>
                            <td className="month-total-cell">
                              {expenseMonthBalance !== 0
                                ? isExpenseMonthSubmitted
                                  ? `${expenseMonthBalance > 0 ? 'Surplus' : 'Deficit'} carried to ${getNextMonthKey(expenseMonth)}`
                                  : 'Submit to carry forward'
                                : '-'}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>

                  <div className="mode-submit-wrap table-end-submit">
                    <button
                      type="button"
                      className="submit-month-btn"
                      onClick={submitExpenseMonth}
                      disabled={isExpenseMonthSubmitted}
                    >
                      {isExpenseMonthSubmitted ? 'Submitted' : 'Submit Month'}
                    </button>
                    <span className={isExpenseMonthSubmitted ? 'mode-lock-badge locked' : 'mode-lock-badge'}>
                      {isExpenseMonthSubmitted ? 'Locked' : 'Unlocked'}
                    </span>
                    {isExpenseMonthSubmitted && (
                      <button
                        type="button"
                        className="unlock-month-btn"
                        onClick={unlockExpenseMonth}
                      >
                        Unlock Month
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        ) : selectedFeature === 'aadhar-income' ? (
          <>
            <div className="feature-page-head">
              <button
                type="button"
                className="back-home-btn"
                onClick={() => setSelectedFeature(null)}
              >
                Home
              </button>
              <h2>Aadhar Income</h2>
            </div>

            <div className="panel expenses-panel">
              <div className="expenses-mode-switch">
                <button
                  type="button"
                  className={aadharIncomeMode === 'entry' ? 'mode-btn active' : 'mode-btn'}
                  onClick={() => setAadharIncomeMode('entry')}
                >
                  Entry
                </button>
                <button
                  type="button"
                  className={aadharIncomeMode === 'view' ? 'mode-btn active' : 'mode-btn'}
                  onClick={() => setAadharIncomeMode('view')}
                >
                  View
                </button>
              </div>

              {aadharIncomeMode === 'view' ? (
                <div className="sheet-stack">
                  <div className="expenses-controls">
                    <div className="mode-month-field">
                      <label htmlFor="aadhar-income-view-fy">Select FY:</label>
                      <select
                        id="aadhar-income-view-fy"
                        value={aadharIncomeViewFy}
                        onChange={(event) => setAadharIncomeViewFy(event.target.value)}
                      >
                        {aadharIncomeViewFyOptions.map((year) => (
                          <option key={year} value={String(year)}>{formatFinancialYear(year)}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="sheet-wrap expenses-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Total income</th>
                          <th>Total expenditure</th>
                          <th>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aadharIncomeViewFyRows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="empty-row">No submitted months in selected FY.</td>
                          </tr>
                        ) : (
                          aadharIncomeViewFyRows.map((row) => (
                            <tr key={row.month}>
                              <td>{formatMonthKey(row.month)}</td>
                              <td>₹{formatRupees(row.totalIncome)}</td>
                              <td>₹{formatRupees(row.totalExpenditure)}</td>
                              <td className={row.balance < 0 ? 'expense-balance-negative' : 'expense-balance-positive'}>
                                ₹{formatRupees(row.balance)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <>
                  <div className="expenses-controls">
                    <div className="mode-month-field">
                      <label htmlFor="aadhar-income-month">Select Month:</label>
                      <input
                        id="aadhar-income-month"
                        type="month"
                        value={aadharIncomeMonth}
                        onChange={(event) => setAadharIncomeMonth(event.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="submit-month-btn"
                      onClick={addAadharIncomeRow}
                      disabled={isAadharIncomeMonthSubmitted}
                    >
                      Add Row
                    </button>
                  </div>

                  <div className="sheet-wrap expenses-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>S.No</th>
                          <th>Date</th>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleAadharIncomeRows.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="empty-row">No entries for this month. Add a row to begin.</td>
                          </tr>
                        ) : (
                          visibleAadharIncomeRows.map((row) => (
                            <tr key={row.id}>
                              <td>{row.sNo}</td>
                              <td>
                                <input
                                  type="date"
                                  value={row.date}
                                  readOnly={isAadharIncomeViewMode || isAadharIncomeMonthSubmitted}
                                  onChange={(event) => updateAadharIncomeCell(row.id, 'date', event.target.value)}
                                />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  value={row.name}
                                  readOnly={isAadharIncomeViewMode || isAadharIncomeMonthSubmitted}
                                  onChange={(event) => updateAadharIncomeCell(row.id, 'name', event.target.value)}
                                />
                              </td>
                              <td>
                                <select
                                  value={row.type || 'Income'}
                                  disabled={isAadharIncomeViewMode || isAadharIncomeMonthSubmitted}
                                  onChange={(event) => updateAadharIncomeCell(row.id, 'type', event.target.value)}
                                >
                                  <option value="Income">Income</option>
                                  <option value="Expense">Expense</option>
                                </select>
                              </td>
                              <td>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={row.amount}
                                  readOnly={isAadharIncomeViewMode || isAadharIncomeMonthSubmitted}
                                  onChange={(event) => {
                                    if (isAadharIncomeViewMode || isAadharIncomeMonthSubmitted) {
                                      return
                                    }
                                    const nextValue = event.target.value
                                    if (!/^\d*\.?\d*$/.test(nextValue)) {
                                      return
                                    }
                                    updateAadharIncomeCell(row.id, 'amount', nextValue)
                                  }}
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {visibleAadharIncomeRows.length > 0 && (
                        <tfoot>
                          <tr className="month-total-row">
                            <td colSpan={3} className="month-total-label expenses-lowercase-label">Total income</td>
                            <td className="month-total-cell">₹{formatRupees(aadharIncomeMonthTotalIncome)}</td>
                            <td className="month-total-cell">-</td>
                          </tr>
                          <tr className="month-total-row salary-row">
                            <td colSpan={3} className="month-total-label expenses-lowercase-label">Total expenditure</td>
                            <td className="month-total-cell">₹{formatRupees(aadharIncomeMonthTotalExpenditure)}</td>
                            <td className="month-total-cell">-</td>
                          </tr>
                          {aadharIncomeMonthCarryAmount > 0 && (
                            <tr className={aadharIncomeMonthCarryLabel === 'Surplus' ? 'month-total-row bank-balance-row' : 'month-total-row deficit-expense-row'}>
                              <td colSpan={3} className="month-total-label expenses-lowercase-label">Last month {aadharIncomeMonthCarryLabel}</td>
                              <td className="month-total-cell">₹{formatRupees(aadharIncomeMonthCarryAmount)}</td>
                              <td className="month-total-cell">-</td>
                            </tr>
                          )}
                          <tr className={aadharIncomeMonthBalance < 0 ? 'month-total-row balance-row deficit' : 'month-total-row balance-row'}>
                            <td colSpan={3} className="month-total-label expenses-lowercase-label">Balance</td>
                            <td className="month-total-cell">₹{formatRupees(Math.abs(aadharIncomeMonthBalance))}</td>
                            <td className="month-total-cell">
                              {aadharIncomeMonthBalance !== 0
                                ? isAadharIncomeMonthSubmitted
                                  ? `${aadharIncomeMonthBalance > 0 ? 'Surplus' : 'Deficit'} carried to ${getNextMonthKey(aadharIncomeMonth)}`
                                  : 'Submit to carry forward'
                                : '-'}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>

                  <div className="mode-submit-wrap table-end-submit">
                    <button
                      type="button"
                      className="submit-month-btn"
                      onClick={submitAadharIncomeMonth}
                      disabled={isAadharIncomeMonthSubmitted}
                    >
                      {isAadharIncomeMonthSubmitted ? 'Submitted' : 'Submit Month'}
                    </button>
                    <span className={isAadharIncomeMonthSubmitted ? 'mode-lock-badge locked' : 'mode-lock-badge'}>
                      {isAadharIncomeMonthSubmitted ? 'Locked' : 'Unlocked'}
                    </span>
                    {isAadharIncomeMonthSubmitted && (
                      <button
                        type="button"
                        className="unlock-month-btn"
                        onClick={unlockAadharIncomeMonth}
                      >
                        Unlock Month
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}

      </section>

      <footer className="app-footer">
        <div className="footer-card">
          <p>© 2026 లావాదేవి All Rights Reserved</p>
        </div>
      </footer>
    </div>
  )
}

export default App