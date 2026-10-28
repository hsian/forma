import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { Button, Image } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

export function useAiImage(disabled: boolean) {
  const [image, setImage] = useState<{ url: string; name: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function attach(files: File[]) {
    if (disabled || pending.current || !files.length) return;
    if (files.length !== 1) { setError('每条消息可附一张图片'); return; }
    const file = files[0];
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError('支持 PNG、JPEG 图片'); return; }
    if (!file.size || file.size > 6 * 1024 * 1024) { setError('图片不能超过 6MB'); return; }
    pending.current = true; setReading(true); setError('');
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(Error('图片读取失败')); reader.readAsDataURL(file);
      });
      const bitmap = document.createElement('img'); bitmap.src = url;
      await bitmap.decode();
      if (bitmap.naturalWidth > 8000 || bitmap.naturalHeight > 8000 || bitmap.naturalWidth * bitmap.naturalHeight > 20000000) throw Error('图片过大，请裁剪到 8000px / 2000 万像素以内');
      if (mounted.current) setImage({ url, name: file.name || '粘贴图片' });
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : '图片无法读取'); }
    finally { pending.current = false; if (mounted.current) setReading(false); }
  }
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault(); event.stopPropagation(); void attach(files);
  }
  const preview = <>{image && <div className="ai-image-attachment"><Image src={image.url} alt="AI 参考图片" width={52} height={52} preview={{ mask: false }}/><Button type="text" size="small" aria-label="移除 AI 参考图片" disabled={disabled} icon={<CloseOutlined/>} onClick={() => setImage(null)}/></div>}{error && <div className="ai-error" role="alert">{error}</div>}</>;
  return { image, reading, onPaste, preview, clear: () => { setImage(null); setError(''); } };
}
