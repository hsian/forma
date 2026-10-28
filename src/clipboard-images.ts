import { makeElement, type PrototypeElement } from '../shared/model';

const maxImageBytes = 4 * 1024 * 1024;
export const maxImageDocumentBytes = 8 * 1024 * 1024;

export async function clipboardImages(files: File[], surface: { width: number; height: number }, center: { x: number; y: number }, parentId?: string): Promise<PrototypeElement[]> {
  if (files.length > 10) throw Error('一次最多粘贴 10 张图片');
  if (files.some(file => !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type))) throw Error('支持粘贴 PNG、JPEG、GIF 或 WebP 图片');
  if (files.some(file => file.size > maxImageBytes)) throw Error('单张图片不能超过 4MB，请压缩后再粘贴');
  if (files.reduce((size, file) => size + file.size, 0) * 4 / 3 > maxImageDocumentBytes) throw Error('本次图片过大，页面内容不能超过 8MB');
  const elements: PrototypeElement[] = [];
  for (const file of files) {
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error('无法读取剪贴板图片')); reader.readAsDataURL(file);
    });
    const image = new Image(); image.src = src;
    try { await image.decode(); } catch { throw Error('剪贴板图片无法解码，请重新复制图片'); }
    const { naturalWidth: width, naturalHeight: height } = image; image.src = '';
    if (!width || !height || width > 20000 || height > 20000 || width * height > 20000000) throw Error('图片尺寸过大，请缩小或裁剪后再粘贴');
    const scale = Math.min(1, surface.width * .8 / width, surface.height * .8 / height);
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const offset = elements.length * 24;
    const element = makeElement('image', Math.round(Math.max(0, Math.min(surface.width - w, center.x - w / 2 + offset))), Math.round(Math.max(0, Math.min(surface.height - h, center.y - h / 2 + offset))));
    elements.push({ ...element, width: w, height: h, parentId, name: file.name && file.name !== 'image.png' ? file.name.slice(0, 120) : '粘贴图片', text: '粘贴图片', component: { ...element.component, src } });
  }
  return elements;
}
