import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
let active=0;
export async function runSketchConversion(input:{file:string;pageId:string;boardId:string;output:string},signal?:AbortSignal) {
  if(active>=2)throw Error('当前有其他导入任务正在处理，请稍后重试');
  active++;
  try {await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,['--max-old-space-size=2048','--import','tsx',fileURLToPath(new URL('./worker.ts',import.meta.url))],{stdio:['pipe','ignore','pipe'],windowsHide:true});
    let errors='',timedOut=false;
    const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timer=setTimeout(()=>{timedOut=true;child.kill();},90000);
    child.stderr.on('data',data=>{errors=(errors+data).slice(-2000);});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{signal?.removeEventListener('abort',abort);clearTimeout(timer);code===0?resolve():reject(Error(timedOut?'Sketch 转换超时，请拆分画板后重试':/heap out of memory|Allocation failed/i.test(errors)?'画板转换所需内存过大，请拆分画板后重试':errors||'Sketch 转换进程中断，尚未创建页面'));});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  });}finally{active--;}
}
