/* CPU-level viewer regressions. Real WebGL/layout interaction is checked in a browser. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const THREE = require('../lib/three.min.js');

function harness(fetch) {
  const elements = new Map(),events=[];
  const documentTarget=new EventTarget();
  function element(id) {
    if (!elements.has(id)) elements.set(id, Object.assign(new EventTarget(), {
      style: {setProperty(key,value){this[key]=value;}}, value: id === 'opacity' ? '45' : '0', dataset: {},
      classList: { toggle() {},contains(){return false;} }, setAttribute() {}, getAttribute() { return null; },
      appendChild() {}, replaceChildren() {}, ownerDocument:documentTarget,
      clientWidth: 960, clientHeight: 540, width:960,height:540,
      getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};},
      captures:new Set(),setPointerCapture(id){this.captures.add(id);},hasPointerCapture(id){return this.captures.has(id);},
      releasePointerCapture(id){this.captures.delete(id);this.dispatchEvent(Object.assign(new Event('lostpointercapture'),{pointerId:id}));}
    }));
    return elements.get(id);
  }
  const sandbox = {
    THREE, console, URL, Blob, Event, setTimeout, clearTimeout, fetch,
    PointerEvent:class extends Event{constructor(type,init){super(type,init);const {bubbles,cancelable,composed,...properties}=init;Object.assign(this,properties);}},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { dispatchEvent(event) {events.push(event);}, addEventListener() {},focus(){} },
    document: Object.assign(documentTarget,{getElementById:element,createElement:()=>element('temporary'),querySelector:()=>null,querySelectorAll:()=>[],body:{appendChild(){}}}),
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    performance: { now: () => 0 }
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(source, /\ninit\(\)\.catch/, 'Viewer bootstrap must be isolated from the test harness');
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/\ninit\(\)\.catch/, '\nPromise.resolve().catch'), sandbox);
  return { sandbox, events, element, run: code => vm.runInContext(code, sandbox) };
}

function prepareViewer(run){
  run(`
    CASES=[{key:'A',dir:'A',type:'video'},{key:'B',dir:'B',type:'images'}];curCase=CASES[0];caseDir='data/A';lsKey='vis2reg_edits_A';
    META={count:2,fps:2,W:960,H:540,fx:960,fy:960,cx:480,cy:270,frames:[{i:0,m:I4().toArray()},{i:1,m:I4().toArray()}]};
    MESH={center:[0,0,0],labels:{liver:'Liver surface',tumour:'Tumour'},meshes:{}};
    for(const name of ['liver','tumour'])MESH.meshes[name]={v:[0,0,0,0,.1,0,0,0,.1],f:[0,1,2],color:[100,140,180]};
    scene=new THREE.Scene();group=new THREE.Group();scene.add(group);
    camera=new THREE.PerspectiveCamera(38,16/9,.01,100);camera.position.set(0,0,3);
    controls={target:new THREE.Vector3(),enabled:false,enableDamping:true,update(){}};
    transformCtl={detach(){},attach(){},setMode(){}};
    renderer={domElement:document.getElementById('gl'),
      capabilities:{isWebGL2:false},outputEncoding:THREE.sRGBEncoding,
      getContext(){return {isContextLost(){return false;}};},render(){},setSize(){},clear(){},
      getRenderTarget(){return this.target||null;},setRenderTarget(target){this.target=target;},
      getActiveCubeFace(){return 0;},getActiveMipmapLevel(){return 0;},readRenderTargetPixels(){}};
    bgImg=document.getElementById('bg');baseMats=[I4(),I4()];STRUCT_KEYS=['tumour'];
    rebuildMeshes();annoEl=document.getElementById('anno');showLoading=()=>{};
  `);
}

test('imports reject another case, out-of-range frames, non-finite matrices and invalid strokes', () => {
  const { sandbox } = harness();
  const identity = new THREE.Matrix4().toArray();
  const good = { case: 'p4video', frameDeltas: { 0: identity }, structMats: { tumour: identity },
    deformStrokes: [{ c: [0, 0, 0], d: [.1, 0, 0], r: .3 }] };
  assert.ok(sandbox.validateEdits(good, 'p4video', 511, ['tumour']));
  const invalid = [
    { ...good, case: 'llr_p1' },
    { ...good, frameDeltas: { 511: identity } },
    { ...good, frameDeltas: { '-1': identity } },
    { ...good, frameDeltas: { 0: [...identity.slice(0, 15), NaN] } },
    { ...good, structMats: { unknown: identity } },
    { ...good, deformStrokes: [{ c: [0, 0, 0], d: [0, 0, 0], r: 0 }] }
  ];
  for (const candidate of invalid) assert.throws(() => sandbox.validateEdits(candidate, 'p4video', 511, ['tumour']));
});

test('deformation uses common coordinates and updates points, bounds, and label centroids', () => {
  const { run } = harness();
  run(`
    group=new THREE.Group();
    for(const name of ['liver','tumour']){
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,0,.1,0,0,0,.1],3));
      geometry.setIndex([0,1,2]);
      parts[name]=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
      parts[name].userData={centroid:new THREE.Vector3()};group.add(parts[name]);
      baseVerts[name]=Float32Array.from(geometry.attributes.position.array);
    }
    points=new THREE.Points(parts.liver.geometry.clone());group.add(points);
    parts.tumour.position.x=1;
    deformStrokes=[{c:[1,0,0],d:[.1,0,0],r:.2}];applyDeform();
  `);
  assert.ok(Math.abs(run('parts.tumour.geometry.attributes.position.array[0]') - .1) < 1e-6);
  assert.equal(run('points.geometry.attributes.position.array[0]'), run('parts.liver.geometry.attributes.position.array[0]'));
  assert.ok(run('parts.tumour.geometry.boundingSphere.radius>0 && parts.tumour.userData.centroid.x>0'));
});

test('changing transparency preserves a disabled liver layer and the public API changes frames', () => {
  const { sandbox, run } = harness();
  run(`
    MESH={labels:{},meshes:{}};
    META={count:2,fps:2,frames:[{i:0,m:I4().toArray()},{i:1,m:I4().toArray()}]};
    curCase={key:'p4video',type:'video'};group=new THREE.Group();
    bgImg=document.getElementById('bg');baseMats=[I4(),I4()];
    parts.liver=new THREE.Mesh();layerState.liver=false;
    document.getElementById('opacity').value=10;syncLiverVisibility();setFrame(1);
  `);
  assert.equal(run('parts.liver.visible'), false);
  assert.equal(sandbox.window.Vis2Reg.getState().frameIdx, 1);
});

test('front, top and side presets keep the complete frame 204 anatomy inside the camera frustum', () => {
  const { sandbox, run } = harness();
  prepareViewer(run);
  // Use the distributed anatomy and its recorded pose: this frame previously
  // clipped the lower liver in Front view despite fitting its 2D bounding size.
  sandbox.recordedMeta = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'frames.json'), 'utf8'));
  sandbox.recordedMesh = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'meshes.json'), 'utf8'));
  run(`META=recordedMeta;MESH=recordedMesh;
    baseMats=META.frames.map(frame=>I4().fromArray(frame.m));
    STRUCT_KEYS=Object.keys(MESH.meshes).filter(key=>key!=='liver');rebuildMeshes();`);
  const api = sandbox.window.Vis2Reg;
  api.setFrame(204);
  assert.equal(api.getState().frameIdx, 204);
  for (const preset of ['front', 'top', 'side']) {
    api.presetView(preset);
    const camera = run('camera');
    camera.updateMatrixWorld(true);
    const projected = new THREE.Vector3();
    let checked = 0;
    for (const part of Object.values(run('parts')).filter(part=>part.visible)) {
      const positions = part.geometry.attributes.position;
      for (let index=0;index<positions.count;index++) {
        projected.fromBufferAttribute(positions,index).applyMatrix4(part.matrixWorld).project(camera);
        for (const axis of ['x','y','z']) {
          assert.ok(Number.isFinite(projected[axis]) && Math.abs(projected[axis]) <= 1 + 1e-6,
            `${preset}: ${part.userData.name} vertex ${index} is outside ${axis} clip range (${projected[axis]})`);
        }
        checked++;
      }
    }
    assert.ok(checked > 7000, 'The projection check must cover the complete visible anatomy');
  }
});

test('out-of-order case fetches retain the latest case, geometry, and storage scope', async () => {
  const pending = new Map();
  const { sandbox, run } = harness(url => new Promise(resolve => pending.set(url, resolve)));
  run(`
    CASES=[{key:'A',dir:'A',type:'images'},{key:'B',dir:'B',type:'images'}];
    showLoading=()=>{};updatePlayIcon=()=>{};setProjection=()=>{};rebuildMeshes=()=>{};
    buildLayerUI=()=>{};buildStructUI=()=>{};applyAllStruct=()=>{};applyDeform=()=>{};
    setEditMode=()=>{};onResize=()=>{};setFrame=()=>{};setMode=()=>{};
  `);
  const meta = { count: 1, frames: [{ i: 0, m: new THREE.Matrix4().toArray() }],
    W: 1920, H: 1080, fx: 1920, fy: 1920, cx: 960, cy: 540 };
  function resolveCase(key) {
    pending.get(`data/${key}/meshes.json`)({ ok: true, json: async () => ({ marker: key, meshes: { liver: {} } }) });
    pending.get(`data/${key}/frames.json`)({ ok: true, json: async () => meta });
  }
  const first = sandbox.loadCase({ key: 'A', dir: 'A', type: 'images' });
  const second = sandbox.loadCase({ key: 'B', dir: 'B', type: 'images' });
  resolveCase('B'); await second;
  resolveCase('A'); await first;
  assert.equal(sandbox.window.Vis2Reg.getState().curCase.key, 'B');
  assert.equal(run('MESH.marker'), 'B');
  assert.equal(run('lsKey'), 'vis2reg_edits_B');
  assert.equal(run('loadingCase'), false);
});

test('display updates are validated atomically and a hidden selected layer clears focus', () => {
  const {sandbox,run,events,element}=harness();prepareViewer(run);
  const api=sandbox.window.Vis2Reg;
  api.focusStructure('tumour');
  assert.equal(events.at(-1).detail.key,'tumour');
  api.setDisplay({opacity:85,layers:{liver:false,tumour:false},fog:false,spin:true,speed:2});
  assert.equal(run('parts.liver.visible'),false);
  assert.equal(run('parts.tumour.visible'),false);
  assert.equal(run('selected'),null);
  assert.equal(element('opacity').value,85);
  assert.equal(element('opt-fog').checked,false);
  assert.equal(api.getState().speed,2);
  assert.equal(api.getState().layers.liver,false);
  const before=JSON.stringify(api.getViewState());
  for(const bad of [{opacity:NaN},{opacity:101},{opacity:0,layers:{unknown:true}},{layers:{liver:1}},{fog:'true'},{speed:100}]){
    assert.throws(()=>api.setDisplay(bad));assert.equal(JSON.stringify(api.getViewState()),before);
  }
  assert.throws(()=>api.focusStructure('tumour'),/Enable this structure/);
  api.getState().layers.liver=true;
  assert.equal(api.getState().layers.liver,false,'Callers cannot mutate layer state through a snapshot');
});

test('restoring a same-case view restores camera and display while retaining manual edits and pausing', async () => {
  const {sandbox,run,events}=harness();prepareViewer(run);const api=sandbox.window.Vis2Reg;
  run(`frameDeltas={1:I4().makeTranslation(.2,0,0).toArray()};structMats={tumour:I4().makeTranslation(0,.1,0).toArray()};
    deformStrokes=[{c:[0,0,0],d:[.1,0,0],r:.3}];`);
  const view=api.getViewState();view.frame=1;view.mode='explore';view.opacity=90;view.fog=false;view.spin=false;
  view.camera={position:[1,2,4],quaternion:[0,0,0,1],target:[0,0,-1],zoom:1.5};
  run('playing=true;');
  const restored=await api.restoreView(view);
  assert.equal(restored.frame,1);assert.equal(restored.mode,'explore');assert.equal(restored.opacity,90);
  assert.equal(JSON.stringify(restored.camera),JSON.stringify(view.camera));
  assert.equal(api.getState().playing,false);assert.equal(api.getState().editMode,'off');
  assert.equal(run('frameDeltas[1][12]'),.2);assert.equal(run('structMats.tumour[13]'),.1);
  assert.equal(run('deformStrokes.length'),1);assert.equal(run('tween'),null);
  assert.ok(events.some(event=>event.type==='vis2reg:view'));
});

test('saved view validation rejects unavailable frames, cases, layers, cameras and version before changing view', async () => {
  const {sandbox,run}=harness();prepareViewer(run);const api=sandbox.window.Vis2Reg;
  const view=api.getViewState(),before=JSON.stringify(view);
  const bad=[{version:2},{caseKey:'unknown'},{frame:2},{frame:.5},{mode:'raw'},{opacity:Infinity},{layers:{liver:true,points:false}},
    {camera:{...view.camera,quaternion:[0,0,0,0]}},{camera:{...view.camera,zoom:-1}},{camera:{...view.camera,position:[0,0,Infinity]}}];
  for(const value of bad){await assert.rejects(api.restoreView({...view,...value}));assert.equal(JSON.stringify(api.getViewState()),before);}
});

test('a rejected case load enables current-case playback again', async () => {
  const {sandbox,run,element}=harness(async()=>({ok:false,status:404}));prepareViewer(run);
  await sandbox.loadCase({key:'B',dir:'B',type:'images'});
  assert.equal(run('loadingCase'),false);assert.equal(element('play').disabled,false);
  assert.equal(sandbox.window.Vis2Reg.getState().curCase.key,'A');
});

test('cross-case restores validate before commit and later case choices supersede an in-flight restore', async () => {
  const pending=new Map();
  const {sandbox,run}=harness(url=>new Promise(resolve=>pending.set(url,resolve)));prepareViewer(run);
  const api=sandbox.window.Vis2Reg,view=api.getViewState();
  run('buildLayerUI=()=>{};buildStructUI=()=>{};');
  const meta={count:1,W:960,H:540,fx:960,fy:960,cx:480,cy:270,frames:[{i:0,m:new THREE.Matrix4().toArray()}]};
  const mesh=JSON.parse(run('JSON.stringify(MESH)'));
  const complete=key=>{
    pending.get('data/'+key+'/meshes.json')({ok:true,json:async()=>mesh});
    pending.get('data/'+key+'/frames.json')({ok:true,json:async()=>meta});
  };
  const invalid=api.restoreView({...view,caseKey:'B',frame:1});complete('B');
  await assert.rejects(invalid,/unavailable frame/);assert.equal(api.getState().curCase.key,'A');
  const restore=api.restoreView({...view,caseKey:'B'}),later=sandbox.loadCase({key:'A',dir:'A',type:'video'});
  complete('B');await assert.rejects(restore,/superseded/);complete('A');await later;
  assert.equal(api.getState().curCase.key,'A');assert.equal(api.getState().loading,false);
});

test('a cross-case round trip preserves manual edits even when browser storage is unavailable', async () => {
  let meta,mesh;
  const {sandbox,run}=harness(async url=>({ok:true,json:async()=>url.endsWith('meshes.json')?mesh:meta}));prepareViewer(run);
  meta=JSON.parse(run('JSON.stringify(META)'));mesh=JSON.parse(run('JSON.stringify(MESH)'));
  run(`buildLayerUI=()=>{};buildStructUI=()=>{};localStorage.setItem=()=>{throw Error('blocked');};
    frameDeltas={1:I4().makeTranslation(.2,0,0).toArray()};structMats={tumour:I4().makeTranslation(0,.1,0).toArray()};
    deformStrokes=[{c:[0,0,0],d:[.05,0,0],r:.3}];`);
  const api=sandbox.window.Vis2Reg,view=api.getViewState();
  await api.restoreView({...view,caseKey:'B'});assert.equal(api.getState().curCase.key,'B');
  await api.restoreView(view);
  assert.equal(api.getState().curCase.key,'A');assert.equal(run('frameDeltas[1][12]'),.2);
  assert.equal(run('structMats.tumour[13]'),.1);assert.equal(run('deformStrokes.length'),1);
});

test('AR remains hidden until the requested frame decodes; stale frame completion cannot reveal it', async () => {
  const {sandbox,run}=harness();prepareViewer(run);
  run(`window.decoded=[];bgImg.complete=false;bgImg.naturalWidth=960;
    bgImg.decode=()=>new Promise(resolve=>window.decoded.push(resolve));`);
  sandbox.setFrame(0);sandbox.setFrame(1);
  assert.equal(run('renderer.domElement.style.visibility'),'hidden');
  run('bgImg.complete=true;window.decoded[0]();');await Promise.resolve();
  assert.equal(run('renderer.domElement.style.visibility'),'hidden');
  run('window.decoded[1]();');await Promise.resolve();
  assert.equal(run('renderer.domElement.style.visibility'),'');
  assert.equal(sandbox.window.Vis2Reg.getState().imageLoading,false);
});

test('capture copies the current WebGL frame synchronously and loads its exact image despite later scrubbing', async () => {
  const {sandbox,run}=harness();prepareViewer(run);
  const canvases=[],images=[],calls=[];
  sandbox.document.createElement=tag=>{
    assert.equal(tag,'canvas');
    const canvas={id:canvases.length, getContext:()=>({fillRect(){},drawImage(source){calls.push({canvas:canvas.id,source});},
      createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(source){calls.push({canvas:canvas.id,source});}}),
      toBlob:callback=>callback(new Blob(['png'],{type:'image/png'}))};canvases.push(canvas);return canvas;
  };
  sandbox.Image=class{constructor(){images.push(this);this.naturalWidth=960;}set src(value){this.url=value;}};
  run('renderer.render=()=>window.captureRendered=frameIdx;');
  sandbox.setFrame(0);
  const capture=sandbox.window.Vis2Reg.captureImage();
  assert.equal(sandbox.window.captureRendered,0);
  assert.equal(calls[0].canvas,1,'The WebGL buffer was copied before loading the background');
  assert.equal(canvases[0].width,1920);assert.equal(canvases[0].height,1080);
  assert.equal(run('renderer.domElement.width'),960,'Export must not resize the visible canvas');
  assert.equal(run('renderer.getRenderTarget()'),null,'Export must restore the previous render target');
  assert.equal(images[0].url,'data/A/frames/f_000000.jpg');
  sandbox.setFrame(1);images[0].onload();
  const blob=await capture;
  assert.equal(blob.type,'image/png');assert.equal(calls[1].source.url,'data/A/frames/f_000000.jpg');
  assert.equal(sandbox.window.Vis2Reg.getState().frameIdx,1);
});

test('3D capture uses a dark background; original capture omits WebGL and failed images reject clearly', async () => {
  const {sandbox,run}=harness();prepareViewer(run);
  const images=[],calls=[];let fills=0;
  sandbox.document.createElement=()=>({getContext:()=>({fillRect(){fills++;},drawImage(source){calls.push(source);},
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(source){calls.push(source);}}),
    toBlob:callback=>callback(new Blob(['png'],{type:'image/png'}))});
  sandbox.Image=class{constructor(){images.push(this);this.naturalWidth=960;}set src(value){this.url=value;}};
  run('mode="explore";window.renderCount=0;renderer.render=()=>window.renderCount++;');
  await sandbox.window.Vis2Reg.captureImage();
  assert.equal(images.length,0);assert.equal(fills,1);assert.equal(sandbox.window.renderCount,1);
  calls.length=0;
  const original=sandbox.window.Vis2Reg.captureImage({original:true});
  assert.equal(sandbox.window.renderCount,1,'Original export must not render anatomy');
  images[0].onload();await original;
  assert.equal(calls.length,1);assert.equal(calls[0],images[0]);
  const failing=sandbox.window.Vis2Reg.captureImage({original:true});images[1].onerror();
  await assert.rejects(failing,/current image could not be loaded/);
});

test('high-resolution rendering flips WebGL rows, unpremultiplies transparent colours, and restores target after failures', () => {
  const {sandbox,run}=harness();prepareViewer(run);let result;
  const context={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>{result=image.data;}};
  run(`window.oldTarget={name:'previous'};renderer.target=window.oldTarget;
    renderer.readRenderTargetPixels=(target,x,y,width,height,pixels)=>pixels.set([10,20,30,255,50,25,0,128]);`);
  sandbox.renderCapture(context,1,2);
  assert.deepEqual(Array.from(result),[100,50,0,128,10,20,30,255]);
  assert.equal(run('renderer.getRenderTarget()===window.oldTarget'),true);
  run('renderer.readRenderTargetPixels=()=>{throw Error("GPU read failed");};');
  assert.throws(()=>sandbox.renderCapture(context,1,2),/GPU read failed/);
  assert.equal(run('renderer.getRenderTarget()===window.oldTarget'),true);
});

test('capture validates requested export resolution before allocating or changing renderer state', async () => {
  const {sandbox,run}=harness();prepareViewer(run);
  for(const width of [0,639,2561,1920.5,NaN,'1920'])await assert.rejects(sandbox.window.Vis2Reg.captureImage({width}),/whole number between/);
  assert.equal(run('renderer.domElement.width'),960);assert.equal(run('renderer.getRenderTarget()'),null);
});

test('mobile sizing follows the source aspect ratio and uses full available width', () => {
  const {sandbox,run,element}=harness();prepareViewer(run);
  sandbox.window.innerWidth=390;element('stage-wrap').clientWidth=360;element('stage-wrap').clientHeight=100;
  run('META.W=4;META.H=3;onResize();');
  assert.equal(element('stage').style.width,'360px');assert.equal(element('stage').style.height,'270px');
  assert.equal(element('stage').style.aspectRatio,String(4/3));
});


// Event sequences exercise the application listeners with the distributed Three.js
// controls. Real browser tests cover gesture default actions and viewport layout.
function pointer(target,type,properties={}){
  const event=Object.assign(new Event(type,{bubbles:true,cancelable:true}),{
    pointerId:1,pointerType:'touch',isPrimary:true,button:type==='pointermove'?-1:0,
    buttons:type==='pointerup'?0:1,clientX:240,clientY:200,...properties
  });
  target.dispatchEvent(event);
  if(target.ownerDocument)target.ownerDocument.dispatchEvent(event);
  return event;
}
function touch(target,type,points){
  const event=Object.assign(new Event(type,{bubbles:true,cancelable:true}),{
    touches:points.map(([pageX,pageY])=>({pageX,pageY,clientX:pageX,clientY:pageY}))
  });
  target.dispatchEvent(event);return event;
}
function prepareInput(h,withOrbit=false){
  prepareViewer(h.run);
  if(withOrbit){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..','lib','OrbitControls.js'),'utf8'),h.sandbox);
    h.run(`controls=new THREE.OrbitControls(camera,renderer.domElement);controls.enabled=false;controls.enableDamping=false;`);
  }
  h.run('window.pickCount=0;pick=()=>window.pickCount++;setupPicking();');
  return h.element('gl');
}

test('touch browsing scrolls without entering 3D, and cancelled or multi-touch gestures never pick',()=>{
  const h=harness(),dom=prepareInput(h,true);
  assert.equal(dom.style.touchAction,'pan-y pinch-zoom');
  pointer(dom,'pointerdown');
  assert.equal(touch(dom,'touchstart',[[240,200]]).defaultPrevented,false);
  pointer(dom,'pointermove',{clientY:260});
  assert.equal(touch(dom,'touchmove',[[240,260]]).defaultPrevented,false);
  pointer(dom,'pointercancel');touch(dom,'touchcancel',[]);
  assert.equal(h.sandbox.window.Vis2Reg.getState().mode,'reg');assert.equal(h.sandbox.window.pickCount,0);
  pointer(dom,'pointerdown');pointer(dom,'pointerup');assert.equal(h.sandbox.window.pickCount,1);
  pointer(dom,'pointerdown');pointer(dom,'pointerdown',{pointerId:2,isPrimary:false});
  pointer(dom,'pointerup',{pointerId:2,isPrimary:false});pointer(dom,'pointerup');
  assert.equal(h.sandbox.window.pickCount,1,'A two-finger gesture must not identify a structure');
  pointer(dom,'pointerdown');pointer(dom,'pointercancel');pointer(dom,'pointerup');
  assert.equal(h.sandbox.window.pickCount,1,'Cancelled contacts must not become taps');
  pointer(dom,'pointerdown');pointer(dom,'pointerup',{clientY:220});
  assert.equal(h.sandbox.window.pickCount,1,'A moved release must not pick even when a move event was missed');
});

test('mouse drag still enters 3D while touch orbit, pinch, pan, and remaining-finger orbit use native controls',()=>{
  const h=harness(),dom=prepareInput(h,true),api=h.sandbox.window.Vis2Reg;
  pointer(dom,'pointerdown',{pointerType:'mouse'});
  pointer(dom,'pointermove',{pointerType:'mouse',clientX:280});pointer(dom,'pointerup',{pointerType:'mouse',clientX:280});
  assert.equal(api.getState().mode,'explore');assert.equal(h.sandbox.window.pickCount,0);
  api.presetView('front');assert.equal(dom.style.touchAction,'none');
  const initial=h.run('camera.position.clone()');
  pointer(dom,'pointerdown');touch(dom,'touchstart',[[240,200]]);
  pointer(dom,'pointermove',{clientX:300});touch(dom,'touchmove',[[300,200]]);
  assert.ok(h.run('camera.position').distanceTo(initial)>1e-3,'One-finger movement must rotate the camera');
  pointer(dom,'pointerup',{clientX:300});touch(dom,'touchend',[]);
  const distance=h.run('camera.position.distanceTo(controls.target)'),target=h.run('controls.target.clone()');
  pointer(dom,'pointerdown');touch(dom,'touchstart',[[240,200]]);
  pointer(dom,'pointerdown',{pointerId:2,isPrimary:false,clientX:360});touch(dom,'touchstart',[[240,200],[360,200]]);
  touch(dom,'touchmove',[[220,230],[400,230]]);
  assert.ok(h.run('camera.position.distanceTo(controls.target)')<distance,'Spreading fingers must zoom in');
  assert.ok(h.run('controls.target').distanceTo(target)>1e-3,'Moving the midpoint must pan');
  pointer(dom,'pointerup',{pointerId:2,isPrimary:false,clientX:400,clientY:230});touch(dom,'touchend',[[220,230]]);
  const afterPinch=h.run('camera.position.clone()');touch(dom,'touchmove',[[260,230]]);
  assert.ok(h.run('camera.position').distanceTo(afterPinch)>1e-3,'The remaining finger should continue orbiting');
  pointer(dom,'pointercancel');touch(dom,'touchcancel',[]);
  const afterCancel=h.run('camera.position.clone()');touch(dom,'touchmove',[[320,230]]);
  assert.ok(h.run('camera.position').distanceTo(afterCancel)<1e-8,'Cancellation must clear the OrbitControls gesture');
  assert.equal(h.sandbox.window.pickCount,0);
  api.resetView();assert.equal(dom.style.touchAction,'pan-y pinch-zoom');
});

test('only the owning finger can move or commit a deformation and cancellation restores its geometry',()=>{
  const h=harness(),dom=prepareInput(h);
  h.run(`editMode='deform';syncTouchAction();group.updateMatrixWorld(true);
    raycaster.intersectObject=()=>[{point:new THREE.Vector3(0,0,-1)}];`);
  pointer(dom,'pointerdown');pointer(dom,'pointermove',{clientX:300});
  const delta=h.run('JSON.stringify(curStroke.d)');
  pointer(dom,'pointerdown',{pointerId:2,isPrimary:false});pointer(dom,'pointermove',{pointerId:2,isPrimary:false,clientX:400});
  pointer(dom,'pointerup',{pointerId:2,isPrimary:false});
  assert.equal(h.run('JSON.stringify(curStroke.d)'),delta);assert.equal(h.run('deformStrokes.length'),0);
  pointer(dom,'pointerup',{clientX:300});assert.equal(h.run('deformStrokes.length'),1);assert.equal(dom.hasPointerCapture(1),false);
  const committed=h.run('Array.from(parts.liver.geometry.attributes.position.array)');
  pointer(dom,'pointerdown',{pointerId:3});pointer(dom,'pointermove',{pointerId:3,clientX:350});
  pointer(dom,'pointercancel',{pointerId:3});
  assert.equal(h.run('deformStrokes.length'),1);assert.equal(h.run('curStroke'),null);
  assert.deepEqual(h.run('Array.from(parts.liver.geometry.attributes.position.array)'),committed);
  pointer(dom,'pointerdown',{pointerId:4});pointer(dom,'pointermove',{pointerId:4,clientX:320});dom.releasePointerCapture(4);
  assert.equal(h.run('curStroke'),null);assert.equal(h.run('deformStrokes.length'),1);
});

test('TransformControls accepts touch down without prior hover, isolates extra fingers, and rolls back cancellation',()=>{
  const h=harness();prepareViewer(h.run);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','lib','TransformControls.js'),'utf8'),h.sandbox);
  h.run(`transformCtl=new THREE.TransformControls(camera,renderer.domElement);scene.add(transformCtl);transformCtl.attach(group);
    transformCtl.pointerHover=()=>{transformCtl.axis='X';};
    transformCtl.pointerDown=p=>{if(p.button===0)transformCtl.dragging=true;};
    transformCtl.pointerMove=p=>{if(transformCtl.dragging)group.position.x=p.x;};
    window.commits=0;transformCtl.addEventListener('mouseUp',()=>window.commits++);setupTransformInput(transformCtl);editMode='reg';`);
  const dom=h.element('gl');pointer(dom,'pointerdown');
  assert.equal(h.run('transformCtl.dragging'),true,'A touch down must perform the gizmo hover hit-test');
  pointer(dom,'pointermove',{clientX:320});const position=h.run('group.position.x');
  pointer(dom,'pointerdown',{pointerId:2,isPrimary:false});pointer(dom,'pointermove',{pointerId:2,isPrimary:false,clientX:420});
  pointer(dom,'pointerup',{pointerId:2,isPrimary:false});
  assert.equal(h.run('group.position.x'),position);assert.equal(h.run('transformCtl.dragging'),true);assert.equal(h.sandbox.window.commits,0);
  pointer(dom,'pointercancel');assert.equal(h.run('group.position.x'),0);assert.equal(h.run('transformCtl.dragging'),false);
  assert.equal(h.sandbox.window.commits,0);assert.equal(dom.hasPointerCapture(1),false);assert.equal(dom.style.touchAction,'none');
  pointer(dom,'pointerdown',{pointerId:3});pointer(dom,'pointermove',{pointerId:3,clientX:400});pointer(dom,'pointerup',{pointerId:3,clientX:400});
  assert.equal(h.sandbox.window.commits,1);assert.notEqual(h.run('group.position.x'),0);assert.equal(dom.style.touchAction,'none');
});

test('CSS layout flow drives exact sizing at tablet widths; unchanged resize avoids reallocating the canvas',()=>{
  const h=harness();prepareViewer(h.run);h.sandbox.window.innerWidth=900;
  const wrap=h.element('stage-wrap');wrap.clientWidth=860;wrap.clientHeight=200;
  let flow='stacked';h.sandbox.getComputedStyle=()=>({getPropertyValue:()=>flow});
  h.run('window.resizeCalls=[];renderer.setSize=(w,h)=>window.resizeCalls.push([w,h]);META.W=4;META.H=3;onResize();onResize();');
  assert.equal(h.element('stage').style.height,'645px');assert.equal(h.sandbox.window.resizeCalls.length,1);
  flow='contained';h.run('onResize();');assert.ok(Math.abs(parseFloat(h.element('stage').style.height)-200)<1e-10);
  flow='stacked';h.sandbox.document.fullscreenElement={};h.run('onResize();');
  assert.ok(Math.abs(parseFloat(h.element('stage').style.height)-200)<1e-10,'Fullscreen continues to fit inside available height');
  h.sandbox.document.fullscreenElement=null;h.sandbox.window.devicePixelRatio=2;h.run('onResize();onResize();');
  assert.equal(h.sandbox.window.resizeCalls.length,3,'A new pixel density causes one allocation, then settles');
  wrap.clientWidth=620;h.run('onResize();');
  assert.ok(Math.abs(parseFloat(h.element('stage').style.width)/parseFloat(h.element('stage').style.height)-4/3)<1e-12);
});
