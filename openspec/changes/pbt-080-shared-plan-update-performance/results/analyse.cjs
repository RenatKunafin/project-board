const fs=require('node:fs');
const path=require('node:path');
const {TraceMap,originalPositionFor}=require('@jridgewell/trace-mapping');
const root=path.join(process.cwd(),'.context/diagnostics/pbt-080/results/profile');
const buildFile=path.join(root,'build.json');
if(fs.existsSync(buildFile)){
 const build=JSON.parse(fs.readFileSync(buildFile));
 const bundle=path.join(process.cwd(),'apps/project-board/dist/assets',build.bundle);
 const hash=fs.existsSync(bundle)?require('node:crypto').createHash('sha256').update(fs.readFileSync(bundle)).digest('hex'):null;
 if(hash!==build.bundleSha256)throw new Error('Production bundle differs from recorded baseline; rebuild sourceCommit with sourcemaps before decoding.');
}
const profile=JSON.parse(fs.readFileSync(path.join(root,'add-task.cpuprofile')));
const maps=new Map();
const nodes=new Map(profile.nodes.map(n=>[n.id,n]));
const parents=new Map(); for(const n of profile.nodes)for(const id of n.children||[])parents.set(id,n.id);
const sources=new Map(), frames=new Map(), inclusive=new Map();
const metadata=JSON.parse(fs.readFileSync(path.join(root,'metadata.json')));
const trace=JSON.parse(fs.readFileSync(path.join(root,'add-task.trace.json'))).traceEvents;
const start=trace.find(event=>event.name==='PBT080-submit').ts;
const end=start+metadata.sample.ms*1000;
let at=profile.startTime;
function source(n){
 const f=n.callFrame;
 if(!f.url)return {source:f.functionName||'(native)',line:0,name:f.functionName};
 const file=path.join(process.cwd(),'apps/project-board/dist/assets',path.basename(f.url)+'.map');
 if(!fs.existsSync(file))return {source:f.url,line:f.lineNumber+1,name:f.functionName};
 let map=maps.get(file);if(!map){map=new TraceMap(JSON.parse(fs.readFileSync(file)));maps.set(file,map);}
 const pos=originalPositionFor(map,{line:f.lineNumber+1,column:f.columnNumber});
 return {source:pos.source||f.url,line:pos.line,name:pos.name||f.functionName};
}
const located=new Map(profile.nodes.map(n=>[n.id,source(n)]));
let total=0, idle=0;
for(let i=0;i<profile.samples.length;i++){
 const id=profile.samples[i], ms=profile.timeDeltas[i]/1000;at+=profile.timeDeltas[i];if(at<start||at>end)continue;total+=ms;
 const f=located.get(id);if(f.source==='(idle)')idle+=ms;
 sources.set(f.source,(sources.get(f.source)||0)+ms);
 const key=`${f.source}:${f.line} ${f.name}`;frames.set(key,(frames.get(key)||0)+ms);
 let cursor=id;const seen=new Set();while(cursor){const s=located.get(cursor).source;if(!seen.has(s)){inclusive.set(s,(inclusive.get(s)||0)+ms);seen.add(s);}cursor=parents.get(cursor);}
}
function top(map){return [...map].map(([name,ms])=>({name,ms:+ms.toFixed(2),percent:+(ms/total*100).toFixed(2)})).sort((a,b)=>b.ms-a.ms).slice(0,30);}
const durations={};for(const e of trace){if(e.ts>=start&&e.ts<end&&e.ph==='X'&&['Layout','UpdateLayoutTree','Paint','PrePaint','RecalculateStyles','MinorGC','MajorGC'].includes(e.name))durations[e.name]=(durations[e.name]||0)+e.dur/1000;}
const result={profileWallMs:(profile.endTime-profile.startTime)/1000,windowMs:metadata.sample.ms,window:'PBT080-submit mark through ready+two rAF; preparation and profiler stop excluded',sampledMs:total,idleMs:idle,self:top(sources),frames:top(frames),inclusive:top(inclusive),traceDurationsMs:durations};
fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
