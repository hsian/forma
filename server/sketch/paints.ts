import type {DrawingPaint,DrawingStyle} from '../../shared/drawing.js';
type Obj=Record<string,any>;
export const sketchColor=(c:Obj={})=>'#'+[c.red??0,c.green??0,c.blue??0].map(n=>Math.round(Math.max(0,Math.min(1,n))*255).toString(16).padStart(2,'0')).join('');
const opacity=(v:unknown)=>Math.max(0,Math.min(1,typeof v==='number'?v:1));
function pair(value:string):[number,number]{const n=value?.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number);if(!n||n.length!==2||!n.every(Number.isFinite))throw Error('渐变坐标无效');return n as [number,number];}
export function sketchDrawing(style:Obj,unsupported:(code:string,message:string)=>void):DrawingStyle {
  function paint(fill:Obj):DrawingPaint|undefined {
    const alpha=opacity(fill.contextSettings?.opacity);
    if(fill.contextSettings?.blendMode)unsupported('paint.blend','填充或描边的特殊混合模式暂不支持');
    if(!fill.fillType)return {kind:'solid',color:sketchColor(fill.color),opacity:alpha*opacity(fill.color?.alpha)};
    if(fill.fillType===1 && [0,1].includes(fill.gradient?.gradientType))return {kind:fill.gradient.gradientType===0?'linear':'radial',from:pair(fill.gradient.from),to:pair(fill.gradient.to),opacity:alpha,stops:(fill.gradient.stops||[]).map((s:Obj)=>({offset:Math.max(0,Math.min(1,s.position)),color:sketchColor(s.color),opacity:opacity(s.color?.alpha)})).sort((a:Obj,b:Obj)=>a.offset-b.offset)};
    unsupported('paint.unsupported','暂不支持的图案或角度渐变填充');return;
  }
  const fills=(style.fills||[]).filter((f:Obj)=>f.isEnabled).map(paint).filter(Boolean) as DrawingPaint[];
  const options=style.borderOptions||{};
  const strokes=(style.borders||[]).filter((b:Obj)=>b.isEnabled).flatMap((b:Obj)=>{const p=paint(b);return p?[{paint:p,width:b.thickness||0,position:(b.position===1?'inside':b.position===2?'outside':'center') as 'inside',dash:options.isEnabled?(options.dashPattern||[]):[],cap:(['butt','round','square'][options.lineCapStyle||0]||'butt') as 'butt',join:(['miter','round','bevel'][options.lineJoinStyle||0]||'miter') as 'miter'}]:[];});
  const shadows=(style.shadows||[]).filter((s:Obj)=>s.isEnabled).map((s:Obj)=>({x:s.offsetX||0,y:s.offsetY||0,blur:Math.max(0,s.blurRadius||0),spread:s.spread||0,color:sketchColor(s.color),opacity:opacity(s.color?.alpha)*opacity(s.contextSettings?.opacity)}));
  if((style.innerShadows||[]).some((s:Obj)=>s.isEnabled))unsupported('effect.inner-shadow','内阴影暂不支持');
  if((style.blurs||[]).some((b:Obj)=>b.isEnabled))unsupported('effect.blur','图层或背景模糊暂不支持');
  if(style.startMarkerType || style.endMarkerType)unsupported('stroke.markers','箭头等特殊路径端点暂不支持');
  if(style.corners?.style)unsupported('shape.corner-style','特殊圆角样式暂按普通圆角处理');
  if(style.colorControls?.isEnabled)unsupported('effect.color-controls','图层亮度、对比度等调色暂不支持');
  if(style.contextSettings?.blendMode)unsupported('effect.blend','非正常混合模式暂不支持');
  return {fills,strokes,shadows};
}
