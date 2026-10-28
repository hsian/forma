import type { PrototypeDocument, PrototypeElement } from './model';
import type { AiMessage } from './ai';

export type DesignAiEvent = { type: 'status' | 'text' | 'error'; text: string } | { type: 'result'; message: AiMessage };

export function designBounds(element: PrototypeElement) {
  const radians = element.rotation * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  const [a,b,c,d] = element.importTransform || [1,0,0,1];
  const points = [[0,0],[element.width,0],[0,element.height],[element.width,element.height]].map(([x,y]) => {
    const rotatedX = (x-element.width/2)*cosine-(y-element.height/2)*sine+element.width/2;
    const rotatedY = (x-element.width/2)*sine+(y-element.height/2)*cosine+element.height/2;
    return { x: element.x+element.width/2+a*(rotatedX-element.width/2)+c*(rotatedY-element.height/2), y: element.y+element.height/2+b*(rotatedX-element.width/2)+d*(rotatedY-element.height/2) };
  });
  const left = Math.min(...points.map(p=>p.x)), top = Math.min(...points.map(p=>p.y));
  const right = Math.max(...points.map(p=>p.x)), bottom = Math.max(...points.map(p=>p.y));
  return { left, top, right, bottom, width:right-left, height:bottom-top };
}

export function hitDesignElement(doc: PrototypeDocument, point: {x:number;y:number}) {
  return [...doc.elements].reverse().find(element => {
    if (element.hidden || element.parentId || !element.opacity) return false;
    const [a,b,c,d]=element.importTransform || [1,0,0,1], determinant=a*d-b*c;
    if(Math.abs(determinant)<1e-12)return false;
    const dx=point.x-element.x-element.width/2, dy=point.y-element.y-element.height/2;
    const transformedX=(d*dx-c*dy)/determinant, transformedY=(-b*dx+a*dy)/determinant;
    const radians=element.rotation*Math.PI/180;
    const x=transformedX*Math.cos(radians)+transformedY*Math.sin(radians)+element.width/2;
    const y=-transformedX*Math.sin(radians)+transformedY*Math.cos(radians)+element.height/2;
    return x>=0 && x<=element.width && y>=0 && y<=element.height;
  });
}

export function inspectDesign(doc: PrototypeDocument, selectedIds: string[]) {
  const elements = doc.elements.filter(element => selectedIds.includes(element.id) && !element.hidden && !element.parentId);
  const selected = elements.map(element => ({ id:element.id,name:element.name,text:element.text,bounds:designBounds(element),fontSize:element.fontSize,
    fill:element.fill,color:element.color,stroke:element.stroke,strokeWidth:element.strokeWidth,opacity:element.opacity,typography:element.typography,drawing:element.drawing,
    canvasInsets: { left:designBounds(element).left,top:designBounds(element).top,right:doc.width-designBounds(element).right,bottom:doc.height-designBounds(element).bottom } }));
  const spacing = elements.length === 2 ? (() => {
    const a=designBounds(elements[0]), b=designBounds(elements[1]);
    return { firstId:elements[0].id,secondId:elements[1].id,horizontalGap:Math.max(0,a.left-b.right,b.left-a.right),verticalGap:Math.max(0,a.top-b.bottom,b.top-a.bottom),
      horizontalOverlap:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)),verticalOverlap:Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)),
      leftEdgeOffset:b.left-a.left,topEdgeOffset:b.top-a.top,measurement:'画布原始像素；旋转图层使用变换后的轴对齐边界，不包含阴影' };
  })() : undefined;
  return { unit:'px',selected,spacing };
}
