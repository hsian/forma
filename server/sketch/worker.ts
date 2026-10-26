import {createHash} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
import {openSketch} from './archive.js';
import {convertSketchBoard} from './convert.js';
import {documentSchema} from '../document-validation.js';
const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
try {
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const bytes=readFileSync(input.file);
  const result=convertSketchBoard(openSketch(bytes),input.pageId,input.boardId);
  Object.assign(result.document.importInfo!,{sourceHash:createHash('sha256').update(bytes).digest('hex'),sourcePageId:input.pageId,sourceBoardId:input.boardId});
  const parsed=documentSchema.safeParse(result.document);
  if(!parsed.success)throw Error('画板数据超出支持范围：'+parsed.error.issues.slice(0,3).map(i=>i.path.join('.')+' '+i.message).join('；'));
  const output=JSON.stringify(result);
  if(Buffer.byteLength(JSON.stringify(result.document))>8*1024*1024)throw Error('转换后的单页超过 8MB，请减少图片或图层后重试');
  writeFileSync(input.output,output);
}catch(error){process.stderr.write(error instanceof Error?error.message:'Sketch 转换失败');process.exitCode=1;}
