import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const crcTable=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?(n>>>1)^0xedb88320:n>>>1;return n>>>0;});
function crc32(bytes:Buffer){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
// Read entries in memory; never extract untrusted archive paths to disk.
export function openSketch(path: string | Buffer) {
  const bytes = typeof path === 'string' ? readFileSync(path) : path;
  if(bytes.length<22 || bytes.length>64*1024*1024)throw Error('Sketch 文件大小不合法（最大 64MB）');
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw Error('不是有效的 Sketch ZIP 文件');
  if(end+22+bytes.readUInt16LE(end+20)!==bytes.length || bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0)throw Error('Sketch ZIP 结束记录无效');
  const count=bytes.readUInt16LE(end+10),centralEnd=bytes.readUInt32LE(end+16)+bytes.readUInt32LE(end+12);
  if(count>20000 || centralEnd>end || bytes.readUInt16LE(end+8)!==count)throw Error('Sketch ZIP 目录或文件数量无效');
  const entries = new Map<string, { offset: number; size: number; length: number; method: number;crc:number }>();let total=0;
  let cursor = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    if(cursor+46>centralEnd)throw Error('Sketch ZIP 目录不完整');
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw Error('Sketch ZIP 目录损坏');
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if(entries.has(name) || (bytes.readUInt16LE(cursor+8)&1))throw Error('Sketch ZIP 包含重复或加密条目');
    entries.set(name, {crc:bytes.readUInt32LE(cursor+16), offset: bytes.readUInt32LE(cursor + 42), size: bytes.readUInt32LE(cursor + 20), length: bytes.readUInt32LE(cursor + 24), method: bytes.readUInt16LE(cursor + 10) });
    total+=bytes.readUInt32LE(cursor+24);if(total>1024*1024*1024)throw Error('Sketch 解压后超过 1GB');
    cursor += 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    if(cursor>centralEnd)throw Error('Sketch ZIP 目录长度无效');
  }
  function read(name: string) {
    const entry = entries.get(name);
    if (!entry) throw Error(`Sketch 文件中不存在 ${name}`);
    if (entry.length > 256 * 1024 * 1024) throw Error('单个 Sketch 数据文件超过 256MB');
    if(entry.offset+30>bytes.readUInt32LE(end+16))throw Error('Sketch ZIP 数据偏移无效');
    if (bytes.readUInt32LE(entry.offset) !== 0x04034b50) throw Error('Sketch ZIP 文件头损坏');
    const start = entry.offset + 30 + bytes.readUInt16LE(entry.offset + 26) + bytes.readUInt16LE(entry.offset + 28);
    if(start+entry.size>bytes.readUInt32LE(end+16))throw Error('Sketch ZIP 数据越界');
    const data = bytes.subarray(start, start + entry.size);
    if (data.length !== entry.size) throw Error('Sketch ZIP 数据不完整');
    const result = entry.method === 8 ? inflateRawSync(data, { maxOutputLength: 256 * 1024 * 1024 }) : entry.method === 0 ? data : undefined;
    if (!result || result.length !== entry.length) throw Error('Sketch ZIP 压缩方式或长度不正确');
    if(crc32(result)!==entry.crc)throw Error('Sketch ZIP 内容校验失败，文件可能已损坏');
    return result;
  }
  return { names: [...entries.keys()], read, json: (name: string) => { if(name==='meta.json' && (entries.get(name)?.length||0)>8*1024*1024)throw Error('Sketch 元信息过大');return JSON.parse(read(name).toString('utf8')); } };
}
