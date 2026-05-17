import path from "path";
import fs from "fs";
import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, templatesTable, websitesTable } from "@workspace/db";
import type { ContentField } from "./content-extractor";

// ── Shared path helpers ───────────────────────────────────────────────────────

export function findProjectDir(templateDir: string): string {
  const entries = fs.readdirSync(templateDir).filter((e) => e !== "__MACOSX");
  if (entries.length === 1) {
    const candidate = path.join(templateDir, entries[0]);
    if (fs.statSync(candidate).isDirectory()) return candidate;
  }
  return templateDir;
}

export function findDistDir(projectDir: string): string | null {
  for (const d of ["dist", "build", "out", "public", ".output/public"]) {
    const candidate = path.join(projectDir, d);
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

export const MIME_MAP: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

// ── Block ops type ─────────────────────────────────────────────────────────────

interface BlockOps {
  order: string[];
  deleted: string[];
}

// ── Visual editor injection script ────────────────────────────────────────────
// Injected when ?editor=1. Block editor + inline text editing via postMessage.

function buildEditorScript(fields: ContentField[], blockOps?: BlockOps): string {
  const json = JSON.stringify(
    fields.map((f) => ({ id: f.id, label: f.label, original: f.original, current: f.current }))
  );
  const opsJson = JSON.stringify(blockOps ?? { order: [], deleted: [] });

  return `<script>
(function(){
'use strict';
// ── Config ───────────────────────────────────────────────────────────────────
var FIELDS=${json};
var BLOCK_OPS=${opsJson};

// ── Text-editor state ─────────────────────────────────────────────────────────
var labelEl=null,inited=false,initTimer=null,captureReady=false,autoIdx=0,textJustClicked=false;
var SKIP_TAGS={script:1,style:1,noscript:1,head:1,svg:1,path:1,iframe:1,code:1,pre:1,textarea:1,input:1,select:1};

// ── Block-editor state ────────────────────────────────────────────────────────
var allBlocks=[],blockContainer=null,selectedBlock=null,hoveredBlock=null,blockToolbar=null,dupCounter=0,insBtns=[];

// ── Image-editor state ────────────────────────────────────────────────────────
var editorMode='text',hoveredImg=null;

// ─────────────────────────────────────────────────────────────────────────────
// TEXT EDITING HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function buildMap(){
  var m={};
  FIELDS.forEach(function(f){
    if(f.original&&f.original.trim().length>1) m[f.original.trim()]=f;
    if(f.current&&f.current.trim().length>1&&f.current!==f.original) m[f.current.trim()]=f;
  });
  return m;
}
function showLabel(el,text){
  if(!labelEl){
    labelEl=document.createElement('div');
    labelEl.setAttribute('data-cxa-tip','1');
    labelEl.style.cssText='position:fixed;z-index:2147483647;background:#1A0333;color:#e2c8ff;font-size:10px;font-weight:600;letter-spacing:.05em;padding:3px 8px;border-radius:5px;pointer-events:none;font-family:system-ui,sans-serif;white-space:nowrap;border:1px solid #3B0764;box-shadow:0 4px 12px rgba(0,0,0,.5);opacity:0;transition:opacity .1s';
    document.body.appendChild(labelEl);
  }
  labelEl.textContent=text;
  var r=el.getBoundingClientRect();
  var top=r.top-28; if(top<4)top=r.bottom+4;
  labelEl.style.top=top+'px';
  labelEl.style.left=Math.max(4,r.left)+'px';
  labelEl.style.display='block';
  requestAnimationFrame(function(){if(labelEl)labelEl.style.opacity='1';});
}
function hideLabel(){if(labelEl){labelEl.style.opacity='0';setTimeout(function(){if(labelEl)labelEl.style.display='none';},100);}}
function activateEdit(el){
  if(el.contentEditable==='true') return;
  hideLabel();
  el.contentEditable='true';
  el.style.outline='2px solid #C97B2B';
  el.style.outlineOffset='4px';
  el.style.borderRadius='3px';
  el.style.cursor='text';
  el.focus();
  try{var r=document.createRange(),s=window.getSelection();r.selectNodeContents(el);r.collapse(false);if(s){s.removeAllRanges();s.addRange(r);}}catch(ex){}
}
function wire(el,field){
  if(el.getAttribute('data-cxa')==='true') return;
  el.setAttribute('data-cxa','true');
  el.setAttribute('data-cxa-id',field.id);
  el.setAttribute('data-cxa-lbl',field.label);
  el.setAttribute('data-cxa-orig',field.original);
  el.setAttribute('data-cxa-base',el.innerText||'');
  el.style.cursor='pointer';
  el.addEventListener('blur',function(){
    el.contentEditable='false';
    el.style.outline='';el.style.outlineOffset='';el.style.borderRadius='';el.style.cursor='pointer';
    var v=(el.innerText||'').trim();
    var fid=el.getAttribute('data-cxa-id')||'';
    var isAuto=fid.indexOf('auto-')===0;
    var orig=el.getAttribute('data-cxa-orig')||'';
    var lbl=el.getAttribute('data-cxa-lbl')||'';
    try{window.parent.postMessage({type:isAuto?'certxa-field-new':'certxa-field-update',fieldId:fid,original:orig,label:lbl,value:v},'*');}catch(ex){}
  });
  el.addEventListener('keydown',function(e){
    if(e.key==='Escape'){el.innerText=el.getAttribute('data-cxa-base')||'';el.blur();}
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();el.blur();}
  });
}
function scanAll(){
  var map=buildMap(),count=0;
  var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null),n;
  while((n=w.nextNode())){
    var txt=(n.nodeValue||'').trim();
    if(!txt||txt.length<2||txt.length>500) continue;
    var hasCurrency=/[$\u20ac\u00a3\u00a5]/.test(txt);
    if(!hasCurrency&&!/[a-zA-Z]/.test(txt)&&txt.length<5) continue;
    var p=n.parentElement;
    if(!p||p===document.body||p.hasAttribute('data-cxa')) continue;
    if(SKIP_TAGS[p.tagName.toLowerCase()]) continue;
    if(p.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li').length>0) continue;
    var field=map[txt];
    if(!field){var slug=txt.replace(/[^a-z0-9]/gi,'').slice(0,12);field={id:'auto-'+(autoIdx++)+'-'+slug,label:p.tagName+' \u2014 '+txt.slice(0,45),original:txt,current:txt};}
    wire(p,field);count++;
  }
  var priceRx=/^[$\u20ac\u00a3\u00a5]\s*[\d,]+[\d.,+\-]*[+\-]?%?$/;
  document.querySelectorAll('span,div,td,p,strong,b,em').forEach(function(el){
    if(el.getAttribute('data-cxa')==='true') return;
    var tc=(el.textContent||'').trim();
    if(!priceRx.test(tc)) return;
    if(el.querySelector('[data-cxa="true"]')) return;
    if(el.querySelectorAll('p,h1,h2,h3,h4,h5,h6,div,section,article').length>0) return;
    var slug=tc.replace(/[^a-z0-9]/gi,'').slice(0,12);
    var field=map[tc]||{id:'auto-'+(autoIdx++)+'-'+slug,label:el.tagName+' \u2014 '+tc,original:tc,current:tc};
    wire(el,field);count++;
  });
  return count;
}
function setupCaptureHandlers(){
  if(captureReady) return;captureReady=true;
  document.addEventListener('click',function(e){
    var hits=document.elementsFromPoint(e.clientX,e.clientY);
    for(var i=0;i<hits.length;i++){
      if(hits[i].getAttribute('data-cxa')==='true'){
        e.preventDefault();e.stopPropagation();textJustClicked=true;activateEdit(hits[i]);return;
      }
    }
    textJustClicked=false;
  },true);
  document.addEventListener('mousemove',function(e){
    var hits=document.elementsFromPoint(e.clientX,e.clientY),found=null;
    for(var i=0;i<hits.length;i++){if(hits[i].getAttribute('data-cxa')==='true'&&hits[i].contentEditable!=='true'){found=hits[i];break;}}
    document.querySelectorAll('[data-cxa="true"]').forEach(function(el){if(el!==found&&el.contentEditable!=='true'){el.style.outline='';el.style.outlineOffset='';el.style.borderRadius='';}});
    if(found){found.style.outline='2px solid #3B0764';found.style.outlineOffset='4px';found.style.borderRadius='3px';showLabel(found,found.getAttribute('data-cxa-lbl')||'Edit text');}
    else hideLabel();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK EDITOR HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function blkSig(el){
  var tag=el.tagName.toLowerCase();
  var cls=(el.className||'').trim().split(/\s+/)[0]||'';
  var txt=(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,40);
  var h=0;for(var i=0;i<txt.length;i++)h=((h*31)|0)+txt.charCodeAt(i);
  return tag+'_'+cls+'_'+(h>>>0).toString(36);
}
function blkLabel(el){
  var t=el.tagName.toLowerCase(),c=(el.className||'').toLowerCase();
  if(c.indexOf('announcement')>=0||c.indexOf('marquee')>=0||c.indexOf('banner-top')>=0) return 'Announcement Bar';
  if(t==='header'||c.indexOf('header')>=0) return 'Header / Nav';
  if(t==='nav'||c.indexOf('navbar')>=0) return 'Navigation';
  if(c.indexOf('hero')>=0) return 'Hero';
  if(c.indexOf('service')>=0) return 'Services';
  if(c.indexOf('gallery')>=0||c.indexOf('portfolio')>=0) return 'Gallery';
  if(c.indexOf('review')>=0||c.indexOf('testimonial')>=0) return 'Reviews';
  if(c.indexOf('contact')>=0) return 'Contact';
  if(c.indexOf('cta')>=0||c.indexOf('booking')>=0||c.indexOf('appointment')>=0) return 'Booking / CTA';
  if(c.indexOf('about')>=0) return 'About';
  if(c.indexOf('team')>=0||c.indexOf('staff')>=0) return 'Team';
  if(c.indexOf('price')>=0||c.indexOf('pricing')>=0) return 'Pricing';
  if(t==='footer'||c.indexOf('footer')>=0) return 'Footer';
  if(t==='section') return 'Section';
  return 'Block';
}
function findBlocks(){
  var BT={section:1,div:1,article:1,header:1,footer:1,main:1,aside:1,nav:1};
  function sigKids(el){
    var k=[];
    for(var i=0;i<el.children.length;i++){
      var c=el.children[i];
      if(BT[c.tagName.toLowerCase()]){var r=c.getBoundingClientRect();if(r.height>60&&r.width>100)k.push(c);}
    }
    return k;
  }
  var el=document.body,d=0,best=null;
  while(el&&d<10){var k=sigKids(el);if(k.length>=2){best={container:el,blocks:k};}if(k.length===1){el=k[0];d++;}else break;}
  return best;
}
function refreshBlocks(){
  // Clear marks on old blocks
  allBlocks.forEach(function(b){b.removeAttribute('data-cxa-block');b.removeAttribute('data-cxa-hover');});
  var res=findBlocks();if(!res)return;
  blockContainer=res.container;allBlocks=res.blocks;
  allBlocks.forEach(function(b){
    if(!b.__cxasig)b.__cxasig=blkSig(b);
    b.setAttribute('data-cxa-block','1');
  });
  renderInsBtns();
}
function applyStoredOps(){
  if(!blockContainer||!allBlocks.length)return;
  var ord=BLOCK_OPS.order||[],del=BLOCK_OPS.deleted||[];
  var sigMap={};allBlocks.forEach(function(b){sigMap[b.__cxasig]=b;});
  del.forEach(function(s){if(sigMap[s])sigMap[s].style.display='none';});
  if(ord.length>0)ord.forEach(function(s){if(sigMap[s]&&sigMap[s].style.display!=='none')blockContainer.appendChild(sigMap[s]);});
}
function sendBlockOps(){
  var order=[],deleted=[];
  allBlocks.forEach(function(b){if(b.style.display==='none')deleted.push(b.__cxasig);else order.push(b.__cxasig);});
  try{window.parent.postMessage({type:'certxa-block-ops',order:order,deleted:deleted},'*');}catch(e){}
}
function updateTbPos(){
  if(!selectedBlock||!blockToolbar)return;
  var lbl=blockToolbar.querySelector('[data-cxa-tb-lbl]');
  if(lbl)lbl.textContent=blkLabel(selectedBlock);
  blockToolbar.style.display='flex';
  var r=selectedBlock.getBoundingClientRect();
  // Pin the bar flush to the top-left of the block border (Microweber style)
  blockToolbar.style.top=(r.top-1)+'px';
  var left=Math.max(0,r.left);
  blockToolbar.style.left=left+'px';
}
function selectBlock(el){
  if(selectedBlock===el)return;
  deselectBlock();selectedBlock=el;
  el.setAttribute('data-cxa-sel','1');
  updateTbPos();
}
function deselectBlock(){
  if(selectedBlock){
    selectedBlock.removeAttribute('data-cxa-sel');selectedBlock=null;
  }
  if(blockToolbar)blockToolbar.style.display='none';
}
function createToolbar(){
  var t=document.createElement('div');
  t.setAttribute('data-cxa-toolbar','1');
  // Bar sits at the top edge of the block — no border-radius so it feels flush
  t.style.cssText='position:fixed;z-index:2147483646;display:none;align-items:stretch;font-family:system-ui,sans-serif;pointer-events:auto;user-select:none;height:26px;box-shadow:0 2px 8px rgba(0,0,0,.25);';
  // Left: blue label badge
  var lbl=document.createElement('div');
  lbl.setAttribute('data-cxa-tb-lbl','1');
  lbl.style.cssText='background:#1B6EF0;color:#fff;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:0 10px;display:flex;align-items:center;white-space:nowrap;';
  t.appendChild(lbl);
  // Right: action buttons (blue, separated by subtle dividers)
  var ctrl=document.createElement('div');
  ctrl.style.cssText='display:flex;align-items:stretch;';
  function btn(title,svg,action){
    var b=document.createElement('button');b.title=title;
    b.style.cssText='background:#1B6EF0;border:none;border-left:1px solid rgba(255,255,255,.18);color:#fff;cursor:pointer;padding:0 9px;display:flex;align-items:center;justify-content:center;transition:background .12s;';
    b.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">'+svg+'</svg>';
    b.addEventListener('mouseenter',function(){b.style.background='#0f55cc';});
    b.addEventListener('mouseleave',function(){b.style.background='#1B6EF0';});
    b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();action();});
    return b;
  }
  // Move up
  ctrl.appendChild(btn('Move section up','<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',function(){
    if(!selectedBlock)return;
    var prev=selectedBlock.previousElementSibling;
    while(prev&&(prev.getAttribute('data-cxa-toolbar')||prev.getAttribute('data-cxa-tip')))prev=prev.previousElementSibling;
    if(prev&&allBlocks.indexOf(prev)>=0){blockContainer.insertBefore(selectedBlock,prev);refreshBlocks();sendBlockOps();updateTbPos();}
  }));
  // Move down
  ctrl.appendChild(btn('Move section down','<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',function(){
    if(!selectedBlock)return;
    var next=selectedBlock.nextElementSibling;
    while(next&&(next.getAttribute('data-cxa-toolbar')||next.getAttribute('data-cxa-tip')))next=next.nextElementSibling;
    if(next&&allBlocks.indexOf(next)>=0){blockContainer.insertBefore(next,selectedBlock);refreshBlocks();sendBlockOps();updateTbPos();}
  }));
  // Duplicate
  ctrl.appendChild(btn('Duplicate section','<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',function(){
    if(!selectedBlock)return;
    var clone=selectedBlock.cloneNode(true);
    clone.querySelectorAll('[data-cxa]').forEach(function(el){
      ['data-cxa','data-cxa-id','data-cxa-lbl','data-cxa-orig','data-cxa-base'].forEach(function(a){el.removeAttribute(a);});
      el.style.cursor='';el.style.outline='';el.style.outlineOffset='';el.style.borderRadius='';
    });
    clone.removeAttribute('data-cxa-sel');
    clone.__cxasig=selectedBlock.__cxasig+'-d'+(dupCounter++);
    blockContainer.insertBefore(clone,selectedBlock.nextElementSibling);
    refreshBlocks();setTimeout(function(){scanAll();},150);
    sendBlockOps();selectBlock(clone);
  }));
  // Delete
  ctrl.appendChild(btn('Delete section','<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',function(){
    if(!selectedBlock)return;
    if(!confirm('Delete this section? Save to make it permanent, or refresh to undo.'))return;
    var toDel=selectedBlock;deselectBlock();toDel.style.display='none';
    refreshBlocks();sendBlockOps();
  }));
  t.appendChild(ctrl);
  document.body.appendChild(t);
  return t;
}
// ── Single "Add Layout" button — appears at top-center of hovered/selected block ──
var insBtnEl=null;
function clearInsBtns(){/* no-op: single shared button, not a list */}
function createInsBtn(){
  if(insBtnEl)return;
  var btn=document.createElement('button');
  btn.setAttribute('data-cxa-ins','1');
  btn.style.cssText='position:fixed;z-index:2147483644;display:none;background:#1B6EF0;color:#fff;border:none;cursor:pointer;font-size:11px;font-weight:700;padding:5px 18px;border-radius:20px;font-family:system-ui,sans-serif;letter-spacing:.06em;white-space:nowrap;box-shadow:0 2px 12px rgba(27,110,240,.6);pointer-events:auto;transform:translateX(-50%);transition:background .12s;';
  btn.textContent='+ ADD LAYOUT';
  btn.addEventListener('mouseenter',function(){btn.style.background='#0f55cc';});
  btn.addEventListener('mouseleave',function(){btn.style.background='#1B6EF0';});
  btn.addEventListener('click',function(e){
    e.preventDefault();e.stopPropagation();
    var target=hoveredBlock||selectedBlock;
    if(target)selectBlock(target);
    // Find the block BEFORE the target so new block inserts above it
    var targetIdx=target?allBlocks.indexOf(target):-1;
    var afterBlk=targetIdx>0?allBlocks[targetIdx-1]:null;
    try{window.parent.postMessage({type:'certxa-open-block-picker',afterSig:afterBlk?afterBlk.__cxasig:null},'*');}catch(ex){}
  });
  document.body.appendChild(btn);
  insBtnEl=btn;
}
function posInsBtn(){
  if(!insBtnEl)return;
  var target=hoveredBlock||selectedBlock;
  if(!target||target.style.display==='none'){insBtnEl.style.display='none';return;}
  var r=target.getBoundingClientRect();
  // Anchor to the top edge of the block, horizontally centred
  insBtnEl.style.top=Math.max(4,r.top-14)+'px';
  insBtnEl.style.left=(r.left+r.width/2)+'px';
  insBtnEl.style.display='block';
}
function updateInsBtnPos(){posInsBtn();}
function renderInsBtns(){posInsBtn();}
function initBlockEditor(){
  blockToolbar=createToolbar();
  createInsBtn();
  refreshBlocks();applyStoredOps();
  // Retry a few times to catch late React renders
  setTimeout(function(){refreshBlocks();applyStoredOps();},600);
  setTimeout(function(){refreshBlocks();applyStoredOps();},1400);
  setTimeout(function(){refreshBlocks();applyStoredOps();},3000);
  // Hover highlight for blocks — blue dashed outline + show insert button
  document.addEventListener('mouseover',function(e){
    if(insBtnEl&&insBtnEl.contains(e.target))return;
    var overText=false;
    var hits=document.elementsFromPoint(e.clientX,e.clientY);
    for(var i=0;i<hits.length;i++){if(hits[i].getAttribute('data-cxa')==='true'){overText=true;break;}}
    var found=null;
    if(!overText){for(var i=0;i<allBlocks.length;i++){if(allBlocks[i].style.display!=='none'&&(allBlocks[i]===e.target||allBlocks[i].contains(e.target))){found=allBlocks[i];break;}}}
    if(hoveredBlock&&hoveredBlock!==found){hoveredBlock.removeAttribute('data-cxa-hover');}
    hoveredBlock=found;
    if(found&&found!==selectedBlock){found.setAttribute('data-cxa-hover','1');}
    posInsBtn();
  },false);
  document.addEventListener('mouseout',function(e){
    if(insBtnEl&&(insBtnEl===e.relatedTarget||insBtnEl.contains(e.relatedTarget)))return;
    if(!e.relatedTarget||e.relatedTarget===document.documentElement){
      if(hoveredBlock){hoveredBlock.removeAttribute('data-cxa-hover');hoveredBlock=null;}
      posInsBtn();
    }
  },false);
  // Block click — bubble phase (capture phase handles text clicks + stops propagation)
  document.addEventListener('click',function(e){
    if(textJustClicked){textJustClicked=false;return;}
    if(blockToolbar&&blockToolbar.contains(e.target))return;
    if(insBtnEl&&insBtnEl.contains(e.target))return;
    var clicked=null;
    for(var i=0;i<allBlocks.length;i++){if(allBlocks[i].style.display!=='none'&&(allBlocks[i]===e.target||allBlocks[i].contains(e.target))){clicked=allBlocks[i];break;}}
    if(clicked)selectBlock(clicked);else deselectBlock();
  },false);
  window.addEventListener('scroll',function(){if(selectedBlock)updateTbPos();posInsBtn();},true);
  window.addEventListener('resize',function(){if(selectedBlock)updateTbPos();posInsBtn();});
  // Re-detect blocks after React mutates DOM (subtree:true catches re-renders inside #root)
  var blkTimer;
  new MutationObserver(function(mutations){
    var hasStructural=mutations.some(function(m){return m.addedNodes.length>0||m.removedNodes.length>0;});
    if(!hasStructural)return;
    clearTimeout(blkTimer);blkTimer=setTimeout(function(){refreshBlocks();applyStoredOps();},700);
  }).observe(document.body,{childList:true,subtree:true});
  // Insert a new block from the block library panel
  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='certxa-insert-block')return;
    var html=e.data.html;if(!html)return;
    var tmp=document.createElement('div');tmp.innerHTML=html;
    var section=tmp.firstElementChild;if(!section)return;
    if(blockContainer){
      if(selectedBlock&&selectedBlock.parentNode===blockContainer){
        blockContainer.insertBefore(section,selectedBlock.nextElementSibling);
      }else{blockContainer.appendChild(section);}
    }else{document.body.appendChild(section);}
    refreshBlocks();
    setTimeout(function(){var cnt=scanAll();selectBlock(section);try{window.parent.postMessage({type:'certxa-editor-ready',count:cnt},'*');}catch(e){}},250);
    sendBlockOps();
  },false);
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE EDITOR
// ─────────────────────────────────────────────────────────────────────────────
function imgCategory(img){
  var r=img.getBoundingClientRect();
  var w=r.width||img.naturalWidth||0,h=r.height||img.naturalHeight||0;
  if(w<=2&&h<=2)return'bullet';
  if(w<=90||h<=90)return'bullet';
  var ratio=w/(h||1);
  if(ratio>2.0&&w>400)return'hero';
  var alt=(img.alt||'').toLowerCase();
  var cls=((img.closest&&img.closest('[class]'))||{className:''}).className.toLowerCase();
  var combined=alt+' '+cls;
  if(/nail|manicure|pedicure|gel|acrylic/.test(combined))return'nails';
  if(/barber|fade|buzz|shave|beard/.test(combined))return'barber';
  if(/hair|color|dye|style|cut|blow/.test(combined))return'hair';
  if(/interior|reception|chair|mirror/.test(combined))return'interior';
  if(/person|staff|team|portrait/.test(combined))return'team';
  if(ratio>1.5)return'interior';
  if(w<150)return'bullet';
  return'nails';
}
function clearImgHover(){
  if(hoveredImg){hoveredImg.style.outline='';hoveredImg.style.outlineOffset='';hoveredImg.style.cursor='';hoveredImg=null;}
}
function initImageEditor(){
  // Hover highlight on images in image mode
  document.addEventListener('mouseover',function(e){
    if(editorMode!=='image')return;
    var img=e.target.tagName==='IMG'?e.target:(e.target.closest?e.target.closest('img'):null);
    if(hoveredImg&&hoveredImg!==img)clearImgHover();
    hoveredImg=img;
    if(img&&!img.getAttribute('data-cxa-toolbar')){
      img.style.outline='2px dashed rgba(27,110,240,.8)';
      img.style.outlineOffset='3px';
      img.style.cursor='pointer';
    }
  },false);
  // Click to select image — capture phase so we intercept before template handlers
  document.addEventListener('click',function(e){
    if(editorMode!=='image')return;
    var img=e.target.tagName==='IMG'?e.target:(e.target.closest?e.target.closest('img'):null);
    if(!img||img.getAttribute('data-cxa-toolbar'))return;
    e.preventDefault();e.stopPropagation();
    // Solid outline on selected image
    document.querySelectorAll('img[data-cxa-img-sel]').forEach(function(el){el.removeAttribute('data-cxa-img-sel');el.style.outline='2px dashed rgba(27,110,240,.8)';el.style.outlineOffset='3px';});
    img.setAttribute('data-cxa-img-sel','1');
    img.style.outline='2px solid #1B6EF0';
    img.style.outlineOffset='3px';
    var r=img.getBoundingClientRect();
    try{window.parent.postMessage({
      type:'certxa-image-click',
      src:img.src,
      naturalWidth:img.naturalWidth,
      naturalHeight:img.naturalHeight,
      displayWidth:Math.round(r.width),
      displayHeight:Math.round(r.height),
      alt:img.alt||'',
      category:imgCategory(img)
    },'*');}catch(ex){}
  },true);
  // Receive replacement image
  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='certxa-replace-image')return;
    var orig=e.data.originalSrc,newSrc=e.data.newSrc;
    document.querySelectorAll('img').forEach(function(img){
      if(img.src===orig||img.getAttribute('src')===orig){
        img.src=newSrc;
        img.removeAttribute('srcset');
        img.setAttribute('data-cxa-img-sel','1');
        img.style.outline='2px solid #1B6EF0';img.style.outlineOffset='3px';
      }
    });
    try{window.parent.postMessage({type:'certxa-image-replaced',originalSrc:orig,newSrc:newSrc},'*');}catch(ex){}
  },false);
  // Mode switch
  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='certxa-set-mode')return;
    editorMode=e.data.mode||'text';
    clearImgHover();
    document.querySelectorAll('img[data-cxa-img-sel]').forEach(function(el){el.removeAttribute('data-cxa-img-sel');el.style.outline='';el.style.outlineOffset='';el.style.cursor='';});
  },false);
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
function init(){
  if(inited)return;
  // Apply saved text values
  var map=buildMap(),w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null),n,pairs=[];
  while((n=w.nextNode())){var v=(n.nodeValue||'').trim();var f=map[v];if(f&&f.current&&f.current!==v)pairs.push([n,f.current]);}
  pairs.forEach(function(p){try{p[0].nodeValue=p[1];}catch(e){}});
  var cnt=scanAll();
  setupCaptureHandlers();
  inited=true;
  initBlockEditor();
  initImageEditor();
  try{window.parent.postMessage({type:'certxa-editor-ready',count:cnt},'*');}catch(e){}
  var obs=new MutationObserver(function(){clearTimeout(initTimer);initTimer=setTimeout(function(){inited=false;scanAll();},500);});
  obs.observe(document.body,{childList:true,subtree:true});
}

var style=document.createElement('style');
style.textContent=[
  '[data-cxa="true"]{transition:outline .12s,outline-offset .12s;cursor:pointer!important;}',
  '[data-cxa="true"][contenteditable="true"]{min-width:4px;min-height:1em;white-space:pre-wrap;cursor:text!important;}',
  '[data-cxa-block="1"]{outline:2px dashed rgba(27,110,240,0.38)!important;outline-offset:0!important;}',
  '[data-cxa-block="1"][data-cxa-hover="1"]{outline:2px dashed rgba(27,110,240,0.8)!important;}',
  '[data-cxa-sel="1"]{outline:2px solid #1B6EF0!important;outline-offset:0!important;}'
].join('');
document.head.appendChild(style);

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(init,800);});}
else{setTimeout(init,800);}
})();
</script>`;
}

// ── Block-ops application script (served on preview + published sites) ─────────
// Re-applies saved block order/deletions after React renders.

function buildBlockOpsScript(blockOps: BlockOps): string {
  if (blockOps.order.length === 0 && blockOps.deleted.length === 0) return "";
  const json = JSON.stringify(blockOps);
  return `<script>
(function(){
var OPS=${json};
function blkSig(el){
  var tag=el.tagName.toLowerCase();
  var cls=(el.className||'').trim().split(/\s+/)[0]||'';
  var txt=(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,40);
  var h=0;for(var i=0;i<txt.length;i++)h=((h*31)|0)+txt.charCodeAt(i);
  return tag+'_'+cls+'_'+(h>>>0).toString(36);
}
function findBlocks(){
  var BT={section:1,div:1,article:1,header:1,footer:1,main:1,aside:1,nav:1};
  function kids(el){var k=[];for(var i=0;i<el.children.length;i++){var c=el.children[i];if(BT[c.tagName.toLowerCase()]){var r=c.getBoundingClientRect();if(r.height>60&&r.width>100)k.push(c);}}return k;}
  var el=document.body,d=0;
  while(el&&d<7){var k=kids(el);if(k.length>=3)return{container:el,blocks:k};if(k.length===1){el=k[0];d++;}else break;}
  return null;
}
function applyOps(){
  var res=findBlocks();if(!res)return;
  var sigMap={};res.blocks.forEach(function(b){sigMap[blkSig(b)]=b;});
  (OPS.deleted||[]).forEach(function(s){if(sigMap[s])sigMap[s].style.display='none';});
  if(OPS.order&&OPS.order.length>0)OPS.order.forEach(function(s){if(sigMap[s]&&sigMap[s].style.display!=='none')res.container.appendChild(sigMap[s]);});
}
var obs=new MutationObserver(function(){
  var root=document.getElementById('root');
  if(root&&root.children.length>0){obs.disconnect();setTimeout(applyOps,400);}
});
obs.observe(document.body,{childList:true,subtree:true});
setTimeout(function(){obs.disconnect();applyOps();},8000);
})();
</script>`;
}

// ── Text replacement injection script (used for published/preview without editing) ──

function buildReplacementScript(fields: ContentField[]): string {
  const replacements: Record<string, string> = {};
  for (const f of fields) {
    if (f.current !== f.original) {
      replacements[f.original] = f.current;
    }
  }
  if (Object.keys(replacements).length === 0) return "";

  const json = JSON.stringify(replacements);
  return `<script>
(function(){
  var r=${json};
  function apply(root){
    var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null);
    var n,pairs=[];
    while((n=w.nextNode())){
      var v=(n.nodeValue||'').trim();
      if(Object.prototype.hasOwnProperty.call(r,v)) pairs.push([n,r[v]]);
    }
    pairs.forEach(function(p){try{p[0].nodeValue=p[1];}catch(e){}});
  }
  var t;
  var obs=new MutationObserver(function(){clearTimeout(t);t=setTimeout(function(){apply(document.body);},150);});
  function init(){obs.observe(document.body,{childList:true,subtree:true});apply(document.body);}
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(init,300);});}
  else{setTimeout(init,300);}
})();
</script>`;
}

// ── Image-ops application script (served on preview + published sites) ───────
// Replaces saved image src values after React renders.

function buildImageOpsScript(imageOps: Record<string, string>): string {
  if (Object.keys(imageOps).length === 0) return "";
  const json = JSON.stringify(imageOps);
  return `<script>
(function(){
var IOPS=${json};
function applyImageOps(){
  document.querySelectorAll('img').forEach(function(img){
    var orig=img.getAttribute('src');
    if(orig&&Object.prototype.hasOwnProperty.call(IOPS,img.src))img.src=IOPS[img.src];
    else if(orig&&Object.prototype.hasOwnProperty.call(IOPS,orig)){img.src=IOPS[orig];img.removeAttribute('srcset');}
  });
}
var obs=new MutationObserver(function(){
  var root=document.getElementById('root');
  if(root&&root.children.length>0){obs.disconnect();setTimeout(applyImageOps,400);}
});
obs.observe(document.body,{childList:true,subtree:true});
setTimeout(function(){obs.disconnect();applyImageOps();},8000);
})();
</script>`;
}

// ── Core file-serving logic (shared by template + website preview) ─────────────

export function serveDistFile(
  distDir: string,
  splat: string | undefined,
  basePath: string,
  replacementScript: string,
  res: Response,
  inlineScript?: string
): void {
  const urlPath = splat ? `/${decodeURIComponent(splat)}` : "/index.html";
  let filePath = path.join(distDir, urlPath);

  if (!filePath.startsWith(distDir)) {
    res.status(403).send("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    res.status(404).send("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".html" || ext === "") {
    const rawHtml = fs.readFileSync(filePath, "utf-8");

    // Rewrite absolute asset paths to go through our preview handler
    let html = rawHtml.replace(
      /(src|href)="(\/((?!\/)[^"]+))"/g,
      (_match, attr, absPath) => {
        if (absPath.startsWith(basePath) || absPath.startsWith("//")) {
          return `${attr}="${absPath}"`;
        }
        return `${attr}="${basePath}${absPath}"`;
      }
    );

    // Inject site data vars before </head>
    if (inlineScript) {
      html = html.replace("</head>", `${inlineScript}</head>`);
    }

    // Inject replacement script before </body>
    if (replacementScript) {
      html = html.replace("</body>", `${replacementScript}</body>`);
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(html);
  } else {
    res.setHeader("Content-Type", MIME_MAP[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.sendFile(filePath);
  }
}

// ── Core tenant serving logic (shared by slug + custom-domain handlers) ───────

async function serveTenantSite(
  website: { id: number; templateId: number | null; content: unknown; slug: string },
  splat: string | undefined,
  basePath: string,
  res: Response,
  showUpsell = false
): Promise<void> {
  if (!website.templateId) {
    res.status(422).send("<html><body><p>No template assigned to this website.</p></body></html>");
    return;
  }

  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, website.templateId));
  if (!template || !template.filesPath || !fs.existsSync(template.filesPath)) {
    res.status(422).send("<html><body><p>Template files not found.</p></body></html>");
    return;
  }

  const projectDir = findProjectDir(template.filesPath);
  const distDir = findDistDir(projectDir);
  if (!distDir) {
    res.status(422).send("<html><body><p>Template not yet built — please check back shortly.</p></body></html>");
    return;
  }

  const content = website.content as { fields?: ContentField[]; blockOps?: BlockOps; imageOps?: Record<string, string> } | null;
  const fields: ContentField[] = content?.fields ?? [];
  const blockOps: BlockOps = content?.blockOps ?? { order: [], deleted: [] };
  const imageOps: Record<string, string> = content?.imageOps ?? {};
  const upsellBanner = showUpsell ? buildDomainUpsellBanner(website.slug, website.id) : "";
  const replacementScript = buildReplacementScript(fields) + buildBlockOpsScript(blockOps) + buildImageOpsScript(imageOps) + upsellBanner;

  const slugScript = `<script>window.__CERTXA_SLUG__=${JSON.stringify(website.slug)};window.__CERTXA_API_BASE__='';</script>`;
  serveDistFile(distDir, splat, basePath, replacementScript, res, slugScript);
}

// ── Domain upsell banner (shown only on subdomain sites) ──────────────────────

function buildDomainUpsellBanner(slug: string, websiteId: number): string {
  const editUrl = `https://builder.mysalon.me/websites/${websiteId}/edit`;
  return `
<div id="certxa-domain-banner" style="position:fixed;bottom:0;left:0;right:0;z-index:2147483640;background:#0c1f3e;color:#fff;padding:13px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;font-family:system-ui,sans-serif;box-shadow:0 -4px 24px rgba(0,0,0,.35);border-top:2px solid #1B6EF0;">
  <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;">
    <div style="background:rgba(27,110,240,.18);border:1px solid rgba(27,110,240,.35);border-radius:8px;padding:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B6EF0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
    </div>
    <div style="min-width:0;">
      <p style="margin:0;font-size:14px;font-weight:700;line-height:1.3;">Own your domain for just <span style="color:#C97B2B;">$15/year</span></p>
      <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,.55);line-height:1.4;">You&rsquo;re on <strong style="color:rgba(255,255,255,.75);">${slug}.mysalon.me</strong> &mdash; upgrade to your own custom address like <em>yourname.com</em></p>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
    <a href="${editUrl}" style="background:#1B6EF0;color:#fff;font-weight:700;padding:9px 20px;border-radius:8px;text-decoration:none;font-size:13px;white-space:nowrap;letter-spacing:.02em;">Connect Domain &rarr;</a>
    <button id="certxa-domain-banner-close" style="background:transparent;border:none;color:rgba(255,255,255,.4);cursor:pointer;padding:6px;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:color .12s;" onmouseenter="this.style.color='rgba(255,255,255,.9)'" onmouseleave="this.style.color='rgba(255,255,255,.4)'" aria-label="Dismiss">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
</div>
<script>
(function(){
  var KEY='certxa_domain_upsell_v1';
  var banner=document.getElementById('certxa-domain-banner');
  if(!banner)return;
  try{
    var ts=localStorage.getItem(KEY);
    if(ts&&(Date.now()-parseInt(ts,10))<7*24*60*60*1000){banner.style.display='none';return;}
  }catch(e){}
  var btn=document.getElementById('certxa-domain-banner-close');
  if(btn){btn.addEventListener('click',function(){
    banner.style.display='none';
    try{localStorage.setItem(KEY,String(Date.now()));}catch(e){}
  });}
})();
</script>`;
}

// ── Tenant site by slug (called from /api/tenant/:slug/site routes) ───────────

export async function handleTenantSiteBySlug(req: Request, res: Response): Promise<void> {
  const slug = (req.params as Record<string, string>).slug;
  if (!slug) { res.status(400).send("Missing slug"); return; }

  const [website] = await db
    .select()
    .from(websitesTable)
    .where(and(eq(websitesTable.slug, slug), eq(websitesTable.published, true)));

  if (!website) {
    res.status(404).send(notFoundHtml(slug));
    return;
  }

  // Derive sub-path from req.path — more reliable than Express 5 wildcard params
  const sitePrefix = `/tenant/${slug}/site`;
  const splat = req.path.startsWith(sitePrefix + "/")
    ? req.path.slice(sitePrefix.length + 1)
    : undefined;
  const basePath = `/api/tenant/${slug}/site`;
  await serveTenantSite(website, splat, basePath, res, true);
}

// ── Tenant site by custom domain (reads Host header; called from Nginx) ───────

export async function handleTenantSiteByDomain(req: Request, res: Response): Promise<void> {
  // Nginx sets X-Forwarded-Host; fall back to Host header
  const host = (req.headers["x-forwarded-host"] as string | undefined)
    ?? req.get("host")
    ?? "";

  // Strip port if present
  const domain = host.split(":")[0].toLowerCase().trim();

  if (!domain) {
    res.status(400).send("Missing Host header");
    return;
  }

  const [website] = await db
    .select()
    .from(websitesTable)
    .where(eq(websitesTable.customDomain, domain));

  if (!website) {
    res.status(404).send(notFoundHtml(domain));
    return;
  }

  // Before payment is confirmed — serve the ownership-verification "coming soon" page
  if (website.customDomainStatus === "pending_payment") {
    const token = website.customDomainToken ?? "";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(domainValidationPageHtml(domain, token));
    return;
  }

  // Only serve the real site when the domain is active and the website is published
  if (website.customDomainStatus !== "active" || !website.published) {
    res.status(404).send(notFoundHtml(domain));
    return;
  }

  const sitePrefix = "";
  const splat = req.path.startsWith("//")
    ? req.path.slice(1)
    : req.path === "/" || req.path === ""
      ? undefined
      : req.path.slice(1);
  await serveTenantSite(website, splat, sitePrefix, res);
}

function domainValidationPageHtml(domain: string, token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="certxa-domain-verify" content="${token}">
  <title>${domain} — Coming Soon</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0F0A1A;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}
    .card{max-width:520px}
    .logo{font-size:1.15rem;font-weight:800;letter-spacing:-.02em;color:#fff;margin-bottom:2.5rem}
    .logo .dot{color:#C97B2B}
    h1{font-size:2.5rem;font-weight:700;margin-bottom:1rem;background:linear-gradient(135deg,#fff 40%,#C97B2B 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    p{color:#9ca3af;line-height:1.7;margin-bottom:.5rem}
    .domain{font-weight:600;color:#d1b3f5}
    .badge{display:inline-block;margin-top:2.5rem;padding:.5rem 1.75rem;background:#1A0333;border:1px solid #3B0764;border-radius:50px;font-size:.85rem;color:#9d7ec4}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Cert<span class="dot">X</span>A<span class="dot">.</span></div>
    <h1>Coming Soon</h1>
    <p><span class="domain">${domain}</span> is getting ready.</p>
    <p>This website is currently being set up. Please check back soon.</p>
    <div class="badge">Powered by CertXA</div>
  </div>
</body>
</html>`;
}

function notFoundHtml(identifier: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Website Not Found</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#0F0A1A;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}
    .card{max-width:480px}
    h1{font-size:2rem;font-weight:700;margin-bottom:1rem;color:#C97B2B}
    p{color:#9ca3af;line-height:1.6}
    .badge{display:inline-block;margin-top:1.5rem;padding:.5rem 1.5rem;background:#1A0333;border:1px solid #3B0764;border-radius:50px;font-size:.85rem;color:#d1b3f5}
  </style>
</head>
<body>
  <div class="card">
    <h1>404 — Not Found</h1>
    <p>The website <strong>${identifier}</strong> doesn't exist or hasn't been published yet.</p>
    <div class="badge">Powered by CertXA</div>
  </div>
</body>
</html>`;
}

// ── Template preview handler ──────────────────────────────────────────────────

export async function handleTemplatePreview(req: Request, res: Response): Promise<void> {
  const raw = req.params.id;
  const id = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  if (isNaN(id)) { res.status(400).send("Invalid template ID"); return; }

  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!template) { res.status(404).send("Template not found"); return; }
  if (!template.filesPath || !fs.existsSync(template.filesPath)) {
    res.status(422).send("Template files not found on disk"); return;
  }

  const projectDir = findProjectDir(template.filesPath);
  const distDir = findDistDir(projectDir);
  if (!distDir) {
    res.status(422).send("<html><body><p>Template is still being built. Please wait and refresh.</p></body></html>");
    return;
  }

  // Derive sub-path from req.path — more reliable than Express 5 wildcard params
  const previewPrefix = `/templates/${id}/preview`;
  const splat = req.path.startsWith(previewPrefix + "/")
    ? req.path.slice(previewPrefix.length + 1)
    : undefined;
  const basePath = `/api/templates/${id}/preview`;
  serveDistFile(distDir, splat, basePath, "", res);
}

// ── Website preview handler ───────────────────────────────────────────────────

export async function handleWebsitePreview(req: Request, res: Response): Promise<void> {
  const raw = req.params.id;
  const id = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  if (isNaN(id)) { res.status(400).send("Invalid website ID"); return; }

  const [website] = await db.select().from(websitesTable).where(eq(websitesTable.id, id));
  if (!website) { res.status(404).send("Website not found"); return; }
  if (!website.templateId) {
    res.status(422).send("<html><body><p>No template assigned to this website.</p></body></html>");
    return;
  }

  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, website.templateId));
  if (!template || !template.filesPath || !fs.existsSync(template.filesPath)) {
    res.status(422).send("<html><body><p>Template files not found.</p></body></html>");
    return;
  }

  const projectDir = findProjectDir(template.filesPath);
  const distDir = findDistDir(projectDir);
  if (!distDir) {
    res.status(422).send("<html><body><p>Template not yet built. Please wait.</p></body></html>");
    return;
  }

  const content = website.content as { fields?: ContentField[]; blockOps?: BlockOps; imageOps?: Record<string, string> } | null;
  const fields: ContentField[] = content?.fields ?? [];
  const blockOps: BlockOps = content?.blockOps ?? { order: [], deleted: [] };
  const imageOps: Record<string, string> = content?.imageOps ?? {};

  // ?editor=1 → inject the visual inline-editing script instead of simple replacement
  const editorMode = (req.query as Record<string, string>).editor === "1";
  const injectedScript = editorMode
    ? buildEditorScript(fields, blockOps) + buildImageOpsScript(imageOps)
    : buildReplacementScript(fields) + buildBlockOpsScript(blockOps) + buildImageOpsScript(imageOps);

  // Derive sub-path from req.path — more reliable than Express 5 wildcard params
  const previewPrefix = `/websites/${id}/preview`;
  const splat = req.path.startsWith(previewPrefix + "/")
    ? req.path.slice(previewPrefix.length + 1)
    : undefined;
  const basePath = `/api/websites/${id}/preview`;
  const slugScript = `<script>window.__CERTXA_SLUG__=${JSON.stringify(website.slug)};window.__CERTXA_API_BASE__='';</script>`;
  serveDistFile(distDir, splat, basePath, injectedScript, res, slugScript);
}
