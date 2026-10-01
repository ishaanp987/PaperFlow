import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/server.ts";
import { samplePdf } from "../src/pdf.ts";
import { once } from "node:events";
import { demoStudy } from "../src/demo.ts";

test("HTTP flow uploads, saves edits, exports edited cards, redacts keys, and blocks cross-site requests",async()=>{
  const directory=await mkdtemp(join(tmpdir(),'paperflow-http-'));
  const app=await createApplication({directory,env:{}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const port=(app.server.address() as {port:number}).port;const origin=`http://127.0.0.1:${port}`;
  const post=(path:string,value:unknown)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
  try {
    const html=await fetch(origin);assert.equal(html.status,200);assert.match(await html.text(),/PaperFlow/);
    assert.match(html.headers.get('Content-Security-Policy')!,/frame-ancestors 'none'/);
    const blocked=await fetch(origin+'/api/settings',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,403);
    const noOrigin=await fetch(origin+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noOrigin.status,403);
    const saved=await post('/api/settings',{openaiKey:'sensitive-openai-key'});assert.equal((await saved.text()).includes('sensitive-openai-key'),false);
    const upload=await fetch(origin+'/api/lectures',{method:'POST',headers:{Origin:origin,'Content-Type':'application/pdf','X-Filename':'functions.pdf'},body:await samplePdf()});assert.equal(upload.status,201);const {lecture}=await upload.json();
    const record=app.store.requireLecture(lecture.id);record.study=structuredClone(demoStudy);record.status='ready';app.store.save(record);
    const edited=structuredClone(demoStudy);edited.flashcards[0].back='My edited answer';assert.equal((await post(`/api/lectures/${lecture.id}`,edited)).status,200);
    const csv=await fetch(origin+`/api/lectures/${lecture.id}/csv`);assert.match(await csv.text(),/My edited answer/);
    record.publishStarted=true;app.store.save(record);assert.equal((await post(`/api/lectures/${lecture.id}`,edited)).status,409);
    const pdf=await fetch(origin+`/api/lectures/${lecture.id}/pdf`);assert.equal(pdf.headers.get('Content-Type'),'application/pdf');
    assert.equal((await fetch(origin+'/../src/config.ts')).status,404);
    const demo=await post('/api/demo',{});assert.equal((await demo.json()).source,'demo');
  }finally{await new Promise<void>(resolve=>app.server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
