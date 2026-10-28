import { useEffect, useRef, useState } from 'react';
import { Button, Input, Tooltip } from 'antd';
import { CloseOutlined, CommentOutlined, RobotOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import type { AiMessage } from '../shared/ai';
import type { PrototypeDocument } from '../shared/model';
import type { DesignAiEvent } from '../shared/design-inspection';
import './ai-panel.css';

export function DesignAiPanel({ pageId, designId, name, doc, selectedIds, visible, onClose }: {pageId:string;designId:string;name:string;doc:PrototypeDocument;selectedIds:string[];visible:boolean;onClose:()=>void}) {
  const endpoint=`/api/pages/${encodeURIComponent(pageId)}/design/${encodeURIComponent(designId)}/ai`;
  const draftKey=`forma:design-ai-draft:${designId}`;
  const [draft,setDraft]=useState(()=>{try{return localStorage.getItem(draftKey)||'';}catch{return '';}});
  const [messages,setMessages]=useState<AiMessage[]>([]);
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [live,setLive]=useState('');
  const [error,setError]=useState('');
  const controller=useRef<AbortController|null>(null), sending=useRef(false), mounted=useRef(false);
  const log=useRef<HTMLDivElement>(null), input=useRef<import('antd/es/input/TextArea').TextAreaRef>(null);
  const selected=doc.elements.filter(element=>selectedIds.includes(element.id));
  const scope=selected.length?`已选 ${selected.length} 个图层：${selected.map(element=>element.name).join('、')}`:`当前画板：${name}`;
  useEffect(()=>{try{localStorage.setItem(draftKey,draft);}catch{}},[draft,draftKey]);
  async function load(signal?:AbortSignal){
    const response=await fetch(`${endpoint}/messages`,{signal});const result=await response.json();
    if(!response.ok)throw Error(result.message||'无法读取设计稿对话');
    if(mounted.current&&!signal?.aborted)setMessages(result.messages);
  }
  useEffect(()=>{
    mounted.current=true;const abort=new AbortController();
    void load(abort.signal).catch(error=>{if(!abort.signal.aborted)setError(error.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>{mounted.current=false;abort.abort();controller.current?.abort();};
  },[endpoint]);
  useEffect(()=>{if(visible)input.current?.focus({preventScroll:true});},[visible]);
  useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight});},[messages,live,open,visible]);
  async function submit(){
    if(sending.current||loading||!draft.trim())return;
    const prompt=draft.trim(), selection=[...selectedIds], abort=new AbortController();
    controller.current=abort;sending.current=true;setBusy(true);setError('');setLive('正在读取图层属性…');setDraft('');
    setMessages(old=>[...old,{id:crypto.randomUUID(),role:'user',content:prompt,status:'done',provider:'',createdAt:Date.now()}]);
    let received=false;
    try{
      const response=await fetch(`${endpoint}/turn`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,selectedIds:selection}),signal:abort.signal});
      if(!response.ok){const result=await response.json();throw Error(result.message||'发送失败');}
      const reader=response.body?.getReader();if(!reader)throw Error('未收到有效响应');
      const decoder=new TextDecoder();let buffer='', streamed='';
      function event(line:string){
        if(!line.trim()||abort.signal.aborted||!mounted.current)return;
        const event:DesignAiEvent=JSON.parse(line);
        if(event.type==='status'&&!streamed)setLive(event.text);
        if(event.type==='text'){streamed+=event.text;setLive(streamed);}
        if(event.type==='error'){received=true;setError(event.text);setDraft(old=>old||prompt);}
        if(event.type==='result'){received=true;setMessages(old=>[...old,event.message]);setLive('');}
      }
      try{for(;;){const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:!chunk.done});const lines=buffer.split('\n');buffer=lines.pop()||'';lines.forEach(event);if(chunk.done)break;}if(buffer.trim())event(buffer);}finally{reader.releaseLock();}
      if(!received&&!abort.signal.aborted)throw Error('连接中断，请重新提问');
    }catch(error){if(mounted.current){setError(abort.signal.aborted?'已停止设计稿分析。':error instanceof Error?error.message:'分析失败');if(!received)setDraft(old=>old||prompt);}}
    finally{sending.current=false;if(mounted.current){setBusy(false);setLive('');void load().catch(()=>{});}}
  }
  const notice=error||live||messages.filter(message=>message.role==='assistant').at(-1)?.content;
  return <section id="design-ai-assistant-panel" className={`ai-panel design-ai-panel ${open?'history-open':''}`} aria-label="设计稿 AI 助手" hidden={!visible}>
    <div className="design-ai-scope"><strong><RobotOutlined/> AI 问设计</strong><span title={scope}>{scope}</span><Button type="text" size="small" aria-label="关闭设计稿 AI" icon={<CloseOutlined/>} onClick={onClose}/></div>
    <div className="ai-history" hidden={!open}><div className="ai-messages" ref={log} role="log" aria-label="设计稿 AI 对话记录" aria-live="polite">{!messages.length&&<div className="ai-welcome">点选图层，Shift 多选后可询问间距、颜色、字号和尺寸。</div>}{messages.map(message=><div className={`ai-message ${message.role}`} key={message.id}><div className="ai-message-heading">{message.role==='user'?'你':'AI 助手'}<span>{message.provider}</span></div><div className="ai-message-text">{message.content}</div></div>)}{live&&<div className="ai-live">{live}</div>}</div></div>
    <div className="ai-composer"><div className="ai-input-row"><Input.TextArea ref={input} aria-label="设计稿 AI 问题" placeholder="问问间距、颜色、字号、尺寸…" value={draft} maxLength={6000} autoSize={{minRows:1,maxRows:3}} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void submit();}}}/><Tooltip title="查看对话记录"><Button type="text" aria-label="展开设计稿 AI 对话" aria-expanded={open} icon={<CommentOutlined/>} onClick={()=>setOpen(value=>!value)}/></Tooltip>{busy?<Button aria-label="停止设计稿 AI" icon={<StopOutlined/>} onClick={()=>controller.current?.abort()}/>:<Button type="primary" aria-label="发送设计稿 AI 问题" disabled={loading||!draft.trim()} icon={<SendOutlined/>} onClick={()=>void submit()}/>}</div>
      {error?<div className="ai-error" role="alert">{error}</div>:notice&&!open?<div className="ai-inline-notice"><button title={notice} onClick={()=>setOpen(true)}><span>{notice}</span></button></div>:null}
    </div>
  </section>;
}
