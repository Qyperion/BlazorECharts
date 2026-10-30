import * as bridge from '/_content/BlazorECharts/js/runtime-loader.js';
// The loader takes the options as UTF-8 bytes and the bindings separately, as the .NET transport sends them.
const setOption=(owner,id,prepared,update)=>bridge.setOption(owner,id,new TextEncoder().encode(JSON.stringify(prepared.json)),prepared.bindings,update);

const owner = 'wordcloud-lifecycle-fixture';
const ids = [], natives = [], events = [];
const gates = new Map();
const watched=[];
const pendingImmediate=new Set();
const pendingTimeout=new Set();
const setTimeout=window.setTimeout,clearTimeout=window.clearTimeout;
// The layout schedules its start and its iterations with its own named loop function.
window.setTimeout=(fn,delay,...args)=>{
  if(typeof fn!=='function'||fn.name!=='loop')return setTimeout(fn,delay,...args);
  const id=setTimeout(()=>{pendingTimeout.delete(id);fn(...args);},delay);pendingTimeout.add(id);return id;
};
const immediateIds=new Set(),clearedTimeouts=[],clearedImmediates=[],browserErrors=[];
// Only clears made by a layout cancellation are recorded, so unrelated page timers cannot match.
let cancelling=false;
window.clearTimeout=id=>{if(cancelling)clearedTimeouts.push(id);pendingTimeout.delete(id);clearTimeout(id);};
const setImmediate=window.setImmediate,clearImmediate=window.clearImmediate;
window.setImmediate=(fn,...args)=>{const id=setImmediate(()=>{pendingImmediate.delete(id);fn(...args);});pendingImmediate.add(id);immediateIds.add(id);return id;};
const recordBrowserError=event=>browserErrors.push(event.detail);
document.addEventListener('blazorecharts:error',recordBrowserError);
window.clearImmediate=id=>{if(cancelling)clearedImmediates.push(id);pendingImmediate.delete(id);clearImmediate(id);};
const createElement=document.createElement.bind(document);
document.createElement=(tag,options)=>{
  const el=createElement(tag,options);if(tag!=='canvas')return el;
  const add=el.addEventListener.bind(el),remove=el.removeEventListener.bind(el),listeners=new Map();
  let record;
  el.addEventListener=(type,fn,opts)=>{
    if(!type.startsWith('wordcloud'))return add(type,fn,opts);
    if(!record){record={canvas:el,listeners,draws:0};watched.push(record);add('wordclouddrawn',()=>record.draws++);}
    if(!listeners.has(type))listeners.set(type,new Map());
    const callbacks=listeners.get(type);
    const wrapper=opts?.once?function(event){callbacks.delete(fn);fn.call(this,event);}:fn;
    callbacks.set(fn,wrapper);add(type,wrapper,opts);
  };
  el.removeEventListener=(type,fn,opts)=>{const callbacks=listeners.get(type);const wrapper=callbacks?.get(fn)??fn;callbacks?.delete(fn);remove(type,wrapper,opts);};
  return el;
};
const originalLoad = document.fonts.load.bind(document.fonts);
document.fonts.load = (font, text) => {
  const gate = [...gates].find(([name]) => font.includes(name));
  return gate ? gate[1].promise.then(() => originalLoad('16px Arial', text)) : originalLoad(font, text);
};
export function hold(name) {
  let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; });
  // A rejected font request is observed by the adapter, including after cancellation.
  promise.catch(() => {}); gates.set(name, {promise,resolve,reject});
}
export function release(name, fail=false) { const gate=gates.get(name); fail?gate.reject(Error('font failed')):gate.resolve(); }
export async function setup() {
  await bridge.openFacade(bridge.runtimeProtocol, owner, {}, []);
  const e = bridge.getECharts();
  for (const renderer of ['canvas','svg','canvas','canvas']) {
    const el=document.createElement('div'); el.className='lifecycle-chart'; el.style.cssText='width:700px;height:400px';
    document.body.appendChild(el); const id=bridge.createChart(owner,el,null,{renderer}); ids.push(id);
    const native=e.getInstanceByDom(el); natives.push(native);
    native.on('finished',()=>events.push({kind:'finished',index:ids.indexOf(id),count:rendered(ids.indexOf(id)).length}));
  }
}
export function option(count, font='Arial', prefix='Слово') {
  return {animation:false,series:[{type:'wordCloud',width:'96%',height:'96%',sizeRange:[12,12],gridSize:4,
    rotationRange:[0,0],shape:'square',layoutAnimation:true,shrinkToFit:false,
    textStyle:{fontFamily:font,color:'#2468ac'},data:Array.from({length:count},(_,i)=>({name:`${prefix}${String(i).padStart(4,'0')}`,value:1,textStyle:{color:i===count-1?'#ff00ff':'#2468ac'}}))}]};
}
export function update(index,count,font='Arial',prefix='Слово',extra={}) {
  const value=option(count,font,prefix);Object.assign(value.series[0],extra);
  setOption(owner,ids[index],{json:value,bindings:[]},{notMerge:true});
  const layout=natives[index].getModel().getSeriesByType('wordCloud')[0].layoutInstance;
  EventTarget.prototype.addEventListener.call(layout.canvas,'wordcloudstop',()=>events.push({kind:'stop',index,count:rendered(index).length}),{once:true});
  return true;
}
export function rendered(index) {
  if(natives[index].isDisposed()) return [];
  const data=natives[index].getModel()?.getSeriesByType('wordCloud')[0]?.getData();
  return data?Array.from({length:data.count()},(_,i)=>data.getItemGraphicEl(i)?data.getName(i):null).filter(Boolean):[];
}
// The page clock marks the start and the end of a capture, so a deadline is measured where it runs.
export function capture(index,method='getDataURL',timeout=10000) {
  const startedAt=performance.now();
  globalThis.wcCapture={status:'pending',startedAt};
  const args=method==='awaitStable'?[]:[{type:'png',backgroundColor:'white',pixelRatio:1}];
  return bridge.exportChart(owner,ids[index],`wc:${Math.random()}`,method,{json:{args},bindings:[]},timeout)
    .then(value=>{globalThis.wcCapture={status:'done',value,startedAt,endedAt:performance.now()};return value;},
      e=>{globalThis.wcCapture={status:'error',error:String(e),startedAt,endedAt:performance.now()};});
}
// An ordered round trip: two frames and a task after them. Whatever an earlier event scheduled has run by then.
export function settle(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,0))));}
export function state(){return {events,rendered:ids.map((_,i)=>rendered(i)),capture:globalThis.wcCapture};}
export function connect(){bridge.connect(owner,[ids[0],ids[2],ids[3]]);}
export function standard(){setOption(owner,ids[3],{json:{animation:false,series:[{type:'pie',data:[{name:'Standard',value:1}]}]},bindings:[]},{notMerge:true});}
export function resize(index){bridge.invokeMethod(owner,ids[index],'resize',[]);}
export function nonLayout(index,action){if(action==='hideLoading')bridge.invokeMethod(owner,ids[index],'hideLoading',[]);else bridge.dispatchAction(owner,ids[index],{type:action,seriesIndex:0,dataIndex:0},null);}
export function itemFonts(family,rich=false){const value=option(2);value.series[0].data[1].textStyle=rich?{rich:{token:{fontFamily:family,fontStyle:'italic',fontWeight:'bold'}}}:{fontFamily:family,fontStyle:'italic',fontWeight:'bold'};if(rich)value.series[0].data[1].name='{token|Шрифт}';setOption(owner,ids[0],{json:value,bindings:[]},{notMerge:true});}
export function fontEdgeCase(kind){const value=option(2);if(kind==='size'){value.series[0].data[1].name='{token|Шрифт}';value.series[0].data[1].textStyle.rich={token:{fontSize:'12px'}};}else {value.series[0].data[1].name='{bad-name|Literal}';value.series[0].data[1].textStyle.rich={'bad-name':{fontFamily:'UnusedInvalidTokenFace'}};}setOption(owner,ids[0],{json:value,bindings:[]},{notMerge:true});}
export function recreate(index){bridge.recreateChart(owner,ids[index],{renderer:'svg'},null);natives[index]=bridge.getECharts().getInstanceByDom(document.querySelectorAll('.lifecycle-chart')[index]);}
export function cancel(index){cancelling=true;try{natives[index].getModel().getSeriesByType('wordCloud')[0].layoutInstance.dispose();}finally{cancelling=false;}}
export function oldCanvas(index){return natives[index].getModel().getSeriesByType('wordCloud')[0].layoutInstance.canvas;}
export function statistics(){return bridge.referenceStatistics();}
export function brokenShape(){const value=option(20);value.series[0].shape=null;return setOption(owner,ids[0],{json:value,bindings:[{kind:'module',path:['series',0,'shape'],token:'binding:0',signature:'test-shape',moduleUrl:import.meta.url,exportName:'throwingShape'}]},{notMerge:true});}
export function throwingShape(){throw Error('shape callback failed');}
export function image(url){const value=new Image();value.crossOrigin='anonymous';value.src=url;return value;}
export async function mask(url){
  const ref=await bridge.createNative(owner,'module',{moduleUrl:import.meta.url,exportName:'image'},{json:{args:[url]},bindings:[]});
  try{const value=option(20);value.series[0].maskImage=null;await setOption(owner,ids[0],{json:value,bindings:[{...ref.bindings[0],path:['series',0,'maskImage']}]},{notMerge:true});}
  finally{await bridge.releaseResult(owner,ref.leaseId);}
}
export function listeners(){return watched.reduce((n,r)=>n+[...r.listeners.values()].reduce((n,s)=>n+s.size,0),0);}
export function draws(){return watched.reduce((n,r)=>n+r.draws,0);}
// The first draw shows that a draw schedules the next iteration; the second cancels during its draw.
export function cancelDuringDraw(){
  let draws=0;const canvas=oldCanvas(0);
  const onDraw=()=>{
    if(++draws===1){queueMicrotask(()=>{globalThis.wcPendingWithoutCancel=pendingImmediate.size;});return;}
    EventTarget.prototype.removeEventListener.call(canvas,'wordclouddrawn',onDraw);
    cancel(0);queueMicrotask(()=>{globalThis.wcPendingAfterCancel=pendingImmediate.size;});
  };
  EventTarget.prototype.addEventListener.call(canvas,'wordclouddrawn',onDraw);
}
export function cancelOnStart(){EventTarget.prototype.addEventListener.call(oldCanvas(0),'wordcloudstart',()=>{queueMicrotask(()=>{globalThis.wcStartTimeouts=[...pendingTimeout];cancel(0);globalThis.wcPendingTimeoutAfterCancel=pendingTimeout.size;});},{once:true});}
export function dispose(index){bridge.disposeChart(owner,ids[index]);}
export function timerIds(){return {immediate:[...immediateIds],pendingImmediate:[...pendingImmediate],clearedTimeouts:[...clearedTimeouts],clearedImmediates:[...clearedImmediates]};}
export function browserErrorDetails(){return browserErrors.map(({code,operation})=>({code,operation}));}
export function throwingFormatter(){throw Error('formatter failed');}
// A series before the word cloud fails in render, after ECharts prepared the WordCloud view and started its layout.
export async function failedFirstRender(index){
  const value=option(20);value.series.unshift({type:'pie',radius:[0,10],label:{formatter:null},data:[{name:'Failing',value:1}]});
  try{await setOption(owner,ids[index],{json:value,bindings:[{kind:'module',path:['series',0,'label','formatter'],token:'binding:0',signature:'test-formatter',moduleUrl:import.meta.url,exportName:'throwingFormatter'}]},{notMerge:true});return null;}
  catch(error){return String(error);}
}
export async function attempt(action){try{await action();return null;}catch(error){return String(error);}}
export function replaceWithPie(index){return attempt(()=>setOption(owner,ids[index],{json:{animation:false,series:[{type:'pie',data:[{name:'Standard',value:1}]}]},bindings:[]},{notMerge:true}));}
export function disposeChecked(index){return attempt(()=>bridge.disposeChart(owner,ids[index]));}
export function registered(index){return !!bridge.getECharts().getInstanceById(natives[index].id);}
export function pendingTimers(){return pendingImmediate.size+pendingTimeout.size;}
export function brushed(index){
  const words=option(20).series[0];Object.assign(words,{left:'45%',width:'50%'});
  setOption(owner,ids[index],{json:{animation:false,brush:{xAxisIndex:0},grid:{left:10,width:'35%'},xAxis:{type:'value'},yAxis:{type:'value'},
    series:[{type:'scatter',data:[[1,1],[2,2]]},words]},bindings:[]},{notMerge:true});
}
export function brush(index){bridge.dispatchAction(owner,ids[index],{type:'brush',areas:[{brushType:'lineX',coordRange:[0,3],xAxisIndex:0}]},null);}
export function attached(index){
  const data=natives[index].getModel().getSeriesByType('wordCloud')[0].getData();
  return Array.from({length:data.count()},(_,i)=>data.getItemGraphicEl(i)?.parent).filter(Boolean).length;
}
let foreignChart;
export function foreign(updates){
  const el=document.createElement('div');el.className='lifecycle-chart';el.style.cssText='width:700px;height:400px';document.body.appendChild(el);
  foreignChart=bridge.getECharts().init(el);const errors=[];
  for(const [count,extra] of updates){
    const value=option(count);Object.assign(value.series[0],extra);
    try{foreignChart.setOption(value,{notMerge:true});}catch(error){errors.push(String(error));}
  }
  return errors;
}
export function foreignRendered(){
  const data=foreignChart.getModel().getSeriesByType('wordCloud')[0].getData();
  return Array.from({length:data.count()},(_,i)=>!!data.getItemGraphicEl(i)).filter(Boolean).length;
}
export async function cleanup(){document.removeEventListener('blazorecharts:error',recordBrowserError);foreignChart?.dispose();for(const gate of gates.values())gate.resolve();document.fonts.load=originalLoad;await bridge.releaseFacade(owner);document.createElement=createElement;window.setImmediate=setImmediate;window.clearImmediate=clearImmediate;window.setTimeout=setTimeout;window.clearTimeout=clearTimeout;document.querySelectorAll('.lifecycle-chart').forEach(e=>e.remove());return {listeners:listeners(),draws:draws(),timers:pendingImmediate.size+pendingTimeout.size,statistics:statistics()};}
