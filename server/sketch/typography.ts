import {sketchColor} from './paints.js';
import type { PrototypeElement } from '../../shared/model.js';

// Keep Sketch text-box behaviour separate from the editor's generic text layout.
export function sketchTypography(layer: Record<string, any>, fontSize: number): NonNullable<PrototypeElement['typography']> {
  const attrs=layer.attributedString?.attributes?.[0]?.attributes || layer.style?.textStyle?.encodedAttributes || {};
  const font=attrs.MSAttributedStringFontAttribute?.attributes || {};
  const name=String(font.name || 'PingFangSC-Regular');
  const paragraph=attrs.paragraphStyle || {};
  const text=String(layer.attributedString?.string || '');
  const singleLine=!/[\r\n]/.test(text) && (layer.horizontalSizing===1 || layer.textBehaviour===0 || layer.frame.height <= fontSize*1.8);
  const fontFamily=/PingFang/i.test(name)?'"PingFang SC", Arial, "Microsoft YaHei", sans-serif':/SourceHan|NotoSans/i.test(name)?'"Source Han Sans CN", "Noto Sans CJK SC", Arial, "Microsoft YaHei", sans-serif':/MicrosoftYaHei/i.test(name)?'"Microsoft YaHei", Arial, sans-serif':/Helvetica/i.test(name)?'Helvetica, Arial, "Microsoft YaHei", sans-serif':'Arial, "Microsoft YaHei", sans-serif';
  const vertical=layer.style?.textStyle?.verticalAlignment ?? attrs.textStyleVerticalAlignmentKey ?? 0;
  const result:NonNullable<PrototypeElement['typography']> = {
    fontFamily, sourceFont:name, fontWeight:/semibold|demibold/i.test(name)?600:/bold|heavy/i.test(name)?700:/medium/i.test(name)?500:400,
    fontStyle:/italic|oblique/i.test(name)?'italic':'normal',
    align:paragraph.alignment===1?'right':paragraph.alignment===2?'center':'left',
    lineHeight:Math.max(fontSize,paragraph.maximumLineHeight || paragraph.minimumLineHeight || (singleLine ? layer.frame.height : fontSize*1.4)),
    letterSpacing:Number(attrs.kerning)||0, wrap:singleLine?'nowrap':'wrap',
    verticalAlign:vertical===1?'middle':vertical===2?'bottom':'top',
  };
  if(layer.attributedString?.attributes?.length>1){
    result.originalText=text;result.baseColor=sketchColor(attrs.MSAttributedStringColorAttribute);
    result.runs=layer.attributedString.attributes.map((run:any)=>{
      const merged={...attrs,...run.attributes,MSAttributedStringFontAttribute:{attributes:{...attrs.MSAttributedStringFontAttribute?.attributes,...run.attributes?.MSAttributedStringFontAttribute?.attributes}}};
      const info=sketchTypography({...layer,attributedString:{string:text,attributes:[{attributes:merged}]}},fontSize);
      return {start:run.location,length:run.length,fontFamily:info.fontFamily,fontWeight:info.fontWeight,fontStyle:info.fontStyle||'normal',fontScale:Math.max(12,merged.MSAttributedStringFontAttribute?.attributes?.size||fontSize)/fontSize,letterSpacing:info.letterSpacing||0,color:sketchColor(merged.MSAttributedStringColorAttribute),opacity:merged.MSAttributedStringColorAttribute?.alpha??1};
    });
  }
  return result;
}
