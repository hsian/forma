import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { makeElement, type PrototypeDocument } from '../shared/model';
import { designBounds, hitDesignElement, inspectDesign } from '../shared/design-inspection';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';
import { registerApi } from '../server/api';
import { registerAi } from '../server/ai/routes';
import { registerAuth } from '../server/auth';

const document = (): PrototypeDocument => ({width:800,height:600,background:'#ffffff',elements:[
  {...makeElement('rectangle'),id:'first',name:'按钮一',x:20,y:20,width:100,height:40,fill:'#1677ff',fontSize:16},
  {...makeElement('rectangle'),id:'second',name:'按钮二',x:144,y:20,width:100,height:40},
]});
test('design inspection measures original coordinates, transformed bounds, hidden layers and overlap independently of viewport zoom',()=>{
  const doc=document();
  const measurement=inspectDesign(doc,['first','second']);
  assert.equal(measurement.spacing?.horizontalGap,24);
  assert.equal(measurement.spacing?.verticalGap,0);
  assert.equal(measurement.spacing?.verticalOverlap,40);
  assert.equal(measurement.selected[0].fill,'#1677ff');
  assert.equal(hitDesignElement(doc,{x:30,y:30})?.id,'first');
  doc.elements[0].hidden=true;
  assert.equal(hitDesignElement(doc,{x:30,y:30}),undefined);
  const rotated={...makeElement('rectangle'),x:20,y:30,width:100,height:40,rotation:90};
  const bounds=designBounds(rotated);
  assert.ok(Math.abs(bounds.width-40)<1e-8);
  assert.ok(Math.abs(bounds.height-100)<1e-8);
  assert.equal(bounds.left,50);
  const scaled=designBounds({...rotated,rotation:0,importTransform:[2,0,0,1]});
  assert.equal(scaled.left,-30); assert.equal(scaled.right,170);
});

test('design AI answers use server-side measurements, keep history per board, allow viewers and preserve prototype/design documents',async()=>{
  const keys=['FORMA_AI_PROVIDER','FORMA_CODEX_CLI'] as const, previous=keys.map(key=>process.env[key]);
  process.env.FORMA_AI_PROVIDER='codex'; process.env.FORMA_CODEX_CLI=resolve('tests/fixtures/fake-model.mjs');
  const connection=openDatabase(':memory:'), repository=createRepository(connection.db);repository.initialize();
  const app=Fastify(); const auth=registerAuth(app,connection.db);registerApi(app,repository,auth);registerAi(app,connection.db,auth);
  try{
    const first=repository.attachDesignBoard('default-project','default-page','界面一',document()).board;
    const second=repository.attachDesignBoard('default-project','default-page','界面二',document()).board;
    const prototype=repository.readDocument('default-page');
    const endpoint=`/api/pages/default-page/design/${first.id}/ai`;
    assert.equal((await app.inject({method:'POST',url:`${endpoint}/turn`,payload:{prompt:'间距和颜色',selectedIds:['first','second']}})).statusCode,401);
    const setup=await app.inject({method:'POST',url:'/api/auth/setup',payload:{username:'admin',password:'password-123'}});
    const admin=String(setup.headers['set-cookie']).split(';')[0];
    const created=await app.inject({method:'POST',url:'/api/admin/users',headers:{cookie:admin},payload:{username:'viewer',password:'password-123'}});
    await app.inject({method:'PUT',url:`/api/projects/default-project/members/${created.json().user.id}`,headers:{cookie:admin},payload:{role:'viewer'}});
    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'viewer',password:'password-123'}});
    const cookie=String(login.headers['set-cookie']).split(';')[0];
    const answer=await app.inject({method:'POST',url:`${endpoint}/turn`,headers:{cookie},payload:{prompt:'间距和颜色',selectedIds:['first','second']}});
    assert.equal(answer.statusCode,200,answer.body);
    const events=answer.body.trim().split('\n').map(line=>JSON.parse(line));
    assert.match(events.find(event=>event.type==='result')?.message.content,/24px.*#1677ff.*16px/);
    assert.equal((await app.inject({method:'GET',url:`${endpoint}/messages`,headers:{cookie}})).json().messages.length,2);
    assert.equal((await app.inject({method:'GET',url:`/api/pages/default-page/design/${second.id}/ai/messages`,headers:{cookie}})).json().messages.length,0);
    assert.equal((await app.inject({method:'GET',url:'/api/pages/default-page/ai/messages',headers:{cookie}})).json().messages.length,0);
    assert.deepEqual(repository.readDocument('default-page'),prototype);
    assert.deepEqual(repository.readDesignBoard('default-page',first.id).document,document());
    assert.equal((await app.inject({method:'POST',url:`${endpoint}/turn`,headers:{cookie},payload:{prompt:'间距',selectedIds:[],baseDocument:document()}})).statusCode,400);
    const foreign=repository.createProject('其他项目');
    assert.equal((await app.inject({method:'GET',url:`/api/pages/${foreign.page.id}/design/${first.id}/ai/messages`,headers:{cookie:admin}})).statusCode,404);
    await app.inject({method:'PUT',url:`/api/projects/default-project/members/${created.json().user.id}`,headers:{cookie:admin},payload:{role:null}});
    assert.equal((await app.inject({method:'GET',url:`${endpoint}/messages`,headers:{cookie}})).statusCode,403);
  }finally{await app.close();connection.close();keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];});}
});
