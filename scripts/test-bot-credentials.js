const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../apps-script/bot/CredentialSafety.gs'), 'utf8');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fields = ['RegistrationID','Status','Login','Password','PasswordHash','PasswordSalt','AccessStatus','PasswordCiphertext','CredentialIssuedAt','CredentialDeliveredAt','PasswordHashScheme','Математика'];
let fresh, writes, generated;
const headers = Object.fromEntries(fields.map((f,i) => [f,i+1]));
const sheet = {getLastRow:()=>2,getLastColumn:()=>fields.length,getRange(row,col,numRows){return {
  setValue(value){const field=fields[col-1];writes.push(field);fresh[field]=value;},
  getValues(){return [fields.map(f=>fresh[f]||'')];}
};}};
const ctx = vm.createContext({
  console, Date, LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  getSourceSheet:()=>sheet,readSourceRow:()=>({...fresh}),ensureSourceCredentialHeaders_:()=>headers,
  credentialDigestHex_:digest,safeCredentialEqual_:(a,b)=>a===b,
  openCredential_:c=>{if(!c.startsWith('sealed:'))throw Error('corrupt');return c.slice(7);},
  sealCredential_:p=>'sealed:'+p,randomSourcePassword_:()=>{generated++;return 'new-password';},
  secureSourceToken_:()=> 'new-salt',uniqueSourceLogin_:()=> 'NEW-LOGIN',setParticipantField(){},
  getParticipantByTelegramId:()=>({TelegramID:'test'}),resolveSourceForParticipant:()=>({...fresh,__row:2})
});
vm.runInContext(code,ctx);
const original={RegistrationID:'test-id',Login:'KEEP-LOGIN',PasswordSalt:'keep-salt',PasswordHash:digest('keep-salt:keep-password'),AccessStatus:'Активний',Status:'Дані доступу видано',CredentialIssuedAt:'old-date','Математика':177};
function reset(extra={}){fresh={...original,...extra};writes=[];generated=0;}
function issue(){return ctx.getCredentialsByTelegramId('test');}
for(const variant of [{Password:'keep-password'},{PasswordCiphertext:'sealed:keep-password'},{Password:'keep-password',PasswordCiphertext:'sealed:keep-password'}]){
  reset(variant); const before={...fresh};assert.equal(issue().Password,'keep-password');assert.equal(issue().Password,'keep-password');assert.equal(generated,0);
  for(const f of ['Login','PasswordHash','PasswordSalt','Password','PasswordCiphertext','CredentialIssuedAt','Математика'])assert.equal(fresh[f],before[f]);
  assert.ok(writes.every(f=>['Status','CredentialDeliveredAt'].includes(f)));
}
for(const extra of [{Password:'wrong'},{PasswordCiphertext:'sealed:wrong'},{PasswordCiphertext:'corrupt'},{Password:'keep-password',PasswordCiphertext:'sealed:other'},{Password:'keep-password',PasswordSalt:''},{Password:'keep-password',PasswordHash:''},{}]){
  reset(extra);assert.throws(issue);assert.equal(generated,0);assert.deepEqual(writes,[]);
}
for(const extra of [{AccessStatus:'Без доступу'},{AccessStatus:'Заблоковано'},{Status:'Запізніла реєстрація'},{Status:'Відмовлено'},{Status:'Дубль'}]){
  reset({...extra,Password:'keep-password'});assert.equal(issue(),null);assert.deepEqual(writes,[]);assert.equal(ctx.sourcePasswordMatches_(fresh,'keep-password'),false);
}
reset({Status:'Тестовий',Password:'keep-password'});issue();assert.equal(fresh.Status,'Тестовий');
reset();fresh={RegistrationID:'new','Математика':177};const created=issue();assert.equal(created.Password,'new-password');assert.equal(fresh.PasswordHash,digest(fresh.PasswordSalt+':'+created.Password));assert.equal(fresh.PasswordCiphertext,'sealed:'+created.Password);assert.equal(fresh['Математика'],177);assert.equal(generated,1);issue();assert.equal(generated,1);
for(const extra of [{Login:'already-issued'},{PasswordHash:'old-hash'},{PasswordSalt:'old-salt'},{CredentialIssuedAt:'old'},{CredentialDeliveredAt:'old'},{Password:'old'},{PasswordCiphertext:'old'}]){
  fresh={RegistrationID:'old',...extra,'Математика':177};writes=[];generated=0;ctx.generatePendingCredentials();assert.equal(generated,0);assert.deepEqual(writes,[]);
}
reset({Password:'keep-password'});assert.equal(ctx.sourcePasswordMatches_(fresh,'keep-password'),true);assert.equal(ctx.sourcePasswordMatches_(fresh,'wrong'),false);
console.log('Credential safety passed: legacy, encrypted, repeat issuance, partial, corrupt, denied, new, score preservation, background generation.');
