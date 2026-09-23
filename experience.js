/* Presentation layer: uses the viewer's public API, leaves registration data untouched. */
'use strict';
(() => {
  const el=id=>document.getElementById(id);
  const viewer=document.querySelector('.viewer');
  let currentCase=null, manifest=null, metadata=null, raw=false, guideStep=0, guideSnapshot=null, guideMode='reg', guideCompare=50, toastTimer, refreshToken=0;
  const api=()=>window.Vis2Reg;
  const state=()=>api()?.getState();
  window.demoToast=message=>{clearTimeout(toastTimer);el('toast').textContent=message;el('toast').classList.add('visible');toastTimer=setTimeout(()=>el('toast').classList.remove('visible'),3200);};
  function rangePaint(input){const n=(+input.value-+input.min)/(+input.max-+input.min)*100;input.style.setProperty('--range',n+'%');}
  document.querySelectorAll('input[type="range"]').forEach(input=>{rangePaint(input);input.addEventListener('input',()=>rangePaint(input));});
  function leaveRaw(){raw=false;viewer.classList.remove('raw');el('mode-raw').classList.remove('active');}
  function setOpacity(value){el('opacity').value=value;el('opacity').dispatchEvent(new Event('input',{bubbles:true}));}
  document.querySelectorAll('[data-opacity]').forEach(button=>button.addEventListener('click',()=>setOpacity(button.dataset.opacity)));
  el('opacity').addEventListener('input',()=>{if(raw)el('mode-reg').click();document.querySelectorAll('[data-opacity]').forEach(button=>button.classList.toggle('active',button.dataset.opacity===el('opacity').value));});
  el('layer-list').addEventListener('change',()=>{if(raw)el('mode-reg').click();});
  el('mode-raw').addEventListener('click',()=>{
    if(!api())return;
    api().setEditMode('off');api().setMode('reg');raw=true;viewer.classList.add('raw');
    el('mode-badge').textContent='Original laparoscopic image';el('mode-raw').classList.add('active');el('mode-reg').classList.remove('active');el('mode-explore').classList.remove('active');
    syncPressed();
  });
  el('mode-reg').addEventListener('click',leaveRaw);
  el('mode-explore').addEventListener('click',leaveRaw);
  ['v-front','v-top','v-side','v-reset','em-reg','em-struct','em-deform'].forEach(id=>el(id).addEventListener('click',leaveRaw));
  function step(n){const s=state();if(!s)return;if(s.playing)api().togglePlay();api().setFrame(s.frameIdx+n);}
  el('step-back').onclick=()=>step(-1);el('step-next').onclick=()=>step(1);
  function syncPressed(){document.querySelectorAll('.view-tabs button,.speed button,.reveal-presets button').forEach(button=>button.setAttribute('aria-pressed',String(button.classList.contains('active'))));}
  const buttonObserver=new MutationObserver(syncPressed);
  document.querySelectorAll('.view-tabs button,.speed button,.reveal-presets button').forEach(button=>buttonObserver.observe(button,{attributes:true,attributeFilter:['class']}));
  window.addEventListener('vis2reg:mode',event=>{
    const d=event.detail; leaveRaw();
    viewer.classList.toggle('exploring',d.mode==='explore');
    el('hint').textContent=d.editMode!=='off'?'Manual adjustment active · changes save in this browser':d.mode==='explore'?'Drag to rotate · scroll to zoom · R to return':'Click an internal structure to identify it · select 3D anatomy to rotate';
    document.querySelectorAll('[data-opacity]').forEach(button=>button.disabled=d.editMode==='deform');
    if(d.editMode!=='off'&&el('edit-body').style.display==='none'){el('edit-body').style.display='block';el('edit-toggle').setAttribute('aria-expanded','true');el('edit-chevron').textContent='−';}
    syncPressed();
  });
  new MutationObserver(()=>{const open=el('edit-body').style.display!=='none';el('edit-toggle').setAttribute('aria-expanded',String(open));el('edit-chevron').textContent=open?'−':'+';}).observe(el('edit-body'),{attributes:true,attributeFilter:['style']});
  window.addEventListener('vis2reg:case',async event=>{
    leaveRaw();const token=++refreshToken;currentCase=event.detail;el('filmstrip').replaceChildren();
    const c=currentCase;const isImages=c.type==='images';const patient=c.key==='p4video'?'04':c.key.replace('llr_p','').padStart(2,'0');
    el('case-title').textContent='Patient '+patient;
    el('case-kind').textContent=isImages?'LLR-LUS image set':'In-vivo sequence';
    el('case-source').textContent=isImages?'LLR-LUS benchmark':'Recorded laparoscopy';
    el('source-status').textContent=isImages?'Default pose · manual alignment required':'Manually aligned sequence';
    el('scope-note').innerHTML=isImages?'Default poses · tumour from preoperative model.<br>Alignment is not validated in this viewer.':'Manual poses · illustrative internal anatomy.<br>For research demonstration.';
    el('frame-unit').textContent=isImages?'IMAGE':'FRAME';el('duration').textContent=isImages?c.count+' images':((c.count-1)/c.fps).toFixed(1)+'s';
    const options=el('case-sel').options;
    const names=['Patient 04 · In-vivo sequence','Patient 01 · LLR-LUS','Patient 02 · LLR-LUS','Patient 03 · LLR-LUS','Patient 04 · LLR-LUS'];
    Array.from(options).forEach((option,i)=>{if(names[i])option.textContent=names[i];});
    try{
      manifest=manifest||await fetch('data/datasets.json').then(r=>r.json());
      const dataCase=manifest.cases.find(x=>x.key===c.key); if(!dataCase)return;
      const m=await fetch('data/'+dataCase.dir+'/frames.json').then(r=>r.json()); if(token!==refreshToken)return;
      metadata=m;el('filmstrip').replaceChildren();
      const indices=[...new Set(Array.from({length:6},(_,i)=>Math.round(i*(m.count-1)/5)))];
      for(const i of indices){const frame=m.frames[i],button=document.createElement('button');button.className='film-frame';button.dataset.frame=i;
        const caption=isImages?'Image '+(i+1):((i/(m.fps||1)).toFixed(1)+'s');
        button.setAttribute('aria-label','Go to '+(isImages?'image '+(i+1):'frame '+i+', '+caption));
        const img=document.createElement('img');img.src='data/'+dataCase.dir+'/frames/f_'+String(frame.i).padStart(6,'0')+'.jpg';img.alt='';img.loading='lazy';
        const label=document.createElement('span');label.textContent=caption;button.append(img,label);button.onclick=()=>{const s=state();if(s.playing)api().togglePlay();api().setFrame(i);};el('filmstrip').append(button);
      }
      updateFrame({index:state()?.frameIdx||0,count:m.count});
    }catch(error){window.demoToast('Keyframe previews could not be loaded. The timeline is still available.');}
    rangePaint(el('opacity'));syncPressed();
  });
  function updateFrame(d){if(raw)el('mode-badge').textContent='Original laparoscopic image';rangePaint(el('scrub'));el('step-back').disabled=d.index<=0;el('step-next').disabled=d.index>=d.count-1;
    const imageSequence=(d.type||currentCase?.type)==='images';el('fi').textContent=imageSequence?d.index+1:d.index;el('fn').textContent=imageSequence?d.count:d.count-1;const buttons=Array.from(el('filmstrip').children);let nearest=null,dist=Infinity;for(const b of buttons){const delta=Math.abs(+b.dataset.frame-d.index);if(delta<dist){dist=delta;nearest=b;}}
    buttons.forEach(b=>{b.classList.toggle('active',b===nearest);b.setAttribute('aria-current',b===nearest?'true':'false');});
    if(currentCase?.type==='images'){const edited=el('edited').style.display!=='none';el('source-status').textContent=edited?'Manual adjustment · unvalidated':'Default pose · manual alignment required';}
  }
  new MutationObserver(()=>{if(currentCase?.type==='images')el('source-status').textContent=el('edited').style.display!=='none'?'Manual adjustment · unvalidated':'Default pose · manual alignment required';}).observe(el('edited'),{attributes:true,attributeFilter:['style']});
  window.addEventListener('vis2reg:frame',event=>updateFrame(event.detail));
  el('bg').addEventListener('error',()=>{el('frame-error').hidden=false;});el('bg').addEventListener('load',()=>{el('frame-error').hidden=true;});
  function presentation(){const on=document.body.classList.toggle('presenting');el('present').querySelector('span').textContent=on?'Exit presentation':'Present';el('present').setAttribute('aria-pressed',String(on));el('present').setAttribute('aria-label',on?'Exit presentation':'Enter presentation');window.dispatchEvent(new Event('resize'));}
  el('present').onclick=presentation;
  el('stage-fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(viewer.requestFullscreen)await viewer.requestFullscreen();else presentation();}catch(error){presentation();}};
  document.addEventListener('fullscreenchange',()=>{const target=document.fullscreenElement||document.body;['toast','loading','guide'].forEach(id=>target.appendChild(el(id)));window.dispatchEvent(new Event('resize'));const name=document.fullscreenElement?'Exit fullscreen':'Expand imaging workspace';el('stage-fullscreen').setAttribute('aria-label',name);el('stage-fullscreen').title=name;});
  function openDialog(content){if(state()?.playing)api().togglePlay();el('dialog-content').innerHTML=content;el('dialog-content').querySelector('h2').id='dialog-title';el('info-dialog').setAttribute('aria-labelledby','dialog-title');el('info-dialog').showModal();}
  el('about-open').onclick=()=>openDialog(`<div class="eyebrow">VIS2REG · AE-CAI × PRiSM 2026</div><h2>From the surface<br>to the anatomy beneath.</h2><p>Explore preoperative liver anatomy in the context of recorded laparoscopic images. Adjust transparency, inspect internal structures and orbit the anatomy in 3D.</p><h3>What you are seeing</h3><p>The Patient 04 sequence uses saved manual liver poses. Internal anatomy is illustrative; its alignment has not been validated. This viewer replays prepared data and does not run the Vis2Reg inference pipeline.</p><h3>About the method</h3><p>Vis2Reg studies visibility-aware, landmark-free 3D–2D liver registration, combining rigid alignment and non-rigid refinement with supervision from the visible image domain.</p><div class="dialog-meta">Jiaming Feng · Sharib Ali<br>AI in Medicine and Surgery Group · University of Leeds<br>EPSRC Grant UKRI914<br><br>Prepared data · local processing · research demonstration</div>`);
  el('help-open').onclick=()=>openDialog(`<div class="eyebrow">MAKE YOURSELF AT HOME</div><h2>A few useful shortcuts.</h2><div class="shortcut-list"><span>Play / pause the sequence</span><kbd>Space</kbd><span>Previous / next frame</span><kbd>← / →</kbd><span>AR / original / comparison / 3D</span><kbd>1 / 2 / 3 / 4</kbd><span>Save the current view</span><kbd>B</kbd><span>Export an image</span><kbd>E</kbd><span>Return to camera view</span><kbd>R</kbd><span>Move / rotate / scale while editing</span><kbd>G / T / S</kbd><span>Close guide or presentation</span><kbd>Esc</kbd></div><p>In 3D anatomy, drag to orbit and scroll to zoom. Click an internal structure to identify it. Manual adjustments save in this browser; export edits to keep a portable copy.</p>`);
  el('info-dialog').querySelector('.dialog-close').onclick=()=>el('info-dialog').close();
  el('info-dialog').addEventListener('click',e=>{if(e.target===el('info-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  const guide=[{title:'Start with the surface.',text:'The original image is all the laparoscope sees. Use the timeline or a thumbnail to explore another moment.',run:()=>el('mode-raw').click()},{title:'Reveal the hidden anatomy.',text:'The preoperative model adds internal context. Drag liver transparency to reveal the tumours beneath the surface.',run:()=>{el('mode-reg').click();setOpacity(85);}},{title:'Two views. One frame.',text:'Drag the comparison divider across the same image to see exactly what the prepared overlay adds. Save an interesting perspective to revisit it.',run:()=>{el('mode-reg').click();setOpacity(65);el('mode-compare').click();}},{title:'A different perspective.',text:'Drag to rotate the anatomy and explore its spatial relationships. Return to the camera view whenever you are ready.',run:()=>{leaveRaw();api()?.presetView('front');}}];
  function showStep(){const g=guide[guideStep];g.run();el('guide-step').textContent='0'+(guideStep+1)+' / 04';el('guide-title').textContent=g.title;el('guide-text').textContent=g.text;el('guide-next').innerHTML=(guideStep===3?'Start exploring':'Next step')+' <svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg>';el('guide').querySelectorAll('.guide-progress i').forEach((bar,i)=>bar.classList.toggle('active',i<=guideStep));}
  async function closeGuide(restore=true){el('guide').hidden=true;const snapshot=guideSnapshot;guideSnapshot=null;if(restore!==false&&snapshot){try{await api().restoreView(snapshot);window.Vis2RegExperience?.setComparison(guideCompare);window.Vis2RegExperience?.setViewMode(guideMode);}catch(error){window.demoToast('The guide has closed. Choose a view to continue.');}}el('guide-open').focus();}
  el('guide-open').onclick=()=>{if(!api())return;guideSnapshot=api().getViewState?.()||null;guideMode=window.Vis2RegExperience?.getViewMode()||'reg';guideCompare=window.Vis2RegExperience?.getComparison()??50;api().setEditMode('off');guideStep=0;el('guide').hidden=false;showStep();el('guide-next').focus();};
  el('guide-next').onclick=()=>{if(guideStep<3){guideStep++;showStep();}else{closeGuide(false);el('mode-reg').click();setOpacity(65);}};
  el('guide-close').onclick=closeGuide;
  window.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]'))return;if(e.key==='Escape'){if(!el('guide').hidden)closeGuide();else if(document.body.classList.contains('presenting'))presentation();}if(!e.defaultPrevented&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.toLowerCase()==='r'&&!/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)&&!el('info-dialog').open)leaveRaw();});
  const importButton=document.querySelector('label.btn:has(#e-import)');importButton.setAttribute('tabindex','0');importButton.setAttribute('role','button');importButton.addEventListener('keydown',e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();e.stopPropagation();el('e-import').click();}});
  syncPressed();
})();
