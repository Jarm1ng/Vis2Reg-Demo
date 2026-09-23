/* Vis2Reg — Interactive Liver AR viewer + manual editor (multi-dataset).
   Public release: the Patient 04 recorded sequence only.
   View: timeline / layers / X-ray transparency / 3D orbit / click-to-label.
   Edit: per-frame liver pose (delta on the registration) + structure placement; gizmo; localStorage + JSON. */
'use strict';
const $ = id => document.getElementById(id);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const I4 = ()=>new THREE.Matrix4();

let CASES=[], curCase=null, caseDir='.', lsKey='';
let META, MESH, renderer, scene, camera, controls, transformCtl, group, bgImg;
let frameIdx=0, playhead=0, playing=false, speed=1, lastT=0, mode='reg', spin=false, fog=true;
let editMode='off', gizmoMode='translate';
let baseMats=[], frameDeltas={}, structMats={};
let deformStrokes=[], baseVerts={}, brushRadius=0.30, uLast=1.0, curStroke=null;
const parts={}; let points=null;
let selected=null, annoEl=null, editStruct='tumour', STRUCT_KEYS=[];
const REG_POS=new THREE.Vector3(0,0,0), REG_QUAT=new THREE.Quaternion();
let assemblyCenter=new THREE.Vector3();
let loadToken=0, loadingCase=false, hideLoadingTimer=null, layerState={}, resizeObserver=null;
let restoreToken=0;
const caseEdits=new Map();
let imageLoadToken=0,frameImageReady=false;
const frameImages=new Map();

const storage={
  get(key){try{return localStorage.getItem(key);}catch(e){return null;}},
  set(key,value){try{localStorage.setItem(key,value);return true;}catch(e){return false;}},
  remove(key){try{localStorage.removeItem(key);}catch(e){}}
};
function notify(message){
  if(typeof window.demoToast==='function'){window.demoToast(message);return;}
  let el=$('engine-notice');
  if(!el){el=document.createElement('div');el.id='engine-notice';el.setAttribute('role','status');
    Object.assign(el.style,{position:'fixed',bottom:'92px',left:'24px',zIndex:90,padding:'12px 16px',background:'#172b31',color:'#fff',borderRadius:'10px',maxWidth:'420px'});document.body.appendChild(el);}
  el.textContent=message;el.hidden=false;clearTimeout(el._timer);el._timer=setTimeout(()=>el.hidden=true,4500);
}
function emit(name,detail){window.dispatchEvent(new CustomEvent('vis2reg:'+name,{detail}));}
function emitMode(){emit('mode',{mode,editMode});}
function displayState(){return {opacity:+$('opacity').value,layers:{...layerState},fog,spin,speed};}
function state(){return {frameIdx,count:META?META.count:0,playing,mode,editMode,curCase,loading:loadingCase,imageLoading:!frameImageReady,...displayState()};}
window.Vis2Reg={setFrame,setMode,presetView,setEditMode,togglePlay,getState:state,getViewState,restoreView,setDisplay,
  getStructures,focusStructure,captureImage,resetView:()=>{setEditMode('off');setMode('reg');}};

function requireReady(){if(!META||!camera||loadingCase)throw Error('Wait for the case to finish loading, then try again.');}
function getViewState(){
  requireReady();
  return {version:1,caseKey:curCase.key,frame:frameIdx,mode,...displayState(),camera:{
    position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),target:controls.target.toArray(),zoom:camera.zoom}};
}
function validateDisplay(value,keys=Object.keys(layerState),complete=false){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Display settings must be an object.');
  if((complete||Object.hasOwn(value,'opacity'))&&(!Number.isFinite(value.opacity)||value.opacity<0||value.opacity>100))throw Error('Transparency must be between 0 and 100.');
  for(const key of ['fog','spin'])if((complete||Object.hasOwn(value,key))&&typeof value[key]!=='boolean')throw Error('Depth cue and auto-rotate settings must be true or false.');
  if((complete||Object.hasOwn(value,'speed'))&&![0.5,1,2].includes(value.speed))throw Error('Playback speed must be 0.5, 1, or 2.');
  if(complete||Object.hasOwn(value,'layers')){
    if(!value.layers||typeof value.layers!=='object'||Array.isArray(value.layers))throw Error('Layer settings must be an object.');
    if(Object.entries(value.layers).some(([key,v])=>!keys.includes(key)||typeof v!=='boolean')||
      (complete&&keys.some(key=>!Object.hasOwn(value.layers,key))))throw Error('These layers do not match the selected case.');
  }
}
function setDisplay(value){
  requireReady();validateDisplay(value);
  if(Object.hasOwn(value,'opacity')){$('opacity').value=value.opacity;$('opv').textContent=value.opacity+'%';parts.liver.material.opacity=(100-value.opacity)/100;}
  if(value.layers)Object.assign(layerState,value.layers);
  for(const [key,visible] of Object.entries(layerState)){
    if(parts[key])parts[key].visible=visible;
    if(key==='points'&&points)points.visible=visible;
    const input=document.querySelector('#layer-list input[data-layer="'+key+'"]');if(input)input.checked=visible;
  }
  syncLiverVisibility();if(selected&&!selected.visible)select(null);
  if(Object.hasOwn(value,'fog'))fog=value.fog;
  if(Object.hasOwn(value,'spin'))spin=value.spin;
  if(Object.hasOwn(value,'speed'))speed=value.speed;
  $('opt-fog').checked=fog;$('opt-spin').checked=spin;
  $('opacity').style.setProperty('--range',$('opacity').value+'%');
  document.querySelectorAll('.speed button').forEach(button=>button.classList.toggle('active',+button.dataset.s===speed));
  document.querySelectorAll('[data-opacity]').forEach(button=>button.classList.toggle('active',+button.dataset.opacity===+$('opacity').value));
  scene.fog=(fog&&mode==='explore')?new THREE.Fog(0x0a1420,2.2,6.5):null;
  const result=displayState();emit('display',result);return result;
}
function validateView(view,meta,mesh){
  if(!view||typeof view!=='object'||Array.isArray(view)||view.version!==1)throw Error('This saved view has an unsupported format.');
  if(typeof view.caseKey!=='string'||!CASES.some(c=>c.key===view.caseKey))throw Error('This saved view refers to an unavailable case.');
  if(!Number.isInteger(view.frame)||view.frame<0||(meta&&view.frame>=meta.count))throw Error('This saved view refers to an unavailable frame.');
  if(!['reg','explore'].includes(view.mode))throw Error('This saved view has an invalid viewing mode.');
  const keys=mesh?Object.keys(mesh.meshes).concat('points'):Object.keys(view.layers||{});
  validateDisplay(view,keys,true);
  const c=view.camera,vector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=1000000);
  if(!c||!vector(c.position,3)||!vector(c.target,3)||!vector(c.quaternion,4)||!Number.isFinite(c.zoom)||c.zoom<0.05||c.zoom>20||
    Math.abs(Math.hypot(...c.quaternion)-1)>0.001||
    (view.mode==='explore'&&Math.hypot(...c.position.map((v,i)=>v-c.target[i]))<1e-6))throw Error('This saved view contains an invalid camera.');
  return view;
}
async function restoreView(candidate){
  validateView(candidate);
  // Own the payload: caller mutations must not alter an in-flight restore.
  const view=JSON.parse(JSON.stringify(candidate)),request=++restoreToken;
  const c=CASES.find(item=>item.key===view.caseKey);
  const retainEdit=()=>{if(META&&(editMode==='reg'||editMode==='struct'))saveCurrentEdit();};
  let token=loadToken;
  if(!META||loadingCase||curCase.key!==view.caseKey){
    const loaded=await loadCase(c,{validate:(meta,mesh)=>{validateView(view,meta,mesh);retainEdit();},quietError:true});
    if(!loaded||request!==restoreToken||loaded.token!==loadToken)throw Error('This view was superseded by another case or saved view.');
    token=loaded.token;
  }else{validateView(view,META,MESH);retainEdit();}
  if(request!==restoreToken||token!==loadToken||loadingCase)throw Error('This view was superseded by another case or saved view.');
  setEditMode('off');setFrame(view.frame);setMode(view.mode);setDisplay(view);
  // Drain residual orbit damping before assigning the saved camera precisely.
  const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;
  tween=null;camera.position.fromArray(view.camera.position);camera.quaternion.fromArray(view.camera.quaternion).normalize();
  camera.zoom=view.camera.zoom;controls.target.fromArray(view.camera.target);setProjection();camera.updateMatrixWorld(true);
  const restored=getViewState();emit('view',restored);return restored;
}
function getStructures(){return ['liver',...STRUCT_KEYS].filter(key=>parts[key]).map(key=>({key,
  label:parts[key].userData.label,color:'#'+parts[key].material.color.getHexString(),visible:!!parts[key].visible}));}
function focusStructure(key){
  requireReady();
  if(key===null){select(null);return null;}
  if(typeof key!=='string'||!Object.hasOwn(parts,key))throw Error('This structure is not available in the current case.');
  if(!parts[key].visible)throw Error('Enable this structure in Layers before focusing it.');
  if(editMode!=='off')setEditMode('off');
  select(parts[key]);updateAnno();return getStructures().find(s=>s.key===key);
}
function frameSource(index=frameIdx){return caseDir+'/frames/f_'+String(META.frames[index].i).padStart(6,'0')+'.jpg';}
function imageForCapture(src){return new Promise((resolve,reject)=>{
  const img=new Image(),timer=setTimeout(()=>finish(Error('The image is taking too long to load. Try capturing again.')),15000);
  function finish(error){clearTimeout(timer);img.onload=null;img.onerror=null;error?reject(error):resolve(img);}
  img.onload=()=>img.naturalWidth?finish():finish(Error('The current image is unavailable.'));
  img.onerror=()=>finish(Error('The current image could not be loaded. Try another frame.'));img.src=src;
});}
function canvasBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('The browser could not create the image.')),'image/png'));}
function renderCapture(context,width,height){
  const Target=renderer.capabilities.isWebGL2&&THREE.WebGLMultisampleRenderTarget?THREE.WebGLMultisampleRenderTarget:THREE.WebGLRenderTarget;
  const target=new Target(width,height,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
    minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false,depthBuffer:true,stencilBuffer:false});
  target.texture.encoding=renderer.outputEncoding;target.samples=4;
  const previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),level=renderer.getActiveMipmapLevel();
  try{
    renderer.setRenderTarget(target);renderer.clear();scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);renderer.render(scene,camera);
    const pixels=new Uint8Array(width*height*4);renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
    const image=context.createImageData(width,height);
    // WebGL rows start at the bottom; Canvas ImageData expects straight alpha.
    // Undo the premultiplied RGB produced by blending into a transparent target.
    for(let y=0;y<height;y++)image.data.set(pixels.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
    for(let i=0;i<image.data.length;i+=4){const alpha=image.data[i+3];if(alpha>0&&alpha<255){
      image.data[i]=Math.min(255,Math.round(image.data[i]*255/alpha));
      image.data[i+1]=Math.min(255,Math.round(image.data[i+1]*255/alpha));
      image.data[i+2]=Math.min(255,Math.round(image.data[i+2]*255/alpha));}}
    context.putImageData(image,0,0);
  }finally{renderer.setRenderTarget(previous,face,level);target.dispose();}
}
async function captureImage({original=false,width=1920}={}){
  requireReady();if(typeof original!=='boolean')throw Error('The original-image option must be true or false.');
  if(!Number.isInteger(width)||width<640||width>2560)throw Error('Image width must be a whole number between 640 and 2560 pixels.');
  const captured={caseKey:curCase.key,frame:frameIdx,mode,original},src=frameSource();
  const canvas=document.createElement('canvas'),overlay=document.createElement('canvas');
  canvas.width=overlay.width=width;canvas.height=overlay.height=Math.max(1,Math.round(width*META.H/META.W));
  const context=canvas.getContext('2d'),overlayContext=overlay.getContext('2d');
  if(!context||!overlayContext)throw Error('Image export is unavailable in this browser.');
  try{
    // Render offscreen synchronously before playback advances. Neither the visible
    // canvas size nor its drawing buffer is changed for this high-resolution export.
    if(!original){if(renderer.getContext().isContextLost())throw Error('The 3D view is temporarily unavailable. Reload it before capturing.');
      renderCapture(overlayContext,canvas.width,canvas.height);}
    context.fillStyle='#09151a';context.fillRect(0,0,canvas.width,canvas.height);
    if(original||captured.mode==='reg')context.drawImage(await imageForCapture(src),0,0,canvas.width,canvas.height);
    if(!original)context.drawImage(overlay,0,0);
    const blob=await canvasBlob(canvas);emit('capture',{...captured,width:canvas.width,height:canvas.height});return blob;
  }catch(error){throw Error('Could not capture this view. '+error.message);}
}

function matrixValid(v){return Array.isArray(v)&&v.length===16&&v.every(Number.isFinite)&&
  Math.abs(v[3])<1e-6&&Math.abs(v[7])<1e-6&&Math.abs(v[11])<1e-6&&Math.abs(v[15]-1)<1e-6&&
  Number.isFinite(I4().fromArray(v).determinant())&&Math.abs(I4().fromArray(v).determinant())>1e-12;}
function validateEdits(s,caseKey,count,keys){
  if(!s||typeof s!=='object'||Array.isArray(s))throw Error('The edits file must contain an object.');
  if(s.case&&s.case!==caseKey)throw Error('This edits file belongs to a different case. Switch to that case before importing.');
  const fd=s.frameDeltas||{},sm=s.structMats||{},ds=s.deformStrokes||[];
  if(!fd||typeof fd!=='object'||Array.isArray(fd)||!sm||typeof sm!=='object'||Array.isArray(sm)||!Array.isArray(ds))throw Error('Invalid edits format.');
  for(const [key,m] of Object.entries(fd))if(!/^(0|[1-9]\d*)$/.test(key)||+key>=count||!matrixValid(m))throw Error('An edited frame or transform is invalid.');
  for(const [key,m] of Object.entries(sm))if(!keys.includes(key)||!matrixValid(m))throw Error('An edited structure or transform is invalid.');
  if(ds.length>2000)throw Error('This file contains too many deformation strokes.');
  for(const s of ds)if(!s||!Array.isArray(s.c)||s.c.length!==3||!s.c.every(Number.isFinite)||!Array.isArray(s.d)||s.d.length!==3||!s.d.every(Number.isFinite)||!Number.isFinite(s.r)||s.r<=0||s.r>100)throw Error('A deformation stroke is invalid.');
  return {frameDeltas:fd,structMats:sm,deformStrokes:ds};
}
function showLoading(error,retry){
  const l=$('loading');if(!l)return;
  clearTimeout(hideLoadingTimer);l.style.display='grid';l.style.opacity='1';l.replaceChildren();
  const box=document.createElement('div');box.style.textAlign='center';box.style.maxWidth='440px';box.style.padding='28px';
  if(!error){const spinner=document.createElement('div');spinner.className='spin';box.appendChild(spinner);}
  const message=document.createElement('div');message.className='l';message.textContent=error||'Loading anatomy and image data…';message.setAttribute('role',error?'alert':'status');box.appendChild(message);
  if(error){const b=document.createElement('button');b.className='btn';b.style.marginTop='18px';b.textContent='Try again';b.onclick=retry;box.appendChild(b);
    if(META){const back=document.createElement('button');back.className='btn';back.style.margin='18px 0 0 8px';back.textContent='Return to current case';back.onclick=()=>{l.style.display='none';$('case-sel').value=CASES.findIndex(x=>x.key===curCase.key);};box.appendChild(back);}}
  l.appendChild(box);
}
async function fetchJSON(url){const r=await fetch(url);if(!r.ok)throw Error('Could not load '+url+' ('+r.status+').');return r.json();}

init().catch(e=>{console.error(e);showLoading('The viewer could not start. '+e.message,()=>location.reload());});

async function init(){
  CASES = (await fetchJSON('data/datasets.json')).cases;
  if(!Array.isArray(CASES)||!CASES.length)throw Error('No cases are available.');
  const sel=$('case-sel'); sel.innerHTML='';
  CASES.forEach((c,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=c.label; sel.appendChild(o); });
  const launchParams=new URLSearchParams(location.search);
  const requested=CASES.findIndex(c=>c.key===launchParams.get('case'));
  const last = CASES.findIndex(c=>c.key===storage.get('vis2reg_lastcase'));
  const startIdx = requested>=0?requested:last>=0?last:0; sel.value=startIdx;
  sel.onchange=()=>loadCase(CASES[+sel.value]);

  renderer=new THREE.WebGLRenderer({canvas:$('gl'),antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.outputEncoding=THREE.sRGBEncoding;
  bgImg=$('bg');
  scene=new THREE.Scene(); scene.fog=null;
  camera=new THREE.PerspectiveCamera(35,16/9,0.01,100); camera.position.copy(REG_POS); camera.quaternion.copy(REG_QUAT);
  scene.add(new THREE.HemisphereLight(0xcfe0ff,0x202838,0.9));
  const k=new THREE.DirectionalLight(0xffffff,1.05); k.position.set(-1.5,2,2.5); scene.add(k);
  const rim=new THREE.DirectionalLight(0x88bbff,0.6); rim.position.set(2,-1,-2); scene.add(rim);
  scene.add(new THREE.AmbientLight(0x223044,0.5));
  group=new THREE.Group(); scene.add(group);

  controls=new THREE.OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true; controls.dampingFactor=0.08; controls.enabled=false;
  transformCtl=new THREE.TransformControls(camera,renderer.domElement);
  transformCtl.size=0.7; transformCtl.visible=false; transformCtl.enabled=false;
  transformCtl.addEventListener('dragging-changed',e=>{ controls.enabled=(!e.value&&mode==='explore'); });
  transformCtl.addEventListener('mouseUp',saveCurrentEdit);
  scene.add(transformCtl);

  wireUI(); setupPicking();
  window.__dbg={ get group(){return group}, parts, save:saveCurrentEdit, setFrame,
    get frameDeltas(){return frameDeltas}, get structMats(){return structMats}, loadCase,
    pushStroke:(c,d,r)=>{ deformStrokes.push({c,d,r}); saveEdits(); applyDeform(); },
    get deformStrokes(){return deformStrokes} };
  window.addEventListener('resize',onResize);
  if(window.ResizeObserver){resizeObserver=new ResizeObserver(onResize);resizeObserver.observe($('stage-wrap'));}
  document.addEventListener('visibilitychange',()=>{if(document.hidden){playing=false;updatePlayIcon();}});
  await loadCase(CASES[startIdx]);
  if(META&&curCase?.key===CASES[startIdx].key){
    const queryFrame=launchParams.get('frame');
    const initialFrame=queryFrame!==null&&/^\d+$/.test(queryFrame)?Number(queryFrame):CASES[startIdx].defaultFrame;
    if(Number.isInteger(initialFrame)&&initialFrame>=0&&initialFrame<META.count)setFrame(initialFrame);
  }
  requestAnimationFrame(loop);
}

async function loadCase(c,options={}){
  const token=++loadToken,dir='data/'+c.dir;loadingCase=true;playing=false;updatePlayIcon();showLoading();
  try{
  const [mesh,meta]=await Promise.all([fetchJSON(dir+'/meshes.json'),fetchJSON(dir+'/frames.json')]);
  if(token!==loadToken)return;
  if(!meta||!Array.isArray(meta.frames)||!meta.frames.length||meta.count!==meta.frames.length||
    !['fx','fy','W','H'].every(k=>Number.isFinite(meta[k])&&meta[k]>0)||!['cx','cy'].every(k=>Number.isFinite(meta[k]))||
    !meta.frames.every(f=>Number.isInteger(f.i)&&f.i>=0&&matrixValid(f.m))||!mesh.meshes||!mesh.meshes.liver)throw Error('This case contains invalid registration data.');
  if(options.validate)options.validate(meta,mesh);
  if(curCase)caseEdits.set(curCase.key,{frameDeltas,structMats,deformStrokes});
  curCase=c;caseDir=dir;lsKey='vis2reg_edits_'+c.key;MESH=mesh;META=meta;curStroke=null;if(META.editableBase&&MESH.labels)MESH.labels.tumour='Tumour · preoperative';
  storage.set('vis2reg_lastcase',c.key);
  $('case-sel').value=CASES.findIndex(x=>x.key===c.key);
  baseMats=META.frames.map(f=>I4().fromArray(f.m));
  STRUCT_KEYS=Object.keys(MESH.meshes).filter(x=>x!=='liver');
  editStruct=STRUCT_KEYS[0]||'tumour';
  frameDeltas={};structMats={};deformStrokes=[];
  try{const s=caseEdits.get(c.key)||JSON.parse(storage.get(lsKey));if(s)({frameDeltas,structMats,deformStrokes}=validateEdits(s,c.key,META.count,STRUCT_KEYS));}
  catch(e){notify('Saved edits could not be loaded. The original anatomy is shown.');}
  setProjection();
  rebuildMeshes(); buildLayerUI(); buildStructUI(); applyAllStruct(); applyDeform();
  $('fn').textContent=META.count-1; $('scrub').max=META.count-1;
  $('pill-frames').textContent=META.count+(c.type==='images'?' images':' frames');
  selected=null; if(annoEl) annoEl.style.display='none';
  loadingCase=false;setEditMode('off');playing=false;updatePlayIcon();
  onResize();setFrame(0);setMode('reg');
  emit('case',{key:c.key,label:c.label,type:c.type,count:META.count,fps:META.fps,editableBase:!!META.editableBase});
  emit('display',displayState());emit('selection',{key:null});
  const l=$('loading');if(l){l.style.opacity=0;hideLoadingTimer=setTimeout(()=>{if(token===loadToken)l.style.display='none';},300);}
  return {token};
  }catch(e){if(token!==loadToken)return;loadingCase=false;updatePlayIcon();console.error(e);
    if(options.quietError){if($('loading'))$('loading').style.display='none';if(curCase)$('case-sel').value=CASES.findIndex(x=>x.key===curCase.key);throw e;}
    showLoading('Unable to open this case. '+e.message,()=>loadCase(c));}
}

function setProjection(){
  if(mode==='explore'){camera.fov=38;camera.aspect=META.W/META.H;camera.updateProjectionMatrix();return;}
  const {fx,fy,cx,cy,W,H}=META, n=0.01, f=100;
  const P=I4(); P.set(
    2*fx/W, 0, 1-2*cx/W, 0,
    0, 2*fy/H, 2*cy/H-1, 0,
    0, 0, -(f+n)/(f-n), -2*f*n/(f-n),
    0, 0, -1, 0);
  camera.projectionMatrix.copy(P); camera.projectionMatrixInverse.copy(P.clone().invert());
}

function geomFrom(m){ const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(m.v,3)); g.setIndex(m.f); g.computeVertexNormals(); return g; }
function rebuildMeshes(){
  transformCtl.detach();selected=null;layerState={};
  for(const k in parts){ group.remove(parts[k]); parts[k].geometry.dispose(); parts[k].material.dispose(); delete parts[k]; }
  if(points){ group.remove(points); points.geometry.dispose(); points.material.dispose(); points=null; }
  assemblyCenter.fromArray(MESH.center); baseVerts={};
  const keys=Object.keys(MESH.meshes).filter(x=>x!=='liver').concat('liver'); // opaque first, liver last
  for(const name of keys){
    const m=MESH.meshes[name]; const c=new THREE.Color(m.color[0]/255,m.color[1]/255,m.color[2]/255);
    baseVerts[name]=Float32Array.from(m.v);
    const transp=(name==='liver');
    const mat=new THREE.MeshStandardMaterial({color:c,roughness:transp?.5:.45,metalness:transp?0:.08,side:THREE.DoubleSide,
      emissive:c,emissiveIntensity:transp?0:.16,transparent:transp,opacity:transp?(100-+$('opacity').value)/100:1.0,depthWrite:!transp});
    const mesh=new THREE.Mesh(geomFrom(m),mat); mesh.renderOrder=transp?2:1;
    mesh.geometry.computeBoundingBox(); const cen=new THREE.Vector3(); mesh.geometry.boundingBox.getCenter(cen);
    mesh.userData={name,centroid:cen,baseEmis:transp?0:.16,label:(MESH.labels&&MESH.labels[name])||name};
    parts[name]=mesh;group.add(mesh);layerState[name]=true;
  }
  const lm=MESH.meshes.liver; const pg=new THREE.BufferGeometry();
  pg.setAttribute('position',new THREE.Float32BufferAttribute(lm.v,3));
  points=new THREE.Points(pg,new THREE.PointsMaterial({size:0.012,color:0x8fe8ff,transparent:true,opacity:.9}));
  points.visible=false; group.add(points);
  layerState.points=false;syncLiverVisibility();
}
function syncLiverVisibility(){if(parts.liver)parts.liver.visible=!!layerState.liver&&+$('opacity').value<100;}
function rgb(a){ return 'rgb('+a[0]+','+a[1]+','+a[2]+')'; }
function buildLayerUI(){
  const box=$('layer-list'); box.innerHTML='';
  const row=(key,label,color,checked,fn)=>{
    const el=document.createElement('label'); el.className='layer';
    el.innerHTML='<span class="chip" style="background:'+color+'"></span><span class="name">'+label+'</span>';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=checked;cb.setAttribute('aria-label',label);cb.dataset.layer=key;
    cb.addEventListener('change',e=>setDisplay({layers:{[key]:e.target.checked}}));el.appendChild(cb);box.appendChild(el);
  };
  row('liver','Liver surface',rgb(MESH.meshes.liver.color),true,syncLiverVisibility);
  for(const key of STRUCT_KEYS) row(key,(MESH.labels&&MESH.labels[key])||key,rgb(MESH.meshes[key].color),true,v=>parts[key].visible=v);
  row('points','Point cloud','linear-gradient(90deg,#7be0c8,#5aa2ff)',false,v=>points.visible=v);
}
function buildStructUI(){
  const box=$('struct-pick-btns'); box.innerHTML='';
  const short={tumour:'Tumour',tumor2:'Tum 2',vena_cava:'Vena'};
  STRUCT_KEYS.forEach((key,i)=>{ const b=document.createElement('button'); b.className='btn'+(i===0?' active':'');
    b.id='sp-'+key; b.textContent=short[key]||(MESH.labels&&MESH.labels[key])||key;
    b.onclick=()=>pickStruct(key); box.appendChild(b); });
}

/* ---------- placement ---------- */
function setFrame(i){
  if(!META||loadingCase||!Number.isFinite(+i))return;
  playhead=clamp(i,0,META.count-1); frameIdx=clamp(Math.round(i),0,META.count-1);
  const f=META.frames[frameIdx];
  const D=frameDeltas[frameIdx]?I4().fromArray(frameDeltas[frameIdx]):I4();
  D.multiply(baseMats[frameIdx].clone()).decompose(group.position,group.quaternion,group.scale);
  group.updateMatrixWorld(true);
  const src=frameSource();
  if(bgImg.getAttribute('src')!==src){
    const token=++imageLoadToken;frameImageReady=false;syncImageVisibility();bgImg.src=src;
    bgImg.alt=(curCase.type==='images'?'Laparoscopic image ':'Laparoscopic video frame ')+(f.name??frameIdx);
    emit('image',{index:frameIdx,loading:true});
    const ready=()=>{if(token!==imageLoadToken||!bgImg.complete||!bgImg.naturalWidth)return;
      frameImageReady=true;syncImageVisibility();emit('image',{index:frameIdx,loading:false});preloadFrames();};
    if(typeof bgImg.decode==='function')bgImg.decode().then(ready).catch(()=>{});
    else if(bgImg.complete&&bgImg.naturalWidth)ready();
    else bgImg.onload=ready;
  }
  $('scrub').value=frameIdx; $('fi').textContent=(f.name!==undefined?f.name:frameIdx);
  $('ftime').textContent=curCase.type==='images'?('img '+(frameIdx+1)):((frameIdx/(META.fps||25)).toFixed(1)+'s');
  updateEditedBadge();
  updateModeBadge();
  emit('frame',{index:frameIdx,count:META.count,time:frameIdx/(META.fps||25),type:curCase.type,name:f.name});
}
function syncImageVisibility(){if(renderer)renderer.domElement.style.visibility=(mode==='reg'&&!frameImageReady)?'hidden':'';}
function preloadFrames(){
  if(typeof Image==='undefined')return;
  for(const index of [frameIdx+1,frameIdx+2,frameIdx+3,frameIdx+4,frameIdx-1]){
    if(index<0||index>=META.count)continue;const src=frameSource(index);if(frameImages.has(src))continue;
    const img=new Image();img.src=src;if(typeof img.decode==='function')img.decode().catch(()=>{});frameImages.set(src,img);
  }
  while(frameImages.size>16)frameImages.delete(frameImages.keys().next().value);
}
function applyStruct(name){ const p=parts[name]; if(!p) return;
  if(structMats[name]) I4().fromArray(structMats[name]).decompose(p.position,p.quaternion,p.scale);
  else { p.position.set(0,0,0); p.quaternion.identity(); p.scale.set(1,1,1); } p.updateMatrix(); }
function applyAllStruct(){ STRUCT_KEYS.forEach(applyStruct); }

/* ---------- edit ---------- */
function setEditMode(m){
  if(!META||loadingCase||!['off','reg','struct','deform'].includes(m))return;
  if(curStroke){curStroke=null;applyDeform();}
  editMode=m; playing=false; updatePlayIcon();
  ['off','reg','struct','deform'].forEach(x=>$('em-'+x).classList.toggle('active',x===m));
  $('edit-tools').style.display=(m==='off')?'none':'block';
  $('gizmo-tools').style.display=(m==='reg'||m==='struct')?'block':'none';
  $('struct-pick').style.display=(m==='struct')?'block':'none';
  $('deform-tools').style.display=(m==='deform')?'block':'none';
  $('uscale').value=50; uLast=1; $('uscv').textContent='100%';
  if(m==='reg'||m==='struct'){
    transformCtl.visible=true; transformCtl.enabled=true; transformCtl.setMode(gizmoMode);
    if(m==='reg'){ setMode('reg'); transformCtl.attach(group); $('mode-badge').textContent='✎ Editing liver pose'; }
    else { transformCtl.attach(parts[editStruct]); select(parts[editStruct]);
      $('mode-badge').textContent='✎ Editing '+((MESH.labels&&MESH.labels[editStruct])||editStruct); }
  } else {
    transformCtl.detach(); transformCtl.visible=false; transformCtl.enabled=false;
    if(m==='deform'){ setMode('reg'); controls.enabled=false; select(null); $('mode-badge').textContent='✎ Deform — drag on the liver'; }
    else {select(null);controls.enabled=(mode!=='reg');}
  }
  updateEditedBadge();updateModeBadge();emitMode();
}
function setGizmo(m){ gizmoMode=m; transformCtl.setMode(m);
  ['translate','rotate','scale'].forEach(x=>$('gz-'+x).classList.toggle('active',x===m)); }
function saveCurrentEdit(){
  if(editMode==='reg'){ group.updateMatrix();
    frameDeltas[frameIdx]=group.matrix.clone().multiply(baseMats[frameIdx].clone().invert()).toArray(); }
  else if(editMode==='struct'){parts[editStruct].updateMatrix();structMats[editStruct]=parts[editStruct].matrix.toArray();applyDeform();}
  saveEdits(); updateEditedBadge();
}
function pickStruct(name){ editStruct=name; applyStruct(name); transformCtl.attach(parts[name]); select(parts[name]);
  STRUCT_KEYS.forEach(n=>{ const b=$('sp-'+n); if(b) b.classList.toggle('active',n===name); });updateModeBadge(); }
function resetFrame(){ delete frameDeltas[frameIdx]; saveEdits(); setFrame(frameIdx); if(editMode==='reg') transformCtl.attach(group); }
function resetStruct(){delete structMats[editStruct];applyStruct(editStruct);applyDeform();saveEdits();updateEditedBadge();}
function copyDelta(all){ if(!frameDeltas[frameIdx]) return; const d=frameDeltas[frameIdx];
  if(all){ for(let i=0;i<META.count;i++) frameDeltas[i]=d.slice(); } else if(frameIdx+1<META.count) frameDeltas[frameIdx+1]=d.slice();
  saveEdits(); updateEditedBadge(); }
function updateEditedBadge(){const e=!!frameDeltas[frameIdx]||Object.keys(structMats).length>0||deformStrokes.length>0;$('edited').style.display=e?'inline-flex':'none';
  const n=Object.keys(frameDeltas).length,s=Object.keys(structMats).length,d=deformStrokes.length;
  $('edit-count').textContent=[n+' frame pose'+(n===1?'':'s'),s+' structure'+(s===1?'':'s'),d+' stroke'+(d===1?'':'s')].join(' · ');updateModeBadge();}
let storageWarningShown=false;
function saveEdits(){if(!storage.set(lsKey,JSON.stringify({case:curCase.key,frameDeltas,structMats,deformStrokes}))&&!storageWarningShown){storageWarningShown=true;notify('Browser storage is unavailable. Export your edits to keep them.');}updateEditedBadge();}
function exportEdits(){ const blob=new Blob([JSON.stringify({case:curCase.key,frameDeltas,structMats,deformStrokes},null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='vis2reg_edits_'+curCase.key+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);notify('Edits exported for this case.');}
function importEdits(file){if(!file||!META||loadingCase)return;if(file.size>8*1024*1024){notify('This edits file is too large (maximum 8 MB).');return;}
  const targetCase=curCase.key,r=new FileReader();r.onload=()=>{try{const s=JSON.parse(r.result);
  if(curCase.key!==targetCase||loadingCase)throw Error('The case changed while reading. Import again in the intended case.');
  if(s.case!==targetCase)throw Error('This edits file belongs to another case or has no case identifier.');
  const validated=validateEdits(s,targetCase,META.count,STRUCT_KEYS);
  ({frameDeltas,structMats,deformStrokes}=validated);curStroke=null;applyAllStruct();applyDeform();setFrame(frameIdx);saveEdits();
  if(editMode==='reg') transformCtl.attach(group); else if(editMode==='struct') transformCtl.attach(parts[editStruct]);
  notify('Edits imported for this case.');
  }catch(e){notify('Could not import edits: '+e.message);}finally{$('e-import').value='';}};r.onerror=()=>notify('Could not read that file.');r.readAsText(file);}

/* ---------- uniform scale (all axes) ---------- */
function scaleTarget(){ return editMode==='reg'?group:(editMode==='struct'?parts[editStruct]:null); }
function uScaleInput(v){ const t=scaleTarget(); if(!t) return;
  const factor=Math.pow(4,(v-50)/50); t.scale.multiplyScalar(factor/uLast); uLast=factor; t.updateMatrix();
  $('uscv').textContent=Math.round(factor*100)+'%'; }
function uScaleCommit(){ if(scaleTarget()) saveCurrentEdit(); $('uscale').value=50; uLast=1; $('uscv').textContent='100%'; }

/* ---------- manual elastic deformation (Gaussian soft-drag brush on the liver) ---------- */
function applyDeform(){
  const strokes = curStroke ? deformStrokes.concat([curStroke]) : deformStrokes;
  const vertex=new THREE.Vector3();
  for(const name in parts){
    const base=baseVerts[name]; if(!base) continue;
    const part=parts[name];part.updateMatrix();const inverse=part.matrix.clone().invert();
    const pos=part.geometry.attributes.position.array;
    for(let i=0;i<base.length;i+=3){
      vertex.set(base[i],base[i+1],base[i+2]).applyMatrix4(part.matrix);
      let x=vertex.x,y=vertex.y,z=vertex.z;
      for(const s of strokes){ const r=s.r, s2=2*r*r;
        const dx=x-s.c[0], dy=y-s.c[1], dz=z-s.c[2], d2=dx*dx+dy*dy+dz*dz;
        if(d2<9*r*r){ const w=Math.exp(-d2/s2); x+=s.d[0]*w; y+=s.d[1]*w; z+=s.d[2]*w; } }
      vertex.set(x,y,z).applyMatrix4(inverse);pos[i]=vertex.x;pos[i+1]=vertex.y;pos[i+2]=vertex.z;
    }
    parts[name].geometry.attributes.position.needsUpdate=true;
    parts[name].geometry.computeVertexNormals();
    part.geometry.computeBoundingBox();part.geometry.computeBoundingSphere();part.geometry.boundingBox.getCenter(part.userData.centroid);
  }
  if(points&&parts.liver){points.geometry.attributes.position.array.set(parts.liver.geometry.attributes.position.array);points.geometry.attributes.position.needsUpdate=true;points.geometry.computeBoundingSphere();points.geometry.computeBoundingBox();}
}
function setupDeformDrag(dom){
  let startWorld=null, startPx=null, depthZ=1;
  dom.addEventListener('pointerdown',e=>{
    if(editMode!=='deform'||loadingCase||e.button!==0||!parts.liver.visible)return;
    const r=dom.getBoundingClientRect();
    const ndc=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);
    raycaster.setFromCamera(ndc,camera);
    const hit=raycaster.intersectObject(parts.liver,false)[0]; if(!hit) return;
    const inv=group.matrixWorld.clone().invert();
    const hl=hit.point.clone().applyMatrix4(inv);          // hit in liver-local (common) frame
    // Each new stroke acts in the current, already deformed common anatomy frame.
    const c=[hl.x,hl.y,hl.z];
    startWorld=hit.point.clone(); startPx=[e.clientX,e.clientY]; depthZ=Math.max(0.05,-hit.point.z);
    curStroke={c, d:[0,0,0], r:brushRadius};
    controls.enabled=false; dom.setPointerCapture(e.pointerId);
  });
  dom.addEventListener('pointermove',e=>{
    if(editMode!=='deform'||!curStroke) return;
    const {fx,fy,W,H}=META,r=dom.getBoundingClientRect();
    const wdx=(depthZ/fx)*(e.clientX-startPx[0])*W/r.width;
    const wdy=-(depthZ/fy)*(e.clientY-startPx[1])*H/r.height;
    const inv=group.matrixWorld.clone().invert();
    const p0=startWorld.clone().applyMatrix4(inv);
    const p1=startWorld.clone().add(new THREE.Vector3(wdx,wdy,0)).applyMatrix4(inv);
    curStroke.d=[p1.x-p0.x, p1.y-p0.y, p1.z-p0.z];
    applyDeform();
  });
  dom.addEventListener('pointerup',e=>{
    if(editMode!=='deform'||!curStroke) return;
    const mag=Math.hypot(curStroke.d[0],curStroke.d[1],curStroke.d[2]);
    if(mag>1e-4){ deformStrokes.push(curStroke); saveEdits(); }
    curStroke=null; applyDeform();
    if(dom.hasPointerCapture(e.pointerId))dom.releasePointerCapture(e.pointerId);
  });
  dom.addEventListener('pointercancel',()=>{if(curStroke){curStroke=null;applyDeform();}});
}
function undoDeform(){ deformStrokes.pop(); saveEdits(); applyDeform(); }
function resetDeform(){ deformStrokes=[]; curStroke=null; saveEdits(); applyDeform(); }

/* ---------- global resets ---------- */
function resetCase(){
  frameDeltas={}; structMats={}; deformStrokes=[]; curStroke=null;
  storage.remove(lsKey);
  loadCase(curCase);
}
function resetAll(){
  if(!confirm('Reset ALL manual edits (pose, structures, deformation) for EVERY patient / case? This cannot be undone.')) return;
  CASES.forEach(c=>storage.remove('vis2reg_edits_'+c.key));
  caseEdits.clear();
  frameDeltas={}; structMats={}; deformStrokes=[]; curStroke=null;
  loadCase(curCase);
}

/* ---------- view ---------- */
function updateModeBadge(){
  if(!META)return;
  const b=$('mode-badge');if(!b)return;
  if(editMode==='reg')b.textContent='Editing · liver pose';
  else if(editMode==='struct')b.textContent='Editing · '+((MESH.labels&&MESH.labels[editStruct])||editStruct);
  else if(editMode==='deform')b.textContent='Editing · deformation';
  else if(mode==='explore')b.textContent='3D anatomy exploration';
  else if(META.editableBase)b.textContent=frameDeltas[frameIdx]?'Manual alignment · edited':'Default pose · alignment required';
  else b.textContent='Manual registration · recorded sequence';
  b.style.color=editMode!=='off'?'var(--t1)':mode==='reg'?'var(--accent2)':'var(--t1)';
}
function setMode(m){if(!META||loadingCase||!['reg','explore'].includes(m))return;
  if(m==='explore'&&editMode!=='off')setEditMode('off');
  mode=m;setProjection();const reg=m==='reg';playing=false;updatePlayIcon();
  syncImageVisibility();
  if(editMode==='off') controls.enabled=!reg;
  $('mode-reg').classList.toggle('active',reg); $('mode-explore').classList.toggle('active',!reg);
  updateModeBadge();
  bgImg.style.opacity=reg?1:0.12; scene.fog=(fog&&!reg)?new THREE.Fog(0x0a1420,2.2,6.5):null;
  if(reg){if(editMode!=='off'){tween=null;camera.position.copy(REG_POS);camera.quaternion.copy(REG_QUAT);}else tweenCamera(REG_POS,REG_QUAT);}
  else {tween=null;const c=assemblyCenter.clone().applyMatrix4(group.matrixWorld);controls.target.copy(c);controls.update();}
  emitMode();}
let tween=null;
function tweenCamera(pos,quat){ tween={t:0,p0:camera.position.clone(),q0:camera.quaternion.clone(),pos:pos.clone(),quat:quat.clone()}; }
function stepTween(dt){ if(!tween)return; tween.t=Math.min(1,tween.t+dt*2.2); const e=1-Math.pow(1-tween.t,3);
  camera.position.lerpVectors(tween.p0,tween.pos,e); camera.quaternion.slerpQuaternions(tween.q0,tween.quat,e);
  if(tween.t>=1){ tween=null; controls.target.set(0,0,-3);} }
function presetView(w){if(!META||loadingCase||!['front','top','side'].includes(w))return;setMode('explore');group.updateMatrixWorld(true);
  const bounds=new THREE.Box3(),vertex=new THREE.Vector3();
  Object.values(parts).forEach(part=>{const positions=part.geometry.attributes.position;for(let i=0;i<positions.count;i++)bounds.expandByPoint(vertex.fromBufferAttribute(positions,i).applyMatrix4(part.matrixWorld));});
  const c=bounds.getCenter(new THREE.Vector3());
  const size=bounds.getSize(new THREE.Vector3()),halfFov=38*Math.PI/360,aspect=META.W/META.H;
  const horizontal=w==='side'?size.z:size.x,vertical=w==='top'?size.z:size.y,depth=w==='front'?size.z:w==='top'?size.y:size.x;
  const r=(Math.max(vertical/(2*Math.tan(halfFov)),horizontal/(2*Math.tan(halfFov)*aspect))+depth*.5)*1.12;
  const off={front:[0,0,r],top:[0,-r,0.001],side:[r,0,0.001]}[w]; tween=null;
  camera.position.set(c.x+off[0],c.y+off[1],c.z+off[2]); controls.target.copy(c); camera.lookAt(c); controls.update(); }

/* ---------- pick / label ---------- */
const raycaster=new THREE.Raycaster();
function setupPicking(){ annoEl=document.createElement('div'); annoEl.id='anno'; annoEl.style.display='none'; $('stage').appendChild(annoEl);
  const dom=renderer.domElement; let sx=0,sy=0,downT=0,moved=false; dom.style.cursor='crosshair';
  let held=false,replaying=false;
  dom.addEventListener('pointerdown',e=>{if(replaying)return;sx=e.clientX;sy=e.clientY;moved=false;held=e.button===0;downT=performance.now();});
  dom.addEventListener('pointermove',e=>{
    if(held&&mode==='reg'&&editMode==='off'&&!loadingCase&&Math.hypot(e.clientX-sx,e.clientY-sy)>6){
      setMode('explore');replaying=true;
      dom.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:e.pointerId,pointerType:e.pointerType,clientX:sx,clientY:sy,button:0,buttons:1}));
      replaying=false;moved=true;
    }
  },true);
  dom.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-sx,e.clientY-sy)>6) moved=true;});
  dom.addEventListener('pointerup',e=>{held=false;if(loadingCase||transformCtl.dragging||editMode==='deform')return;if(!moved&&performance.now()-downT<500)pick(e);});
  dom.addEventListener('pointercancel',()=>{held=false;moved=true;});
  setupDeformDrag(dom); }
function pick(e){ const r=renderer.domElement.getBoundingClientRect();
  const ndc=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);
  raycaster.setFromCamera(ndc,camera);
  const structures=raycaster.intersectObjects(STRUCT_KEYS.map(n=>parts[n]).filter(m=>m&&m.visible),false);
  const liverHit=parts.liver.visible?raycaster.intersectObject(parts.liver,false)[0]:null;
  const hit=editMode==='struct'?structures[0]:parts.liver.material.opacity<0.98?structures[0]||liverHit:
    [structures[0],liverHit].filter(Boolean).sort((a,b)=>a.distance-b.distance)[0];
  if(editMode==='struct'){ if(hit) pickStruct(hit.object.userData.name); } else select(hit?hit.object:null); }
function select(mesh){ if(selected&&selected!==mesh) selected.material.emissiveIntensity=selected.userData.baseEmis;
  selected=mesh;emit('selection',mesh?{key:mesh.userData.name,label:mesh.userData.label,color:'#'+mesh.material.color.getHexString(),visible:mesh.visible}:{key:null});
  if(!annoEl)return;if(!mesh){ annoEl.style.display='none'; return; }
  annoEl.innerHTML='<span class="dot" style="background:#'+mesh.material.color.getHexString()+'"></span>'+mesh.userData.label; annoEl.style.display='flex'; }
function updateAnno(){if(!selected||!annoEl)return;if(!selected.visible){annoEl.style.display='none';return;}
  selected.material.emissiveIntensity=selected.userData.baseEmis+0.4*(0.5+0.5*Math.sin(performance.now()*0.005));
  selected.updateWorldMatrix(true,false);const w=selected.userData.centroid.clone().applyMatrix4(selected.matrixWorld);w.project(camera);
  const r=renderer.domElement.getBoundingClientRect();
  annoEl.style.left=(w.x*0.5+0.5)*r.width+'px'; annoEl.style.top=(-w.y*0.5+0.5)*r.height+'px';
  annoEl.style.display=(w.z>=-1&&w.z<=1&&Math.abs(w.x)<1.1&&Math.abs(w.y)<1.1)?'flex':'none'; }

/* ---------- loop ---------- */
function loop(t){ const dt=Math.min(0.05,(t-lastT)/1000)||0; lastT=t;
  stepTween(dt); updateAnno();
  if(playing&&!loadingCase&&mode==='reg'&&editMode==='off'){
    let nf=playhead+dt*(META.fps||25)*speed;
    if(nf>=META.count){nf=0;}
    if(Math.min(META.count-1,Math.floor(nf))!==frameIdx)setFrame(Math.min(META.count-1,Math.floor(nf)));
    playhead=nf;
  }
  if(mode==='explore'){ if(scene.fog){const distance=camera.position.distanceTo(controls.target);scene.fog.near=distance;scene.fog.far=distance+Math.max(.8,distance*.9);scene.fog.color.setHex(0x14251b);} if(spin){ const c=controls.target; camera.position.sub(c);
    camera.position.applyAxisAngle(new THREE.Vector3(0,1,0),dt*0.4); camera.position.add(c);} controls.update(); }
  renderer.render(scene,camera); requestAnimationFrame(loop); }
function onResize(){if(!renderer)return;const s=$('stage'),wrap=$('stage-wrap'),aspect=META?META.W/META.H:16/9;
  const mobilePage=window.innerWidth<=760&&!document.fullscreenElement&&!document.body.classList?.contains('presenting');
  const w=Math.max(1,mobilePage?wrap.clientWidth:Math.min(wrap.clientWidth,wrap.clientHeight*aspect)),h=w/aspect;
  s.style.width=w+'px';s.style.height=h+'px';s.style.aspectRatio=String(aspect);s.style.setProperty('--image-aspect',String(aspect));renderer.setSize(w,h,false);if(META)setProjection();}

/* ---------- UI ---------- */
function wireUI(){
  $('opacity').addEventListener('input',e=>{if(META&&!loadingCase)setDisplay({opacity:+e.target.value});});
  $('mode-reg').onclick=()=>window.Vis2Reg.resetView(); $('mode-explore').onclick=()=>setMode('explore');
  $('v-reset').onclick=()=>window.Vis2Reg.resetView(); $('v-front').onclick=()=>presetView('front');
  $('v-top').onclick=()=>presetView('top'); $('v-side').onclick=()=>presetView('side');
  $('opt-fog').addEventListener('change',e=>{if(META&&!loadingCase)setDisplay({fog:e.target.checked});});
  $('opt-spin').addEventListener('change',e=>{if(META&&!loadingCase)setDisplay({spin:e.target.checked});});
  $('em-off').onclick=()=>setEditMode('off'); $('em-reg').onclick=()=>setEditMode('reg');
  $('em-struct').onclick=()=>setEditMode('struct'); $('em-deform').onclick=()=>setEditMode('deform');
  $('gz-translate').onclick=()=>setGizmo('translate'); $('gz-rotate').onclick=()=>setGizmo('rotate'); $('gz-scale').onclick=()=>setGizmo('scale');
  $('uscale').addEventListener('input',e=>uScaleInput(+e.target.value)); $('uscale').addEventListener('change',uScaleCommit);
  $('brush').addEventListener('input',e=>{ brushRadius=+e.target.value/100; $('brv').textContent=e.target.value+'%'; });
  $('d-undo').onclick=undoDeform; $('d-reset').onclick=resetDeform;
  $('e-reset-case').onclick=resetCase; $('e-reset-all').onclick=resetAll;
  $('edit-toggle').onclick=()=>{ const b=$('edit-body'); const willHide=b.style.display!=='none';
    b.style.display=willHide?'none':'block'; $('edit-chevron').textContent=willHide?'▸ SHOW':'▾ HIDE';
    if(willHide) setEditMode('off'); };
  $('e-reset-frame').onclick=resetFrame; $('e-reset-struct').onclick=resetStruct;
  $('e-copy-next').onclick=()=>copyDelta(false); $('e-copy-all').onclick=()=>copyDelta(true);
  $('e-export').onclick=exportEdits; $('e-import').onchange=e=>{ if(e.target.files[0]) importEdits(e.target.files[0]); };
  $('play').onclick=togglePlay;
  $('scrub').addEventListener('input',e=>{ playing=false; updatePlayIcon(); setFrame(+e.target.value); if(editMode==='reg') transformCtl.attach(group); });
  document.querySelectorAll('.speed button').forEach(b=>b.onclick=()=>{if(META&&!loadingCase)setDisplay({speed:+b.dataset.s});});
  addEventListener('keydown',e=>{if(loadingCase||!META||e.ctrlKey||e.metaKey||e.altKey||e.defaultPrevented||
      document.querySelector('dialog[open]')||e.target.closest('input,select,textarea,button,a,[contenteditable="true"],dialog,[role="dialog"]'))return;
    if(e.code==='Space'){e.preventDefault();togglePlay();}
    else if(e.code==='ArrowRight'){e.preventDefault();playing=false;updatePlayIcon();setFrame(frameIdx+1);if(editMode==='reg')transformCtl.attach(group);}
    else if(e.code==='ArrowLeft'){e.preventDefault();playing=false;updatePlayIcon();setFrame(frameIdx-1);if(editMode==='reg')transformCtl.attach(group);}
    else if(e.key.toLowerCase()==='r'){e.preventDefault();window.Vis2Reg.resetView();}
    else if(e.code==='Escape'&&editMode!=='off'){e.preventDefault();setEditMode('off');}
    else if(editMode==='reg'||editMode==='struct'){if(e.key==='g')setGizmo('translate');else if(e.key==='t')setGizmo('rotate');else if(e.key==='s')setGizmo('scale');} });
}
function togglePlay(){if(!META||loadingCase||editMode!=='off'||mode!=='reg')return;playing=!playing;updatePlayIcon();}
function updatePlayIcon(){if(!$('play-i'))return;$('play-i').innerHTML=playing?'<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>':'<path d="M8 5v14l11-7z"/>';
  $('play').setAttribute('aria-label',playing?'Pause':curCase&&curCase.type==='images'?'Play image sequence':'Play recorded sequence');
  $('play').setAttribute('aria-pressed',String(playing));$('play').disabled=loadingCase||editMode!=='off'||mode!=='reg';emit('playback',{playing});}
