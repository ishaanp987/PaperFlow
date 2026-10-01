import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/storage.ts";
import { createPipeline } from "../src/pipeline.ts";
import { samplePdf } from "../src/pdf.ts";
import { demoStudy, demoTranscription } from "../src/demo.ts";
import { createNotion, studyBlocks } from "../src/providers.ts";
const settings = {openaiKey:'test-key',model:'gpt-4.1-mini',notionKey:'test-token',notionParentId:'parent'};
const reply = (value: unknown,status=200) => new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(),'paperflow-pipeline-')); const store = await createStore(dir);
  const lecture = (await store.create(await samplePdf(),'notes.pdf',1)).lecture;
  return {store,lecture,cleanup:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};
}

test("processing sends PDF pages, validates both stages, and persists usage", async () => {
  const f = await fixture(); let calls = 0;
  const stub = async (_url: any, init: any) => {
    const body = JSON.parse(init.body); assert.equal(body.store,false); assert.equal(body.text.format.strict,true);
    calls++; if(calls===1) assert.match(body.input[0].content[0].file_data,/^data:application\/pdf;base64,/);
    return reply({status:'completed',usage:{input_tokens:100,output_tokens:50},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(calls===1?demoTranscription:demoStudy)}]}]});
  };
  try {
    const pipeline = createPipeline(f.store,()=>settings,stub as typeof fetch); const result = await pipeline.processLecture(f.lecture.id);
    assert.equal(result.status,'ready'); assert.equal(calls,2); assert.deepEqual(result.usage,{input:200,output:100});
  } finally { await f.cleanup(); }
});
test("generation retry reuses transcription and does not send the PDF again", async () => {
  const f = await fixture(); let calls = 0;
  const stub = async (_url: any, init: any) => {
    calls++; const body = JSON.parse(init.body);
    if(calls===2) return reply({error:'quota exceeded secret prompt'},429);
    if(calls===3) assert.equal(body.input[0].content[0].type,'input_text');
    return reply({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(calls===1?demoTranscription:demoStudy)}]}]});
  };
  try {
    const pipeline = createPipeline(f.store,()=>settings,stub as typeof fetch);
    const failed = await pipeline.processLecture(f.lecture.id); assert.equal(failed.status,'processing_error'); assert.ok(failed.transcription); assert.equal(failed.error!.includes('secret prompt'),false);
    assert.equal((await pipeline.processLecture(f.lecture.id)).status,'ready'); assert.equal(calls,3);
  } finally { await f.cleanup(); }
});

function fakeNotion(options: {losePage?:boolean;loseAttachment?:boolean;failAttachment?:boolean} = {}) {
  const blocks = new Map<string,any[]>([['parent',[]],['course',[]]]); let pageCreates=0; let filePatches=0; let sends=0;
  let losePage = options.losePage; let loseAttachment = options.loseAttachment; let failAttachment = options.failAttachment;
  const stub = async (url: any,init: any={}) => {
    const path = new URL(url).pathname.replace('/v1/',''); const method = init.method || 'GET';
    if(method==='GET' && path.startsWith('blocks/')) return reply({results:blocks.get(path.split('/')[1])||[],has_more:false});
    if(method==='POST' && path==='pages') {
      const body=JSON.parse(init.body); const title=body.properties.title.title[0].text.content;
      if(body.parent.page_id==='parent') { blocks.get('parent')!.push({id:'course',type:'child_page',child_page:{title}}); return reply({id:'course',url:'https://notion.so/course'}); }
      pageCreates++; blocks.get('course')!.push({id:'lecture',type:'child_page',child_page:{title}}); blocks.set('lecture',body.children);
      if(losePage) {losePage=false;throw new Error('Connection lost after commit');}
      return reply({id:'lecture',url:'https://notion.so/lecture'});
    }
    if(method==='POST' && path==='file_uploads') return reply({id:'upload'});
    if(path==='file_uploads/upload/send') {sends++; if(failAttachment){failAttachment=false;return reply({},500);} assert.ok(init.body instanceof FormData); return reply({status:'uploaded'});}
    if(method==='PATCH' && path==='blocks/lecture/children') {
      filePatches++; blocks.get('lecture')!.push(...JSON.parse(init.body).children);
      if(loseAttachment){loseAttachment=false;throw new Error('Connection lost after attaching');}
      return reply({results:[]});
    }
    throw new Error(`Unexpected mocked route ${method} ${path}`);
  };
  return {stub:stub as typeof fetch,counts:()=>({pageCreates,filePatches,sends}),blocks};
}

for(const scenario of ['failAttachment','losePage','loseAttachment'] as const) {
  test(`Notion retry recovers ${scenario} without duplicate pages or attachments`,async()=>{
    const f=await fixture();const fake=fakeNotion({[scenario]:true});
    try {
      f.lecture.study=structuredClone(demoStudy);f.lecture.status='ready';f.store.save(f.lecture);
      const pipeline=createPipeline(f.store,()=>settings,fake.stub);
      assert.equal((await pipeline.publishLecture(f.lecture.id)).status,'partial');
      const result=await pipeline.publishLecture(f.lecture.id);assert.equal(result.status,'published');assert.equal(result.fileAttached,true);
      assert.equal(fake.counts().pageCreates,1);assert.equal(fake.counts().filePatches,1);
      await pipeline.publishLecture(f.lecture.id);assert.equal(fake.counts().pageCreates,1);
    }finally{await f.cleanup();}
  });
}
test("long guides use sections under the Notion 100-child limit", async()=>{
  const f=await fixture();const fake=fakeNotion();
  try {
    f.lecture.study=structuredClone(demoStudy);for(let i=0;i<60;i++) f.lecture.study.flashcards[i]={front:`Question ${i}`,back:'Answer',sourcePages:[1]};
    for(let i=0;i<25;i++){f.lecture.study.keyConcepts[i]={title:'Concept',explanation:'Explanation',sourcePages:[1]};f.lecture.study.definitions[i]={term:'Term',meaning:'Meaning',sourcePages:[1]};}
    f.store.save(f.lecture);const result=await createPipeline(f.store,()=>settings,fake.stub).publishLecture(f.lecture.id);assert.equal(result.status,'published');
    assert.ok(fake.blocks.get('lecture')!.length<100);
  }finally{await f.cleanup();}
});
test("demo guides cannot be published",async()=>{
  const f=await fixture();try{f.lecture.source='demo';f.lecture.study=structuredClone(demoStudy);f.store.save(f.lecture);await assert.rejects(createPipeline(f.store,()=>settings).publishLecture(f.lecture.id),/Demo guides/);}finally{await f.cleanup();}
});
