import {Alert,Button} from 'antd';
import type {SketchImportReport} from '../shared/drawing';
export function ImportReport({report}:{report:SketchImportReport}) {
  const errors=report.issues.filter(i=>i.severity==='error');
  return <div className="sketch-import-report">
    <Alert showIcon type={errors.length?'error':report.issues.length?'warning':'success'} message={errors.length?`有 ${errors.length} 项错误，尚不能生成页面`:report.issues.length?`有 ${report.issues.length} 项需要注意的外观差异`:'未检测到已知的不支持项'} description={`可生成 ${report.elements} 个元素。隐藏图层 ${report.skippedHidden} 个，画板外图层 ${report.skippedOutside} 个。`}/>
    {!!report.issues.length && <details style={{marginTop:12}}><summary style={{cursor:'pointer'}}>查看具体图层和处理说明</summary><ul style={{maxHeight:220,overflow:'auto',paddingLeft:20}}>{report.issues.slice(0,200).map((issue,i)=><li key={i} style={{marginBottom:8}}><strong>{issue.layerName}</strong><br/>{issue.message}</li>)}</ul>{report.issues.length>200&&<p>仅显示前 200 项，可下载完整报告。</p>}</details>}
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:8,fontSize:12,color:'#858b9c'}}><span>Sketch {report.sourceVersion} · 转换器 {report.converterVersion}</span><Button size="small" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='sketch-import-report.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>下载报告</Button></div>
  </div>;
}
