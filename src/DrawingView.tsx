import {useId} from 'react';
import type {PrototypeElement} from '../shared/model';
import type {DrawingPaint} from '../shared/drawing';
import {roundedRectanglePath,vectorRectangleRadii} from '../shared/vector';

export function DrawingView({element:e}:{element:PrototypeElement}) {
  const uid=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const w=e.vector?.viewWidth||e.width,h=e.vector?.viewHeight||e.height;
  const radii=vectorRectangleRadii(e);
  const d=e.vector?(radii?roundedRectanglePath(w,h,radii):e.vector.path):e.kind==='ellipse'?`M0 ${h/2} A${w/2} ${h/2} 0 1 0 ${w} ${h/2} A${w/2} ${h/2} 0 1 0 0 ${h/2} Z`:roundedRectanglePath(w,h,[e.radius]);
  const drawing=e.drawing!;
  const defs:React.ReactNode[]=[];
  function paint(p:DrawingPaint,id:string){
    if(p.kind==='solid')return p.color;
    const stops=p.stops.map((s,i)=><stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity}/>);
    defs.push(p.kind==='linear'?<linearGradient key={id} id={id} x1={p.from[0]} y1={p.from[1]} x2={p.to[0]} y2={p.to[1]}>{stops}</linearGradient>:<radialGradient key={id} id={id} cx={p.from[0]} cy={p.from[1]} r={Math.hypot(p.to[0]-p.from[0],p.to[1]-p.from[1])}>{stops}</radialGradient>);
    return `url(#${id})`;
  }
  const activeFills=drawing.baseFill && e.fill!==drawing.baseFill ? [...drawing.fills.slice(0,-1),{kind:'solid' as const,color:e.fill,opacity:1}] : drawing.fills;
  const activeStrokes=drawing.strokes.map((s,i)=>i===drawing.strokes.length-1?{...s,width:e.strokeWidth,paint:drawing.baseStroke&&e.stroke!==drawing.baseStroke?{kind:'solid' as const,color:e.stroke,opacity:1}:s.paint}:s);
  if(!activeStrokes.length && e.strokeWidth)activeStrokes.push({paint:{kind:'solid',color:e.stroke,opacity:1},width:e.strokeWidth,position:'center',dash:[],cap:'butt',join:'miter'});
  const fills=activeFills.map((p,i)=><path key={`f${i}`} d={d} fill={paint(p,`${uid}f${i}`)} fillOpacity={p.opacity} fillRule={e.vector?.fillRule||'nonzero'}/>);
  defs.push(<clipPath key="inside" id={`${uid}inside`}><path d={d} fillRule={e.vector?.fillRule||'nonzero'}/></clipPath>);
  const pad=Math.max(10,...drawing.strokes.map(s=>s.width*2),...drawing.shadows.map(s=>Math.abs(s.x)+Math.abs(s.y)+s.blur*3+Math.abs(s.spread)*2));
  defs.push(<mask key="outside" id={`${uid}outside`} maskUnits="userSpaceOnUse" x={-pad} y={-pad} width={w+pad*2} height={h+pad*2}><rect x={-pad} y={-pad} width={w+pad*2} height={h+pad*2} fill="white"/><path d={d} fill="black" fillRule={e.vector?.fillRule||'nonzero'}/></mask>);
  const strokes=activeStrokes.map((s,i)=><path key={`s${i}`} d={d} fill="none" stroke={paint(s.paint,`${uid}s${i}`)} strokeOpacity={s.paint.opacity} strokeWidth={s.width*(s.position==='center'?1:2)} strokeDasharray={s.dash.join(' ')||undefined} strokeLinecap={s.cap} strokeLinejoin={s.join} clipPath={s.position==='inside'?`url(#${uid}inside)`:undefined} mask={s.position==='outside'?`url(#${uid}outside)`:undefined}/>);
  const shadows=drawing.shadows.map((s,i)=>{
    const id=`${uid}shadow${i}`;
    defs.push(<filter key={id} id={id} filterUnits="userSpaceOnUse" x={-pad} y={-pad} width={w+pad*2} height={h+pad*2} colorInterpolationFilters="sRGB"><feMorphology in="SourceAlpha" operator={s.spread<0?'erode':'dilate'} radius={Math.abs(s.spread)} result="spread"/><feGaussianBlur in="spread" stdDeviation={s.blur/2} result="blur"/><feOffset in="blur" dx={s.x} dy={s.y} result="offset"/><feFlood floodColor={s.color} floodOpacity={s.opacity}/><feComposite in2="offset" operator="in"/></filter>);
    return <g key={id} filter={`url(#${id})`}>{fills}{strokes}</g>;
  });
  return <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{display:'block',overflow:'visible'}}><defs>{defs}</defs>{shadows}{fills}{strokes}</svg>;
}
