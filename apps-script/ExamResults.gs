// Answer keys are installed privately in Script Properties, never in this repository.
const PNMT_EXAM_VERSION = "pnmt-2026-10-30";
const PNMT_SUBJECTS = {ukrainian:"Українська мова",math:"Математика",history:"Історія України",english:"Англійська мова"};
const PNMT_ANSWER_HEADERS = ["Timestamp","AttemptID","RegistrationID","Subject","QuestionNumber","Answer","Points","MaxPoints","AnswerSavedAt","ServerReceivedAt"];

function pnmtExamKeys_() {
  const props = PropertiesService.getScriptProperties();
  const keys = {};
  Object.keys(PNMT_SUBJECTS).forEach(function(subject) {
    const value = props.getProperty("PNMT_KEYS_" + PNMT_EXAM_VERSION + "_" + subject);
    if (!value) throw new Error("Ключі нового варіанта ще не встановлено.");
    keys[subject] = JSON.parse(value);
  });
  return keys;
}

function pnmtExamInfo_() {
  const keys = pnmtExamKeys_();
  return {ok:true,exam_version:PNMT_EXAM_VERSION,question_counts:Object.fromEntries(Object.keys(keys).map(function(subject){return [subject,keys[subject].length];}))};
}

function pnmtSigningKey_() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty("PNMT_PARTICIPANT_SESSION_KEY");
  if (!key) key = withLock_(function() {
    let existing = props.getProperty("PNMT_PARTICIPANT_SESSION_KEY");
    if (!existing) { existing = createSecureToken_() + createSecureToken_(); props.setProperty("PNMT_PARTICIPANT_SESSION_KEY",existing); }
    return existing;
  });
  return key;
}

function pnmtIssueSession_(record) {
  const body = Utilities.base64EncodeWebSafe(JSON.stringify({registration_id:String(record.RegistrationID),login:String(record.Login),testAccess:String(record.Status)==="Тестовий",expires:Date.now()+24*60*60*1000}),Utilities.Charset.UTF_8);
  const signature = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body,pnmtSigningKey_()));
  return body + "." + signature;
}

function pnmtRequireParticipant_(payload) {
  const token = String(payload.token || "");
  const pieces = token.split(".");
  if (pieces.length !== 2 || token.length > 2000) throw new Error("Увійдіть повторно, щоб зберегти результат.");
  const key = PropertiesService.getScriptProperties().getProperty("PNMT_PARTICIPANT_SESSION_KEY");
  if (!key || !safeEqual_(Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(pieces[0],key)),pieces[1])) throw new Error("Недійсна сесія.");
  let user;
  try { user = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pieces[0])).getDataAsString()); }
  catch (_) { throw new Error("Недійсна сесія."); }
  if (!user.registration_id || user.login !== payload.login || user.expires <= Date.now()) throw new Error("Сесія завершилася. Увійдіть повторно.");
  return user;
}

function pnmtMax_(q) { return q.type === "match" ? q.rows : q.type === "number" ? 2 : q.type === "sequence" || q.type === "multi" ? 3 : 1; }
function pnmtNumeric_(value) {
  const text = String(value == null ? "" : value).trim().replace(/\s+/g,"").replace(/[−–—]/g,"-").replace(",",".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || !Number.isFinite(Number(text))) return null;
  return String(Number(text));
}
function pnmtCanonicalAnswer_(q,value) {
  if (value == null || value === "") return null;
  if (q.type === "number") return pnmtNumeric_(value);
  const valid = q.subject === "english" ? "ABCDEFGH" : q.type === "multi" ? "1234567" : "АБВГД";
  if (q.type === "single") return typeof value === "string" && value.length === 1 && valid.includes(value) ? value : null;
  if (!Array.isArray(value)) return null;
  const size = q.type === "match" ? q.rows : q.type === "sequence" ? 4 : 3;
  if (value.length > size) return null;
  const filled = value.filter(function(v){return v != null && v !== "";});
  if (!filled.length) return null;
  if (new Set(filled).size !== filled.length || filled.some(function(v){return typeof v !== "string" || v.length !== 1 || !valid.includes(v) || q.type === "sequence" && v === "Д";})) return null;
  if (q.type === "multi") return filled.length ? filled.slice().sort() : null;
  return Array.from({length:size},function(_,i){return value[i] || null;});
}
function pnmtPoints_(q,answer) {
  if (answer == null) return 0;
  if (q.type === "single") return answer === q.correct ? 1 : 0;
  if (q.type === "number") return answer === pnmtNumeric_(q.correct) ? 2 : 0;
  if (q.type === "match") return q.correct.reduce(function(sum,key,i){return sum + (answer[i] === key ? 1 : 0);},0);
  if (q.type === "multi") return q.correct.filter(function(key){return answer.includes(key);}).length;
  if (q.type === "sequence") {
    if (answer.some(function(v){return !v;})) return 0;
    if (answer.join("") === q.correct.join("")) return 3;
    return Number(answer[0] === q.correct[0]) + Number(answer[3] === q.correct[3]);
  }
  return 0;
}
function pnmtGrade_(answers) {
  const keys = pnmtExamKeys_(),results = {},rows = [];
  Object.keys(keys).forEach(function(subject) {
    const result = results[subject] = {points:0,max:0,answered:0,total:keys[subject].length};
    keys[subject].forEach(function(key,i) {
      const q = Object.assign({subject:subject},key),answer = pnmtCanonicalAnswer_(q,answers[subject+":"+i]);
      const points = pnmtPoints_(q,answer),max = pnmtMax_(q);
      result.points += points; result.max += max;
      if (answer != null && (!Array.isArray(answer) || answer.some(function(v){return v != null;}))) result.answered++;
      rows.push({subject:subject,number:q.number,answer:answer,points:points,max:max,index:i});
    });
  });
  return {results:results,rows:rows};
}

function pnmtSaveResult_(payload) {
  const user = pnmtRequireParticipant_(payload);
  if (payload.exam_version !== PNMT_EXAM_VERSION) throw new Error("Варіант тесту змінився. Оновіть сторінку.");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(String(payload.client_submission_id || ""))) throw new Error("Некоректний ідентифікатор спроби.");
  if (!payload.answers || typeof payload.answers !== "object" || Array.isArray(payload.answers)) throw new Error("Некоректні відповіді.");
  if (!user.testAccess && Date.now() < Date.parse("2026-10-31T10:00:00+02:00")) throw new Error("Тестування ще не почалося.");
  return withLock_(function() {
    const spreadsheet = getSpreadsheet_(),registrations = spreadsheet.getSheetByName("Registrations");
    const participantRow = findRowByValue_(registrations,"RegistrationID",user.registration_id);
    if (!participantRow) throw new Error("Реєстрацію не знайдено.");
    const headers = sheetHeaders_(registrations),record = {};
    registrations.getRange(participantRow,1,1,headers.length).getValues()[0].forEach(function(value,i){record[headers[i]]=value;});
    if (record.Login !== user.login || record.AccessStatus !== "Активний" || record.Status === "Запізніла реєстрація") throw new Error("Доступ до тестування відсутній.");
    const sheet = ensureSheet_(spreadsheet,"Answers",PNMT_ANSWER_HEADERS);
    const attemptPrefix = PNMT_EXAM_VERSION+":"+digestHex_(user.registration_id).slice(0,24)+":";
    const attempt = attemptPrefix+digestHex_(payload.client_submission_id).slice(0,24);
    const previousRow = findRowByValue_(sheet,"AttemptID",attempt);
    let graded,duplicate = Boolean(previousRow);
    if (duplicate) {
      // Read the already committed attempt; retry payloads cannot change its scores.
      const count = Object.values(pnmtExamKeys_()).reduce(function(n,qs){return n+qs.length;},0);
      const existingHeaders = sheetHeaders_(sheet);
      const saved = sheet.getRange(previousRow,1,count,existingHeaders.length).getValues();
      const results = {};
      saved.forEach(function(values){
        const row={};existingHeaders.forEach(function(h,i){row[h]=values[i];});
        if (row.AttemptID !== attempt || row.RegistrationID !== user.registration_id || !PNMT_SUBJECTS[row.Subject]) throw new Error("Збережена спроба потребує перевірки адміністратора.");
        const r=results[row.Subject] || (results[row.Subject]={points:0,max:0,answered:0,total:0});
        r.points+=Number(row.Points);r.max+=Number(row.MaxPoints);r.total++;
        if (row.Answer !== "" && row.Answer !== "null") r.answered++;
      });
      graded={results:results};
    } else {
      if (!user.testAccess && sheet.getLastRow() > 1) {
        const existing = sheet.getRange(2,headerIndex_(sheet,"AttemptID"),sheet.getLastRow()-1,1).createTextFinder(attemptPrefix).matchEntireCell(false).findNext();
        if (existing) throw new Error("Результат цього варіанта вже збережено.");
      }
      graded = pnmtGrade_(payload.answers);
      const now = new Date(),answerHeaders = sheetHeaders_(sheet);
      const rows = graded.rows.map(function(q) {
        const savedAt = (payload.answer_saved_at || {})[q.subject+":"+q.index];
        const record = {Timestamp:now,AttemptID:attempt,RegistrationID:user.registration_id,Subject:q.subject,QuestionNumber:q.number,Answer:q.answer==null?"":JSON.stringify(q.answer),Points:q.points,MaxPoints:q.max,AnswerSavedAt:!isNaN(Date.parse(savedAt))?new Date(savedAt):"",ServerReceivedAt:now};
        return answerHeaders.map(function(h){return record[h] == null ? "" : record[h];});
      });
      const firstRow = sheet.getLastRow()+1;
      if (firstRow+rows.length-1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),firstRow+rows.length-1-sheet.getMaxRows());
      sheet.getRange(firstRow,1,rows.length,answerHeaders.length).setValues(rows);
      SpreadsheetApp.flush();
    }
    // Retrying after a failed summary update safely repairs these four cells only.
    Object.keys(PNMT_SUBJECTS).forEach(function(subject){
      registrations.getRange(participantRow,headerIndex_(registrations,PNMT_SUBJECTS[subject])).setValue(graded.results[subject].points);
    });
    SpreadsheetApp.flush();
    return {ok:true,duplicate:duplicate,results:user.testAccess?graded.results:undefined};
  });
}
