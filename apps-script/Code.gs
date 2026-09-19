const REGISTRATION_HEADERS = [
  "RegistrationID","Timestamp","Name","Phone","Telegram","Email","Grade","City","Status",
  "FirstUTMSource","FirstUTMMedium","FirstUTMCampaign","FirstUTMContent","FirstUTMTerm",
  "LastUTMSource","LastUTMMedium","LastUTMCampaign","LastUTMContent","LastUTMTerm",
  "InitialReferrer","InitialLandingPage",
  "Login","PasswordHash","PasswordSalt","AccessStatus","CredentialIssuedAt"
];

const EVENT_HEADERS = [
  "Timestamp","RegistrationID","EventName","EventCategory","Target","Page",
  "UTMSource","UTMMedium","UTMCampaign","UTMContent"
];

const SETTINGS_HEADERS = ["Key","Value"];
const DEFAULT_SETTINGS = {
  RegistrationOpen:"true",
  RegistrationDeadline:"2026-10-02T23:59:00+03:00",
  ExamDate:"2026-10-03",
  ExamStart:"10:00",
  ExamEnd:"14:20",
  SupportTelegram:"",
  KolisnykTelegram:"",
  KolisnykInstagram:"",
  KolisnykTikTok:"",
  KolisnykSite:"",
  KolisnykViber:"",
  KolisnykYouTube:"",
  Lessons4YouTelegram:"",
  Lessons4YouInstagram:"",
  Lessons4YouTikTok:"",
  Lessons4YouYouTube:"",
  Lessons4YouSite:""
};

const PUBLIC_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
const ALLOWED_STATUSES = [
  "Нова реєстрація","Підтверджено","Допущено","Відмовлено","Дубль","Проблема з контактом"
];
const ALLOWED_EVENTS = new Set([
  "registration_success","preparation_open","support_click",
  "kolisnyk_telegram_click","kolisnyk_instagram_click","kolisnyk_tiktok_click",
  "lessons4you_telegram_click","lessons4you_instagram_click","lessons4you_tiktok_click"
]);
const ADMIN_SESSION_SECONDS = 1800;
const ADMIN_ACTIONS = new Set([
  "adminDashboard","adminListRegistrations","adminGetParticipant","adminUpdateParticipant",
  "adminGenerateCredentials","adminListEvents","adminGetSettings","adminSaveSettings",
  "adminExportRegistrations"
]);

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const action = clean_(payload.action, 80);
    if (action === "publicConfig") return json_({ok:true,config:publicConfig_()});
    if (action === "register") return json_(register_(payload));
    if (action === "logEvent") return json_(logEvent_(payload));
    if (action === "adminLogin") return json_(adminLogin_(payload));
    if (action === "adminLogout") return json_(adminLogout_(payload));
    if (ADMIN_ACTIONS.has(action)) {
      requireAdmin_(payload);
      return json_(dispatchAdmin_(action, payload));
    }
    return json_({ok:false,error:"Невідома дія."});
  } catch (error) {
    console.error(error && error.message ? error.message : "Server error");
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
  ensureSettingsSheet_(spreadsheet);
}

function register_(payload) {
  const settings = getSettingsMap_();
  if (String(settings.RegistrationOpen).toLowerCase() !== "true") {
    throw new Error("Реєстрацію тимчасово закрито.");
  }
  const deadline = new Date(settings.RegistrationDeadline || DEFAULT_SETTINGS.RegistrationDeadline);
  if (Number.isNaN(deadline.getTime()) || Date.now() > deadline.getTime()) {
    throw new Error("Реєстрацію вже завершено.");
  }

  const values = {
    name:clean_(payload.name,160), phone:clean_(payload.phone,80),
    telegram:clean_(payload.telegram,40), email:clean_(payload.email,200),
    grade:clean_(payload.grade,40), city:clean_(payload.city,160)
  };
  Object.keys(values).forEach(function(key) {
    if (!values[key]) throw new Error("Заповніть усі обов’язкові поля.");
  });
  if (!/^@[A-Za-z0-9_]{5,32}$/.test(values.telegram)) {
    throw new Error("Вкажіть Telegram у форматі @username.");
  }

  const registrationId = Utilities.getUuid();
  const record = {
    RegistrationID:registrationId, Timestamp:new Date(), Name:values.name, Phone:values.phone,
    Telegram:values.telegram, Email:values.email, Grade:values.grade, City:values.city,
    Status:"Нова реєстрація",
    FirstUTMSource:clean_(payload.first_utm_source,200),
    FirstUTMMedium:clean_(payload.first_utm_medium,200),
    FirstUTMCampaign:clean_(payload.first_utm_campaign,200),
    FirstUTMContent:clean_(payload.first_utm_content,200),
    FirstUTMTerm:clean_(payload.first_utm_term,200),
    LastUTMSource:clean_(payload.last_utm_source,200),
    LastUTMMedium:clean_(payload.last_utm_medium,200),
    LastUTMCampaign:clean_(payload.last_utm_campaign,200),
    LastUTMContent:clean_(payload.last_utm_content,200),
    LastUTMTerm:clean_(payload.last_utm_term,200),
    InitialReferrer:clean_(payload.initial_referrer,500),
    InitialLandingPage:clean_(payload.initial_landing_page,500),
    Login:"",PasswordHash:"",PasswordSalt:"",AccessStatus:"",CredentialIssuedAt:""
  };

  withLock_(function() {
    appendRecord_(ensureSheet_(getSpreadsheet_(),"Registrations",REGISTRATION_HEADERS),record);
  });
  return {ok:true,registration_id:registrationId};
}

function logEvent_(payload) {
  const registrationId = clean_(payload.registration_id,80);
  const eventName = clean_(payload.event_name,100);
  if (!registrationId) throw new Error("RegistrationID is required.");
  if (!ALLOWED_EVENTS.has(eventName)) throw new Error("Event is not allowed.");

  const spreadsheet = getSpreadsheet_();
  const registrations = ensureSheet_(spreadsheet,"Registrations",REGISTRATION_HEADERS);
  if (!findRowByValue_(registrations,"RegistrationID",registrationId)) {
    throw new Error("Unknown RegistrationID.");
  }

  const record = {
    Timestamp:new Date(), RegistrationID:registrationId, EventName:eventName,
    EventCategory:clean_(payload.event_category,100), Target:clean_(payload.target,200),
    Page:clean_(payload.page,500), UTMSource:clean_(payload.utm_source,200),
    UTMMedium:clean_(payload.utm_medium,200), UTMCampaign:clean_(payload.utm_campaign,200),
    UTMContent:clean_(payload.utm_content,200)
  };
  withLock_(function() {
    appendRecord_(ensureSheet_(spreadsheet,"Events",EVENT_HEADERS),record);
  });
  return {ok:true};
}

function publicConfig_() {
  const settings = getSettingsMap_();
  const config = {};
  PUBLIC_SETTING_KEYS.forEach(function(key) { config[key] = clean_(settings[key],500); });
  return config;
}

function adminLogin_(payload) {
  const cache = CacheService.getScriptCache();
  const failures = Number(cache.get("admin_login_failures") || "0");
  if (failures >= 10) throw new Error("Забагато спроб. Спробуйте через 5 хвилин.");

  const configured = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
  if (!configured) throw new Error("ADMIN_PASSWORD не налаштовано.");
  const supplied = String(payload.password == null ? "" : payload.password);
  if (!safeEqual_(supplied, configured)) {
    cache.put("admin_login_failures",String(failures + 1),300);
    throw new Error("Неправильний пароль.");
  }

  cache.remove("admin_login_failures");
  const token = createSecureToken_();
  cache.put(adminSessionKey_(token),JSON.stringify({issuedAt:Date.now()}),ADMIN_SESSION_SECONDS);
  return {ok:true,adminToken:token,expiresIn:ADMIN_SESSION_SECONDS};
}

function adminLogout_(payload) {
  const token = clean_(payload.adminToken,300);
  if (token) CacheService.getScriptCache().remove(adminSessionKey_(token));
  return {ok:true};
}

function requireAdmin_(payload) {
  const token = clean_(payload.adminToken,300);
  if (!token) throw new Error("AUTH_REQUIRED");
  const cache = CacheService.getScriptCache();
  const session = cache.get(adminSessionKey_(token));
  if (!session) throw new Error("AUTH_REQUIRED");
}

function dispatchAdmin_(action,payload) {
  if (action === "adminDashboard") return adminDashboard_();
  if (action === "adminListRegistrations") return adminListRegistrations_();
  if (action === "adminGetParticipant") return adminGetParticipant_(payload);
  if (action === "adminUpdateParticipant") return adminUpdateParticipant_(payload);
  if (action === "adminGenerateCredentials") return adminGenerateCredentials_(payload);
  if (action === "adminListEvents") return adminListEvents_();
  if (action === "adminGetSettings") return {ok:true,settings:getSettingsMap_()};
  if (action === "adminSaveSettings") return adminSaveSettings_(payload);
  if (action === "adminExportRegistrations") return adminExportRegistrations_();
  throw new Error("Unknown admin action.");
}

function adminDashboard_() {
  const spreadsheet = getSpreadsheet_();
  const registrations = readObjects_(ensureSheet_(spreadsheet,"Registrations",REGISTRATION_HEADERS));
  const events = readObjects_(ensureSheet_(spreadsheet,"Events",EVENT_HEADERS));
  const today = Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd");
  const sources = {TikTok:0,Instagram:0,Telegram:0,YouTube:0,"Direct / Other":0};
  const referrals = {Kolisnyk:0,"Lessons for You":0,Other:0};

  registrations.forEach(function(row) {
    const source = String(row.LastUTMSource || row.FirstUTMSource || "").toLowerCase();
    if (source.indexOf("tiktok") >= 0) sources.TikTok++;
    else if (source.indexOf("instagram") >= 0) sources.Instagram++;
    else if (source.indexOf("telegram") >= 0 || source.indexOf("t.me") >= 0) sources.Telegram++;
    else if (source.indexOf("youtube") >= 0) sources.YouTube++;
    else sources["Direct / Other"]++;

    const referral = [
      row.FirstUTMSource,row.FirstUTMCampaign,row.FirstUTMContent,
      row.LastUTMSource,row.LastUTMCampaign,row.LastUTMContent,row.InitialReferrer
    ].join(" ").toLowerCase();
    if (referral.indexOf("kolisnyk") >= 0) referrals.Kolisnyk++;
    else if (referral.indexOf("lessons4you") >= 0 || referral.indexOf("lessons.4.you") >= 0) referrals["Lessons for You"]++;
    else referrals.Other++;
  });

  const eventCounts = {};
  events.forEach(function(row) {
    const name = String(row.EventName || "");
    eventCounts[name] = (eventCounts[name] || 0) + 1;
  });
  return {
    ok:true,
    metrics:{
      total:registrations.length,
      today:registrations.filter(function(row){return isoDate_(row.Timestamp) === today;}).length,
      confirmed:registrations.filter(function(row){return row.Status === "Підтверджено" || row.Status === "Допущено";}).length,
      unconfirmed:registrations.filter(function(row){return row.Status !== "Підтверджено" && row.Status !== "Допущено";}).length
    },
    sources:sources,
    referrals:referrals,
    events:eventCounts
  };
}

function adminListRegistrations_() {
  const rows = readObjects_(ensureSheet_(getSpreadsheet_(),"Registrations",REGISTRATION_HEADERS));
  return {ok:true,registrations:rows.map(sanitizeRegistration_)};
}

function adminGetParticipant_(payload) {
  const id = clean_(payload.registration_id,80);
  const spreadsheet = getSpreadsheet_();
  const registrations = readObjects_(ensureSheet_(spreadsheet,"Registrations",REGISTRATION_HEADERS));
  const participant = registrations.find(function(row){return String(row.RegistrationID) === id;});
  if (!participant) throw new Error("Учасника не знайдено.");
  const events = readObjects_(ensureSheet_(spreadsheet,"Events",EVENT_HEADERS))
    .filter(function(row){return String(row.RegistrationID) === id;});
  return {ok:true,participant:sanitizeRegistration_(participant),events:events.map(sanitizeEvent_)};
}

function adminUpdateParticipant_(payload) {
  const id = clean_(payload.registration_id,80);
  const status = clean_(payload.status,80);
  if (ALLOWED_STATUSES.indexOf(status) === -1) throw new Error("Недозволений статус.");
  const sheet = ensureSheet_(getSpreadsheet_(),"Registrations",REGISTRATION_HEADERS);
  const row = findRowByValue_(sheet,"RegistrationID",id);
  if (!row) throw new Error("Учасника не знайдено.");
  const statusColumn = headerIndex_(sheet,"Status");
  sheet.getRange(row,statusColumn).setValue(status);
  return {ok:true,status:status};
}

function adminGenerateCredentials_(payload) {
  const id = clean_(payload.registration_id,80);
  const regenerate = Boolean(payload.regenerate);
  const sheet = ensureSheet_(getSpreadsheet_(),"Registrations",REGISTRATION_HEADERS);
  const row = findRowByValue_(sheet,"RegistrationID",id);
  if (!row) throw new Error("Учасника не знайдено.");
  const headers = sheetHeaders_(sheet);
  const currentHash = String(sheet.getRange(row,headers.indexOf("PasswordHash")+1).getValue() || "");
  if (currentHash && !regenerate) throw new Error("Доступ уже створено. Використайте перегенерацію.");

  const login = uniqueLogin_(sheet);
  const password = randomPassword_(14);
  const salt = createSecureToken_().slice(0,32);
  const passwordHash = digestHex_(salt + ":" + password);
  const values = {
    Login:login,PasswordHash:passwordHash,PasswordSalt:salt,
    AccessStatus:"Активний",CredentialIssuedAt:new Date()
  };
  Object.keys(values).forEach(function(key) {
    sheet.getRange(row,headers.indexOf(key)+1).setValue(values[key]);
  });
  return {
    ok:true,
    credentials:{login:login,password:password,accessStatus:"Активний"},
    warning:"Пароль показується лише один раз і не зберігається відкритим текстом."
  };
}

function adminListEvents_() {
  const rows = readObjects_(ensureSheet_(getSpreadsheet_(),"Events",EVENT_HEADERS));
  return {ok:true,events:rows.map(sanitizeEvent_)};
}

function adminSaveSettings_(payload) {
  const incoming = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  const spreadsheet = getSpreadsheet_();
  const sheet = ensureSettingsSheet_(spreadsheet);
  const current = getSettingsMap_();
  PUBLIC_SETTING_KEYS.forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(incoming,key)) return;
    const value = clean_(incoming[key],500);
    if (key === "RegistrationOpen" && value !== "true" && value !== "false") {
      throw new Error("RegistrationOpen має бути true або false.");
    }
    current[key] = value;
  });
  writeSettingsMap_(sheet,current);
  return {ok:true,settings:current};
}

function adminExportRegistrations_() {
  const rows = readObjects_(ensureSheet_(getSpreadsheet_(),"Registrations",REGISTRATION_HEADERS));
  const headers = REGISTRATION_HEADERS.filter(function(h){return h !== "PasswordHash" && h !== "PasswordSalt";});
  const lines = [headers.map(csvCell_).join(",")];
  rows.forEach(function(row) {
    lines.push(headers.map(function(header){return csvCell_(serializeValue_(row[header]));}).join(","));
  });
  return {
    ok:true,
    filename:"pnmt-registrations-"+Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd")+".csv",
    csv:"\uFEFF"+lines.join("\r\n")
  };
}

function sanitizeRegistration_(row) {
  const result = {};
  REGISTRATION_HEADERS.forEach(function(header) {
    if (header === "PasswordHash" || header === "PasswordSalt") return;
    result[header] = serializeValue_(row[header]);
  });
  result.HasPassword = Boolean(row.PasswordHash);
  return result;
}

function sanitizeEvent_(row) {
  const result = {};
  EVENT_HEADERS.forEach(function(header){result[header]=serializeValue_(row[header]);});
  return result;
}

function getSettingsMap_() {
  const sheet = ensureSettingsSheet_(getSpreadsheet_());
  const rows = sheet.getLastRow() < 2 ? [] : sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues();
  const result = Object.assign({},DEFAULT_SETTINGS);
  rows.forEach(function(row) {
    const key = String(row[0] || "");
    if (PUBLIC_SETTING_KEYS.indexOf(key) >= 0) result[key] = String(row[1] == null ? "" : row[1]);
  });
  return result;
}

function ensureSettingsSheet_(spreadsheet) {
  const sheet = ensureSheet_(spreadsheet,"Settings",SETTINGS_HEADERS);
  if (sheet.getLastRow() < 2) writeSettingsMap_(sheet,DEFAULT_SETTINGS);
  return sheet;
}

function writeSettingsMap_(sheet,settings) {
  const values = PUBLIC_SETTING_KEYS.map(function(key){return [key,String(settings[key] == null ? "" : settings[key])];});
  if (sheet.getLastRow() > 1) sheet.getRange(2,1,sheet.getLastRow()-1,2).clearContent();
  sheet.getRange(2,1,values.length,2).setValues(values);
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error("Set the SPREADSHEET_ID script property.");
  return active;
}

function ensureSheet_(spreadsheet,name,requiredHeaders) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0 || !sheet.getRange(1,1).getValue()) {
    ensureColumnCapacity_(sheet,requiredHeaders.length);
    sheet.getRange(1,1,1,requiredHeaders.length).setValues([requiredHeaders]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const existing = sheet.getRange(1,1,1,lastColumn).getValues()[0].map(String);
  const missing = requiredHeaders.filter(function(header){return existing.indexOf(header) === -1;});
  if (missing.length) {
    ensureColumnCapacity_(sheet,existing.length+missing.length);
    sheet.getRange(1,existing.length+1,1,missing.length).setValues([missing]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function ensureColumnCapacity_(sheet,needed) {
  const current = sheet.getMaxColumns();
  if (current < needed) sheet.insertColumnsAfter(current,needed-current);
}

function appendRecord_(sheet,record) {
  const headers = sheetHeaders_(sheet);
  sheet.appendRow(headers.map(function(header){
    return Object.prototype.hasOwnProperty.call(record,header) ? record[header] : "";
  }));
}

function readObjects_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  const headers = sheetHeaders_(sheet);
  return sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues().map(function(row) {
    const object = {};
    headers.forEach(function(header,index){object[header]=row[index];});
    return object;
  });
}

function sheetHeaders_(sheet) {
  return sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
}

function headerIndex_(sheet,header) {
  const index = sheetHeaders_(sheet).indexOf(header);
  if (index < 0) throw new Error("Missing column: "+header);
  return index+1;
}

function findRowByValue_(sheet,header,value) {
  const column = headerIndex_(sheet,header);
  if (sheet.getLastRow() < 2) return 0;
  const match = sheet.getRange(2,column,sheet.getLastRow()-1,1)
    .createTextFinder(String(value)).matchEntireCell(true).findNext();
  return match ? match.getRow() : 0;
}

function uniqueLogin_(sheet) {
  const column = headerIndex_(sheet,"Login");
  const existing = sheet.getLastRow() < 2 ? [] : sheet.getRange(2,column,sheet.getLastRow()-1,1).getValues().flat().map(String);
  let login = "";
  do { login = "PM-"+createSecureToken_().replace(/[^A-Za-z0-9]/g,"").slice(0,8).toUpperCase(); }
  while (existing.indexOf(login) >= 0);
  return login;
}

function randomPassword_(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid()+":"+Utilities.getUuid()+":"+Date.now()
  );
  let result = "";
  for (let i=0;i<length;i++) result += alphabet.charAt((bytes[i] & 255) % alphabet.length);
  return result;
}

function createSecureToken_() {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid()+":"+Utilities.getUuid()+":"+Date.now()+":"+Math.random()
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/,"");
}

function adminSessionKey_(token) {
  return "admin_session_"+digestHex_(token).slice(0,40);
}

function safeEqual_(left,right) {
  const a = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(left));
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(right));
  let difference = a.length ^ b.length;
  for (let i=0;i<Math.min(a.length,b.length);i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

function digestHex_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value))
    .map(function(byte){return ("0"+((byte+256)%256).toString(16)).slice(-2);}).join("");
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return callback(); } finally { lock.releaseLock(); }
}

function isoDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value,Session.getScriptTimeZone(),"yyyy-MM-dd");
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : Utilities.formatDate(parsed,Session.getScriptTimeZone(),"yyyy-MM-dd");
}

function serializeValue_(value) {
  if (value instanceof Date) return value.toISOString();
  return value == null ? "" : String(value);
}

function csvCell_(value) {
  return '"'+String(value == null ? "" : value).replace(/"/g,'""')+'"';
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error("Порожній запит.");
  try { return JSON.parse(e.postData.contents); }
  catch (_) { throw new Error("Некоректний JSON."); }
}

function clean_(value,maxLength) {
  return String(value == null ? "" : value).trim().slice(0,maxLength);
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}


