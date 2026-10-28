import {ImportReport} from './ImportReport';
import type {SketchImportReport} from '../shared/drawing';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Select, Spin, Checkbox } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { PageInfo } from '../shared/projects';

export interface SketchBoard { pageId:string;pageName:string;boardId:string;name:string }
export function SketchImport({projectId,busy,onCancel,onImport,pages = [],initialPageId = ''}:{projectId:string;busy:boolean;onCancel:()=>void;pages?:PageInfo[];initialPageId?:string;onImport:(token:string,board:SketchBoard,acceptWarnings:boolean,targetPageId?:string)=>Promise<boolean>}) {
  const [targetPageId,setTargetPageId]=useState(initialPageId);
  const [filename,setFilename]=useState('');
  const [boards,setBoards]=useState<SketchBoard[]>([]);
  const [selected,setSelected]=useState<number>();
  const [uploading,setUploading]=useState(false);
  const [error,setError]=useState('');
  const [token,setToken]=useState('');
  const [report,setReport]=useState<SketchImportReport>();
  const [checking,setChecking]=useState(false);
  const [accepted,setAccepted]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const fileInput=useRef<HTMLInputElement>(null);
  const pending=useRef<AbortController|null>(null);
  const tokenRef=useRef('');
  const endpoint=`/api/projects/${encodeURIComponent(projectId)}/sketch`;
  const discard=(id:string)=>{if(id)void fetch(`${endpoint}/${encodeURIComponent(id)}`,{method:'DELETE',keepalive:true}).catch(()=>{});};
  useEffect(()=>()=>{pending.current?.abort();discard(tokenRef.current);},[projectId]);
  useEffect(()=>{
    setReport(undefined);setAccepted(false);
    if(!token || selected===undefined)return;
    const controller=new AbortController();setChecking(true);setError('');
    const board=boards[selected];
    void fetch(`${endpoint}/${encodeURIComponent(token)}/prepare`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:board.pageId,boardId:board.boardId}),signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.message||'预检查失败');if(!controller.signal.aborted)setReport(data.report);}).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setChecking(false);});
    return ()=>controller.abort();
  },[token,selected,attempt]);
  async function upload(file:File) {
    pending.current?.abort();discard(tokenRef.current);tokenRef.current='';setToken('');setBoards([]);setSelected(undefined);setError('');setFilename(file.name);
    if(!file.name.toLowerCase().endsWith('.sketch')){setUploading(false);setError('请选择 .sketch 原始设计文件');return;}
    if(file.size>64*1024*1024){setUploading(false);setError('文件不能超过 64MB，请先拆分设计文件');return;}
    const controller=new AbortController();pending.current=controller;setUploading(true);
    try {
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file,signal:controller.signal});
      const result=await response.json();
      if(!response.ok)throw Error(result.message || '文件上传失败，请重试');
      if(controller.signal.aborted){discard(result.token);return;}
      tokenRef.current=result.token;setToken(result.token);setBoards(result.boards);setSelected(0);
    } catch(error) {if(!controller.signal.aborted)setError(error instanceof Error?error.message:'文件上传失败');}
    finally {if(!controller.signal.aborted)setUploading(false);}
  }
  return <Modal open title="导入 Sketch" okText={targetPageId ? '关联到页面' : '导入并新建页面'} cancelText="取消" confirmLoading={busy} okButtonProps={{disabled:uploading || checking || !report || report.issues.some(i=>i.severity==='error') || !!report.issues.length&&!accepted || !token || selected===undefined}} closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={()=>{if(!busy)onCancel();}} onOk={()=>{if(token && selected!==undefined)void onImport(token,boards[selected],accepted,targetPageId || undefined);}}>
    <p>{targetPageId ? '选择 Sketch 画板，作为 UI 设计稿关联到页面，原型内容保持不变。' : '选择设计文件和画板，可以关联到已有页面，也可以生成新原型页面。'}</p>
    {!!pages.length && <label className="stacked-label">关联页面<Select aria-label="关联页面" value={targetPageId} disabled={busy || !!initialPageId} onChange={setTargetPageId} options={[{value:'',label:'新建原型页面'},...pages.map(p=>({value:p.id,label:p.name}))]}/></label>}
    <input ref={fileInput} type="file" accept=".sketch" aria-label="Sketch 文件" style={{display:'none'}} disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void upload(file);}}/>
    <div style={{marginTop:pages.length ? 16 : 0}}><Button icon={<UploadOutlined/>} disabled={busy} onClick={()=>fileInput.current?.click()}>选择 Sketch 文件</Button></div>
    {filename && <p style={{overflowWrap:'anywhere'}}>{filename}</p>}
    {uploading && <div style={{padding:'16px 0'}}><Spin size="small"/> 正在读取画板…</div>}
    {error && <Alert type="error" showIcon message={error} style={{marginTop:16}} action={token?<Button size="small" onClick={()=>setAttempt(n=>n+1)}>重试检查</Button>:undefined}/>}
    {!!boards.length && <label className="stacked-label" style={{marginTop:16}}>要导入的画板<Select aria-label="导入画板" showSearch optionFilterProp="label" disabled={busy || checking} value={selected} onChange={setSelected} options={boards.map((b,i)=>({value:i,label:`${b.pageName} / ${b.name}`}))}/></label>}
    {checking && <p><Spin size="small"/> 正在转换并检查画板…</p>}
    {report && <div style={{marginTop:16}}><ImportReport report={report}/>{!!report.issues.length && !report.issues.some(i=>i.severity==='error') && <Checkbox checked={accepted} onChange={e=>setAccepted(e.target.checked)} style={{marginTop:12}}>已了解报告中的差异，按当前效果导入</Checkbox>}</div>}
    <p style={{fontSize:12,color:'#858b9c',marginTop:16}}>画板会先完成转换检查，部分 Sketch 效果可能简化，请查看导入报告。关联后可在页面的「UI 设计稿」中查看；新建原型页面后可继续配置交互。</p>
  </Modal>;
}

