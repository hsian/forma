import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sketchDrawing} from '../server/sketch/paints';
import {convertSketchBoard} from '../server/sketch/convert';
import {openSketch} from '../server/sketch/archive';
import {documentSchema} from '../server/document-validation';
// @ts-expect-error shared JS ZIP fixture
import {sketchFixture} from './fixtures/sketch.mjs';
const frame={x:0,y:0,width:120,height:40};
const red={red:1,green:0,blue:0,alpha:0.5};
test('Drawing styles preserve gradient stops, multiple paints, opacity, stroke alignment, dashes and shadows',()=>{
  const issues:string[]=[];
  const style=sketchDrawing({fills:[{isEnabled:true,fillType:0,color:red},{isEnabled:true,fillType:1,contextSettings:{opacity:0.8},gradient:{gradientType:0,from:'{0, 0}',to:'{1, 1}',stops:[{position:0,color:red},{position:1,color:{red:0,green:0,blue:1,alpha:1}}]}}],borders:[{isEnabled:true,fillType:0,color:red,thickness:2,position:1}],borderOptions:{isEnabled:true,dashPattern:[4,2],lineCapStyle:1,lineJoinStyle:2},shadows:[{isEnabled:true,offsetX:3,offsetY:4,blurRadius:8,spread:2,color:red}]},(code)=>issues.push(code));
  assert.equal(style.fills.length,2);assert.equal(style.fills[0].opacity,0.5);assert.equal(style.fills[1].kind,'linear');assert.equal(style.fills[1].opacity,0.8);
  assert.equal(style.strokes[0].position,'inside');assert.deepEqual(style.strokes[0].dash,[4,2]);assert.equal(style.strokes[0].cap,'round');assert.equal(style.shadows[0].blur,8);assert.deepEqual(issues,[]);
});

test('Single solid paint context opacity is not discarded by the simple-shape fast path',()=>{
  const archive={names:['pages/p.json'],read:()=>Buffer.alloc(0),json:(name:string)=>name==='meta.json'?{pagesAndArtboards:{p:{name:'设计'}}}:{layers:[{name:'画板',frame,layers:[{_class:'rectangle',do_objectID:'alpha',name:'半透明填充',frame,style:{fills:[{isEnabled:true,fillType:0,color:{red:1,green:0,blue:0,alpha:1},contextSettings:{opacity:0.25}}]}}]}]}};
  const result=convertSketchBoard(archive,'设计','画板');assert.equal(result.document.elements[0].drawing!.fills[0].opacity,0.25);assert.equal(documentSchema.safeParse(result.document).success,true);
});
test('Symbol overrides are applied per instance and source groups never select another instance',()=>{
  const master={_class:'symbolMaster',symbolID:'master',frame,layers:[{_class:'group',do_objectID:'same-group',name:'组件分组',frame,layers:[{_class:'text',do_objectID:'label',name:'文字',frame,attributedString:{string:'默认',attributes:[]}}]}]};
  const instances=['第一个','第二个'].map((value,i)=>({_class:'symbolInstance',do_objectID:`instance-${i}`,name:value,frame:{...frame,x:i*150},symbolID:'master',overrideValues:[{overrideName:'label_stringValue',value}]}));
  const archive={names:['pages/p.json','pages/library.json'],read:()=>Buffer.alloc(0),json:(name:string)=>name==='meta.json'?{appVersion:'2025.2.2',pagesAndArtboards:{p:{name:'设计'}}}:name==='pages/library.json'?{layers:[master]}:{layers:[{do_objectID:'board',name:'画板',frame:{...frame,width:600,height:400},layers:instances}]}};
  const {document,report}=convertSketchBoard(archive,'p','board');
  assert.deepEqual(document.elements.map(e=>e.text),['第一个','第二个']);
  assert.notEqual(document.elements[0].source!.groups.at(-1)!.id,document.elements[1].source!.groups.at(-1)!.id);
  assert.equal(report.sourceVersion,'2025.2.2');assert.deepEqual(report.issues,[]);assert.equal(documentSchema.safeParse(document).success,true);
});
test('Missing symbols and unsupported effects have persistent layer-level diagnostics',()=>{
  const archive={names:['pages/p.json'],read:()=>Buffer.alloc(0),json:(name:string)=>name==='meta.json'?{pagesAndArtboards:{p:{name:'设计'}}}:{layers:[{do_objectID:'board',name:'画板',frame,layers:[{_class:'symbolInstance',do_objectID:'lost',name:'缺失组件',symbolID:'missing',frame}]}]}};
  const {document,report}=convertSketchBoard(archive,'p','board');assert.equal(report.issues[0].severity,'error');assert.equal(report.issues[0].layerName,'缺失组件');assert.deepEqual(document.importInfo?.report,report);
  const codes:string[]=[];sketchDrawing({fills:[{isEnabled:true,fillType:4}],innerShadows:[{isEnabled:true}],blurs:[{isEnabled:true}]},code=>codes.push(code));
  assert.deepEqual(codes,['paint.unsupported','effect.inner-shadow','effect.blur']);
});
test('ZIP content CRC and truncated archives are checked before conversion',()=>{
  const bytes=sketchFixture();assert.equal(openSketch(bytes).json('meta.json').pagesAndArtboards.p.name,'设计页面');
  const damaged=Buffer.from(bytes);const start=30+damaged.readUInt16LE(26);damaged[start+5]^=1;
  assert.throws(()=>openSketch(damaged).json('meta.json'),/校验失败/);assert.throws(()=>openSketch(bytes.subarray(0,bytes.length-10)));assert.throws(()=>openSketch(Buffer.from('bad')));
});

test('Rich text keeps per-run font, color, size and opacity; outline masks respect coordinate transforms and break chains',()=>{
  const text={_class:'text',do_objectID:'rich',name:'混合文字',frame,attributedString:{string:'AB',attributes:[{location:0,length:1,attributes:{MSAttributedStringFontAttribute:{attributes:{name:'Helvetica',size:14}},MSAttributedStringColorAttribute:{red:1,green:0,blue:0,alpha:1}}},{location:1,length:1,attributes:{MSAttributedStringFontAttribute:{attributes:{name:'Helvetica-Bold',size:18}},MSAttributedStringColorAttribute:{red:0,green:0,blue:1,alpha:0.5}}}]}};
  const mask={_class:'rectangle',do_objectID:'mask',name:'蒙版',frame:{x:10,y:10,width:30,height:30},hasClippingMask:true,clippingMaskMode:0,style:{}};
  const shape={_class:'rectangle',do_objectID:'shape',name:'图形',frame:{x:0,y:0,width:100,height:100},style:{fills:[{isEnabled:true,fillType:0,color:red}]}};
  const archive={names:['pages/p.json'],read:()=>Buffer.alloc(0),json:(name:string)=>name==='meta.json'?{pagesAndArtboards:{p:{name:'设计'}}}:{layers:[{do_objectID:'board',name:'画板',frame:{...frame,width:500,height:400},layers:[text,{_class:'group',do_objectID:'flipped',name:'翻转分组',frame:{x:150,y:100,width:100,height:100},isFlippedHorizontal:true,layers:[mask,shape,{...shape,do_objectID:'free',shouldBreakMaskChain:true}]}]}]}};
  const {document}=convertSketchBoard(archive,'p','board');const rich=document.elements.find(e=>e.name==='混合文字')!;
  assert.equal(rich.typography!.runs!.length,2);assert.equal(rich.typography!.runs![1].fontWeight,700);assert.equal(rich.typography!.runs![1].color,'#0000ff');assert.equal(rich.typography!.runs![1].opacity,0.5);
  assert.match(document.elements.find(e=>e.source?.layerId==='shape')!.clipPaths![0],/M10 10/);
  assert.equal(document.elements.find(e=>e.source?.layerId==='free')!.clipPaths,undefined);assert.equal(documentSchema.safeParse(document).success,true);
});
