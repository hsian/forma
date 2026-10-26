import {authenticatedPage} from './browser-auth.mjs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(process.env.PLAYWRIGHT_MODULE_ROOT?resolve(process.env.PLAYWRIGHT_MODULE_ROOT,'package.json'):import.meta.url);
const {chromium}=require('playwright');
if(!process.env.TEST_URL)throw Error('必须使用隔离数据库');
const baseline=process.env.SKETCH_ACCURACY_BASELINE==='1';
const doc=JSON.parse(readFileSync(`test-results/sketch-accuracy/${baseline?'before':'after'}.json`,'utf8'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const page=await authenticatedPage(browser,{viewport:{width:2300,height:1500}});
try {
  const put=await page.request.put(`${process.env.TEST_URL}/api/pages/default-page/document`,{data:{revision:0,document:doc}});assert.equal(put.ok(),true,await put.text());
  await page.goto(`${process.env.TEST_URL}/preview?projectId=default-project&pageId=default-page`);await page.locator('.preview-page').waitFor();
  const metrics=await page.locator('.preview-page').evaluate(root=>[...root.querySelectorAll('[data-preview-id]')].filter(el=>el.textContent==='1,377.00').map(el=>{
    const range=document.createRange();range.selectNodeContents(el.querySelector('.text-content'));const box=el.getBoundingClientRect(),textBox=range.getBoundingClientRect(),style=getComputedStyle(el.querySelector('.text-content'));
    return {lines:range.getClientRects().length,rightOffset:box.right-textBox.right,topOffset:textBox.top-box.top,font:style.fontFamily,whiteSpace:style.whiteSpace};
  }));
  assert.ok(metrics.length>10);
  if(!baseline){
    const outline=doc.elements.find(e=>e.source?.layerId==='69F4C789-282F-45F7-BF74-83A2E8C2B094');
    assert.ok(outline);assert.match(await page.locator(`[data-preview-id="${outline.id}"] svg > path`).getAttribute('d'),/Q115 0 115 6/,'项目勾稽关系按钮保留 6px 圆角');
  }
  const vectors=await page.locator('.preview-page svg').evaluateAll(nodes=>nodes.map(svg=>({top:svg.getBoundingClientRect().top-svg.parentElement.getBoundingClientRect().top,left:svg.getBoundingClientRect().left-svg.parentElement.getBoundingClientRect().left})));
  writeFileSync(`test-results/sketch-accuracy/${baseline?'before':'after'}-metrics.json`,JSON.stringify(metrics,null,2));
  await page.locator('.preview-page').screenshot({path:`test-results/sketch-accuracy/${baseline?'before':'after'}.png`,animations:'disabled'});
  if(!baseline && process.env.SKETCH_REFERENCE_PREVIEW){
    const reference=readFileSync(process.env.SKETCH_REFERENCE_PREVIEW),width=reference.readUInt32BE(16),height=reference.readUInt32BE(20);
    await page.locator('.preview-page').evaluate((el,scale)=>{el.style.transform=`scale(${scale})`;el.style.transformOrigin='top left';},width/doc.width);
    const boxes=await page.locator('.preview-page').evaluate(root=>{const origin=root.getBoundingClientRect();return [...root.querySelectorAll('.imported-text')].map(text=>{const b=text.closest('[data-preview-id]').getBoundingClientRect();return {x:b.left-origin.left-4,y:b.top-origin.top-4,w:b.width+8,h:b.height+8};});});
    const screenshot=await page.locator('.preview-page').screenshot({path:'test-results/sketch-accuracy/reference-scale.png',animations:'disabled'});
    const comparison=await page.evaluate(async({a,b,width,height,boxes})=>{
      async function load(base64){const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,width,height);return ctx.getImageData(0,0,width,height).data;}
      const [x,y]=await Promise.all([load(a),load(b)]),skip=new Uint8Array(width*height);for(const box of boxes)for(let row=Math.max(0,Math.floor(box.y));row<Math.min(height,Math.ceil(box.y+box.h));row++)for(let col=Math.max(0,Math.floor(box.x));col<Math.min(width,Math.ceil(box.x+box.w));col++)skip[row*width+col]=1;
      let n=0,bad=0,total=0;for(let i=0;i<width*height;i++){if(skip[i])continue;n++;let max=0;for(let j=0;j<3;j++){const diff=Math.abs(x[i*4+j]-y[i*4+j]);max=Math.max(max,diff);total+=diff;}if(max>30)bad++;}return {nonTextMean:total/(n*3),nonTextBadRatio:bad/n,comparedPixels:n};
    },{a:screenshot.toString('base64'),b:reference.toString('base64'),width,height,boxes});
    writeFileSync('test-results/sketch-accuracy/source-comparison.json',JSON.stringify(comparison,null,2));
    assert.ok(comparison.nonTextBadRatio<0.01,JSON.stringify(comparison));
    console.log('Sketch 内嵌设计预览对比（排除缺失原字体造成的文字差异）',comparison);
  }
  if(!baseline){for(const metric of metrics){assert.equal(metric.lines,1,'金额必须保持一行');assert.ok(Math.abs(metric.rightOffset)<1,'金额必须与文本框右边缘对齐');}for(const vector of vectors){assert.ok(Math.abs(vector.top)<0.1,'SVG 不应受到行内文字基线影响');assert.ok(Math.abs(vector.left)<0.1);}}
  console.log(JSON.stringify({baseline,amounts:metrics.length,wrapped:metrics.filter(m=>m.lines>1).length,rightAligned:metrics.filter(m=>Math.abs(m.rightOffset)<1).length,misalignedVectors:vectors.filter(v=>Math.abs(v.top)>=0.1).length}));
}finally{await browser.close();}
