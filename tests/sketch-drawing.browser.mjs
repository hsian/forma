import {authenticatedPage} from './browser-auth.mjs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {drawingSketchFixture} from './fixtures/sketch.mjs';
const require=createRequire(process.env.PLAYWRIGHT_MODULE_ROOT?resolve(process.env.PLAYWRIGHT_MODULE_ROOT,'package.json'):import.meta.url);
const {chromium}=require('playwright');
if(!process.env.TEST_URL)throw Error('必须使用隔离数据库');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const page=await authenticatedPage(browser,{viewport:{width:1400,height:1000}});
try{
 const root=`${process.env.TEST_URL}/api/projects/default-project/sketch`;
 const upload=await page.request.post(root,{headers:{'content-type':'application/octet-stream'},data:drawingSketchFixture()});assert.equal(upload.ok(),true,await upload.text());
 const token=(await upload.json()).token;
 const prepared=await page.request.post(`${root}/${token}/prepare`,{data:{pageId:'p',boardId:'board'}});assert.equal(prepared.ok(),true,await prepared.text());assert.deepEqual((await prepared.json()).report.issues,[]);
 const created=await page.request.post(`${root}/${token}/import`,{data:{pageId:'p',boardId:'board'}});assert.equal(created.ok(),true,await created.text());const id=(await created.json()).page.id;
 await page.goto(`${process.env.TEST_URL}/preview?projectId=default-project&pageId=${id}`);await page.locator('.preview-page').waitFor();
 const rendered=await page.locator('.preview-page').screenshot({path:'test-results/sketch-drawing-rendered.png',animations:'disabled'});
 const reference=await page.context().newPage();await reference.setViewportSize({width:1000,height:800});
 // Independently authored reference uses native SVG shapes and CSS shadows.
 await reference.setContent(`<style>body{margin:0}.canvas{position:relative;width:800px;height:600px;background:white}.shadow{position:absolute;left:220px;top:120px;width:160px;height:60px;background:white;border-radius:8px;box-shadow:4px 6px 8px 2px #0006}</style><div class="canvas"><div class="shadow"></div><svg width="800" height="600" style="position:absolute;inset:0"><defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><clipPath id="inside"><rect x="20" y="220" width="160" height="60" rx="8"/></clipPath><mask id="outside" maskUnits="userSpaceOnUse" x="200" y="200" width="200" height="100"><rect x="200" y="200" width="200" height="100" fill="white"/><rect x="220" y="220" width="160" height="60" rx="8" fill="black"/></mask></defs><circle cx="450" cy="50" r="30" fill="red"/><rect x="520" y="20" width="60" height="60" fill="blue"/><rect x="20" y="20" width="160" height="60" rx="8" fill="url(#g)"/><rect x="220" y="20" width="160" height="60" rx="8" fill="red"/><rect x="220" y="20" width="160" height="60" rx="8" fill="blue" opacity=".5"/><rect x="20" y="120" width="160" height="60" rx="8" fill="none" stroke="black" stroke-width="2" stroke-dasharray="6 4"/><rect x="20" y="220" width="160" height="60" rx="8" fill="white"/><rect x="20" y="220" width="160" height="60" rx="8" fill="none" stroke="#008000" stroke-width="8" clip-path="url(#inside)"/><rect x="220" y="220" width="160" height="60" rx="8" fill="white"/><rect x="220" y="220" width="160" height="60" rx="8" fill="none" stroke="#008000" stroke-width="8" mask="url(#outside)"/></svg></div>`);
 const expected=await reference.locator('.canvas').screenshot({path:'test-results/sketch-drawing-reference.png'});
 const comparison=await reference.evaluate(async([a,b])=>{
  const pixels=async base64=>{const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,img.width,img.height).data;};
  const [x,y]=await Promise.all([pixels(a),pixels(b)]);let total=0,bad=0;
  for(let i=0;i<x.length;i+=4){let diff=0;for(let j=0;j<3;j++){diff=Math.max(diff,Math.abs(x[i+j]-y[i+j]));total+=Math.abs(x[i+j]-y[i+j]);}if(diff>20)bad++;}
  return {mean:total/(x.length/4*3),badRatio:bad/(x.length/4)};
 },[rendered.toString('base64'),expected.toString('base64')]);
 assert.ok(comparison.mean<1.5,JSON.stringify(comparison));assert.ok(comparison.badRatio<0.015,JSON.stringify(comparison));
 const saved=(await (await page.request.get(`${process.env.TEST_URL}/api/pages/${id}/document`)).json());
 assert.equal(saved.document.importInfo.report.converterVersion,'2.0.0');
 saved.document.elements.find(e=>e.name==='gradient').fill='#00ff00';
 const changed=await page.request.put(`${process.env.TEST_URL}/api/pages/${id}/document`,{data:{revision:saved.revision,document:saved.document}});assert.equal(changed.ok(),true,await changed.text());
 await page.reload();await page.locator('.preview-page').waitFor();assert.equal(await page.locator('.preview-page [data-preview-id]').filter({has:page.locator('svg path[fill="#00ff00"]')}).count(),1);
 console.log('PASS: 渐变、多重填充、透明度、虚线、内外描边和阴影与独立参考图比较，保存重载后可继续编辑。',comparison);
}finally{await browser.close();}
