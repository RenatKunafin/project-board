import http from 'node:http';
import { chromium, firefox, webkit } from '@playwright/test';
const root = 'http://127.0.0.1:4186';
const html = '<!doctype html><title>SW probe</title><h1>cached page</h1>';
const sw = `self.addEventListener('install',e=>e.waitUntil(caches.open('probe').then(c=>c.addAll(['/','/asset.txt']))));self.addEventListener('activate',e=>e.waitUntil(clients.claim()));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`;
const server = http.createServer((req,res) => {
 res.writeHead(200, {'content-type':req.url==='/sw.js'?'application/javascript':req.url==='/asset.txt'?'text/plain':'text/html','cache-control':'no-store'});
 res.end(req.url==='/sw.js'?sw:req.url==='/asset.txt'?'cached asset':html);
});
await new Promise(r=>server.listen(4186,'127.0.0.1',r));
try {
 for(const [name,type] of [['chromium',chromium],['firefox',firefox],['webkit',webkit]]) {
  const browser = await type.launch();
  for(const routing of [false,true]) {
   const context=await browser.newContext();
   const page=await context.newPage();
   await page.goto(root);
   const preparation=await page.evaluate(async()=>{
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller) await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));
    return {controller:!!navigator.serviceWorker.controller,caches:await caches.keys(),asset:await (await fetch('/asset.txt')).text()};
   });
   await page.close();
   if(routing) await context.route('**/*',route=>route.continue());
   await context.setOffline(true);
   const reopened=await context.newPage();
   let result;
   try {await reopened.goto(root,{timeout:5000});result={title:await reopened.title(),body:await reopened.textContent('h1')};}
   catch(e){result={error:e.message.split('\n')[0]};}
   process.stdout.write(JSON.stringify({name,routing,preparation,result})+'\n');
   await context.close();
  }
  await browser.close();
 }
} finally {server.close();}
