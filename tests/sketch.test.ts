import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertSketchBoard, layerPath } from '../server/sketch/convert';
import { documentSchema } from '../server/document-validation';
import { makeElement } from '../shared/model';
import {sketchTypography} from '../server/sketch/typography';
import {roundedRectanglePath,vectorRectangleRadii} from '../shared/vector';
const frame=(x=0,y=0,width=100,height=100)=>({x,y,width,height});
const fill={fills:[{isEnabled:true,fillType:0,color:{red:1,green:0,blue:0,alpha:1}}]};
function archive(layers: any[]) {
  return {names:['pages/p.json'],read:()=>Buffer.alloc(0),json:(name:string)=>name==='meta.json'?{pagesAndArtboards:{p:{name:'测试'}}}:{layers:[{name:'画板',frame:frame(1000,2000,500,500),layers}]}};
}
test('Sketch nested groups become editable elements with local coordinates, opacity, grouping and minimum font size',()=>{
  const textLayer={_class:'text',name:'文字',do_objectID:'t',frame:frame(),attributedString:{string:'测试',attributes:[{attributes:{MSAttributedStringFontAttribute:{attributes:{size:9}}}}]}};
  const group={_class:'group',name:'按钮组',do_objectID:'g',frame:frame(20,30),style:{contextSettings:{opacity:0.5}},layers:[{_class:'rectangle',name:'背景',do_objectID:'r',frame:frame(10,15),style:fill},textLayer]};
  const result=convertSketchBoard(archive([group,{_class:'rectangle',name:'界外',do_objectID:'outside',frame:frame(1000),style:fill},{_class:'rectangle',name:'隐藏',do_objectID:'hidden',frame:frame(),isVisible:false}]),'测试','画板');
  assert.equal(result.document.elements.length,2);
  const [rect,text]=result.document.elements;
  assert.equal(rect.x,30);assert.equal(rect.y,45);assert.equal(rect.opacity,0.5);
  assert.equal(rect.fill,'#ff0000');assert.equal(text.fontSize,12);
  assert.equal(text.text,'测试');assert.deepEqual(rect.source?.groups,[{id:'g',name:'按钮组'}]);
  assert.equal(result.report.skippedOutside,1);assert.equal(result.report.skippedHidden,1);
  assert.equal(documentSchema.safeParse(result.document).success,true);
});
test('Sketch Bezier curves and flips survive as safe structured paths and transforms',()=>{
  const layer={_class:'shapePath',do_objectID:'p',name:'曲线',frame:frame(20,40,100,50),isFlippedHorizontal:true,style:fill,points:[{point:'{0, 0}',hasCurveFrom:true,curveFrom:'{0.5, 0}'},{point:'{1, 1}',hasCurveTo:true,curveTo:'{0.5, 1}'}]};
  assert.equal(layerPath(layer),'M0 0 C50 0 50 50 100 50');
  const doc=convertSketchBoard(archive([layer]),'测试','画板').document;
  assert.equal(doc.elements[0].kind,'vector');assert.equal(doc.elements[0].x,20);
  assert.deepEqual(doc.elements[0].importTransform,[-1,0,0,1]);
  const invalid={...doc,elements:[{...doc.elements[0],vector:{...doc.elements[0].vector!,path:'<script>alert(1)</script>'}}]};
  assert.equal(documentSchema.safeParse(invalid).success,false);
  assert.equal(documentSchema.safeParse({width:100,height:100,background:'#ffffff',elements:[makeElement('vector')]}).success,true);
});

test('Sketch bitmap assets remain embedded images and can pass normal document saving validation',()=>{
  const image=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(100000)]);
  const input=archive([{_class:'bitmap',name:'图片',do_objectID:'image',frame:frame(),image:{_ref:'images/a'}}]);
  input.names.push('images/a');input.read=()=>image;
  const doc=convertSketchBoard(input,'测试','画板').document;
  assert.equal(doc.elements[0].kind,'image');
  assert.match(String(doc.elements[0].component?.src),/^data:image\/png;base64,/);
  assert.equal(documentSchema.safeParse(doc).success,true);
});

test('Sketch text preserves single lines, paragraph spacing, weight, alignment and explicit multiline layout',()=>{
  const amount={frame:frame(0,0,54,20),horizontalSizing:1,attributedString:{string:'1,377.00',attributes:[{attributes:{MSAttributedStringFontAttribute:{attributes:{name:'PingFangSC-Regular',size:14}},paragraphStyle:{alignment:1},kerning:0}}]}};
  const t=sketchTypography(amount,14);assert.equal(t.wrap,'nowrap');assert.equal(t.lineHeight,20);assert.equal(t.align,'right');assert.match(t.fontFamily,/PingFang SC/);assert.equal(t.sourceFont,'PingFangSC-Regular');
  const multiline={...amount,attributedString:{string:'第一行\n第二行',attributes:[{attributes:{MSAttributedStringFontAttribute:{attributes:{name:'Helvetica-BoldOblique',size:14}},paragraphStyle:{alignment:2,minimumLineHeight:24},kerning:1.5}}]}};
  const m=sketchTypography(multiline,14);assert.equal(m.wrap,'wrap');assert.equal(m.lineHeight,24);assert.equal(m.fontWeight,700);assert.equal(m.fontStyle,'italic');assert.equal(m.align,'center');assert.equal(m.letterSpacing,1.5);
});

test('Outline-only Sketch rectangles keep editable rounded corners, including legacy imports',()=>{
  const layer={_class:'rectangle',name:'描边按钮',do_objectID:'outline',frame:frame(0,0,115,32),isClosed:true,style:{corners:{radii:[6]},borders:[{isEnabled:true,thickness:1,color:{red:0.8,green:0.8,blue:0.8}}]}};
  const doc=convertSketchBoard(archive([layer]),'测试','画板').document;
  const e=doc.elements[0];assert.equal(e.kind,'vector');assert.equal(e.radius,6);assert.equal(e.vector?.fillEnabled,false);assert.deepEqual(e.vector?.rectangleRadii,[6,6,6,6]);assert.match(e.vector!.path,/Q115 0 115 6/);assert.equal(documentSchema.safeParse(doc).success,true);
  const old={...e,vector:{...e.vector!,rectangleRadii:undefined,path:'M0 0 L115 0 L115 32 L0 32 L0 0 Z'}};
  assert.deepEqual(vectorRectangleRadii(old),[6]);
  assert.equal(vectorRectangleRadii({...old,vector:{...old.vector,path:'M0 0 L50 32 L115 0 Z'}}),undefined);
  assert.deepEqual(vectorRectangleRadii({...e,radius:10}),[10]);
  assert.match(roundedRectanglePath(115,32,[2,4,6,8]),/Q115 0 115 4/);
});
