const CONFIG={
  SHEETS_ENDPOINT:"https://script.google.com/macros/s/AKfycbwKbPlcaCvSNmSGqSJi156PL4HdRft3kqKv8Rl4FQnmAuDoN4gqMdWGJomh3IflILH4/exec",
  DEFAULT_DEADLINE:"2026-10-02T23:59",
  DEFAULT_TEST_START:"2026-10-03T10:00",
  DEFAULT_TEST_END:"2026-10-03T14:20",
  DEMO_LOGIN:"",
  DEMO_PASSWORD:"",
  LOCAL_DEMO:false
};

const STORAGE={
  participants:"probne_nmt_participants_v36",
  settings:"probne_nmt_settings_v36",
  answers:"probne_nmt_answers_v36",
  session:"probne_nmt_session_v37",
  answerTimes:"probne_nmt_answer_times_v38",
  pendingResults:"probne_nmt_pending_results_v39",
  submissionId:"probne_nmt_submission_id_v39"
};

const LABELS={
  ukrainian:"Українська мова",
  math:"Математика",
  history:"Історія України",
  english:"Англійська мова"
};

/* Точний порядок ФОРМ завдань за НМТ-2026:
   Українська: 1–25 single, 26–30 matching
   Математика: 1–15 single5, 16–18 matching3, 19–22 numeric
   Історія: 1–20 single4, 21–24 matching4, 25–27 ordering, 28–30 multi3of7
   Англійська: 1–5 matching-choice, 6–10 single4, 11–16 matching-choice,
               17–22 gap-choice, 23–27 single4, 28–32 single4.
*/

function range(n, fn){return Array.from({length:n},(_,i)=>fn(i+1))}
function genericQuestion(subject,n,type){
  const base={
    number:n,type,
    source:`${LABELS[subject]} · демонстраційна структура НМТ-2026`,
    prompt:`Завдання ${n}. Інтерфейс і тип відповіді відповідають позиції цього завдання в демонстраційному варіанті. Точний текст завдання можна підставити в об'єкт QUESTION_TEXTS без зміни логіки тестувальника.`,
    correct:null
  };
  if(type==="single4") base.options=["Варіант А","Варіант Б","Варіант В","Варіант Г"];
  if(type==="single5") base.options=["Варіант А","Варіант Б","Варіант В","Варіант Г","Варіант Д"];
  if(type==="single8"||type==="gap8") base.options=["A","B","C","D","E","F","G","H"];
  if(type==="matching4") {base.rows=["1","2","3","4"];base.options=["А","Б","В","Г","Д"]}
  if(type==="matching3") {base.rows=["1","2","3"];base.options=["А","Б","В","Г","Д"]}
  if(type==="ordering") {base.rows=["А","Б","В","Г"]}
  if(type==="multi7") base.options=["1","2","3","4","5","6","7"];
  return base;
}

const QUESTION_BANK=IMPORTED_EXAMS;

function updatePublicCountdown(){
  const deadline=new Date(CONFIG.DEFAULT_DEADLINE+":00+03:00").getTime();const diff=Math.max(0,deadline-Date.now());
  const parts={days:Math.floor(diff/86400000),hours:Math.floor((diff%86400000)/3600000),minutes:Math.floor((diff%3600000)/60000),seconds:Math.floor((diff%60000)/1000)};
  Object.entries(parts).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.textContent=String(value).padStart(2,"0")});
}
updatePublicCountdown();setInterval(updatePublicCountdown,1000);

function readStoredSession(){try{return JSON.parse(localStorage.getItem(STORAGE.session)||"null")}catch(e){return null}}
const persistedSession=readStoredSession();
const app={
  view:"home",
  user:persistedSession?.user||null,
  stage:persistedSession?.stage||0, // 0 not started, 1 first, 2 break, 3 second, 4 finished
  subject:persistedSession?.subject||"ukrainian",
  questionIndex:Number(persistedSession?.questionIndex)||0,
  secondsLeft:7200,
  breakSeconds:1200,
  timerId:null,
  breakId:null,
  answers:JSON.parse(localStorage.getItem(STORAGE.answers)||"{}"),
  answerTimes:JSON.parse(localStorage.getItem(STORAGE.answerTimes)||"{}"),
  visited:JSON.parse(localStorage.getItem("probne_nmt_visited_v4")||"{}"),
  flagged:JSON.parse(localStorage.getItem("probne_nmt_flagged_v4")||"{}"),
  stageStartedAt:persistedSession?.stageStartedAt||0,stageEndsAt:persistedSession?.stageEndsAt||0,stage2StartsAt:persistedSession?.stage2StartsAt||0,attemptStartedAt:persistedSession?.attemptStartedAt||0,warned:{},
  adminToken:null
};


const EXAM_SCHEDULE={login:Date.parse('2026-10-03T09:00:00+03:00'),start:Date.parse('2026-10-03T10:00:00+03:00'),firstEnd:Date.parse('2026-10-03T12:00:00+03:00'),secondStart:Date.parse('2026-10-03T12:20:00+03:00'),end:Date.parse('2026-10-03T14:20:00+03:00')};
function isTestUser(){return app.user?.testAccess===true}
function updateTestControls(){document.querySelectorAll('[data-test-control]').forEach(button=>{button.hidden=!isTestUser()})}

function getLocalSettings(){
  const x=JSON.parse(localStorage.getItem(STORAGE.settings)||"{}");
  return {
    deadline:x.deadline||CONFIG.DEFAULT_DEADLINE,
    testStart:x.testStart||CONFIG.DEFAULT_TEST_START,
    testEnd:x.testEnd||CONFIG.DEFAULT_TEST_END,
    registrationOpen:x.registrationOpen!==false,
    socials:x.socials||{
      math:{telegram:"",instagram:"",tiktok:""},
      other:{telegram:"",instagram:"",tiktok:""}
    }
  };
}
function saveLocalSettings(s){localStorage.setItem(STORAGE.settings,JSON.stringify(s))}
function getLocalParticipants(){return JSON.parse(localStorage.getItem(STORAGE.participants)||"[]")}
function saveLocalParticipants(v){localStorage.setItem(STORAGE.participants,JSON.stringify(v))}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}
function uid(){return Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-4)}
function randomPass(){const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";return Array.from({length:6},()=>c[Math.floor(Math.random()*c.length)]).join("")}
function loginFromName(name){return name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi,"").slice(0,7)+String(Date.now()).slice(-3)}

async function api(payload){
  if(!CONFIG.SHEETS_ENDPOINT) return null;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const r=await fetch(CONFIG.SHEETS_ENDPOINT,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload),signal:controller.signal});
    const data=await r.json();
    if(!data.ok) throw new Error(data.error||"Помилка сервера");
    return data;
  }catch(error){
    if(error?.name==="AbortError")throw new Error("Сервер не відповів за 20 секунд.");
    throw error;
  }finally{clearTimeout(timeout)}
}

function safeParse(value,fallback){try{return JSON.parse(value)}catch(error){return fallback}}
function pendingResults(){return safeParse(localStorage.getItem(STORAGE.pendingResults)||"[]",[])}
function savePendingResults(items){if(items.length)localStorage.setItem(STORAGE.pendingResults,JSON.stringify(items));else localStorage.removeItem(STORAGE.pendingResults)}
function createSubmissionId(){return crypto.randomUUID?crypto.randomUUID():"sub-"+Date.now()+"-"+Math.random().toString(36).slice(2)}
function currentSubmissionId(){let id=localStorage.getItem(STORAGE.submissionId);if(!id){id=createSubmissionId();localStorage.setItem(STORAGE.submissionId,id)}return id}
function buildResultPayload(){return {action:"saveResult",client_submission_id:currentSubmissionId(),login:app.user?.login||"",token:app.user?.token||"",answers:app.answers,answer_saved_at:app.answerTimes,attempt_started_at:app.attemptStartedAt?new Date(app.attemptStartedAt).toISOString():"",submitted_at:new Date().toISOString()}}
function queueResult(payload){const items=pendingResults().filter(item=>item.client_submission_id!==payload.client_submission_id);items.push(payload);savePendingResults(items)}
function renderResultResponse(response){
  const results=response?.results||{};
  resultGrid.innerHTML=Object.entries(results).map(([s,r])=>{const answered=Number.isFinite(r.answered)?'<div style="font-size:12px;color:var(--muted);margin-top:5px">Надано відповідей: '+r.answered+'/'+r.total+'</div>':"";return '<div class="result"><span>'+LABELS[s]+'</span><br><strong>'+r.points+'/'+r.max+'</strong>'+answered+'</div>'}).join("");
  deliveryState.className="delivery-state ok";deliveryState.textContent=response?.duplicate?"Результат уже був успішно збережений раніше.":"Дані збережено.";
}
async function flushPendingResults(showResult=false){
  if(!navigator.onLine||!CONFIG.SHEETS_ENDPOINT)return false;
  const items=pendingResults();if(!items.length)return true;
  for(const item of [...items]){
    try{
      const response=await api(item);
      savePendingResults(pendingResults().filter(x=>x.client_submission_id!==item.client_submission_id));
      if(showResult)renderResultResponse(response);
    }catch(error){
      if(showResult){deliveryState.className="delivery-state";deliveryState.textContent="Результат збережено в черзі цього браузера. Надсилання повториться автоматично після відновлення інтернету. "+error.message}
      return false;
    }
  }
  if(!pendingResults().length)localStorage.removeItem(STORAGE.submissionId);
  return true;
}

function activeExamStage(){return app.stage===1||app.stage===2||app.stage===3}
function syncExamMode(){document.body.classList.toggle("exam-active",activeExamStage())}
function saveExamSession(){
  if(!app.user)return;
  localStorage.setItem(STORAGE.session,JSON.stringify({version:39,user:app.user,stage:app.stage,subject:app.subject,questionIndex:app.questionIndex,stageStartedAt:app.stageStartedAt,stageEndsAt:app.stageEndsAt,stage2StartsAt:app.stage2StartsAt,attemptStartedAt:app.attemptStartedAt,checkpointAt:Date.now()}));
}
function armExamGuard(){if(activeExamStage()&&!history.state?.examGuard)history.pushState({examGuard:true},"",location.href)}
function showView(id){
  if(activeExamStage()&&id!=="exam")return;
  app.view=id;
  document.querySelectorAll(".section").forEach(s=>s.classList.toggle("active",s.id===id));
  document.querySelectorAll("[data-nav]").forEach(b=>b.classList.toggle("active",b.dataset.nav===id));
  window.scrollTo({top:0,behavior:"smooth"});
  if(id==="tutors") renderSocials();
function renderArchivePages(){
  if(mathReferencePages&&!mathReferencePages.childElementCount)mathReferencePages.innerHTML=Object.values(SOURCE_PAGES.mathRef||{}).map(x=>`<div class="pdf-code-viewport">${x}</div>`).join("");
  if(english2024Pages&&!english2024Pages.childElementCount)english2024Pages.innerHTML=Object.values(SOURCE_PAGES.english2024||{}).map(x=>`<div class="pdf-code-viewport">${x}</div>`).join("");
}
document.querySelectorAll(".archive-block").forEach(x=>x.addEventListener("toggle",()=>{if(x.open)renderArchivePages()}));
}
document.querySelectorAll("[data-nav]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.nav)));
document.getElementById("brandHome").addEventListener("click",()=>{if(activeExamStage()){alert("Спочатку завершіть активний етап тестування.");return}showView("home")});

function validTelegram(v){return /^@[A-Za-z0-9_]{5,32}$/.test(v.trim())}

document.getElementById("registrationForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const box=registrationStatus;
  const telegram=regTelegram.value.trim();
  if(!validTelegram(telegram)){
    box.className="status err show";
    box.textContent="Telegram має бути у форматі @username (5–32 символи після @).";
    return;
  }
  const settings=getLocalSettings();
  if(!settings.registrationOpen || new Date()>new Date(settings.deadline.length===16?settings.deadline+":00+03:00":settings.deadline)){
    box.className="status err show";box.textContent="Реєстрацію вже закрито.";return;
  }
  const p={
    action:"register",
    id:uid(),
    name:regName.value.trim(),
    phone:regPhone.value.trim(),
    telegram,
    email:regEmail.value.trim(),
    grade:regGrade.value,
    city:regCity.value.trim(),
    createdAt:new Date().toISOString()
  };
  const submitButton=e.currentTarget.querySelector('button[type="submit"]');
  const submitLabel=submitButton.textContent;submitButton.disabled=true;submitButton.textContent="Генеруємо доступ…";
  try{
    if(CONFIG.SHEETS_ENDPOINT){
      const res=await api(p);
      box.className="status ok show";
      box.innerHTML=`Реєстрацію отримано.<br><b>Логін:</b> ${esc(res.login)} &nbsp; <b>Пароль:</b> ${esc(res.password)}<br><span style="font-size:12px">Збережіть ці дані: пароль повторно не показується.</span>`;e.target.reset();
    }else{
      const list=getLocalParticipants();
      if(list.some(x=>x.email.toLowerCase()===p.email.toLowerCase()||x.telegram.toLowerCase()===p.telegram.toLowerCase())){
        throw new Error("Заявка з таким email або Telegram уже є.");
      }
      p.login=loginFromName(p.name);
      p.password=randomPass();
      p.status="Очікує підтвердження";
      list.push(p);saveLocalParticipants(list);
      box.className="status ok show";
      box.innerHTML=`Демо-реєстрацію збережено локально.<br><b>Логін:</b> ${esc(p.login)} &nbsp; <b>Пароль:</b> ${esc(p.password)}<br><span style="font-size:12px">У бойовій версії доступ краще надсилати лише після підтвердження заявки.</span>`;
      e.target.reset();
    }
  }catch(err){box.className="status err show";box.textContent=err.message}
  finally{submitButton.disabled=false;submitButton.textContent=submitLabel}
});



loginForm.addEventListener("submit",async e=>{
  e.preventDefault();
  const box=loginStatus,login=loginInput.value.trim(),password=passwordInput.value;
  try{
    let user=null;
    if(CONFIG.SHEETS_ENDPOINT){
      const res=await api({action:"login",login,password});
      user=res.user;
    }else if(CONFIG.LOCAL_DEMO){
      if(login===CONFIG.DEMO_LOGIN&&password===CONFIG.DEMO_PASSWORD) user={name:"Демо учасник",login};
      else user=getLocalParticipants().find(x=>x.login===login&&x.password===password);
    }
    if(!user) throw new Error("Невірний логін або пароль.");
    if(user.testAccess!==true&&Date.now()<EXAM_SCHEDULE.login)throw new Error('Вхід відкриється 3 жовтня о 09:00 за київським часом.');
    app.user=user;updateTestControls();
    saveExamSession();
    lobbyName.textContent=user.name||user.login||"Учасник";
    box.className="status ok show";box.textContent="Вхід успішний.";
    setTimeout(()=>showView("lobby"),300);
  }catch(err){box.className="status err show";box.textContent=err.message}
});

startTestBtn.addEventListener("click",()=>{
  if(!rulesAgree.checked){alert("Спочатку підтвердьте, що ознайомилися з правилами.");return}
  if(!app.user)return;
  if(!isTestUser()){
    if(Date.now()<EXAM_SCHEDULE.start){alert('Тестування почнеться 3 жовтня о 10:00 за київським часом.');return}
    if(Date.now()>=EXAM_SCHEDULE.end){alert('Тестування завершено.');return}
    if(Date.now()>=EXAM_SCHEDULE.firstEnd){app.stage2StartsAt=EXAM_SCHEDULE.secondStart;syncExamMode();showView('exam');if(Date.now()>=EXAM_SCHEDULE.secondStart)beginStage2();else startBreak();return}
  }
  app.stage=1;app.subject="math";app.questionIndex=0;
  app.stageStartedAt=Date.now();
  app.attemptStartedAt=app.stageStartedAt;
  app.stageEndsAt=isTestUser()?app.stageStartedAt+7200*1000:EXAM_SCHEDULE.firstEnd;
  // If session 1 is finished early, the break lasts until the planned 12:20 point.
  app.stage2StartsAt=isTestUser()?app.stageStartedAt+(120+20)*60*1000:EXAM_SCHEDULE.secondStart;
  app.warned={};
  syncExamMode();saveExamSession();armExamGuard();
  startStageTimer();showView("exam");updateSubjects();renderQuestion();
});

function activeSubjects(){return (app.stage===1?["ukrainian","math"]:app.stage===3?["history","english"]:[]).filter(s=>QUESTION_BANK[s]?.length)}
function updateSubjects(){
  const allowed=activeSubjects();
  document.querySelectorAll(".subject-tab").forEach(b=>{
    b.disabled=!allowed.includes(b.dataset.subject)||!(QUESTION_BANK[b.dataset.subject]?.length);
    b.classList.toggle("active",b.dataset.subject===app.subject);
  });
  if(!allowed.includes(app.subject)&&allowed.length){app.subject=allowed[0];app.questionIndex=0}
}
document.querySelectorAll(".subject-tab").forEach(b=>b.addEventListener("click",()=>{
  if(b.disabled||!allowQuestionLeave())return;
  app.subject=b.dataset.subject;app.questionIndex=0;saveExamSession();updateSubjects();renderQuestion();
}));

function fmtTime(s){s=Math.max(0,Math.ceil(s));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),x=s%60;return[h,m,x].map(v=>String(v).padStart(2,"0")).join(":")}
function showTimeWarning(seconds){
  const labels={600:"До завершення сесії залишилося 10 хвилин",300:"До завершення сесії залишилося 5 хвилин",60:"До завершення сесії залишилася 1 хвилина"};
  if(!labels[seconds]||app.warned[`${app.stage}:${seconds}`])return;
  app.warned[`${app.stage}:${seconds}`]=true;warningToast.textContent=labels[seconds];warningToast.classList.add("show");
  timerText.closest(".timer")?.classList.toggle("urgent",seconds<=300);
  setTimeout(()=>warningToast.classList.remove("show"),6500);
}
timerToggle.addEventListener("click",()=>{
  const hidden=timerToggle.classList.toggle("time-hidden");
  timerToggle.setAttribute("aria-pressed",String(hidden));timerToggle.title=hidden?"Показати таймер":"Приховати таймер";
  timerText.classList.toggle("hide",hidden);timerHiddenLabel.classList.toggle("hide",!hidden);
});
function startStageTimer(){
  clearInterval(app.timerId);
  const update=()=>{
    app.secondsLeft=Math.max(0,Math.ceil((app.stageEndsAt-Date.now())/1000));timerText.textContent=fmtTime(app.secondsLeft);
    [600,300,60].forEach(x=>{if(app.secondsLeft<=x)showTimeWarning(x)});
    if(app.secondsLeft<=0){clearInterval(app.timerId);if(app.stage===1)startBreak(true);else finishWholeTest(true)}
  };
  update();app.timerId=setInterval(update,1000);
}
function startBreak(automatic=false){
  app.stage=2;clearInterval(app.timerId);syncExamMode();saveExamSession();breakModal.classList.add("show");
  app.stage2StartsAt=Math.max(app.stage2StartsAt||0,Date.now()+1000);
  const update=()=>{app.breakSeconds=Math.max(0,Math.ceil((app.stage2StartsAt-Date.now())/1000));breakTimerText.textContent=fmtTime(app.breakSeconds);if(app.breakSeconds<=0){clearInterval(app.breakId);beginStage2()}};
  clearInterval(app.breakId);update();app.breakId=setInterval(update,1000);
}
function beginStage2(){
  if(!app.user||(!isTestUser()&&Date.now()<EXAM_SCHEDULE.secondStart))return;
  clearInterval(app.breakId);breakModal.classList.remove("show");app.stage=3;app.subject="history";app.questionIndex=0;
  app.stageStartedAt=Date.now();if(!app.attemptStartedAt)app.attemptStartedAt=app.stageStartedAt;app.stageEndsAt=isTestUser()?app.stageStartedAt+7200*1000:EXAM_SCHEDULE.end;app.warned={};
  syncExamMode();saveExamSession();armExamGuard();updateSubjects();startStageTimer();renderQuestion();showView("exam");
}
skipBreakBtn.addEventListener("click",()=>{if(isTestUser())beginStage2()});
startStage2TestBtn.addEventListener("click",()=>{if(!isTestUser())return;if(!rulesAgree.checked){alert("Спочатку підтвердьте, що ознайомилися з правилами.");return}beginStage2()});
function resetParticipantProgress(){
  if(!isTestUser())return;
  if(pendingResults().length){alert("Дочекайтеся збереження попереднього результату.");return}
  clearInterval(app.timerId);clearInterval(app.breakId);
  app.stage=0;app.subject="ukrainian";app.questionIndex=0;app.secondsLeft=7200;app.breakSeconds=1200;app.answers={};app.answerTimes={};app.visited={};app.flagged={};app.attemptStartedAt=0;app.warned={};localStorage.removeItem(STORAGE.submissionId);
  localStorage.removeItem(STORAGE.answers);localStorage.removeItem(STORAGE.answerTimes);localStorage.removeItem(STORAGE.session);localStorage.removeItem("probne_nmt_visited_v4");localStorage.removeItem("probne_nmt_flagged_v4");syncExamMode();
  breakModal.classList.remove("show");resultModal.classList.remove("show");rulesAgree.checked=false;lobbyName.textContent=app.user?.name||app.user?.login||"Учасник";showView("lobby");
}
resetProgressBtn.addEventListener("click",resetParticipantProgress);
function keyFor(s,i){return `${s}:${i}`}
function normalizedAnswer(value){
  if(Array.isArray(value)&&!value.some(item=>item!==null&&item!==""&&item!==undefined))value=null;
  if(value===""||value===undefined)value=null;
  return JSON.stringify(value)
}
function hasUnsavedDraft(){
  if(!(app.stage===1||app.stage===3)||!QUESTION_BANK[app.subject]?.[app.questionIndex])return false;
  try{return normalizedAnswer(readAnswer())!==normalizedAnswer(app.answers[keyFor(app.subject,app.questionIndex)])}catch(error){return false}
}
function allowQuestionLeave(){return !hasUnsavedDraft()||confirm("Ви змінили відповідь, але не натиснули «Зберегти відповідь». Перейти далі без збереження?")}
function hasSaved(v){
  if(Array.isArray(v))return v.length>0&&v.some(x=>x!==null&&x!==""&&x!==undefined);
  return v!==undefined&&v!==null&&v!==""
}
function typeName(t){return {single:"Вибір однієї відповіді",match:"Установлення відповідності",number:"Коротка числова відповідь",sequence:"Хронологічна послідовність",multi:"Три правильні відповіді"}[t]||"Завдання"}
function optionBody(option){return option.html||option.text||option.id}
function answerControls(q,saved){
  if(q.type==="single"){
    const imageMode=q.options.some(o=>o.html&&(o.html.includes("<img")||o.html.includes("<svg")));
    return `<div class="answers ${imageMode?"image-options":""}">${q.options.map(o=>`<label class="answer"><input type="radio" name="ans" value="${esc(o.id)}" ${saved===o.id?"checked":""}><span class="option-id">${esc(o.id)}</span><span class="option-body">${optionBody(o)}</span></label>`).join("")}</div>`;
  }
  if(q.type==="number")return `<div class="field numeric"><label>Ваша відповідь</label><input id="numericAnswer" value="${esc(saved??"")}" inputmode="decimal" placeholder="Введіть число"></div>`;
  if(q.type==="match"){
    const values=Array.isArray(saved)?saved:Array(q.rows.length).fill("");
    return `<div class="match-layout"><div class="match-grid-v4">${q.rows.map((row,i)=>`<div class="match-row-v4"><div class="row-copy"><b>${i+1}.</b> ${row}</div><select class="matchSel" data-i="${i}" onchange="enforceUniqueMatch(this)"><option value="">Оберіть відповідь</option>${q.options.map(o=>`<option value="${esc(o.id)}" ${values[i]===o.id?"selected":""}>${esc(o.id)}</option>`).join("")}</select></div>`).join("")}</div><div class="choice-bank">${q.options.map(o=>`<div><b>${esc(o.id)}</b><span>${optionBody(o)}</span></div>`).join("")}</div></div>`;
  }
  if(q.type==="sequence"){
    const values=Array.isArray(saved)?saved:Array(4).fill("");
    return `<div class="choice-bank">${q.options.map(o=>`<div><b>${esc(o.id)}</b><span>${optionBody(o)}</span></div>`).join("")}</div><div class="sequence-list">${[0,1,2,3].map(i=>`<label class="sequence-row"><b>${i+1}-ша</b><select class="orderSel" data-i="${i}"><option value="">Оберіть</option>${q.options.map(o=>`<option value="${esc(o.id)}" ${values[i]===o.id?"selected":""}>${esc(o.id)}</option>`).join("")}</select></label>`).join("")}</div>`;
  }
  if(q.type==="multi"){
    const values=Array.isArray(saved)?saved:[];
    return `<div class="answers">${q.options.map(o=>`<label class="answer"><input type="checkbox" name="multi" value="${esc(o.id)}" ${values.includes(o.id)?"checked":""}><span class="option-id">${esc(o.id)}</span><span class="option-body">${optionBody(o)}</span></label>`).join("")}</div><div class="notice">Оберіть рівно три варіанти.</div>`;
  }
  return "";
}
function enforceUniqueMatch(source){
  const selects=[...document.querySelectorAll(".matchSel")];
  if(source&&source.value&&selects.some(x=>x!==source&&x.value===source.value)){
    source.value="";alert("Цю відповідь уже вибрано для іншого рядка.");
  }
  const used=new Set(selects.map(x=>x.value).filter(Boolean));
  selects.forEach(select=>[...select.options].forEach(option=>{option.disabled=Boolean(option.value&&used.has(option.value)&&select.value!==option.value)}));
}
function renderQuestion(){
  if(!(app.stage===1||app.stage===3))return;updateSubjects();const q=QUESTION_BANK[app.subject]?.[app.questionIndex];if(!q)return;
  const key=keyFor(app.subject,app.questionIndex);app.visited[key]=true;localStorage.setItem("probne_nmt_visited_v4",JSON.stringify(app.visited));
  questionTitle.textContent=`${LABELS[app.subject]} · завдання ${q.number}`;typePill.textContent=typeName(q.type);
  const saved=app.answers[key];questionContent.innerHTML=`<article class="question-card imported-question"><div class="source-toolbar"><b>${esc(q.source)}</b><span></span></div>${q.promptHtml}</article>${answerControls(q,saved)}`;
  savedMessage.classList.remove("show");
  if(q.type==="match")enforceUniqueMatch();
  if(q.type==="multi")document.querySelectorAll('input[name="multi"]').forEach(ch=>ch.addEventListener("change",()=>{const selected=[...document.querySelectorAll('input[name="multi"]:checked')];if(selected.length>3){ch.checked=false;alert("У цьому завданні можна вибрати лише три відповіді.")}}));
  renderPalette();
}
function readAnswer(){
  const q=QUESTION_BANK[app.subject][app.questionIndex];
  if(q.type==="single"){const x=document.querySelector('input[name="ans"]:checked');return x?x.value:null}
  if(q.type==="number")return numericAnswer.value.trim().replace(".",",");
  if(q.type==="match"){const a=[];document.querySelectorAll(".matchSel").forEach(x=>a[Number(x.dataset.i)]=x.value||null);return a}
  if(q.type==="sequence"){const a=[];document.querySelectorAll(".orderSel").forEach(x=>a[Number(x.dataset.i)]=x.value||null);return a}
  if(q.type==="multi")return [...document.querySelectorAll('input[name="multi"]:checked')].map(x=>x.value).sort();
  return null;
}
function saveCurrentAnswer(show=true){
  if(!(app.stage===1||app.stage===3)||!QUESTION_BANK[app.subject]?.length)return;
  const v=readAnswer(),key=keyFor(app.subject,app.questionIndex);app.answers[key]=v;app.answerTimes[key]=new Date().toISOString();localStorage.setItem(STORAGE.answers,JSON.stringify(app.answers));localStorage.setItem(STORAGE.answerTimes,JSON.stringify(app.answerTimes));saveExamSession();
  if(show){savedMessage.classList.add("show");setTimeout(()=>savedMessage.classList.remove("show"),1400)}renderPalette();
}
saveAnswerBtn.addEventListener("click",()=>saveCurrentAnswer(true));
questionContent.addEventListener("change",e=>{if(e.target.matches(".orderSel")&&e.target.value){document.querySelectorAll(".orderSel").forEach(x=>{if(x!==e.target&&x.value===e.target.value)x.value=""})}if(e.target.matches(".matchSel"))enforceUniqueMatch(e.target)});
function renderPalette(){
  palette.innerHTML="";(QUESTION_BANK[app.subject]||[]).forEach((q,i)=>{
    const key=keyFor(app.subject,i),b=document.createElement("button");b.className="qbtn";b.textContent=i+1;
    if(hasSaved(app.answers[key]))b.classList.add("savedQ");else if(app.visited[key])b.classList.add("visitedQ");if(i===app.questionIndex)b.classList.add("current");
    b.setAttribute("aria-label",`Завдання ${i+1}`);
    b.onclick=()=>{if(i===app.questionIndex||allowQuestionLeave()){app.questionIndex=i;saveExamSession();renderQuestion()}};palette.appendChild(b);
  });
}

document.querySelectorAll(".exam-tab").forEach(b=>b.addEventListener("click",()=>{
  if(b.dataset.examtab!=="examview"&&!allowQuestionLeave())return;
  document.querySelectorAll(".exam-tab").forEach(x=>x.classList.toggle("active",x===b));
  document.getElementById("examview").classList.toggle("hide-view",b.dataset.examtab!=="examview");
  reference.classList.toggle("active",b.dataset.examtab==="reference");
  instruction.classList.toggle("active",b.dataset.examtab==="instruction");
}));

function stageMissing(){
  const out=[];activeSubjects().forEach(subject=>{const numbers=[];QUESTION_BANK[subject].forEach((q,i)=>{if(!hasSaved(app.answers[keyFor(subject,i)]))numbers.push(i+1)});if(numbers.length)out.push({subject,numbers})});return out
}
function openFinishModal(auto=false){
  if(!auto&&!allowQuestionLeave())return;
  const miss=stageMissing(),total=miss.reduce((sum,item)=>sum+item.numbers.length,0);
  finishTitle.textContent=app.stage===1?"Перевірка першого етапу":"Перевірка перед завершенням";
  finishSummary.textContent=total?'Не збережено відповідей: '+total+'. Натисніть номер, щоб повернутися до завдання, або підтвердьте завершення.':"Усі завдання активного етапу мають збережені відповіді. Після підтвердження повернутися буде неможливо.";
  finishMissing.innerHTML=miss.map(item=>'<section class="missing-group"><strong>'+esc(LABELS[item.subject])+'</strong><div class="missing-buttons">'+item.numbers.map(number=>'<button class="missing-jump" data-subject="'+item.subject+'" data-index="'+(number-1)+'">'+number+'</button>').join("")+'</div></section>').join("");
  finishModal.classList.add("show");
}
finishStageBtn.addEventListener("click",()=>openFinishModal(false));
finishMissing.addEventListener("click",event=>{const button=event.target.closest(".missing-jump");if(!button)return;finishModal.classList.remove("show");app.subject=button.dataset.subject;app.questionIndex=Number(button.dataset.index);saveExamSession();updateSubjects();renderQuestion();showView("exam")});
cancelFinish.addEventListener("click",()=>finishModal.classList.remove("show"));
confirmFinish.addEventListener("click",()=>{
  finishModal.classList.remove("show");
  if(app.stage===1)startBreak();else finishWholeTest()
});

function normalizeNumber(v){const x=String(v??"").trim().replace(/\s+/g,"").replace(/[−–—]/g,"-").replace(",",".");const n=Number(x);return Number.isFinite(n)?String(n):x}
function scoreQuestion(q,answer){
  if(q.type==="single")return answer===q.correct?1:0;
  if(q.type==="number")return normalizeNumber(answer)===normalizeNumber(q.correct)?2:0;
  if(q.type==="match")return q.correct.reduce((sum,key,i)=>sum+(Array.isArray(answer)&&answer[i]===key?1:0),0);
  if(q.type==="multi")return q.correct.reduce((sum,key)=>sum+(Array.isArray(answer)&&answer.includes(key)?1:0),0);
  if(q.type==="sequence"){
    if(!Array.isArray(answer))return 0;if(answer.join("")===q.correct.join(""))return 3;
    const first=answer[0]===q.correct[0],last=answer[3]===q.correct[3];return first&&last?2:first||last?1:0;
  }
  return 0;
}
function maxQuestion(q){if(q.type==="number")return 2;if(q.type==="match")return q.rows.length;if(q.type==="sequence"||q.type==="multi")return 3;return 1}
async function finishWholeTest(automatic=false){
  clearInterval(app.timerId);app.stage=4;saveExamSession();syncExamMode();
  resultGrid.innerHTML='<div class="result"><span>Результат</span><br><strong>Надсилаємо…</strong></div>';
  deliveryState.className="delivery-state";deliveryState.textContent="Не закривайте сторінку до підтвердження збереження. Якщо інтернет зникне, результат залишиться в локальній черзі.";
  resultModal.classList.add("show");
  const payload=buildResultPayload();queueResult(payload);
  const sent=await flushPendingResults(true);
  if(sent){localStorage.removeItem(STORAGE.session)}
  else{deliveryState.className="delivery-state";deliveryState.textContent="Результат надійно збережено в черзі цього браузера. Надсилання повториться автоматично після відновлення інтернету."}
}
repeatTestBtn.addEventListener("click",resetParticipantProgress);resultHome.addEventListener("click",()=>{resultModal.classList.remove("show");showView("home")});

/* Соцмережі */
function socialIcon(name){
  const paths={telegram:'<path d="M21 3 3.8 9.6c-1.2.5-1.2 1.2-.2 1.5l4.4 1.4 1.7 5.2c.2.7.1 1 .8 1 .5 0 .8-.2 1-.5l2.5-2.4 5 3.7c.9.5 1.6.2 1.8-.9L23 4.5C23.3 3.2 22.5 2.6 21 3Z"/>',instagram:'<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>',tiktok:'<path d="M15 4v10.2a4.2 4.2 0 1 1-3.6-4.1M15 4c.8 2.5 2.3 3.8 5 4"/>',site:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',viber:'<path d="M5 4.8A10.5 10.5 0 0 1 19 5c2.2 2.2 2.4 7.5.7 10.2-1.5 2.3-4.8 3.8-8 3.4L7 21v-3.7C3.6 14.8 2.6 8.3 5 4.8Z"/>',youtube:'<path d="M21 8.2a2.7 2.7 0 0 0-1.9-1.9C17.4 5.8 12 5.8 12 5.8s-5.4 0-7.1.5A2.7 2.7 0 0 0 3 8.2 28 28 0 0 0 2.5 12 28 28 0 0 0 3 15.8a2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.1.5 7.1.5s5.4 0 7.1-.5a2.7 2.7 0 0 0 1.9-1.9 28 28 0 0 0 .5-3.8 28 28 0 0 0-.5-3.8Z"/><path d="m10 9 5 3-5 3Z"/>'};
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+(paths[name]||paths.site)+'</svg>';
}
function socialButton(name,label,url){return url?'<a class="social" target="_blank" rel="noopener" href="'+esc(url)+'" aria-label="'+esc(label)+'" title="'+esc(label)+'">'+socialIcon(name)+'</a>':''}
function renderSocials(settings=getLocalSettings()){
  const defaults={math:{telegram:"https://t.me/kolisnyk_academy",tiktok:"https://www.tiktok.com/@kolisnyk_academy",site:"https://olexanderkolsnyk.github.io/Kolisnyk-Academy/",viber:"https://r.mssg.me/m/697bfcc0610fc48495b6ee1d",instagram:"https://www.instagram.com/kolisnyk_academy",youtube:"https://www.youtube.com/@kolisnyk_academy"},other:{telegram:"https://t.me/lessons4you",tiktok:"https://www.tiktok.com/@lessons.4.you?is_from_webapp=1&sender_device=pc",site:"https://www.lessons4you.party",instagram:"https://www.instagram.com/lessons.4.you?stkn=eWkzbnVybnd5M3U0"}};
  const s=settings.socials||{},merge=(base,values)=>({...base,...Object.fromEntries(Object.entries(values||{}).filter(([,value])=>value))}),m=merge(defaults.math,s.math),o=merge(defaults.other,s.other);
  mathSocials.innerHTML=socialButton("telegram","Telegram Kolisnyk Academy",m.telegram)+socialButton("tiktok","TikTok Kolisnyk Academy",m.tiktok)+socialButton("site","Сайт Kolisnyk Academy",m.site)+socialButton("viber","Viber Kolisnyk Academy",m.viber)+socialButton("instagram","Instagram Kolisnyk Academy",m.instagram)+socialButton("youtube","YouTube Kolisnyk Academy",m.youtube);
  otherSocials.innerHTML=socialButton("telegram","Telegram Lessons for You",o.telegram)+socialButton("tiktok","TikTok Lessons for You",o.tiktok)+socialButton("site","Сайт Lessons for You",o.site)+socialButton("instagram","Instagram Lessons for You",o.instagram);
}
renderSocials();

/* Прихований вхід в адмінку: 6 кліків по номеру версії або Ctrl+Shift+K.
   Це лише приховує точку входу. Реальний захист має бути серверним. */
let knockTimes=[];
versionKnock.addEventListener("click",()=>{
  const now=Date.now();knockTimes=knockTimes.filter(t=>now-t<3500);knockTimes.push(now);
  if(knockTimes.length>=6){knockTimes=[];showView("admin")}
});
document.addEventListener("keydown",e=>{
  if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==="k"){e.preventDefault();if(!activeExamStage())showView("admin")}
});

async function adminAuth(){
  const box=adminStatus;
  if(!CONFIG.SHEETS_ENDPOINT){
    box.className="status err show";
    box.textContent="Безпечна адмінка вимкнена, доки не підключено Google Apps Script. Це навмисно: пароль адміністратора не має зберігатися в HTML.";
    return
  }
  try{
    const res=await api({action:"adminAuth",password:adminPassword.value});
    app.adminToken=res.token;
    adminLoginCard.classList.add("hide");adminPanel.classList.remove("hide");
    await loadAdmin()
  }catch(e){box.className="status err show";box.textContent=e.message}
}
adminLoginBtn.addEventListener("click",adminAuth);

async function loadAdmin(){
  if(!app.adminToken)return;
  const res=await api({action:"adminList",token:app.adminToken});
  const s=res.settings;
  adminDeadline.value=(s.deadline||CONFIG.DEFAULT_DEADLINE).slice(0,16);
  adminTestStart.value=(s.testStart||CONFIG.DEFAULT_TEST_START).slice(0,16);
  adminRegOpen.value=s.registrationOpen===false?"no":"yes";
  const social=s.socials||{math:{},other:{}};
  mathTelegram.value=social.math?.telegram||"";
  mathInstagram.value=social.math?.instagram||"";
  mathTiktok.value=social.math?.tiktok||"";
  otherTelegram.value=social.other?.telegram||"";
  otherInstagram.value=social.other?.instagram||"";
  otherTiktok.value=social.other?.tiktok||"";
  participantsBody.innerHTML=(res.participants||[]).map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.name)}</td><td>${esc(p.phone)}</td><td>${esc(p.telegram)}</td><td>${esc(p.email)}</td><td>${esc(p.grade)}</td><td>${esc(p.city)}</td><td>${esc(p.login)}</td><td><span class="tag">${esc(p.status)}</span></td></tr>`).join("")||`<tr><td colspan="9" style="text-align:center;padding:26px;color:var(--muted)">Немає учасників</td></tr>`;
  renderSocials(s)
}
refreshAdmin.addEventListener("click",loadAdmin);
function downloadCredentials(rows){
  const csv="\ufeff"+[["Ім’я","Контакт","Логін","Пароль"],...rows.map(x=>[x.name,x.contact||x.telegram||x.email||"",x.login,x.password])].map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="test-access.csv";a.click();URL.revokeObjectURL(a.href);
}
createAccessBtn.addEventListener("click",async()=>{try{const res=await api({action:"adminCreateAccess",token:app.adminToken,name:accessName.value.trim(),contact:accessContact.value.trim()});credentialOutput.classList.remove("hide");credentialOutput.textContent="Логін: "+res.credential.login+"\nПароль: "+res.credential.password+"\nЗбережіть пароль зараз: повторно він не показується.";downloadCredentials([res.credential]);await loadAdmin()}catch(e){alert(e.message)}});
importMainBtn.addEventListener("click",async()=>{try{const res=await api({action:"adminImportSource",token:app.adminToken});credentialOutput.classList.remove("hide");credentialOutput.textContent=res.credentials.length?"Створено доступів: "+res.credentials.length+". CSV завантажено.":"Нових учасників для імпорту немає.";if(res.credentials.length)downloadCredentials(res.credentials);await loadAdmin()}catch(e){alert(e.message)}});

saveAdminSettings.addEventListener("click",async()=>{
  try{
    const settings={
      deadline:adminDeadline.value,
      testStart:adminTestStart.value,
      registrationOpen:adminRegOpen.value==="yes",
      socials:{
        math:{telegram:mathTelegram.value.trim(),instagram:mathInstagram.value.trim(),tiktok:mathTiktok.value.trim()},
        other:{telegram:otherTelegram.value.trim(),instagram:otherInstagram.value.trim(),tiktok:otherTiktok.value.trim()}
      }
    };
    await api({action:"adminSaveSettings",token:app.adminToken,settings});
    alert("Збережено.");await loadAdmin()
  }catch(e){alert(e.message)}
});
exportAdminCsv.addEventListener("click",async()=>{
  try{
    const res=await api({action:"adminList",token:app.adminToken});
    const rows=[["ПІБ","Телефон","Telegram","Email","Клас","Місто","Логін","Статус"]];
    (res.participants||[]).forEach(p=>rows.push([p.name,p.phone,p.telegram,p.email,p.grade,p.city,p.login,p.status]));
    const csv="\ufeff"+rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(";")).join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");
    a.href=URL.createObjectURL(blob);a.download="probne_nmt_registrations.csv";a.click();URL.revokeObjectURL(a.href)
  }catch(e){alert(e.message)}
});

window.addEventListener("beforeunload",e=>{if(activeExamStage()){e.preventDefault();e.returnValue=""}});
window.addEventListener("popstate",()=>{if(activeExamStage()){history.pushState({examGuard:true},"",location.href);alert("Під час активного тестування вихід заблоковано. Спочатку завершіть етап.")}});
function restorePersistedSession(){
  if(!persistedSession?.user||![1,2,3].includes(app.stage))return;
  lobbyName.textContent=app.user.name||app.user.login||"Учасник";
  syncExamMode();armExamGuard();showView("exam");updateSubjects();
  if(app.stage===2){startBreak()}else{renderQuestion();startStageTimer()}
  warningToast.textContent="Сеанс і всі збережені відповіді відновлено.";warningToast.classList.add("show");setTimeout(()=>warningToast.classList.remove("show"),5000);
}
updateTestControls();
restorePersistedSession();
window.addEventListener("online",()=>{warningToast.textContent="Інтернет відновлено. Перевіряємо чергу результатів…";warningToast.classList.add("show");flushPendingResults(Boolean(resultModal.classList.contains("show"))).finally(()=>setTimeout(()=>warningToast.classList.remove("show"),4500))});
window.addEventListener("offline",()=>{warningToast.textContent="Немає інтернету. Збережені відповіді залишаються на цьому пристрої.";warningToast.classList.add("show")});
window.addEventListener("pagehide",()=>{if(activeExamStage())saveExamSession()});document.addEventListener("visibilitychange",()=>{if(document.hidden&&activeExamStage())saveExamSession()});
if(pendingResults().length){app.stage=4;syncExamMode();resultGrid.innerHTML='<div class="result"><span>Результат</span><br><strong>Очікує надсилання</strong></div>';deliveryState.className="delivery-state";deliveryState.textContent="Знайдено ненадісланий результат. Повторюємо надсилання автоматично.";resultModal.classList.add("show");flushPendingResults(true)}

/* Публічні налаштування із Google Sheets */
(async()=>{
  if(CONFIG.SHEETS_ENDPOINT){
    try{
      const res=await api({action:"publicConfig"});
      if(res.settings){
        saveLocalSettings(res.settings);renderSocials(res.settings)
      }
    }catch(e){}
  }
})();
