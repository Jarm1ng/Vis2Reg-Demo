/* CPU-level viewer regressions. Real WebGL/layout interaction is checked in a browser. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const THREE = require('../lib/three.min.js');

function harness(fetch) {
  const elements = new Map(),events=[];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      style: {setProperty(key,value){this[key]=value;}}, value: id === 'opacity' ? '45' : '0', dataset: {},
      classList: { toggle() {} }, setAttribute() {}, getAttribute() { return null; },
      addEventListener() {}, appendChild() {}, replaceChildren() {},
      clientWidth: 960, clientHeight: 540
    });
    return elements.get(id);
  }
  const sandbox = {
    THREE, console, URL, Blob, setTimeout, clearTimeout, fetch,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { dispatchEvent(event) {events.push(event);}, addEventListener() {} },
    document: { getElementById: element, createElement: () => element('temporary'), querySelector:()=>null,querySelectorAll:()=>[],body: { appendChild() {} } },
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
    renderer={domElement:{width:960,height:540,style:{},getBoundingClientRect(){return {width:960,height:540};}},
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
