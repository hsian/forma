import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {openDatabase} from '../server/db';
import {createRepository} from '../server/db/repository';
import {registerApi} from '../server/api';
import {registerAuth} from '../server/auth';
// @ts-expect-error JavaScript ZIP fixture shared with browser tests.
import {sketchFixture} from './fixtures/sketch.mjs';

test('Sketch upload creates independent pages, disambiguates names, refuses cross-project tokens and rolls back invalid boards',async()=>{
  const connection=openDatabase(':memory:'),repository=createRepository(connection.db);repository.initialize();
  const app=Fastify();registerApi(app,repository);
  const root='/api/projects/default-project/sketch',payload=sketchFixture();
  const upload=()=>app.inject({method:'POST',url:root,headers:{'content-type':'application/octet-stream'},payload});
  try {
    const before=repository.readDocument('default-page');
    assert.equal((await app.inject({method:'POST',url:root,headers:{'content-type':'application/octet-stream'},payload:Buffer.from('not a zip')})).statusCode,400);
    const response=await upload();assert.equal(response.statusCode,200,response.body);const {token,boards}=response.json();assert.equal(boards.length,2);
    const wrong=await app.inject({method:'POST',url:`/api/projects/another/sketch/${token}/import`,payload:{pageId:'p',boardId:'board'}});assert.equal(wrong.statusCode,404);
    const invalid=await app.inject({method:'POST',url:`${root}/${token}/import`,payload:{pageId:'p',boardId:'empty'}});assert.equal(invalid.statusCode,422);assert.equal(repository.listPages('default-project').length,1);
    const created=await app.inject({method:'POST',url:`${root}/${token}/import`,payload:{pageId:'p',boardId:'board'}});assert.equal(created.statusCode,200,created.body);
    const page=created.json().page;assert.equal(page.name,'导入示例');assert.equal(repository.readDocument(page.id)?.document.elements[0].text,'导入的设计文字');
    assert.deepEqual(repository.readDocument('default-page'),before);
    assert.equal((await app.inject({method:'POST',url:`${root}/${token}/import`,payload:{pageId:'p',boardId:'board'}})).statusCode,404);
    const again=(await upload()).json();
    assert.equal((await app.inject({method:'POST',url:`${root}/${again.token}/import`,payload:{pageId:'p',boardId:'board'}})).json().page.name,'导入示例 (2)');
    const cancelled=(await upload()).json();await app.inject({method:'DELETE',url:`${root}/${cancelled.token}`});
    assert.equal((await app.inject({method:'POST',url:`${root}/${cancelled.token}/import`,payload:{pageId:'p',boardId:'board'}})).statusCode,404);
  }finally{await app.close();connection.close();}
});

test('Sketch upload requires login and viewer cannot upload or import',async()=>{
  const connection=openDatabase(':memory:'),repository=createRepository(connection.db);repository.initialize();const app=Fastify();const auth=registerAuth(app,connection.db);registerApi(app,repository,auth);
  const url='/api/projects/default-project/sketch',headers={'content-type':'application/octet-stream'},payload=sketchFixture();
  try {
    assert.equal((await app.inject({method:'POST',url,headers,payload})).statusCode,401);
    const setup=await app.inject({method:'POST',url:'/api/auth/setup',payload:{username:'admin',password:'password-123'}});
    const cookie=String(setup.headers['set-cookie']).split(';')[0];
    const user=await app.inject({method:'POST',url:'/api/admin/users',headers:{cookie},payload:{username:'viewer',password:'password-123'}});
    assert.equal(user.statusCode,200,user.body);
    const id=user.json().user.id;
    await app.inject({method:'PUT',url:`/api/projects/default-project/members/${id}`,headers:{cookie},payload:{role:'viewer'}});
    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'viewer',password:'password-123'}});
    const viewerCookie=String(login.headers['set-cookie']).split(';')[0];
    assert.equal((await app.inject({method:'POST',url,headers:{...headers,cookie:viewerCookie},payload})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:`${url}/fake/import`,headers:{cookie:viewerCookie},payload:{pageId:'p',boardId:'board'}})).statusCode,403);
    const uploaded=await app.inject({method:'POST',url,headers:{...headers,cookie},payload});
    assert.equal(uploaded.statusCode,200,uploaded.body);
    await app.inject({method:'PUT',url:`/api/projects/default-project/members/${id}`,headers:{cookie},payload:{role:'editor'}});
    assert.equal((await app.inject({method:'POST',url:`${url}/${uploaded.json().token}/import`,headers:{cookie:viewerCookie},payload:{pageId:'p',boardId:'board'}})).statusCode,404,'another editor cannot consume the owner upload');
  }finally{await app.close();connection.close();}
});

test('Preflight reports are required for lossy imports and blocking errors never create a page',async()=>{
  const connection=openDatabase(':memory:'),repository=createRepository(connection.db);repository.initialize();const app=Fastify();registerApi(app,repository);
  const root='/api/projects/default-project/sketch';
  async function upload(layers:unknown[]){return (await app.inject({method:'POST',url:root,headers:{'content-type':'application/octet-stream'},payload:sketchFixture(layers)})).json().token;}
  try{
    const token=await upload([{_class:'rectangle',do_objectID:'pattern',name:'图案按钮',frame:{x:0,y:0,width:100,height:40},style:{corners:{radii:[6]},fills:[{isEnabled:true,fillType:4}]}}]);
    const body={pageId:'p',boardId:'board'};
    const checked=await app.inject({method:'POST',url:`${root}/${token}/prepare`,payload:body});assert.equal(checked.statusCode,200,checked.body);assert.equal(checked.json().report.issues[0].layerName,'图案按钮');
    assert.equal((await app.inject({method:'POST',url:`${root}/${token}/import`,payload:body})).statusCode,409);assert.equal(repository.listPages('default-project').length,1);
    const accepted=await app.inject({method:'POST',url:`${root}/${token}/import`,payload:{...body,acceptWarnings:true}});assert.equal(accepted.statusCode,200,accepted.body);
    const saved=repository.readDocument(accepted.json().page.id)!.document;assert.equal(saved.importInfo!.acknowledgedDifferences,true);assert.match(saved.importInfo!.sourceHash!,/^[a-f0-9]{64}$/);assert.equal(saved.importInfo!.report.issues[0].code,'paint.unsupported');
    const missing=await upload([{_class:'symbolInstance',do_objectID:'missing',name:'缺失组件',symbolID:'absent',frame:{x:0,y:0,width:100,height:40}}]);
    assert.equal((await app.inject({method:'POST',url:`${root}/${missing}/import`,payload:{...body,acceptWarnings:true}})).statusCode,422);assert.equal(repository.listPages('default-project').length,2);
  }finally{await app.close();connection.close();}
});
