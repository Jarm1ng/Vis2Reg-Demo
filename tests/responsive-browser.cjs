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
      viewer:rect('.viewer'), fullscreen:rect('#stage-fullscreen'),
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
    assert.ok(Math.abs(state.viewer.x)<1 && Math.abs(state.viewer.y)<1 && Math.abs(state.viewer.width-state.viewport.width)<2 && Math.abs(state.viewer.height-state.viewport.height)<2,
      label + ' viewer does not cover the viewport: '+JSON.stringify({viewer:state.viewer,viewport:state.viewport}));
    assert.ok(state.fullscreen.x>=-1 && state.fullscreen.y>=-1 && state.fullscreen.right<=state.viewport.width+1 && state.fullscreen.bottom<=state.viewport.height+1,
      label + ' exit fullscreen button is outside the viewport: '+JSON.stringify(state.fullscreen));
    assert.ok(state.fullscreen.width>=43.5 && state.fullscreen.height>=43.5,label+' fullscreen exit target is too small');
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
async function assertFullscreenControls(page, active) {
  for(const selector of ['#present','#stage-fullscreen']){
    assert.equal(await page.locator(selector).getAttribute('aria-label'),active?'Exit fullscreen':'Enter fullscreen');
    assert.equal(await page.locator(selector).getAttribute('aria-pressed'),String(active));
  }
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('presenting')),active);
  if(active){
    await page.locator('#stage-fullscreen').waitFor({state:'visible'});
    assert.ok(await page.locator('#stage-fullscreen').evaluate(button=>{
      const r=button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
    }),'exit button is covered by another element');
  }
}
async function exitFullscreen(page, touchscreen = false) {
  if(touchscreen)await page.locator('#stage-fullscreen').tap();else await page.locator('#stage-fullscreen').click();
  await page.waitForFunction(()=>!document.body.classList.contains('presenting')&&!document.fullscreenElement);
  await settle(page);await assertFullscreenControls(page,false);
}
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
      await check(`${width}×${height}: fullscreen covers viewport and keeps transport visible`,async()=>{await page.locator('#present').click();await settle(page);const state=await layout(page);assertLayout(state,'fullscreen',true);if(output)await page.screenshot({path:path.join(output,`present-${width}x${height}.png`)});return {viewer:state.viewer,stage:state.stage,transport:state.transport};});
      if(await page.locator('body').evaluate(el=>el.classList.contains('presenting'))){await page.locator('#stage-fullscreen').click();await page.waitForFunction(()=>!document.body.classList.contains('presenting'));}
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
    await context.close();
    for(const capability of ['native','unavailable','rejected']){
      const fullscreenContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
      if(capability!=='native')await fullscreenContext.addInitScript(kind=>{
        for(const name of ['requestFullscreen','webkitRequestFullscreen','webkitRequestFullScreen']){
          Object.defineProperty(Element.prototype,name,{configurable:true,value:kind==='unavailable'?undefined:function(){return Promise.reject(new DOMException('Fullscreen denied for test','NotAllowedError'));}});
        }
      },capability);
      const fullscreenPage=await fullscreenContext.newPage();
      fullscreenPage.on('pageerror',error=>errors.push('fullscreen '+capability+': '+error.message));
      await ready(fullscreenPage,url);
      await check('Fullscreen '+capability+': covers viewport and exits without changing the selected view',async()=>{
        await fullscreenPage.locator('#mode-compare').click();await settle(fullscreenPage);
        await fullscreenPage.evaluate(()=>scrollTo(0,100));await settle(fullscreenPage);
        const before=await fullscreenPage.evaluate(()=>({frame:window.Vis2Reg.getState().frameIdx,mode:window.Vis2RegExperience.getViewMode(),comparison:window.Vis2RegExperience.getComparison(),scroll:scrollY}));
        await fullscreenPage.locator('#stage-fullscreen').tap();
        await fullscreenPage.waitForFunction(()=>document.body.classList.contains('presenting'));
        if(capability==='native')await fullscreenPage.waitForFunction(()=>!!document.fullscreenElement);await settle(fullscreenPage);
        await assertFullscreenControls(fullscreenPage,true);assertLayout(await layout(fullscreenPage),'fullscreen '+capability,true);
        assert.equal(await fullscreenPage.evaluate(()=>!!document.fullscreenElement),capability==='native','native/fallback branch was not exercised');
        const inside=await fullscreenPage.evaluate(()=>({frame:window.Vis2Reg.getState().frameIdx,mode:window.Vis2RegExperience.getViewMode(),comparison:window.Vis2RegExperience.getComparison()}));
        assert.deepEqual(inside,{frame:before.frame,mode:before.mode,comparison:before.comparison});
        await exitFullscreen(fullscreenPage,true);
        const after=await fullscreenPage.evaluate(()=>({frame:window.Vis2Reg.getState().frameIdx,mode:window.Vis2RegExperience.getViewMode(),comparison:window.Vis2RegExperience.getComparison(),scroll:scrollY,focus:document.activeElement.id}));
        assert.deepEqual({frame:after.frame,mode:after.mode,comparison:after.comparison},{frame:before.frame,mode:before.mode,comparison:before.comparison});
        assert.ok(Math.abs(after.scroll-before.scroll)<2,'exit did not restore page scroll: '+JSON.stringify({before:before.scroll,after:after.scroll}));
        assert.equal(after.focus,'stage-fullscreen','focus was not returned to the initiating button');
      });
      await check('Fullscreen '+capability+': rotate and resize while sequence playback continues',async()=>{
        await fullscreenPage.locator('#mode-reg').click();await fullscreenPage.locator('#play').click();
        await fullscreenPage.locator('#stage-fullscreen').tap();await fullscreenPage.waitForFunction(()=>document.body.classList.contains('presenting'));
        const start=await fullscreenPage.evaluate(()=>window.Vis2Reg.getState().frameIdx);
        for(const viewport of [{width:844,height:390},{width:390,height:844}]){
          await fullscreenPage.setViewportSize(viewport);await settle(fullscreenPage);assertLayout(await layout(fullscreenPage),'rotating fullscreen '+capability,true);
          assert.equal(await fullscreenPage.evaluate(()=>window.Vis2Reg.getState().playing),true,'resize paused playback');
          assert.equal(await fullscreenPage.evaluate(()=>window.Vis2RegExperience.getViewMode()),'reg');
        }
        await fullscreenPage.waitForFunction(frame=>window.Vis2Reg.getState().frameIdx!==frame,start);
        await exitFullscreen(fullscreenPage,true);
        assert.equal(await fullscreenPage.evaluate(()=>window.Vis2Reg.getState().playing),true,'leaving fullscreen paused playback');
        await fullscreenPage.locator('#play').click();
      });
      await check('Fullscreen '+capability+': hidden controls keep an accessible exit',async()=>{
        await fullscreenPage.setViewportSize({width:844,height:390});await settle(fullscreenPage);
        await fullscreenPage.locator('#stage-fullscreen').tap();await fullscreenPage.waitForFunction(()=>document.body.classList.contains('presenting'));await settle(fullscreenPage);
        const before=await fullscreenPage.locator('#stage').boundingBox();
        await fullscreenPage.locator('#presentation-controls').tap();await settle(fullscreenPage);
        await assertFullscreenControls(fullscreenPage,true);
        assert.equal(await fullscreenPage.locator('#transport').isVisible(),false);
        assert.equal(await fullscreenPage.locator('.view-tabs').isVisible(),false);
        const hidden=await fullscreenPage.locator('#stage').boundingBox();
        assert.ok(hidden.height>before.height+10,'hiding controls did not give more space to the image');
        assert.ok(await fullscreenPage.locator('#presentation-controls').isVisible(),'show controls action is not available');
        if(output)await fullscreenPage.screenshot({path:path.join(output,'fullscreen-'+capability+'-hidden-controls.png')});
        await exitFullscreen(fullscreenPage,true);
        await fullscreenPage.locator('#stage-fullscreen').tap();await fullscreenPage.waitForFunction(()=>document.body.classList.contains('presenting'));await settle(fullscreenPage);
        assertLayout(await layout(fullscreenPage),'reopened fullscreen controls '+capability,true);
        assert.equal(await fullscreenPage.locator('#transport').isVisible(),true,'new fullscreen session retained hidden playback controls');
        await fullscreenPage.locator('#presentation-controls').tap();await fullscreenPage.locator('#presentation-controls').tap();await settle(fullscreenPage);
        assertLayout(await layout(fullscreenPage),'restored fullscreen controls '+capability,true);
        if(capability==='native')await fullscreenPage.evaluate(()=>document.exitFullscreen());else await fullscreenPage.keyboard.press('Escape');
        await fullscreenPage.waitForFunction(()=>!document.body.classList.contains('presenting'));await settle(fullscreenPage);
        await assertFullscreenControls(fullscreenPage,false);
      });
      if(capability==='unavailable')await check('Fullscreen phone touch gestures still rotate 3D and move comparison divider',async()=>{
        await fullscreenPage.setViewportSize({width:390,height:844});await fullscreenPage.locator('#mode-explore').tap();
        await fullscreenPage.locator('#stage-fullscreen').tap();await fullscreenPage.waitForFunction(()=>document.body.classList.contains('presenting'));await settle(fullscreenPage);
        const touchClient=await fullscreenContext.newCDPSession(fullscreenPage),box=await stageBox(fullscreenPage),before=await fullscreenPage.evaluate(()=>window.Vis2Reg.getViewState());
        await drag(touchClient,{x:box.x+box.width*.35,y:box.y+box.height*.5},{x:box.x+box.width*.65,y:box.y+box.height*.62});await fullscreenPage.waitForTimeout(300);
        const after=await fullscreenPage.evaluate(()=>window.Vis2Reg.getViewState());assert.equal(after.frame,before.frame);assert.equal(after.mode,'explore');assert.notDeepEqual(after.camera.quaternion,before.camera.quaternion);
        await fullscreenPage.locator('#mode-compare').tap();await settle(fullscreenPage);
        const stage=await stageBox(fullscreenPage),handle=await fullscreenPage.locator('#compare-divider').boundingBox(),comparison=+(await fullscreenPage.locator('#compare-slider').inputValue());
        await drag(touchClient,{x:handle.x+handle.width/2,y:stage.y+stage.height*.55},{x:stage.x+stage.width*.8,y:stage.y+stage.height*.55});
        assert.ok(+(await fullscreenPage.locator('#compare-slider').inputValue())>comparison+10,'fullscreen comparison divider did not respond to touch');
        await exitFullscreen(fullscreenPage,true);
      });
      await fullscreenContext.close();
    }
    for(const [width,height,label] of [[240,320,'small portrait'],[320,240,'small landscape'],[683,384,'200% zoom effective CSS viewport'],[3840,1080,'ultrawide'],[3840,2160,'4K display']]){
      const extremeContext=await browser.newContext({viewport:{width,height},hasTouch:width<700});
      const extremePage=await extremeContext.newPage();extremePage.on('pageerror',error=>errors.push(label+': '+error.message));
      await check(`${width}×${height}: fullscreen ${label}`,async()=>{
        await ready(extremePage,url);await extremePage.locator('#present').click();await extremePage.waitForFunction(()=>document.body.classList.contains('presenting'));await settle(extremePage);
        assertLayout(await layout(extremePage),label,true);await assertFullscreenControls(extremePage,true);
        if(output)await extremePage.screenshot({path:path.join(output,`fullscreen-${width}x${height}.png`)});
        await exitFullscreen(extremePage);
      });
      await extremeContext.close();
    }
    const launchContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),launchPage=await launchContext.newPage();
    launchPage.on('pageerror',error=>errors.push('fullscreen launch: '+error.message));
    await check('Fullscreen launch link fills the viewport without requesting native fullscreen',async()=>{
      await launchContext.addInitScript(()=>{window.nativeFullscreenRequests=0;for(const name of ['requestFullscreen','webkitRequestFullscreen','webkitRequestFullScreen'])Object.defineProperty(Element.prototype,name,{configurable:true,value:function(){window.nativeFullscreenRequests++;return Promise.reject(new Error('No user activation'));}});});
      const launchURL=new URL(url);launchURL.searchParams.set('fullscreen','1');await ready(launchPage,launchURL.href);
      assertLayout(await layout(launchPage),'fullscreen launch',true);await assertFullscreenControls(launchPage,true);
      assert.equal(await launchPage.evaluate(()=>window.nativeFullscreenRequests),0,'auto launch attempted fullscreen without a user gesture');
      assert.equal(await launchPage.evaluate(()=>!!document.fullscreenElement),false);
      await exitFullscreen(launchPage,true);
    });
    await launchContext.close();
    await check('No uncaught browser exceptions',async()=>assert.equal(errors.length,0,errors.length+' uncaught browser errors:\n'+[...new Set(errors)].join('\n')));
  } finally { await browser?.close();if(local)await new Promise(resolve=>local.server.close(resolve)); }
  const report={passed:results.filter(result=>result.pass).length,failed:results.filter(result=>!result.pass).length,results};
  if(output)fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(`\n${report.passed} passed, ${report.failed} failed`);if(report.failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
