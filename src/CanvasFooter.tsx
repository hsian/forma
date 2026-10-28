import { Select, Tooltip } from 'antd';
import { AimOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';

type Props = {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  minZoom?: number;
  maxZoom?: number;
  zoomOptions?: number[];
  labels?: { zoom: string; out: string; in: string; fit: string };
};

export function CanvasFooter({ zoom, onZoomChange, onZoomIn, onZoomOut, onFit, minZoom = .1, maxZoom = 2,
  zoomOptions = [25, 50, 75, 80, 100, 125, 150, 200],
  labels = { zoom: '画布缩放', out: '缩小', in: '放大', fit: '适应画布' } }: Props) {
  const percent = Math.round(zoom * 100);
  return <div className="canvas-bottom">
    <span>滚轮缩放 <span className="shortcut-key">Space</span> 平移画布 <span className="shortcut-key">Shift</span> 多选 <span className="shortcut-key">Ctrl+~</span> 唤起 AI</span>
    <div className="zoom-controls">
      <Tooltip title={labels.out}><button className="tool" aria-label={labels.out} disabled={zoom <= minZoom} onClick={onZoomOut}><MinusOutlined/></button></Tooltip>
      <Select aria-label={labels.zoom} value={percent} onChange={value => onZoomChange(value / 100)} options={[...new Set([...zoomOptions, percent])].sort((a, b) => a - b).map(value => ({ value, label: `${value}%` }))} variant="borderless" size="small"/>
      <Tooltip title={labels.in}><button className="tool" aria-label={labels.in} disabled={zoom >= maxZoom} onClick={onZoomIn}><PlusOutlined/></button></Tooltip>
      <span className="tool-divider"/>
      <Tooltip title={labels.fit}><button className="tool" aria-label={labels.fit} onClick={onFit}><AimOutlined/></button></Tooltip>
    </div>
  </div>;
}
