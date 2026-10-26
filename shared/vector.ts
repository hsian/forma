import type { PrototypeElement } from './model';

export function roundedRectanglePath(width:number,height:number,radii:number[]) {
  let [tl,tr,br,bl]=[0,1,2,3].map(i=>Math.max(0,radii.length===1?radii[0]:radii[i]||0));
  const scale=Math.min(1,width/(tl+tr||1),width/(bl+br||1),height/(tl+bl||1),height/(tr+br||1));
  [tl,tr,br,bl]=[tl,tr,br,bl].map(r=>r*scale);
  const n=(v:number)=>Math.round(v*10000)/10000;
  return `M${n(tl)} 0 L${n(width-tr)} 0 Q${n(width)} 0 ${n(width)} ${n(tr)} L${n(width)} ${n(height-br)} Q${n(width)} ${n(height)} ${n(width-br)} ${n(height)} L${n(bl)} ${n(height)} Q0 ${n(height)} 0 ${n(height-bl)} L0 ${n(tl)} Q0 0 ${n(tl)} 0 Z`;
}

export function vectorRectangleRadii(e:PrototypeElement):number[]|undefined {
  if(e.vector?.rectangleRadii) return e.radius===e.vector.rectangleRadii[0]?e.vector.rectangleRadii:[e.radius];
  // Old imports already contain the radius, but their rectangle became a sharp
  // outline path. Recognize only exact rectangles; leave arbitrary paths alone.
  if(!e.source || !e.vector || e.radius<=0 || !/^[MLZ0-9eE.,+\s-]+$/.test(e.vector.path))return;
  const values=e.vector.path.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number);
  if(!values || ![8,10].includes(values.length))return;
  const w=e.vector.viewWidth,h=e.vector.viewHeight;
  const expected=[0,0,w,0,w,h,0,h,...(values.length===10?[0,0]:[])];
  if(values.every((v,i)=>Math.abs(v-expected[i])<0.001))return [e.radius];
}
