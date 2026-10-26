import {inverse} from './geometry.js';
import {createHash} from 'node:crypto';
import {sketchDrawing} from './paints.js';
import {SKETCH_CONVERTER_VERSION,type ImportIssue} from '../../shared/drawing.js';
import { makeElement, type PrototypeDocument, type PrototypeElement } from '../../shared/model.js';
import { openSketch } from './archive.js';
import { roundedRectanglePath } from '../../shared/vector.js';
import { sketchTypography } from './typography.js';

// Sketch JSON is versioned independently. Unknown drawing features are reported,
// rather than guessed to be functional Ant Design components.
type Layer = Record<string, any>;
type Matrix = [number, number, number, number, number, number];
type OutlineMask={layer:Layer;matrix:Matrix};
const identity: Matrix = [1, 0, 0, 1, 0, 0];
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
function frameMatrix(l: Layer): Matrix {
  const f = l.frame, radians = -(l.rotation || 0) * Math.PI / 180;
  const sx = l.isFlippedHorizontal ? -1 : 1, sy = l.isFlippedVertical ? -1 : 1;
  const a = Math.cos(radians)*sx, b = Math.sin(radians)*sx, c = -Math.sin(radians)*sy, d = Math.cos(radians)*sy;
  return [a,b,c,d,f.x+f.width/2-a*f.width/2-c*f.height/2,f.y+f.height/2-b*f.width/2-d*f.height/2];
}
const round = (n: number) => Math.round(n * 10000) / 10000;
function point(s: string, w: number, h: number, m: Matrix) {
  const values = (s || '').match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number);
  if (!values || values.length !== 2 || !values.every(Number.isFinite)) throw Error('Sketch 路径坐标无效');
  const [x, y] = [values[0]*w, values[1]*h];
  return `${round(m[0]*x+m[2]*y+m[4])} ${round(m[1]*x+m[3]*y+m[5])}`;
}
export function rectangleRadii(l:Layer):[number,number,number,number] {
  const radii=l.style?.corners?.radii;
  if(radii?.length)return [0,1,2,3].map(i=>Math.max(0,radii.length===1?radii[0]:radii[i]||0)) as [number,number,number,number];
  return ['{0, 0}','{1, 0}','{1, 1}','{0, 1}'].map(c=>l.points?.find((p:Layer)=>p.point?.replace(/\s/g,'')===c.replace(/\s/g,''))?.cornerRadius||0) as [number,number,number,number];
}
export function layerPath(l: Layer, m: Matrix = identity): string {
  if(l._class==='oval') {
    const w=l.frame.width,h=l.frame.height,k=0.5522847498;
    const raw=`M0 ${h/2} C0 ${h/2*(1-k)} ${w/2*(1-k)} 0 ${w/2} 0 C${w/2*(1+k)} 0 ${w} ${h/2*(1-k)} ${w} ${h/2} C${w} ${h/2*(1+k)} ${w/2*(1+k)} ${h} ${w/2} ${h} C${w/2*(1-k)} ${h} 0 ${h/2*(1+k)} 0 ${h/2} Z`;
    return raw.replace(/([-+]?[0-9.]+) ([-+]?[0-9.]+)/g,(_,a,b)=>`${round(m[0]*Number(a)+m[2]*Number(b)+m[4])} ${round(m[1]*Number(a)+m[3]*Number(b)+m[5])}`);
  }
  if(l._class==='rectangle') {
    return roundedRectanglePath(l.frame.width,l.frame.height,rectangleRadii(l)).replace(/([-+]?[0-9.]+) ([-+]?[0-9.]+)/g,(_,a,b)=>`${round(m[0]*Number(a)+m[2]*Number(b)+m[4])} ${round(m[1]*Number(a)+m[3]*Number(b)+m[5])}`);
  }
  const points: Layer[] = l.points || [], w=l.frame.width, h=l.frame.height;
  if (!points.length) return '';
  const coord = (p: Layer, key: string) => point(p[key] || p.point, w, h, m);
  let path = `M${coord(points[0], 'point')}`;
  for(let i=1;i<points.length+(l.isClosed ? 1 : 0);i++) {
    const prev=points[(i-1)%points.length], next=points[i%points.length];
    path += prev.hasCurveFrom || next.hasCurveTo ? ` C${coord(prev, prev.hasCurveFrom ? 'curveFrom' : 'point')} ${coord(next, next.hasCurveTo ? 'curveTo' : 'point')} ${coord(next, 'point')}` : ` L${coord(next, 'point')}`;
  }
  return path + (l.isClosed ? ' Z' : '');
}
const hex = (c: Layer = {}) => '#' + [c.red ?? 0,c.green ?? 0,c.blue ?? 0].map(n=>Math.round(Math.max(0,Math.min(1,n))*255).toString(16).padStart(2,'0')).join('');

export function convertSketchBoard(archive: ReturnType<typeof openSketch>, pageName: string, boardName: string, groupId?: string) {
  const meta = archive.json('meta.json');
  const pageEntry = Object.entries(meta.pagesAndArtboards as Record<string, Layer>).find(([id,p])=>id===pageName || p.name===pageName);
  if (!pageEntry) throw Error(`找不到 Sketch 页面：${pageName}`);
  const page = archive.json(`pages/${pageEntry[0]}.json`);
  const artboard = page.layers.find((l: Layer)=>l.do_objectID===boardName || l.name===boardName);
  const board = groupId ? artboard?.layers?.find((l: Layer)=>l.do_objectID===groupId) : artboard;
  if (!board || !board.frame || board.frame.width<1 || board.frame.height<1) throw Error(`找不到 Sketch 画板：${boardName}`);
  const warnings = new Map<string, number>();
  const issues=new Map<string,ImportIssue>();let active:Layer=board;
  const warn=(message:string,code='conversion.approximation',severity:'warning'|'error'='warning')=>{warnings.set(message,(warnings.get(message)||0)+1);const id=active.do_objectID||'unknown';issues.set(`${id}:${code}:${message}`,{code,severity,message,layerId:id,layerName:active.name||active._class||'未命名图层'});};
  if(typeof meta.version==='number' && meta.version!==173)warn('该 Sketch 文件格式版本尚未经过样本回归，请重点复核导入效果','format.untested');
  const document: PrototypeDocument={width:board.frame.width,height:board.frame.height,background:'#ffffff',elements:[]};
  const masters=new Map<string,Layer>();
  // Most boards have no symbols; load library pages only when expansion is needed.
  let librariesLoaded=false;
  function loadLibraries(){if(librariesLoaded)return;librariesLoaded=true;for(const name of archive.names.filter(n=>n.startsWith('pages/'))){const p=archive.json(name);function visit(l:Layer){if(l._class==='symbolMaster')masters.set(l.symbolID,l);for(const c of l.layers||[])visit(c);}visit(p);}}
  let skippedOutside=0, skippedHidden=0;
  function emit(l: Layer, m: Matrix, opacity: number, groups: {id:string;name:string}[], overrideStyle?: Layer, compoundPath?: string, masks:OutlineMask[]=[]) {
    const f=l.frame,w=Math.max(1,f.width),h=Math.max(1,f.height);
    const cx=m[0]*w/2+m[2]*h/2+m[4],cy=m[1]*w/2+m[3]*h/2+m[5];
    const bw=Math.abs(m[0]*w)+Math.abs(m[2]*h),bh=Math.abs(m[1]*w)+Math.abs(m[3]*h);
    if(!groupId && (cx+bw/2<0 || cy+bh/2<0 || cx-bw/2>document.width || cy-bh/2>document.height)){skippedOutside++;return;}
    const style=overrideStyle || l.style || {},fills=(style.fills||[]).filter((f:Layer)=>f.isEnabled),borders=(style.borders||[]).filter((f:Layer)=>f.isEnabled),fill=fills.at(-1),border=borders.at(-1);
    const drawing=sketchDrawing(style,(code,message)=>warn(message,code));
    let kind:PrototypeElement['kind']=l._class==='text'?'text':l._class==='bitmap'?'image':l._class==='rectangle'?'rectangle':l._class==='oval'?'ellipse':'vector';
    const e:PrototypeElement={...makeElement(kind),id:`sketch-${document.elements.length}-${l.do_objectID}`,name:l.name || l._class,x:round(cx-w/2),y:round(cy-h/2),width:w,height:h,rotation:0,radius:0,fill:fill ? hex(fill.color) : '#ffffff',stroke:hex(border?.color),strokeWidth:border?.thickness||0,opacity:Math.max(0,Math.min(1,opacity)),text:'',source:{layerId:l.do_objectID,groups},importTransform:m.slice(0,4).map(round) as [number,number,number,number]};
    if(l._class==='text') {
      const attrs=l.attributedString?.attributes?.[0]?.attributes || style.textStyle?.encodedAttributes || {}, font=attrs.MSAttributedStringFontAttribute?.attributes || {};
      e.text=l.attributedString?.string || '';e.color=hex(attrs.MSAttributedStringColorAttribute);e.fontSize=Math.max(12,font.size || 14);
      if(font.size && font.size<12)warn('原字号小于 12px，已按编辑器最小字号调整','text.minimum-size');
      e.typography=sketchTypography(l,e.fontSize);
      if(!e.typography.runs)e.opacity*=attrs.MSAttributedStringColorAttribute?.alpha ?? 1;
      if((l.attributedString?.attributes||[]).some((r:Layer)=>JSON.stringify({...attrs.paragraphStyle,...r.attributes?.paragraphStyle})!==JSON.stringify(attrs.paragraphStyle||{})))warn('混合段落的行距和对齐暂按首段设置','text.paragraph');
    } else if(l._class==='bitmap') {
      const ref=l.image?._ref;if(!ref || !archive.names.includes(ref)){warn('找不到位图素材，不能生成该图层','image.missing','error');return;}
      const data=archive.read(ref);const mime=data[0]===137?'image/png':data[0]===255?'image/jpeg':data.toString('ascii',0,3)==='GIF'?'image/gif':data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'?'image/webp':undefined;
      if(!mime){warn('未支持的位图格式，不能生成该图层','image.format','error');return;}
      e.component={src:`data:${mime};base64,${data.toString('base64')}`,preview:false};
    } else {
      const radii=l._class==='rectangle'?rectangleRadii(l):style.corners?.radii || l.points?.map((p:Layer)=>p.cornerRadius||0) || [];
      e.radius=Math.max(0,radii[0]||0);
      if(l._class!=='rectangle' && new Set(radii).size>1)warn('非矩形路径的节点圆角暂未转换');
      if(kind==='vector' || l._class==='rectangle' && new Set(radii).size>1 || !fill || (fill.color?.alpha ?? 1)<1 || (border?.color?.alpha ?? 1)<1) {
        e.kind='vector';let path=compoundPath || layerPath(l);
        if(!path && l._class==='oval') path=`M0 ${h/2} A${w/2} ${h/2} 0 1 0 ${w} ${h/2} A${w/2} ${h/2} 0 1 0 0 ${h/2} Z`;
        if(!path){warn('没有可转换的路径，不能生成该图层','path.missing','error');return;}
        e.vector={path,viewWidth:w,viewHeight:h,fillEnabled:!!fill,fillOpacity:fill?.color?.alpha??1,strokeOpacity:border?.color?.alpha??1,fillRule:style.windingRule===0?'nonzero':'evenodd',...(l._class==='rectangle'?{rectangleRadii:rectangleRadii(l)}:{})};
      }
    }
    if(['rectangle','ellipse','vector'].includes(e.kind) && (drawing.fills.length>1 || drawing.strokes.length>1 || fills.some((f:Layer)=>f.contextSettings?.opacity!==undefined && f.contextSettings.opacity!==1) || borders.some((b:Layer)=>b.contextSettings?.opacity!==undefined && b.contextSettings.opacity!==1) || drawing.fills.some(p=>p.kind!=='solid') || drawing.strokes.some(s=>s.paint.kind!=='solid'||s.position!=='center'||s.dash.length>0||s.cap!=='butt'||s.join!=='miter') || drawing.shadows.length)) e.drawing={...drawing,baseFill:e.fill,baseStroke:e.stroke,baseStrokeWidth:e.strokeWidth};
    if(e.kind==='text' && drawing.shadows.length)warn('文字阴影暂不支持','text.shadow');
    if(masks.length){e.clipPaths=masks.map(mask=>layerPath(mask.layer,multiply(inverse(m),mask.matrix)));e.clipRules=masks.map(mask=>mask.layer.style?.windingRule===1?'evenodd':'nonzero');}
    if(document.elements.length>=20000)throw Error('转换结果超过单页 20,000 个元素，请拆分画板');
    document.elements.push(e);
  }
  function walk(l:Layer,parent:Matrix,opacity:number,groups:{id:string;name:string}[],depth=0,scope='',masks:OutlineMask[]=[]) {
    active=l;
    if(depth>80)throw Error('Sketch 分组嵌套过深');
    if(l.isVisible===false){skippedHidden++;return;}
    const m=multiply(parent,frameMatrix(l)),alpha=opacity*(l.style?.contextSettings?.opacity??1);
    if(l.hasClippingMask && l.clippingMaskMode!==0)warn('透明度蒙版暂不支持','mask.alpha');
    if(l._class==='symbolInstance') {
      loadLibraries();const master=masters.get(l.symbolID);if(!master){warn('缺少组件定义，不能生成实例','symbol.missing','error');return;}
      const expanded=structuredClone(master);
      for(const override of l.overrideValues||[]){
        const match=String(override.overrideName||'').match(/^(.*)_(stringValue|symbolID|image|isVisible)$/);
        if(!match){warn('尚不支持此类组件覆盖值','symbol.override');continue;}
        const targetId=match[1].split('/').at(-1);let target:Layer|undefined;
        function locate(node:Layer){if(node.do_objectID===targetId)target=node;for(const c of node.layers||[])locate(c);}locate(expanded);
        if(!target){warn('嵌套组件覆盖目标暂不能解析','symbol.override-target');continue;}
        if(match[2]==='stringValue' && target.attributedString){target.attributedString.string=String(override.value);if(target.attributedString.attributes?.length===1)target.attributedString.attributes[0].length=String(override.value).length;}
        else if(match[2]==='symbolID') {if(override.value)target.symbolID=override.value;else target.isVisible=false;}
        else if(match[2]==='image')target.image=override.value;
        else if(match[2]==='isVisible')target.isVisible=override.value!==false&&override.value!==0;
        else warn('组件覆盖值与目标类型不匹配','symbol.override-type');
      }
      if(Math.abs(l.frame.width-master.frame.width)>0.01 || Math.abs(l.frame.height-master.frame.height)>0.01)warn('组件尺寸已改变，当前按比例展开，未保留组件的自适应约束','symbol.resize');
      const scaled=multiply(m,[l.frame.width/master.frame.width,0,0,l.frame.height/master.frame.height,0,0]);
      for(const child of expanded.layers||[])walk(child,scaled,alpha,[...groups,{id:createHash('sha256').update(scope+'/'+l.do_objectID).digest('hex'),name:l.name}],depth+1,scope+'/'+l.do_objectID,masks);
    } else if(l._class==='shapeGroup') {
      function paths(c:Layer,t:Matrix):string {const next=multiply(t,frameMatrix(c));return c.layers?.length?c.layers.map((s:Layer)=>paths(s,next)).join(' '):layerPath(c,next);}
      if(l.layers?.some((c:Layer)=>c.booleanOperation>0))warn('布尔路径暂按复合路径绘制');
      emit(l,m,alpha,groups,undefined,(l.layers||[]).map((c:Layer)=>paths(c,identity)).join(' '),masks);
    } else if(l.layers) {
      const nested=[...groups,{id:scope?createHash('sha256').update(scope+'/'+l.do_objectID).digest('hex'):l.do_objectID,name:l.name}];
      if(alpha!==opacity && (l.layers||[]).length>1)warn('分组透明度按子图层展开，重叠区域可能不同','group.opacity');
      if((l.style?.shadows||[]).some((s:Layer)=>s.isEnabled))warn('分组整体阴影暂不支持','group.shadow');
      if(l.style?.fills?.some((f:Layer)=>f.isEnabled))emit({...l,_class:'rectangle',points:undefined},m,alpha,groups,undefined,undefined,masks);
      let chain=[...masks];
      for(const child of l.layers){
        if(child.shouldBreakMaskChain)chain=[...masks];
        walk(child,m,alpha,nested,depth+1,scope,chain);
        if(child.hasClippingMask && child.clippingMaskMode===0){
          if(['rectangle','oval','shapePath'].includes(child._class))chain=[...chain,{layer:child,matrix:multiply(m,frameMatrix(child))}];
          else {active=child;warn('此类轮廓蒙版暂不支持','mask.shape');}
        }
      }
    } else emit(l,m,alpha,groups,undefined,undefined,masks);
  }
  // Frame coordinates are relative to the containing Sketch page, not the board.
  let rootMasks:OutlineMask[]=[];
  for(const child of board.layers||[]){
    if(child.shouldBreakMaskChain)rootMasks=[];
    walk(child,identity,1,[],0,'',rootMasks);
    if(child.hasClippingMask && child.clippingMaskMode===0 && ['rectangle','oval','shapePath'].includes(child._class))rootMasks=[...rootMasks,{layer:child,matrix:frameMatrix(child)}];
  }
  if(groupId && document.elements.length) {
    const left=Math.min(...document.elements.map(e=>e.x)),top=Math.min(...document.elements.map(e=>e.y));
    document.width=Math.ceil(Math.max(...document.elements.map(e=>e.x+e.width))-left);
    document.height=Math.ceil(Math.max(...document.elements.map(e=>e.y+e.height))-top);
    for(const e of document.elements){e.x=round(e.x-left);e.y=round(e.y-top);}
    warn('浮层使用实际图层范围，修正源文件中过期的分组边界');
  }
  if(document.elements.length>20000)throw Error('转换结果超过单页元素上限');
  if(!document.elements.length){active=board;warn('画板没有可转换的可见内容','board.empty','error');}
  const report={pageName:pageEntry[1].name,boardName:board.name,elements:document.elements.length,skippedOutside,skippedHidden,warnings:[...warnings].map(([message,count])=>({message,count})),issues:[...issues.values()],converterVersion:SKETCH_CONVERTER_VERSION,sourceVersion:String(meta.appVersion||meta.version||'unknown')};
  document.importInfo={report};
  return {document,report};
}
