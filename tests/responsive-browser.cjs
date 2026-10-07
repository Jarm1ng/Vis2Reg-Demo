/* Real Chromium layout and touch regression checks. No production dependencies.
   Run: node tests/responsive-browser.cjs
   Optional: PLAYWRIGHT_MODULE=/path/to/playwright CHROME_EXECUTABLE=/path/to/chrome
             DEMO_URL=http://127.0.0.1:8778/Vis2Reg-Demo/ QA_OUTPUT=/tmp/vis2reg-qa
   Uses an isolated browser profile, native CDP touch events, and a temporary local
   static server when DEMO_URL is omitted. Never attaches to the user's browser. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
function playwright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright',
    path.join(process.env.HOME || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean);
  for (const candidate of candidates) { try { return require(candidate); } catch {} }
  throw Error('Install Playwright or set PLAYWRIGHT_MODULE to its module directory.');
}
const { chromium } = playwright();
const executablePath = [process.env.CHROME_EXECUTABLE, chromium.executablePath(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(candidate => candidate && fs.existsSync(candidate));
const output = process.env.QA_OUTPUT;
if (output) fs.mkdirSync(output, { recursive: true });
const results = [], errors = [];
async function check(name, operation) {
  try { const detail = await operation(); results.push({ name, pass: true, detail }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
}
async function serve() {
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    let filename;
    try { filename = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
    catch { res.writeHead(400); return res.end(); }
    if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    if (filename === root) filename = path.join(root, 'index.html');
    fs.stat(filename, (error, stat) => {
      if (error || !stat.isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Content-Length': stat.size });
      fs.createReadStream(filename).pipe(res);
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, url: 'http://127.0.0.1:' + server.address().port + '/' };
}
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function ready(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Vis2Reg?.getState().count > 0 && !window.Vis2Reg.getState().loading && !window.Vis2Reg.getState().imageLoading);
  await page.locator('#loading').waitFor({ state: 'hidden' }); await settle(page);
}
async function layout(page) {
  return page.evaluate(() => {
    function rect(selector) { const el = document.querySelector(selector), r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,display:getComputedStyle(el).display }; }
    const overlap = [];
    for (const selector of ['#top', '.workspace-actions', '.view-tabs', '#transport', '.transport-buttons', '.speed']) {
      const elements = [...document.querySelector(selector).children].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      for (let i=0;i<elements.length;i++) for (let j=i+1;j<elements.length;j++) {
        const a=elements[i].getBoundingClientRect(), b=elements[j].getBoundingClientRect();
        if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1) overlap.push(selector + ': ' + (elements[i].id||elements[i].className) + ' / ' + (elements[j].id||elements[j].className));
      }
    }
    return { viewport:{width:innerWidth,height:innerHeight}, documentWidth:document.documentElement.scrollWidth, bodyWidth:document.body.scrollWidth,
      stage:rect('#stage'), image:rect('#bg'), canvas:rect('#gl'), transport:rect('#transport'), play:rect('#play'),
      naturalRatio:document.querySelector('#bg').naturalWidth/document.querySelector('#bg').naturalHeight, overlap,
      coarse:matchMedia('(pointer: coarse)').matches,
      targets:['#play','#step-back','#step-next','#present','#mode-reg','#mode-raw','#mode-compare','#mode-explore','#opacity','#scrub'].map(selector=>({selector,...rect(selector)})) };
  });
}
function assertLayout(state, label, presenting = false) {
  assert.ok(state.documentWidth <= state.viewport.width+1 && state.bodyWidth <= state.viewport.width+1, label + ' document overflows horizontally: ' + JSON.stringify(state));
  assert.ok(state.stage.width > 10 && state.stage.height > 10, label + ' stage has no usable area');
  assert.ok(Math.abs(state.stage.width-state.stage.height*state.naturalRatio)<2, label + ' stage aspect ratio distorts the source image: ' + JSON.stringify(state.stage));
  for (const key of ['image','canvas']) for (const dimension of ['x','y','width','height']) assert.ok(Math.abs(state.stage[dimension]-state[key][dimension])<1, label + ' ' + key + ' differs from stage ' + dimension);
  assert.deepEqual(state.overlap, [], label + ' control groups overlap');
  if (presenting) {
    assert.ok(state.transport.y >= -1 && state.transport.bottom <= state.viewport.height+1, label + ' transport is outside the presentation viewport: ' + JSON.stringify(state.transport));
    assert.ok(state.play.y >= -1 && state.play.bottom <= state.viewport.height+1, label + ' play is outside the presentation viewport');
  }
}
async function touch(client, type, points) {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints:points.map((point, index)=>({x:point.x,y:point.y,id:point.id??index,radiusX:3,radiusY:3,force:1})) });
}
async function drag(client, from, to, cancel=false) {
  await touch(client, 'touchStart', [from]);
  for (let i=1;i<=8;i++) { await touch(client,'touchMove',[{x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8}]); await new Promise(resolve=>setTimeout(resolve,22)); }
  await touch(client,cancel?'touchCancel':'touchEnd',[]);
}
async function stageBox(page) { await page.locator('#stage').scrollIntoViewIfNeeded(); await settle(page); return page.locator('#stage').boundingBox(); }
function cameraDistance(camera) { return Math.hypot(...camera.position.map((value,index)=>value-camera.target[index])); }
async function checkModal(page, id) {
  const modal=page.locator(id); await modal.waitFor({state:'visible'});
  const bounds=await modal.boundingBox(), viewport=page.viewportSize();
  assert.ok(bounds.x>=-1 && bounds.y>=-1 && bounds.x+bounds.width<=viewport.width+1 && bounds.y+bounds.height<=viewport.height+1, id+' does not fit the viewport: '+JSON.stringify(bounds));
  const metrics=await modal.evaluate(dialog=>{
    const nodes=[dialog,...dialog.querySelectorAll('*')];
    return {height:dialog.clientHeight,scrollHeight:dialog.scrollHeight,
      scrollers:nodes.filter(node=>node.scrollHeight>node.clientHeight+2 && /^(auto|scroll)$/.test(getComputedStyle(node).overflowY)).map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})};
  });
  assert.ok(metrics.scrollHeight<=metrics.height+2 || metrics.scrollers.length,id+' clipped dialog has no user-scrollable content');
  if(metrics.scrollers.length){
    const scroller=metrics.scrollers[0];await page.mouse.move(Math.max(1,scroller.x+scroller.width/2),Math.max(1,Math.min(viewport.height-2,scroller.y+scroller.height/2)));
    await page.mouse.wheel(0,450);await page.waitForTimeout(100);
    const moved=await modal.evaluate(dialog=>[dialog,...dialog.querySelectorAll('*')].some(node=>node.scrollTop>2 && /^(auto|scroll)$/.test(getComputedStyle(node).overflowY)));
    assert.ok(moved,id+' content did not scroll with a real wheel event');
  }
  await modal.getByRole('button',{name:/^Close (dialog|case library)$/}).click();
  await modal.waitFor({state:'hidden'});
  return metrics;
}
(async()=>{
  let local, browser;
  try {
    local=process.env.DEMO_URL?null:await serve();const url=process.env.DEMO_URL||local.url;
    browser=await chromium.launch({headless:true,executablePath,args:['--enable-unsafe-swiftshader']});
    for (const [width,height] of [[320,568],[390,844],[667,375],[844,390],[768,1024],[820,1180],[1024,768],[1440,900],[1920,1080],[2560,1440]]) {
      const context=await browser.newContext({viewport:{width,height},hasTouch:width<=1024||width===1920,deviceScaleFactor:1});
      const page=await context.newPage();page.on('pageerror',error=>errors.push(width+'x'+height+': '+error.message));
      await check(`${width}×${height}: workspace layout`,async()=>{await ready(page,url);const state=await layout(page);assertLayout(state,'workspace');if(output)await page.screenshot({path:path.join(output,`workspace-${width}x${height}.png`)});return {stage:state.stage,coarse:state.coarse};});
      if(width===1920)await check('1920×1080: large touchscreen tap targets and mode selection',async()=>{
        const state=await layout(page);assert.ok(state.coarse);const small=state.targets.filter(target=>target.height<43.5||target.width<43.5);assert.deepEqual(small.map(({selector,width,height})=>({selector,width,height})),[]);
        await page.locator('#mode-raw').tap();assert.equal(await page.evaluate(()=>window.Vis2RegExperience.getViewMode()),'raw');await page.locator('#mode-reg').tap();
      });
      await check(`${width}×${height}: presentation keeps transport visible`,async()=>{await page.locator('#present').click();await settle(page);const state=await layout(page);assertLayout(state,'presentation',true);if(output)await page.screenshot({path:path.join(output,`present-${width}x${height}.png`)});return {stage:state.stage,transport:state.transport};});
      if(await page.locator('body').evaluate(el=>el.classList.contains('presenting')))await page.locator('#present').click();
      if(width===320||width===667||width===768){
        await check(`${width}×${height}: save dialog fits and scrolls`,async()=>{await page.locator('#save-view').click();return checkModal(page,'#save-view-dialog');});
        await check(`${width}×${height}: saved library fits and closes`,async()=>{
          for(let i=0;i<3;i++){await page.locator('#save-view').click();await page.locator('#sv-name').fill('Responsive view '+(i+1));await page.locator('#save-view-dialog').getByRole('button',{name:'Save view',exact:true}).click();}
          await page.locator('#saved-views-open').click();assert.equal(await page.locator('.sv-card').count(),3);return checkModal(page,'#saved-views-dialog');
        });
        await check(`${width}×${height}: case library fits and scrolls`,async()=>{await page.locator('#browse-cases').click();await page.locator('.case-card').first().waitFor({state:'visible'});return checkModal(page,'#case-library-dialog');});
      }
      await context.close();
    }
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
    const page=await context.newPage();page.on('pageerror',error=>errors.push('touch: '+error.message));await ready(page,url);
    const client=await context.newCDPSession(page);
    await check('Touch controls have at least 44px hit areas',async()=>{const state=await layout(page);assert.ok(state.coarse);const small=state.targets.filter(target=>target.height<43.5||target.width<43.5);assert.deepEqual(small.map(({selector,width,height})=>({selector,width,height})),[]);});
    await check('AR touch swipe scrolls without switching to 3D or changing frame',async()=>{
      await page.locator('#mode-reg').click();await page.waitForTimeout(650);const box=await stageBox(page),before=await page.evaluate(()=>({view:window.Vis2Reg.getViewState(),scroll:scrollY}));
      await drag(client,{x:box.x+box.width*.35,y:box.y+box.height*.80},{x:box.x+box.width*.35,y:box.y+box.height*.15});await page.waitForTimeout(150);
      const after=await page.evaluate(()=>({view:window.Vis2Reg.getViewState(),scroll:scrollY}));assert.equal(after.view.mode,'reg');assert.equal(after.view.frame,before.view.frame);assert.deepEqual(after.view.camera,before.view.camera);assert.ok(after.scroll>before.scroll+5,'vertical swipe on AR did not scroll the page');
    });
    await check('3D single-finger drag rotates without changing the frame',async()=>{
      await page.locator('#mode-explore').click();await page.waitForTimeout(650);const box=await stageBox(page),before=await page.evaluate(()=>window.Vis2Reg.getViewState());
      await drag(client,{x:box.x+box.width*.35,y:box.y+box.height*.5},{x:box.x+box.width*.65,y:box.y+box.height*.62});await page.waitForTimeout(300);const after=await page.evaluate(()=>window.Vis2Reg.getViewState());
      assert.equal(after.mode,'explore');assert.equal(after.frame,before.frame);assert.notDeepEqual(after.camera.quaternion,before.camera.quaternion);assert.ok(Math.abs(cameraDistance(after.camera)-cameraDistance(before.camera))<.01,'orbit unexpectedly zoomed the camera');
    });
    await check('3D two-finger pinch zooms without changing the frame',async()=>{
      const box=await stageBox(page),cx=box.x+box.width*.5,cy=box.y+box.height*.5,before=await page.evaluate(()=>window.Vis2Reg.getViewState());
      await touch(client,'touchStart',[{x:cx-30,y:cy},{x:cx+30,y:cy}]);for(let i=1;i<=8;i++){await touch(client,'touchMove',[{x:cx-30-i*5,y:cy},{x:cx+30+i*5,y:cy}]);await page.waitForTimeout(22);}await touch(client,'touchEnd',[]);await page.waitForTimeout(300);
      const after=await page.evaluate(()=>window.Vis2Reg.getViewState());assert.equal(after.frame,before.frame);assert.equal(after.mode,'explore');assert.ok(cameraDistance(after.camera)<cameraDistance(before.camera)*.85,'pinch-out did not zoom toward the model');
    });
    await check('Compare divider supports touch drag and restart after cancellation',async()=>{
      await page.locator('#mode-compare').click();let box=await stageBox(page);const before=await page.locator('#compare-slider').inputValue();
      const handle=page.locator('#compare-divider');let h=await handle.boundingBox();await drag(client,{x:h.x+h.width/2,y:box.y+box.height*.55},{x:box.x+box.width*.75,y:box.y+box.height*.55},true);
      const during=+(await page.locator('#compare-slider').inputValue());assert.ok(during>+before+10,'compare drag did not update value');
      h=await handle.boundingBox();await drag(client,{x:h.x+h.width/2,y:box.y+box.height*.55},{x:box.x+box.width*.3,y:box.y+box.height*.55});const after=+(await page.locator('#compare-slider').inputValue());assert.ok(after<during-15,'compare divider did not recover after touchcancel');
      await page.locator('#compare-slider').focus();await page.keyboard.press('ArrowRight');assert.equal(+(await page.locator('#compare-slider').inputValue()),after+1,'range keyboard semantics were lost');
    });
    await check('Compare image away from the divider can scroll the page',async()=>{
      const box=await stageBox(page),before=await page.evaluate(()=>({scroll:scrollY,comparison:window.Vis2RegExperience.getComparison()}));
      await drag(client,{x:box.x+box.width*.85,y:box.y+box.height*.8},{x:box.x+box.width*.85,y:box.y+box.height*.15});await page.waitForTimeout(150);
      const after=await page.evaluate(()=>({scroll:scrollY,comparison:window.Vis2RegExperience.getComparison()}));assert.ok(after.scroll>before.scroll+5,'compare image swipe did not scroll');assert.equal(after.comparison,before.comparison,'image swipe unexpectedly moved divider');
    });
    await check('Touch playback controls start and pause the recorded sequence',async()=>{
      await page.locator('#mode-reg').click();const before=await page.evaluate(()=>window.Vis2Reg.getState().frameIdx);await page.locator('#play').tap();await page.waitForFunction(frame=>window.Vis2Reg.getState().frameIdx>frame,before);await page.locator('#play').tap();assert.equal(await page.evaluate(()=>window.Vis2Reg.getState().playing),false);
    });
    await check('Active page adapts after portrait to landscape and back',async()=>{
      for(const viewport of [{width:844,height:390},{width:390,height:844}]){await page.setViewportSize(viewport);await page.waitForTimeout(150);assertLayout(await layout(page),'orientation change');}
    });
    await check('Fullscreen fallback labels and prior presentation state stay in sync',async()=>{
      await page.evaluate(()=>Object.defineProperty(document.querySelector('.viewer'),'requestFullscreen',{configurable:true,value:undefined}));
      for(const initiallyPresenting of [false,true]){
        if(initiallyPresenting)await page.locator('#present').click();
        await page.locator('#stage-fullscreen').click();await settle(page);
        assert.equal(await page.locator('#stage-fullscreen').getAttribute('aria-label'),'Collapse imaging workspace');
        assert.equal(await page.locator('#stage-fullscreen').getAttribute('aria-pressed'),'true');
        assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('presenting')),true);
        assertLayout(await layout(page),'fullscreen fallback',true);
        await page.locator('#stage-fullscreen').click();await settle(page);
        assert.equal(await page.locator('#stage-fullscreen').getAttribute('aria-label'),'Expand imaging workspace');
        assert.equal(await page.locator('#stage-fullscreen').getAttribute('aria-pressed'),'false');
        assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('presenting')),initiallyPresenting);
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('presenting')),false);
    });
    await check('No uncaught browser exceptions',async()=>assert.deepEqual(errors,[]));
    await context.close();
  } finally { await browser?.close();if(local)await new Promise(resolve=>local.server.close(resolve)); }
  const report={passed:results.filter(result=>result.pass).length,failed:results.filter(result=>!result.pass).length,results};
  if(output)fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(`\n${report.passed} passed, ${report.failed} failed`);if(report.failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
