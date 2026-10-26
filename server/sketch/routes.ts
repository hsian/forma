import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { createRepository } from '../db/repository.js';
import { ManagementError } from '../db/repository.js';
import { documentSchema } from '../document-validation.js';
import { openSketch } from './archive.js';
import type { convertSketchBoard } from './convert.js';
import {runSketchConversion} from './job.js';

export function sketchBoards(archive: ReturnType<typeof openSketch>) {
  const meta = archive.json('meta.json');
  const input = z.record(z.string().max(200), z.object({ name:z.string().max(2000), artboards:z.record(z.string().max(200),z.object({ name:z.string().max(2000) })).optional() })).parse(meta.pagesAndArtboards);
  const boards = Object.entries(input).flatMap(([pageId,page]) => Object.entries(page.artboards || {}).map(([boardId,board]) => ({ pageId, pageName:page.name, boardId, name:board.name })));
  if (!boards.length) throw Error('文件中没有可导入的画板');
  if (boards.length > 5000) throw Error('画板数量超过 5000，请拆分设计文件后导入');
  return boards;
}

export function registerSketchApi(app: FastifyInstance, repository: ReturnType<typeof createRepository>, auth?: import('../auth.js').AuthService) {
  const uploads=new Map<string,{directory:string;file:string;projectId:string;userId:string;expires:number;boards:ReturnType<typeof sketchBoards>;preparing?:boolean;controller?:AbortController;prepared?:{pageId:string;boardId:string;path:string}} >();
  app.addContentTypeParser('application/octet-stream',{parseAs:'buffer'},(_request,body,done)=>done(null,body));
  async function discard(token:string) { const item=uploads.get(token);if(!item)return;item.controller?.abort();uploads.delete(token);await rm(item.directory,{recursive:true,force:true}); }
  const timer=setInterval(()=>{for(const [id,item] of uploads)if(item.expires<Date.now())void discard(id).catch(()=>{});},60000);timer.unref();
  app.addHook('onClose',async()=>{clearInterval(timer);await Promise.all([...uploads.keys()].map(discard));});
  const userId=(request:import('fastify').FastifyRequest)=>request.identity?.user.id || 'local';
  app.post<{Params:{projectId:string};Body:Buffer}>('/api/projects/:projectId/sketch', {bodyLimit:64*1024*1024},async(request,reply)=>{
    if(!Buffer.isBuffer(request.body))return reply.code(400).send({message:'请选择 .sketch 文件'});
    if(uploads.size>=8)return reply.code(429).send({message:'当前等待导入的文件较多，请稍后重试'});
    let directory:string|undefined;
    try {
      const boards=sketchBoards(openSketch(request.body));
      directory=await mkdtemp(join(tmpdir(),'forma-sketch-'));
      const file=join(directory,'design.sketch');await writeFile(file,request.body);
      const token=randomUUID();uploads.set(token,{directory,file,projectId:request.params.projectId,userId:userId(request),expires:Date.now()+15*60000,boards});
      return {token,boards};
    } catch {
      if(directory)await rm(directory,{recursive:true,force:true});
      return reply.code(400).send({message:'无法读取 Sketch 文件，请选择包含画板的有效 .sketch 原始文件'});
    }
  });
  async function prepare(item:NonNullable<ReturnType<typeof uploads.get>>,pageId:string,boardId:string){
    if(item.preparing)throw Error('该文件正在转换，请等待当前任务完成');
    if(item.prepared?.pageId===pageId && item.prepared.boardId===boardId)return JSON.parse(await readFile(item.prepared.path,'utf8')) as ReturnType<typeof convertSketchBoard>;
    item.preparing=true;item.controller=new AbortController();
    try{
      const output=join(item.directory,randomUUID()+'.json');
      await runSketchConversion({file:item.file,pageId,boardId,output},item.controller.signal);
      const result=JSON.parse(await readFile(output,'utf8')) as ReturnType<typeof convertSketchBoard>;
      if(item.prepared)await rm(item.prepared.path,{force:true});
      item.prepared={pageId,boardId,path:output};return result;
    }finally{item.preparing=false;item.controller=undefined;}
  }
  app.post<{Params:{projectId:string;token:string}}>('/api/projects/:projectId/sketch/:token/prepare',async(request,reply)=>{
    const item=uploads.get(request.params.token);
    if(!item || item.projectId!==request.params.projectId || item.userId!==userId(request))return reply.code(404).send({message:'导入文件不存在，请重新选择文件'});
    if(item.expires<Date.now())return reply.code(410).send({message:'导入文件已过期，请重新选择文件'});
    const input=z.object({pageId:z.string().max(200),boardId:z.string().max(200)}).strict().safeParse(request.body);
    if(!input.success || !item.boards.some(b=>b.pageId===input.data.pageId&&b.boardId===input.data.boardId))return reply.code(400).send({message:'请选择文件中的画板'});
    try{const result=await prepare(item,input.data.pageId,input.data.boardId);return {report:result.report};}
    catch(error){return reply.code(400).send({message:error instanceof Error?error.message:'转换失败'});}
  });
  app.post<{Params:{projectId:string;token:string}}>('/api/projects/:projectId/sketch/:token/import',async(request,reply)=>{
    const item=uploads.get(request.params.token);
    if(!item || item.projectId!==request.params.projectId || item.userId!==userId(request))return reply.code(404).send({message:'导入文件不存在，请重新选择文件'});
    if(item.expires<Date.now()){await discard(request.params.token);return reply.code(410).send({message:'导入文件已过期，请重新选择文件'});}
    const input=z.object({pageId:z.string().max(200),boardId:z.string().max(200),acceptWarnings:z.boolean().optional()}).strict().safeParse(request.body);
    const selected=input.success?item.boards.find(b=>b.pageId===input.data.pageId&&b.boardId===input.data.boardId):undefined;
    if(!selected)return reply.code(400).send({message:'请选择文件中的画板'});
    try {
      const result=await prepare(item,selected.pageId,selected.boardId);
      if(result.report.issues.some(i=>i.severity==='error'))return reply.code(422).send({message:'画板有无法转换的图层，请先处理导入报告中的错误',report:result.report});
      if(result.report.issues.length && input.success && !input.data.acceptWarnings)return reply.code(409).send({message:'请先查看并确认导入报告中的外观差异',report:result.report});
      Object.assign(result.document.importInfo!,{importedAt:Date.now(),importedBy:request.identity?.user.username||'本地用户',acknowledgedDifferences:input.success&&!!input.data.acceptWarnings});
      if (auth && !auth.can(request.identity!.user, request.params.projectId, 'sketch.import')) return reply.code(403).send({ message: '导入权限已变化，尚未创建页面' });
      const document=documentSchema.parse(result.document);
      if(!document.elements.length)throw Error('所选画板没有可转换的可见元素');
      if(Buffer.byteLength(JSON.stringify(document))>8*1024*1024)throw Error('转换后的单页超过 8MB，请减少画板中的图片或图层后重试');
      const page=repository.importPage(request.params.projectId,selected.name,document);
      // Remove the upload only after the atomic page+document insert succeeds.
      await discard(request.params.token).catch(()=>{});
      return {page,report:result.report};
    } catch(error) {
      if(error instanceof ManagementError)return reply.code(error.statusCode).send({message:error.message});
      return reply.code(400).send({message:error instanceof z.ZodError?'画板包含暂不支持的数据，尚未创建页面，请尝试其他画板':error instanceof Error?error.message:'画板转换失败，尚未创建页面'});
    }
  });
  app.delete<{Params:{projectId:string;token:string}}>('/api/projects/:projectId/sketch/:token',async(request,reply)=>{
    const item=uploads.get(request.params.token);
    if(item && (item.projectId!==request.params.projectId || item.userId!==userId(request)))return reply.code(404).send({message:'导入文件不存在'});
    await discard(request.params.token);return {ok:true};
  });
}
