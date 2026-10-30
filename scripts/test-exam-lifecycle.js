// Run with Playwright installed, or set PNMT_PLAYWRIGHT to its package directory.
// Only local fixtures are used. No requests or results reach production.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PNMT_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..');
const output=process.env.PNMT_QA_OUTPUT;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
 const url='https://pnmt.local.test/';
 async function serveFixture(route){
  const pathname=new URL(route.request().url()).pathname;
  const file=path.resolve(root,pathname==='/'?'index.html':'.'+pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.pdf':'application/pdf'}[path.extname(file)]||'application/octet-stream';
  return route.fulfill({status:200,contentType:mime,headers:{'Cache-Control':'no-store'},body:fs.readFileSync(file)});
 }
 const browser=await chromium.launch({headless:true,...(process.env.PNMT_CHROME?{executablePath:process.env.PNMT_CHROME}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Europe/Kyiv'});
 const page=await context.newPage(),errors=[];
 let saves=0,saveSucceeds=false;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 page.on('console',m=>{if(m.type()==='error')console.error('Fixture console:',m.text());});
 page.on('requestfailed',r=>{if(r.url().startsWith(url))console.error('Fixture request failed:',r.url(),r.failure()?.errorText);});
 await context.route('**/*',async route=>{
  if(route.request().url().startsWith(url))return serveFixture(route);
  if(!route.request().url().startsWith('https://script.google.com/'))return route.abort();
  let payload={};try{payload=JSON.parse(route.request().postData()||'{}');}catch{}
  let data={ok:true,config:{}};
  if(payload.action==='login')data={ok:true,user:{name:'Технічна перевірка',registration_id:'local-fixture',login:'local-fixture',token:'local-fixture',testAccess:false}};
  if(payload.action==='saveResult'){
   saves++;await sleep(150);data=saveSucceeds?{ok:true,results:{}}:{ok:false,error:'Тимчасово немає підтвердження від сервера.'};
  }
  await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
 });
 try{
  await page.clock.setFixedTime(new Date('2026-10-31T08:59:59+02:00'));
  await page.addInitScript(()=>{
   const stale={user:{login:'old-fixture'},stage:4};
   for(const prefix of ['', 'pnmt:/:','pnmt:/:pnmt-2026-10-30:']){
    localStorage.setItem(prefix+'probne_nmt_session_v37',JSON.stringify(stale));
    localStorage.setItem(prefix+'probne_nmt_pending_results_v39',JSON.stringify([{action:'saveResult',login:'old-fixture'}]));
    localStorage.setItem(prefix+'probne_nmt_answers_v36',JSON.stringify({'math:0':'А'}));
   }
  });
  await page.goto(url,{waitUntil:'networkidle'});
  assert.equal(await page.evaluate(()=>app.stage),0);
  assert.equal(await page.evaluate(()=>Object.keys(app.answers).length),0);
  assert.equal(await page.evaluate(()=>pendingResults().length),0);
  assert.equal(await page.locator('#resultModal').evaluate(e=>e.classList.contains('show')),false);
  assert.equal(saves,0);
  console.log('PASS old sessions, answers and failed queues do not enter the October 31 exam');
  await page.locator('.desktop-nav [data-nav="login"]').click();
  async function login(){await page.locator('#loginInput').fill('local-fixture');await page.locator('#passwordInput').fill('local-fixture');await page.locator('#loginForm button[type="submit"]').click();}
  await login();await page.waitForFunction(()=>loginStatus.textContent.includes('09:00'));
  assert.equal(await page.evaluate(()=>app.user),null);
  await page.clock.setFixedTime(new Date('2026-10-31T09:00:00+02:00'));
  await login();await page.locator('#lobby.active').waitFor();await page.locator('#rulesAgree').check();
  assert(await page.locator('#startTestBtn').isDisabled());
  await page.clock.setFixedTime(new Date('2026-10-31T10:00:00+02:00'));
  await page.waitForFunction(()=>!startTestBtn.disabled);await page.locator('#startTestBtn').click();
  assert.equal(await page.evaluate(()=>app.stage),1);
  await page.locator('#questionContent input[name="ans"]').first().check();await page.locator('#saveAnswerBtn').click();
  console.log('PASS login opens at 09:00; first session opens at 10:00 Kyiv time');
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00+02:00'));
  await page.waitForFunction(()=>app.stage===2);
  assert(await page.locator('#secondStageAgree').isDisabled());assert(await page.locator('#skipBreakBtn').isDisabled());
  await page.evaluate(()=>beginStage2());assert.equal(await page.evaluate(()=>app.stage),2);
  await page.clock.setFixedTime(new Date('2026-10-31T12:19:59+02:00'));
  await page.evaluate(()=>updateScheduledExperience());assert(await page.locator('#skipBreakBtn').isDisabled());
  await page.clock.setFixedTime(new Date('2026-10-31T12:20:00+02:00'));
  await page.waitForFunction(()=>!secondStageAgree.disabled);assert(await page.locator('#skipBreakBtn').isDisabled());
  await page.locator('#secondStageAgree').check();await page.locator('#skipBreakBtn').click();
  assert.equal(await page.evaluate(()=>app.stage),3);
  await page.locator('#questionContent input[name="ans"]').first().check();await page.locator('#saveAnswerBtn').click();
  console.log('PASS first session closes at 12:00; second session requires 12:20 and explicit rules acceptance');
  await page.clock.setFixedTime(new Date('2026-10-31T14:20:00+02:00'));
  await page.waitForFunction(()=>document.querySelector('#ended').classList.contains('active'));
  await page.waitForFunction(()=>document.querySelector('#endedDeliveryState').textContent.includes('сервер ще не підтвердив'));
  assert.equal(await page.locator('#resultModal').evaluate(e=>e.classList.contains('show')),false);
  assert((await page.locator('#ended').textContent()).includes('28 листопада'));
  assert.equal(saves,1);
  assert.equal(await page.locator('#warningToast').evaluate(e=>e.classList.contains('show')),false);
  assert.equal(await page.locator('#breakModal').evaluate(e=>e.classList.contains('show')),false);
  await page.evaluate(()=>{for(let i=0;i<10;i++)applyPublicPhase();});await sleep(250);
  assert.equal(saves,1,'End-screen interval floods the result endpoint');
  await page.clock.setFixedTime(new Date('2026-10-31T14:21:00+02:00'));
  await page.waitForFunction(()=>lastResultFlushAt>=Date.parse('2026-10-31T14:21:00+02:00'));
  await page.waitForFunction(()=>resultFlushPromise===null);assert.equal(saves,2);
  saveSucceeds=true;
  await page.locator('#endedRetryResultBtn').click();await page.waitForFunction(()=>pendingResults().length===0);
  assert.equal(saves,3);assert.equal(await page.locator('#endedDeliveryState').isVisible(),false);
  await page.locator('#ended [data-nav="register"]').click();
  await sleep(1200);assert(await page.locator('#register').evaluate(e=>e.classList.contains('active')));
  console.log('PASS 14:20 thank-you screen, tentative November 28 date, retained answers, paced retry and late lead form');
  await page.locator('#brandHome').click();
  if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'pnmt-after-1420-desktop.png'),fullPage:true});}
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(output)await page.screenshot({path:path.join(output,'pnmt-after-1420-mobile.png'),fullPage:true});
  const other=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'});
  const otherPage=await other.newPage();await otherPage.route('**/*',r=>r.request().url().startsWith(url)?serveFixture(r):r.abort());
  await otherPage.clock.setFixedTime(new Date('2026-10-31T14:20:00+02:00'));await otherPage.goto(url);
  assert(await otherPage.locator('#ended').evaluate(e=>e.classList.contains('active')));await other.close();
  const breakContext=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Kyiv'});
  await breakContext.route('**/*',r=>r.request().url().startsWith(url)?serveFixture(r):r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
  const breakPage=await breakContext.newPage();
  await breakPage.clock.setFixedTime(new Date('2026-10-31T14:19:59+02:00'));
  await breakPage.addInitScript(()=>localStorage.setItem('pnmt:/:2026-10-31:pnmt-2026-10-30:probne_nmt_session_v37',JSON.stringify({eventId:'2026-10-31',user:{name:'Технічна перевірка',login:'local-fixture',token:'local-fixture',testAccess:false},stage:2,subject:'math',stage2StartsAt:Date.parse('2026-10-31T12:20:00+02:00'),stage2RulesAccepted:false})));
  await breakPage.goto(url);await breakPage.locator('#breakModal.show').waitFor();
  await breakPage.clock.setFixedTime(new Date('2026-10-31T14:20:00+02:00'));
  await breakPage.locator('#ended.active').waitFor();
  assert.equal(await breakPage.locator('#breakModal').evaluate(e=>e.classList.contains('show')),false);
  assert.equal(await breakPage.locator('#warningToast').evaluate(e=>e.classList.contains('show')),false);
  await breakContext.close();
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS mobile layout, foreign browser timezone, abandoned break closure and zero uncaught errors');
 }catch(error){
  console.error('Browser errors:',JSON.stringify(errors));
  console.error('Fixture status:',JSON.stringify(await page.evaluate(()=>({title:document.title,scripts:[...document.scripts].map(s=>s.src)}))));
  throw error;
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});
