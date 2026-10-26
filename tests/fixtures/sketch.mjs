// Small real ZIP fixture; never depends on the user's design file.
export function sketchFixture(customLayers) {
  const text={_class:'text',do_objectID:'text',name:'标题',isVisible:true,frame:{x:20,y:20,width:200,height:30},attributedString:{string:'导入的设计文字',attributes:[]}};
  const board={_class:'group',do_objectID:'board',name:'导入示例',frame:{x:1000,y:2000,width:800,height:600},layers:customLayers || [text]};
  const empty={...board,do_objectID:'empty',name:'空画板',layers:[]};
  const entries={'meta.json':{pagesAndArtboards:{p:{name:'设计页面',artboards:{board:{name:board.name},empty:{name:empty.name}}}}},'pages/p.json':{name:'设计页面',layers:[board,empty]}};
  let offset=0;const files=[],central=[];
  for(const [name,value] of Object.entries(entries)) {
    const n=Buffer.from(name),data=Buffer.from(JSON.stringify(value));let crc=0xffffffff;
    for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}crc=(crc^0xffffffff)>>>0;
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(n.length,26);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(n.length,28);entry.writeUInt32LE(offset,42);
    files.push(header,n,data);central.push(entry,n);offset+=header.length+n.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...files,directory,end]);
}

export function drawingSketchFixture(){
 const color=(r,g,b,alpha=1)=>({red:r,green:g,blue:b,alpha});
 const solid=(c)=>({isEnabled:true,fillType:0,color:c});
 const rect=(id,x,y,style)=>({_class:'rectangle',do_objectID:id,name:id,frame:{x,y,width:160,height:60},style:{corners:{radii:[8]},...style}});
 return sketchFixture([
  rect('gradient',20,20,{fills:[{isEnabled:true,fillType:1,gradient:{gradientType:0,from:'{0, 0}',to:'{1, 0}',stops:[{position:0,color:color(1,0,0)},{position:1,color:color(0,0,1)}]}}]}),
  rect('multi',220,20,{fills:[solid(color(1,0,0)),solid(color(0,0,1,0.5))]}),
  rect('dash',20,120,{borders:[{...solid(color(0,0,0)),thickness:2,position:0}],borderOptions:{isEnabled:true,dashPattern:[6,4]}}),
  rect('shadow',220,120,{fills:[solid(color(1,1,1))],shadows:[{isEnabled:true,offsetX:4,offsetY:6,blurRadius:8,spread:2,color:color(0,0,0,0.4)}]}),
  rect('inside',20,220,{fills:[solid(color(1,1,1))],borders:[{...solid(color(0,0.5,0)),thickness:4,position:1}]}),
  rect('outside',220,220,{fills:[solid(color(1,1,1))],borders:[{...solid(color(0,0.5,0)),thickness:4,position:2}]}),
  {_class:'oval',do_objectID:'mask',name:'轮廓蒙版',frame:{x:420,y:20,width:60,height:60},hasClippingMask:true,clippingMaskMode:0,style:{}},
  {_class:'rectangle',do_objectID:'masked',name:'被裁剪图层',frame:{x:400,y:0,width:100,height:100},style:{fills:[solid(color(1,0,0))]}},
  {_class:'rectangle',do_objectID:'break-mask',name:'解除裁剪',shouldBreakMaskChain:true,frame:{x:520,y:20,width:60,height:60},style:{fills:[solid(color(0,0,1))]}}
 ]);
}
