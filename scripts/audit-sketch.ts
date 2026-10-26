import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {openSketch} from '../server/sketch/archive';
import {sketchBoards} from '../server/sketch/routes';
import {runSketchConversion} from '../server/sketch/job';
const file=process.argv[2];if(!file)throw Error('请指定 Sketch 文件，可用第三个参数按页面分类筛选（逗号分隔）');
const selected=new Set((process.argv[3]||'').split(',').filter(Boolean));
const boards=sketchBoards(openSketch(file)).filter(b=>!selected.size||selected.has(b.pageName));
const directory=resolve('test-results/sketch-audit');await mkdir(directory,{recursive:true});
const results=[];
async function check(board:typeof boards[number],index:number){
  const output=join(directory,createHash('sha256').update(board.pageId+'/'+board.boardId).digest('hex').slice(0,24)+'.json');
  try{
    await runSketchConversion({file:resolve(file),pageId:board.pageId,boardId:board.boardId,output});
    const result=JSON.parse(await readFile(output,'utf8'));
    const row={...board,elements:result.report.elements,errors:result.report.issues.filter((i:any)=>i.severity==='error').length,warnings:result.report.issues.filter((i:any)=>i.severity==='warning').length,report:result.report};
    results.push(row);console.log(`${index+1}/${boards.length} ${board.pageName}/${board.name}: ${row.elements} elements, ${row.errors} errors, ${row.warnings} warnings`);
  }catch(error){results.push({...board,failed:error instanceof Error?error.message:String(error)});console.log(`${index+1}/${boards.length} ${board.name}: FAILED`);}
}
for(let i=0;i<boards.length;i+=2){
 await Promise.all(boards.slice(i,i+2).map((board,n)=>check(board,i+n)));
 await writeFile(join(directory,'manifest.json'),JSON.stringify({file:resolve(file),results},null,2));
}
console.log(JSON.stringify({boards:results.length,converted:results.filter(r=>!('failed' in r)).length,blocked:results.filter(r=>'failed'in r || r.errors>0).length,directory}));
