import type { ImageInput } from './provider.js';

export const maxImageBytes = 6 * 1024 * 1024;

/** Read dimensions from bounded PNG/JPEG headers; never accept a client path or remote URL. */
export function parseScreenshot(value: string): ImageInput & { width: number; height: number } {
  const match = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw Error('请选择 PNG 或 JPEG 图片');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > maxImageBytes || bytes.toString('base64') !== match[2]) throw Error('图片无效或超过 6MB');
  let width = 0, height = 0;
  if (match[1] === 'image/png') {
    if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw Error('PNG 图片头无效');
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw Error('JPEG 图片头无效');
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  if (width < 1 || height < 1 || width > 8000 || height > 8000 || width * height > 20000000) throw Error('无法读取图片尺寸，或图片超过 8000px / 2000 万像素，请裁剪后重试');
  return { mediaType: match[1] as ImageInput['mediaType'], data: match[2], width, height };
}
