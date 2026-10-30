const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto'),path=require('path');
const root=path.resolve(__dirname,'..');
// Synthetic grading fixture; contains no real exam keys.
const bank=vm.runInNewContext(fs.readFileSync(path.join(root,'assets/exam-data.js'),'utf8')+';IMPORTED_EXAMS');
const keys={version:'pnmt-2026-10-30',subjects:Object.fromEntries(Object.entries(bank).map(([s,qs])=>[s,qs.map(q=>({number:q.number,type:q.type,...(q.rows?{rows:q.rows.length}:{}),correct:q.type==='number'?'0.25':q.type==='single'?q.options[0].id:q.options.slice(0,q.type==='match'?q.rows.length:q.type==='multi'?3:4).map(o=>o.id)}))]))};
const props=Object.fromEntries(Object.entries(keys.subjects).map(([s,k])=>['PNMT_KEYS_'+keys.version+'_'+s,JSON.stringify(k)]));
props.PNMT_PARTICIPANT_SESSION_KEY='synthetic-local-test-key';
const resultCache={};
let answerLockCount=0;
const ctx={CacheService:{getScriptCache:()=>({get:k=>resultCache[k]||null,put:(k,v)=>resultCache[k]=v})},LockService:{getScriptLock:()=>({waitLock:()=>{answerLockCount++;},releaseLock:()=>{}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v})},Utilities:{base64EncodeWebSafe:v=>Buffer.from(typeof v==='string'?v:v).toString('base64url'),base64DecodeWebSafe:v=>Buffer.from(v,'base64url'),computeHmacSha256Signature:(s,k)=>crypto.createHmac('sha256',k).update(s).digest(),newBlob:v=>({getDataAsString:()=>Buffer.from(v).toString()}),Charset:{UTF_8:'utf8'}},safeEqual_:(a,b)=>a===b,createSecureToken_:()=>crypto.randomUUID(),withLock_:f=>f(),digestHex_:v=>crypto.createHash('sha256').update(v).digest('hex')};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'apps-script/ExamResults.gs'),'utf8'),ctx);
const right={};for(const [s,qs] of Object.entries(keys.subjects))qs.forEach((q,i)=>right[s+':'+i]=q.correct);
let graded=ctx.pnmtGrade_(right);
for(const r of Object.values(graded.results))assert.equal(r.points,r.max);
assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(graded.results).map(([s,r])=>[s,r.max])))),{ukrainian:45,math:32,history:54,english:32});
assert.equal(graded.rows.length,114);
assert(Object.values(ctx.pnmtGrade_({}).results).every(r=>r.points===0&&r.answered===0));
assert.equal(ctx.pnmtNumeric_(''),null);assert.equal(ctx.pnmtNumeric_('−0,25'),'-0.25');assert.equal(ctx.pnmtNumeric_('=IMPORTXML()'),null);
const sequence={subject:'history',type:'sequence',correct:['А','Б','В','Г']};
assert.equal(ctx.pnmtPoints_(sequence,ctx.pnmtCanonicalAnswer_(sequence,['А','В','Б','Г'])),2);
assert.equal(ctx.pnmtCanonicalAnswer_(sequence,['А','А','В','Г']),null);
assert.equal(ctx.pnmtCanonicalAnswer_({subject:'history',type:'multi'},['1','1','3']),null);
assert.equal(ctx.pnmtCanonicalAnswer_({subject:'history',type:'multi'},['1','2','3','4']),null);
const record={RegistrationID:'test-registration',Login:'synthetic-login',Status:'Тестовий'};
const token=ctx.pnmtIssueSession_(record);
assert.equal(ctx.pnmtRequireParticipant_({token,login:record.Login}).registration_id,record.RegistrationID);
assert.throws(()=>ctx.pnmtRequireParticipant_({token:token+'x',login:record.Login}));
assert.throws(()=>ctx.pnmtRequireParticipant_({token,login:'another-login'}));
// Minimal Sheets implementation exercises the actual writer, duplicate path and failed summary repair.
class Sheet{
 constructor(headers,rows=[]){this.data=[headers,...rows];this.max=1000;}
 getLastRow(){return this.data.length;}getLastColumn(){return this.data[0].length;}getMaxRows(){return this.max;}insertRowsAfter(_,n){this.max+=n;}
 getRange(r,c,n=1,m=1){const self=this;return {getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>self.data[r+i-1]?.[c+j-1]??'')),setValues:values=>{if(self.failSummary){self.failSummary=false;throw Error('simulated sheet failure');}values.forEach((row,i)=>row.forEach((v,j)=>{(self.data[r+i-1]??=[])[c+j-1]=v;}));},setValue:v=>{if(self.failSummary){self.failSummary=false;throw Error('simulated sheet failure');}(self.data[r-1]??=[])[c-1]=v;},createTextFinder:text=>{let exact=true;return {matchEntireCell:v=>{exact=v;return this.finder(text,r,c,n,exact);},findNext:()=>this.finder(text,r,c,n,exact).findNext()};}};}
 finder(text,r,c,n,exact){return {findNext:()=>{for(let i=r;i<r+n;i++){const v=String(this.data[i-1]?.[c-1]??'');if(exact?v===text:v.includes(text))return {getRow:()=>i};}return null;}};}
}
const headers=['RegistrationID','Login','Status','AccessStatus','PasswordHash','PasswordCiphertext','Українська мова','Математика','Історія України','Англійська мова'];
const reg=new Sheet(headers,[[record.RegistrationID,record.Login,'Тестовий','Активний','preserve-hash','preserve-ciphertext','','','','']]);
const answers=new Sheet(['Timestamp','AttemptID','RegistrationID','Subject','QuestionNumber','Answer','Points','MaxPoints','AnswerSavedAt','ServerReceivedAt']);
const sheets={Registrations:reg,Answers:answers};
Object.assign(ctx,{getSpreadsheet_:()=>({getSheetByName:name=>sheets[name]}),sheetHeaders_:sheet=>sheet.data[0],headerIndex_:(sheet,h)=>sheet.data[0].indexOf(h)+1,findRowByValue_:(sheet,h,value)=>{const i=sheet.data.findIndex((row,i)=>i&&row[sheet.data[0].indexOf(h)]===value);return i<0?0:i+1;},ensureSheet_:(_,name)=>sheets[name],SpreadsheetApp:{flush:()=>{}}});
const payload={token,login:record.Login,exam_version:keys.version,client_submission_id:'synthetic-submission',answers:right};
reg.failSummary=true;
assert.throws(()=>ctx.pnmtSaveResult_(payload),/simulated/);
assert.equal(answers.data.length,115);
const retry=ctx.pnmtSaveResult_({...payload,answers:{}});
assert.equal(retry.duplicate,true);assert.equal(answers.data.length,115);
assert.equal(retry.results.english.points,32);assert.equal(reg.data[1][4],'preserve-hash');assert.equal(reg.data[1][5],'preserve-ciphertext');
assert.deepEqual(reg.data[1].slice(6),[45,32,54,32]);
const beforeCachedRetry=answerLockCount;
assert.equal(ctx.pnmtSaveResult_(payload).duplicate,true);
assert.equal(answerLockCount,beforeCachedRetry,'Confirmed retries must not acquire the writer lock');
reg.data[1][3]='Без доступу';assert.throws(()=>ctx.pnmtSaveResult_(payload));reg.data[1][3]='Активний';
assert.throws(()=>ctx.pnmtSaveResult_({...payload,exam_version:'old'}));
console.log('PASS: 114 keys, max scores, blanks, numeric formats, invalid selections, signed sessions, result persistence, retry repair and credential preservation');
