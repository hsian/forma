import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ManagementError } from './db/repository.js';

export type NativeDirectoryPicker = (initialDirectory: string, signal: AbortSignal) => Promise<string | null>;
export function nativeDirectoryCommand(validateOnly = false) {
  const script = readFileSync(fileURLToPath(new URL('../scripts/select-project-directory.ps1', import.meta.url)), 'utf8');
  return Buffer.from(validateOnly ? `& {\n${script}\n} -ValidateOnly` : script, 'utf16le').toString('base64');
}
let active = false;
export const pickNativeDirectory: NativeDirectoryPicker = async (initialDirectory, signal) => {
  if (process.platform !== 'win32') throw new ManagementError('系统目录选择器目前支持 Windows，请在 Windows 上运行 Forma', 400);
  if (active) throw new ManagementError('目录选择窗口已打开，请先完成或取消选择', 409);
  active = true;
  try {
    return await new Promise<string | null>((resolve, reject) => {
      execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', nativeDirectoryCommand()], {
        windowsHide: true, encoding: 'utf8', timeout: 300000, maxBuffer: 65536, signal,
        env: { ...process.env, FORMA_PICKER_INITIAL_DIRECTORY: initialDirectory },
      }, (error, stdout) => {
        if (error) { reject(new ManagementError('系统目录选择窗口未能完成，请重试；Forma 需要在已登录的 Windows 桌面中运行', 503)); return; }
        try {
          const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
          if (result.directory !== null && typeof result.directory !== 'string') throw Error('无效目录');
          resolve(result.directory);
        } catch { reject(new ManagementError('未能读取所选目录，请重试', 503)); }
      });
    });
  } finally { active = false; }
};
