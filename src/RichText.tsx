import type {ReactNode} from 'react';
import type {PrototypeElement} from '../shared/model';
export function RichText({element:e}:{element:PrototypeElement}) {
  const t=e.typography;
  if(!t?.runs || t.originalText!==e.text)return e.text;
  const spans:ReactNode[]=[];let cursor=0;
  for(const [index,run] of [...t.runs].sort((a,b)=>a.start-b.start).entries()){
    const start=Math.max(cursor,run.start),end=Math.min(e.text.length,run.start+run.length);
    if(start>cursor)spans.push(e.text.slice(cursor,start));
    if(end>start)spans.push(<span key={index} style={{fontFamily:run.fontFamily,fontWeight:run.fontWeight,fontStyle:run.fontStyle,fontSize:`${run.fontScale}em`,letterSpacing:run.letterSpacing,color:t.baseColor&&e.color!==t.baseColor?e.color:run.color,opacity:run.opacity}}>{e.text.slice(start,end)}</span>);
    cursor=Math.max(cursor,end);
  }
  if(cursor<e.text.length)spans.push(e.text.slice(cursor));
  return spans;
}
