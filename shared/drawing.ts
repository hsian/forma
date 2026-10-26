export type DrawingPaint = { kind:'solid';color:string;opacity:number } | {kind:'linear'|'radial';from:[number,number];to:[number,number];stops:{offset:number;color:string;opacity:number}[];opacity:number};
export interface DrawingStyle {
  baseFill?:string; baseStroke?:string; baseStrokeWidth?:number;
  fills:DrawingPaint[];
  strokes:{paint:DrawingPaint;width:number;position:'center'|'inside'|'outside';dash:number[];cap:'butt'|'round'|'square';join:'miter'|'round'|'bevel'}[];
  shadows:{x:number;y:number;blur:number;spread:number;color:string;opacity:number}[];
}
export interface ImportIssue { code:string;severity:'warning'|'error';message:string;layerId:string;layerName:string }
export interface SketchImportReport { pageName:string;boardName:string;elements:number;skippedOutside:number;skippedHidden:number;warnings:{message:string;count:number}[];issues:ImportIssue[];converterVersion:string;sourceVersion:string }
export const SKETCH_CONVERTER_VERSION='2.0.0';
