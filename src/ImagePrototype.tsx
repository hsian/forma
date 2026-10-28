import { randomId } from '../shared/uuid';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Select, Spin } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { PrototypeDocument } from '../shared/model';
import { ElementView } from './ElementView';
import './image-prototype.css';
import type { ImageAnalysis } from '../shared/image-analysis';

export function ImagePrototype({ projectId, busy, onCancel, onImport }: {
  projectId: string; busy: boolean; onCancel: () => void;
  onImport: (name: string, document: PrototypeDocument) => Promise<boolean>;
}) {
  const [image, setImage] = useState('');
  const [name, setName] = useState('图片原型');
  const [prompt, setPrompt] = useState('');
  const [reading, setReading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ document: PrototypeDocument; summary: string }>();
  const [analysis, setAnalysis] = useState<ImageAnalysis>();
  const [analysisToken, setAnalysisToken] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  function resetAnalysis() { setAnalysis(undefined); setAnalysisToken(''); setAnswers({}); setResult(undefined); }
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const jobId = useRef('');
  const readVersion = useRef(0);
  useEffect(() => () => { pending.current?.abort(); readVersion.current++; }, []);
  async function select(file: File) {
    const version = ++readVersion.current;
    resetAnalysis();
    setResult(undefined); setImage(''); setError(''); setReading(true);
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type)) throw Error('请选择 PNG 或 JPEG 图片');
      if (file.size > 6 * 1024 * 1024) throw Error('图片不能超过 6MB，请压缩或裁剪后重试');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error('图片读取失败')); reader.readAsDataURL(file);
      });
      const bitmap = new Image(); bitmap.src = data; await bitmap.decode();
      if (bitmap.width > 8000 || bitmap.height > 8000 || bitmap.width * bitmap.height > 20000000) throw Error('图片不能超过 8000px / 2000 万像素，请裁剪后重试');
      if (version !== readVersion.current) return;
      setImage(data); setName(file.name.replace(/\.[^.]+$/, '').slice(0, 110) || '图片原型');
    } catch (error) { if (version === readVersion.current) setError(error instanceof DOMException ? '图片无法解码，请选择有效的 PNG 或 JPEG 图片' : error instanceof Error ? error.message : '无法读取图片'); }
    finally { if (version === readVersion.current) setReading(false); }
  }
  async function generate() {
    if (!image || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    jobId.current = randomId();
    setGenerating(true); setResult(undefined); setError(''); setStatus('正在上传图片…');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/image-prototype/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, prompt, requestId: jobId.current, ...(analysisToken ? { analysisToken, answers } : {}) }), signal: controller.signal,
      });
      if (!response.ok) { const data = await response.json(); throw Error(data.message || '生成失败，请重试'); }
      if (!response.body) throw Error('无法读取生成结果');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', received = false;
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === 'error') throw Error(event.text);
        if (event.type === 'status') setStatus(event.text);
        if (event.type === 'analysis') setAnalysis(event.analysis);
        if (event.type === 'clarification') { received = true; setAnalysis(event.analysis); setAnalysisToken(event.analysisToken); setAnswers({}); }
        if (event.type === 'result') { received = true; setAnalysisToken(''); setResult({ document: event.document, summary: event.summary }); }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split('\n'); buffer = lines.pop() || ''; lines.forEach(consume);
          if (done) { consume(buffer); break; }
        }
      } finally { reader.releaseLock(); }
      if (!received) throw Error('连接已中断，未收到完整原型，请重试');
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '生成失败'); }
    finally { if (pending.current === controller) { pending.current = null; setGenerating(false); setStatus(''); } }
  }
  async function stop() {
    const controller = pending.current;
    if (!controller) return;
    setStatus('正在停止生成…');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/image-prototype/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: jobId.current }) });
      if (!response.ok) throw Error('停止请求失败，请关闭窗口后重试');
      controller.abort();
    } catch (error) { setError(error instanceof Error ? error.message : '停止失败'); }
  }
  const blocked = busy || generating || reading;
  const needsAnswers = !!analysisToken && !!analysis?.questions.some(q => !answers[q.id]?.trim());
  const doc = result?.document;
  const scale = doc ? Math.min(1, 430 / doc.width, 460 / doc.height) : 1;
  return <Modal open title="图片生成原型" width={1040} onCancel={() => { if (!busy) { pending.current?.abort(); onCancel(); } }} maskClosable={!blocked} keyboard={!busy} closable={!busy} footer={<>
    <Button disabled={busy} onClick={() => { pending.current?.abort(); onCancel(); }}>取消</Button>
    {analysisToken && <Button disabled={blocked} onClick={resetAnalysis}>重新分析图片</Button>}
    {generating ? <Button onClick={() => void stop()}>停止生成</Button> : <Button disabled={!image || blocked || needsAnswers} onClick={() => void generate()}>{analysisToken ? '补充后继续生成' : result ? '重新生成' : '生成可编辑原型'}</Button>}
    <Button type="primary" loading={busy} disabled={!result || blocked || !name.trim()} onClick={() => { if (result) void onImport(name, result.document); }}>保存为新页面</Button>
  </>}>
    <p>上传图片后先分析组件结构，有疑问时先提问，补充后再生成可编辑原型。没有疑问则直接生成，对照检查后保存。</p>
    <div className="image-prototype-fields">
      <Button icon={<UploadOutlined/>} disabled={blocked} onClick={() => input.current?.click()}>选择图片</Button>
      <input ref={input} hidden type="file" accept="image/png,image/jpeg" aria-label="原型图片" disabled={blocked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void select(file); }}/>
      <Input aria-label="图片原型页面名称" value={name} maxLength={120} disabled={busy || generating} onChange={event => setName(event.target.value)} placeholder="新页面名称"/>
    </div>
    <Input.TextArea aria-label="图片生成补充说明" value={prompt} maxLength={6000} disabled={blocked} onChange={event => { setPrompt(event.target.value); resetAnalysis(); }} rows={2} placeholder="可选：说明页面用途、需要保留的区域或组件，例如：这是用户管理页，表格需要可编辑。"/>
    {(reading || generating) && <p role="status"><Spin size="small"/> {reading ? '正在读取图片…' : status}</p>}
    {error && <Alert type="error" showIcon message={error} style={{ marginTop: 12 }}/ >}
    {analysis && <div style={{ marginTop: 12 }}>
      <Alert type={analysisToken ? 'warning' : 'info'} showIcon message={analysisToken ? '生成前需要补充的信息' : '图片分析'} description={analysis.summary}/>
      {!!analysisToken && analysis.questions.map((q, index) => <div key={q.id} style={{ marginTop: 12 }}>
        <label className="stacked-label">{index + 1}. {q.question}
          <Input.TextArea aria-label={`补充问题 ${index + 1}`} disabled={blocked} rows={2} maxLength={3000} value={answers[q.id] || ''} placeholder="请补充后继续生成" onChange={event => setAnswers(current => ({ ...current, [q.id]: event.target.value }))}/>
        </label>
        {!!q.options.length && <Select aria-label={`问题 ${index + 1} 建议选项`} disabled={blocked} style={{ width: '100%', marginTop: 6 }} placeholder="也可以选择建议答案，再补充说明" value={q.options.includes(answers[q.id]) ? answers[q.id] : undefined} options={q.options.map(value => ({ value, label: value }))} onChange={value => setAnswers(current => ({ ...current, [q.id]: value }))}/>}
      </div>)}
    </div>}
    <div className="image-prototype-comparison">
      <section><h4>原始图片</h4><div className="image-prototype-preview">{image ? <img src={image} alt="原始原型图片"/> : <span>PNG / JPEG，最大 6MB</span>}</div></section>
      <section><h4>生成结果{doc ? ` · ${doc.elements.length} 个可编辑元素` : ''}</h4><div className="image-prototype-preview" aria-label="图片生成结果">{doc ? <div style={{ width: doc.width * scale, height: doc.height * scale, position: 'relative' }}><div style={{ width: doc.width, height: doc.height, position: 'absolute', transform: `scale(${scale})`, transformOrigin: 'top left', background: doc.background, overflow: 'hidden', pointerEvents: 'none' }}>{doc.elements.filter(e => !e.hidden && !e.parentId).map(e => <div key={e.id} style={{ position: 'absolute', left: e.x, top: e.y, width: e.width, height: e.height, opacity: e.opacity, transform: `rotate(${e.rotation}deg)` }}><ElementView element={e}/></div>)}</div></div> : <span>生成后可与原图对照</span>}</div></section>
    </div>
    {result && <Alert type="info" showIcon message={result.summary} style={{ whiteSpace: 'pre-wrap' }}/ >}
    <p className="property-note">图片会发送给当前配置的 AI 引擎用于识别。本次原图仅供对照，不随新页面保存。请校对文字与布局；图片中不可见的交互需要补充配置。</p>
  </Modal>;
}
