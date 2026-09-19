const REGISTRATION_HEADERS = [
  "RegistrationID",
  "Timestamp",
  "Name",
  "Phone",
  "Telegram",
  "Email",
  "Grade",
  "City",
  "Status",
  "FirstUTMSource",
  "FirstUTMMedium",
  "FirstUTMCampaign",
  "FirstUTMContent",
  "FirstUTMTerm",
  "LastUTMSource",
  "LastUTMMedium",
  "LastUTMCampaign",
  "LastUTMContent",
  "LastUTMTerm",
  "InitialReferrer",
  "InitialLandingPage"
];

const EVENT_HEADERS = [
  "Timestamp",
  "RegistrationID",
  "EventName",
  "EventCategory",
  "Target",
  "Page",
  "UTMSource",
  "UTMMedium",
  "UTMCampaign",
  "UTMContent"
];

const REGISTRATION_DEADLINE = new Date("2026-10-02T23:59:00+03:00");
const ALLOWED_EVENTS = new Set([
  "registration_success",
  "preparation_open",
  "support_click",
  "kolisnyk_telegram_click",
  "kolisnyk_instagram_click",
  "kolisnyk_tiktok_click",
  "lessons4you_telegram_click",
  "lessons4you_instagram_click",
  "lessons4you_tiktok_click"
]);

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    if (payload.action === "register") return json_(register_(payload));
    if (payload.action === "logEvent") return json_(logEvent_(payload));
    return json_({ok:false,error:"Невідома дія."});
  } catch (error) {
    console.error(error);
    return json_({ok:false,error:error.message || "Помилка сервера."});
  }
}

function doGet() {
  return json_({ok:true});
}

function setupSheets() {
  const spreadsheet = getSpreadsheet_();
  ensureSheet_(spreadsheet, "Registrations", REGISTRATION_HEADERS);
  ensureSheet_(spreadsheet, "Events", EVENT_HEADERS);
}

function register_(payload) {
  if (Date.now() > REGISTRATION_DEADLINE.getTime()) {
    throw new Error("Реєстрацію вже завершено.");
  }

  const values = {
    name: clean_(payload.name, 160),
    phone: clean_(payload.phone, 80),
    telegram: clean_(payload.telegram, 40),
    email: clean_(payload.email, 200),
    grade: clean_(payload.grade, 40),
    city: clean_(payload.city, 160)
  };

  Object.keys(values).forEach(function(key) {
    if (!values[key]) throw new Error("Заповніть усі обов’язкові поля.");
  });
  if (!/^@[A-Za-z0-9_]{5,32}$/.test(values.telegram)) {
    throw new Error("Вкажіть Telegram у форматі @username.");
  }

  const registrationId = Utilities.getUuid();
  const record = {
    RegistrationID: registrationId,
    Timestamp: new Date(),
    Name: values.name,
    Phone: values.phone,
    Telegram: values.telegram,
    Email: values.email,
    Grade: values.grade,
    City: values.city,
    Status: "new",
    FirstUTMSource: clean_(payload.first_utm_source, 200),
    FirstUTMMedium: clean_(payload.first_utm_medium, 200),
    FirstUTMCampaign: clean_(payload.first_utm_campaign, 200),
    FirstUTMContent: clean_(payload.first_utm_content, 200),
    FirstUTMTerm: clean_(payload.first_utm_term, 200),
    LastUTMSource: clean_(payload.last_utm_source, 200),
    LastUTMMedium: clean_(payload.last_utm_medium, 200),
    LastUTMCampaign: clean_(payload.last_utm_campaign, 200),
    LastUTMContent: clean_(payload.last_utm_content, 200),
    LastUTMTerm: clean_(payload.last_utm_term, 200),
    InitialReferrer: clean_(payload.initial_referrer, 500),
    InitialLandingPage: clean_(payload.initial_landing_page, 500)
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = ensureSheet_(getSpreadsheet_(), "Registrations", REGISTRATION_HEADERS);
    appendRecord_(sheet, record);
  } finally {
    lock.releaseLock();
  }

  return {ok:true,registration_id:registrationId};
}

function logEvent_(payload) {
  const registrationId = clean_(payload.registration_id, 80);
  const eventName = clean_(payload.event_name, 100);
  if (!registrationId) throw new Error("RegistrationID is required.");
  if (!ALLOWED_EVENTS.has(eventName)) throw new Error("Event is not allowed.");

  const spreadsheet = getSpreadsheet_();
  const registrations = ensureSheet_(spreadsheet, "Registrations", REGISTRATION_HEADERS);
  if (!registrationExists_(registrations, registrationId)) {
    throw new Error("Unknown RegistrationID.");
  }

  const record = {
    Timestamp: new Date(),
    RegistrationID: registrationId,
    EventName: eventName,
    EventCategory: clean_(payload.event_category, 100),
    Target: clean_(payload.target, 200),
    Page: clean_(payload.page, 500),
    UTMSource: clean_(payload.utm_source, 200),
    UTMMedium: clean_(payload.utm_medium, 200),
    UTMCampaign: clean_(payload.utm_campaign, 200),
    UTMContent: clean_(payload.utm_content, 200)
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const events = ensureSheet_(spreadsheet, "Events", EVENT_HEADERS);
    appendRecord_(events, record);
  } finally {
    lock.releaseLock();
  }

  return {ok:true};
}

function getSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error("Set the SPREADSHEET_ID script property.");
  return active;
}

function ensureSheet_(spreadsheet, name, requiredHeaders) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);

  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0 || !sheet.getRange(1, 1).getValue()) {
    ensureColumnCapacity_(sheet, requiredHeaders.length);
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const existingHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  const missingHeaders = requiredHeaders.filter(function(header) {
    return existingHeaders.indexOf(header) === -1;
  });
  if (missingHeaders.length) {
    ensureColumnCapacity_(sheet, existingHeaders.length + missingHeaders.length);
    sheet.getRange(1, existingHeaders.length + 1, 1, missingHeaders.length).setValues([missingHeaders]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function ensureColumnCapacity_(sheet, needed) {
  const current = sheet.getMaxColumns();
  if (current < needed) sheet.insertColumnsAfter(current, needed - current);
}

function appendRecord_(sheet, record) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const row = headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : "";
  });
  sheet.appendRow(row);
}

function registrationExists_(sheet, registrationId) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const idColumn = headers.indexOf("RegistrationID") + 1;
  if (!idColumn || sheet.getLastRow() < 2) return false;
  const match = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1)
    .createTextFinder(registrationId)
    .matchEntireCell(true)
    .findNext();
  return Boolean(match);
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error("Порожній запит.");
  try {
    return JSON.parse(e.postData.contents);
  } catch (_) {
    throw new Error("Некоректний JSON.");
  }
}

function clean_(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


