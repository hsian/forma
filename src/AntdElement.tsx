import { useState, type ReactNode } from 'react';
import { Affix, Alert, Anchor, App, AutoComplete, Avatar, Badge, Breadcrumb, Button, Calendar, Card, Carousel, Cascader, Checkbox, Col, Collapse, ColorPicker, ConfigProvider, DatePicker, Descriptions, Divider, Drawer, Dropdown, Empty, Flex, FloatButton, Form, Image, Input, InputNumber, Layout, List, Mentions, Menu, Modal, Pagination, Popconfirm, Popover, Progress, QRCode, Radio, Rate, Result, Row, Segmented, Skeleton, Slider, Space, Spin, Splitter, Statistic, Steps, Tag, Timeline, TimePicker, Tooltip, Tour, Transfer, TreeSelect, Typography, Upload, Watermark } from 'antd';
import { ArrowUpOutlined, BellOutlined, CheckCircleOutlined, FileOutlined, FolderOutlined, HeartOutlined, HomeOutlined, InfoCircleOutlined, PlusOutlined, SearchOutlined, SettingOutlined, StarOutlined, UploadOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { componentConfig, type ComponentItem } from '../shared/antd-catalog';
import type { PrototypeElement } from '../shared/model';
import type { RuntimeValue } from '../shared/runtime';
import './antd-components.css';
dayjs.extend(customParseFormat);

export const prototypeIcons: Record<string, ReactNode> = { StarOutlined: <StarOutlined/>, HeartOutlined: <HeartOutlined/>, UserOutlined: <UserOutlined/>, SearchOutlined: <SearchOutlined/>, SettingOutlined: <SettingOutlined/>, PlusOutlined: <PlusOutlined/>, CheckCircleOutlined: <CheckCircleOutlined/>, InfoCircleOutlined: <InfoCircleOutlined/>, HomeOutlined: <HomeOutlined/>, BellOutlined: <BellOutlined/>, FileOutlined: <FileOutlined/>, FolderOutlined: <FolderOutlined/> };
export interface AntdElementProps { element: PrototypeElement; preview?: boolean; value?: RuntimeValue; onChange?: (value: RuntimeValue) => void; activate?: (element: PrototypeElement) => void; notify?: (text: string) => void }
interface ChoiceNode { value: string; label: string; title: string; disabled?: boolean; children?: ChoiceNode[] }
export function AntdElement({ element: e, preview = false, value, onChange, activate, notify }: AntdElementProps) {
  const { message, notification } = App.useApp();
  const config = componentConfig(e.kind, e.component);
  const str = (key: string, fallback = '') => typeof config[key] === 'string' ? config[key] as string : fallback;
  const num = (key: string, fallback = 0) => typeof config[key] === 'number' ? config[key] as number : fallback;
  const bool = (key: string) => config[key] === true;
  const choice = <T extends string,>(key: string, fallback: T) => (str(key, fallback) || fallback) as T;
  const items = Array.isArray(config.items) ? config.items : [];
  const [local, setLocal] = useState<RuntimeValue>(() => str('value', typeof config.value === 'number' ? String(config.value) : ''));
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(num('current', 1));
  const live = value ?? local;
  const update = (next: RuntimeValue) => { setLocal(next); onChange?.(next); };
  const parsedNumber = Number(typeof live === 'string' && live !== '' ? live : num('value'));
  const numeric = Number.isFinite(parsedNumber) ? parsedNumber : num('value');
  const opts = items.map(item => ({ label: item.label, value: item.id, disabled: item.disabled }));
  const rows = (parentId?: string): ChoiceNode[] => items.filter(item => item.parentId === parentId).map(item => ({ value: item.id, label: item.label, title: item.label, disabled: item.disabled, ...(items.some(child => child.parentId === item.id) ? { children: rows(item.id) } : {}) }));
  const pathOf = (id: string): string[] => { const path: string[] = []; let item: ComponentItem | undefined = items.find(option => option.id === id); while (item && !path.includes(item.id)) { path.unshift(item.id); item = items.find(option => option.id === item?.parentId); } return path; };
  const input = { disabled: bool('disabled'), allowClear: bool('allowClear'), placeholder: e.text, 'aria-label': e.name, style: { width: '100%', height: '100%' } };
  const action = () => { if (preview && e.action !== 'none') activate?.(e); };
  const trigger = (label = e.text, click = action) => <Button style={{ width: '100%', height: '100%' }} disabled={bool('disabled')} onClick={event => { event.stopPropagation(); click(); }}>{label}</Button>;
  const blocks = items.map(item => <div key={item.id} className="prototype-layout-block">{item.label}</div>);
  const date = (value: string) => { const parsed = dayjs(value); return value && parsed.isValid() ? parsed : null; };
  const time = (value: string) => { const parsed = dayjs(value, 'HH:mm:ss', true); return value && parsed.isValid() ? parsed : null; };
  const timeKind = e.kind === 'timePicker' || e.kind === 'timeRangePicker';
  const content = str('content', e.text);
  const notificationType = choice<'info' | 'success' | 'warning' | 'error'>('status', 'info');
  const inputSize = choice<'small' | 'middle' | 'large'>('size', 'middle');
  let node: ReactNode;
  switch (e.kind) {
    case 'icon': node = <span className={bool('spin') ? 'prototype-icon-spin' : ''} style={{ fontSize: Math.max(12, Math.min(e.width, e.height) * .8) }}>{prototypeIcons[str('icon')] || <StarOutlined/>}</span>; break;
    case 'floatButton': case 'backTop': node = <FloatButton type={choice('type', 'primary')} shape={choice('shape', 'circle')} icon={e.kind === 'backTop' ? <ArrowUpOutlined/> : <PlusOutlined/>} tooltip={str('tooltip')} style={{ position: 'absolute', inset: 0, width: e.width, height: e.height }} onClick={() => { if (e.kind === 'backTop') document.querySelector('.preview-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }); else { action(); if (preview && e.action === 'none') void message.info(str('tooltip', e.text)); } }}/>; break;
    case 'typography': {
      const props = { style: { margin: 0, fontSize: e.fontSize, color: e.color }, strong: bool('strong'), italic: bool('italic'), underline: bool('underline'), copyable: bool('copyable') };
      node = str('variant') === 'title' ? <Typography.Title {...props}>{e.text}</Typography.Title> : str('variant') === 'link' ? <Typography.Link {...props} onClick={action}>{e.text}</Typography.Link> : str('variant') === 'text' ? <Typography.Text {...props}>{e.text}</Typography.Text> : <Typography.Paragraph {...props}>{e.text}</Typography.Paragraph>; break;
    }
    case 'divider': node = <Divider dashed={bool('dashed')} orientation={choice('orientation', 'center')} style={{ margin: 0, color: e.color, borderColor: e.stroke }}>{e.text}</Divider>; break;
    case 'flex': node = <Flex style={{ height: '100%' }} gap={num('gap', 12)} vertical={bool('vertical')} justify={str('justify', 'flex-start')} align={str('align', 'stretch')}>{blocks}</Flex>; break;
    case 'grid': node = <Row gutter={[num('gutter', 12), num('gutter', 12)]}>{items.map(item => <Col key={item.id} span={24 / num('columns', 3)}><div className="prototype-layout-block">{item.label}</div></Col>)}</Row>; break;
    case 'layout': node = <Layout style={{ height: '100%' }}><Layout.Header className="prototype-layout-header">{str('header')}</Layout.Header><Layout>{bool('showSider') && <Layout.Sider width="25%" className="prototype-layout-sider">{str('sider')}</Layout.Sider>}<Layout.Content className="prototype-layout-content">{content}</Layout.Content></Layout><Layout.Footer className="prototype-layout-footer">{str('footer')}</Layout.Footer></Layout>; break;
    case 'space': node = <Space direction={choice('direction', 'horizontal')} size={num('gap', 12)} wrap>{blocks}</Space>; break;
    case 'splitter': node = <Splitter layout={choice('direction', 'horizontal')} style={{ height: '100%' }}><Splitter.Panel defaultSize="50%" min="10%"><div className="prototype-layout-block">{str('first')}</div></Splitter.Panel><Splitter.Panel min="10%"><div className="prototype-layout-block">{str('second')}</div></Splitter.Panel></Splitter>; break;
    case 'anchor': node = <Anchor affix={false} direction={choice('direction', 'vertical')} onClick={event => event.preventDefault()} items={items.map(item => ({ key: item.id, title: item.label, href: `#prototype-${e.id}-${item.id}` }))}/>; break;
    case 'breadcrumb': node = <Breadcrumb separator={str('separator', '/')} items={items.map(item => ({ title: item.label }))}/>; break;
    case 'dropdown': node = <Dropdown disabled={bool('disabled')} placement={choice('placement', 'bottomLeft')} trigger={['click']} menu={{ items: items.map(item => ({ key: item.id, label: item.label, disabled: item.disabled })), onClick: item => { update(item.key); if (preview) notify?.(items.find(i => i.id === item.key)?.label || ''); action(); } }}>{trigger(e.text, () => {})}</Dropdown>; break;
    case 'menu': node = <Menu mode={choice('mode', 'inline')} theme={choice('theme', 'light')} disabled={bool('disabled')} selectedKeys={[String(live || items[0]?.id || '')]} items={items.map(item => ({ key: item.id, label: item.label, disabled: item.disabled }))} onClick={item => { update(item.key); action(); }}/>; break;
    case 'pagination': node = <Pagination current={current} total={num('total', 100)} defaultPageSize={num('pageSize', 10)} showSizeChanger={bool('showSizeChanger')} simple={bool('simple')} disabled={bool('disabled')} onChange={page => { setCurrent(page); update(String(page)); }}/>; break;
    case 'steps': node = <Steps current={current} direction={choice('direction', 'horizontal')} status={choice('status', 'process')} items={items.map(item => ({ title: item.label, description: item.description }))} onChange={index => { setCurrent(index); update(String(index)); }}/>; break;
    case 'autoComplete': node = <AutoComplete {...input} value={String(live)} options={items.map(item => ({ value: item.label }))} filterOption={(text, option) => String(option?.value).toLowerCase().includes(text.toLowerCase())} onChange={update}/>; break;
    case 'cascader': {
      const multiple = bool('multiple');
      node = multiple ? <Cascader {...input} options={rows()} multiple value={Array.isArray(live) ? live.map(pathOf) : []} onChange={next => update(next.map(path => String(path.at(-1))))}/> : <Cascader {...input} options={rows()} value={pathOf(String(live))} onChange={next => update(String(next.at(-1) || ''))}/>; break;
    }
    case 'checkboxSingle': node = <Checkbox aria-label={e.name} checked={live ? live === 'true' : bool('checked')} disabled={bool('disabled')} onChange={event => update(String(event.target.checked))}>{e.text}</Checkbox>; break;
    case 'colorPicker': node = <ColorPicker value={typeof live === 'string' && live ? live : str('value', '#635bff')} showText={bool('showText')} disabled={bool('disabled')} onChange={color => update(color.toHexString())}/>; break;
    case 'datePicker': case 'timePicker': {
      const shared = { ...input, format: str('format', timeKind ? 'HH:mm:ss' : 'YYYY-MM-DD'), value: (timeKind ? time : date)(String(live)), onChange: (next: dayjs.Dayjs | null) => update(next ? next.format(timeKind ? 'HH:mm:ss' : 'YYYY-MM-DDTHH:mm:ss') : '') };
      node = timeKind ? <TimePicker {...shared}/> : <DatePicker {...shared} picker={choice('picker', 'date')} showTime={bool('showTime')}/>; break;
    }
    case 'rangePicker': case 'timeRangePicker': {
      const range = Array.isArray(live) ? live : [str('start'), str('end')];
      const shared = { style: input.style, disabled: input.disabled, 'aria-label': e.name, format: str('format', timeKind ? 'HH:mm:ss' : 'YYYY-MM-DD'), value: range.map(timeKind ? time : date) as [dayjs.Dayjs | null, dayjs.Dayjs | null], onChange: (next: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null) => update(next ? next.map(value => value?.format(timeKind ? 'HH:mm:ss' : 'YYYY-MM-DDTHH:mm:ss') || '') : []) };
      node = timeKind ? <TimePicker.RangePicker {...shared}/> : <DatePicker.RangePicker {...shared} showTime={bool('showTime')}/>; break;
    }
    case 'form': node = <Form layout={choice('layout', 'vertical')} disabled={bool('disabled')} onFinish={() => { if (preview) void message.success('模拟表单提交成功'); action(); }}>{items.map(item => <Form.Item key={item.id} label={item.label} name={item.id} rules={[{ required: bool('required'), message: `请输入${item.label}` }]}><Input placeholder={item.description || `请输入${item.label}`}/></Form.Item>)}<Button type="primary" htmlType="submit">{str('submitText', '提交')}</Button></Form>; break;
    case 'textArea': node = <Input.TextArea {...input} value={String(live)} maxLength={num('maxLength', 500)} showCount={bool('showCount')} onChange={event => update(event.target.value)}/>; break;
    case 'inputSearch': node = <Input.Search {...input} size={inputSize} value={String(live)} enterButton={str('enterButton') || undefined} onChange={event => update(event.target.value)} onSearch={text => { action(); if (preview && e.action === 'none') notify?.(text ? `搜索：${text}` : '请输入搜索内容'); }}/>; break;
    case 'inputPassword': node = <Input.Password {...input} size={inputSize} value={String(live)} visibilityToggle={bool('visibilityToggle')} onChange={event => update(event.target.value)}/>; break;
    case 'inputOtp': node = <Input.OTP aria-label={e.name} disabled={bool('disabled')} length={num('length', 6)} mask={bool('mask')} size={inputSize} value={String(live)} onChange={update}/>; break;
    case 'inputNumber': node = <InputNumber {...input} size={inputSize} value={live === '' ? null : numeric} min={num('min', 0)} max={num('max', 100)} step={num('step', 1)} onChange={next => update(next === null ? '' : String(next))}/>; break;
    case 'mentions': node = <Mentions {...input} value={String(live)} prefix={str('prefix', '@')} options={items.map(item => ({ value: item.label, label: item.label }))} onChange={update}/>; break;
    case 'radio': node = <Radio.Group aria-label={e.name} value={live} optionType={choice('optionType', 'default')} options={opts} disabled={bool('disabled')} onChange={event => update(String(event.target.value))}/>; break;
    case 'rate': node = <Rate value={numeric} count={num('count', 5)} allowHalf={bool('allowHalf')} disabled={bool('disabled')} onChange={next => update(String(next))}/>; break;
    case 'slider': node = <Slider aria-label={e.name} value={numeric} min={num('min')} max={num('max', 100)} step={num('step', 1)} disabled={bool('disabled')} onChange={next => update(String(next))}/>; break;
    case 'transfer': node = <Transfer dataSource={items.map(item => ({ key: item.id, title: item.label, description: item.description, disabled: item.disabled }))} targetKeys={Array.isArray(live) ? live : []} render={item => item.title} showSearch={bool('showSearch')} disabled={bool('disabled')} onChange={keys => update(keys.map(String))} listStyle={{ width: 'calc(50% - 24px)', height: e.height - 4 }}/>; break;
    case 'treeSelect': node = <TreeSelect {...input} treeData={rows()} treeDefaultExpandAll multiple={bool('multiple')} value={live || undefined} onChange={next => update(next || (bool('multiple') ? [] : ''))}/>; break;
    case 'upload': node = <div><Upload name={e.id} disabled={bool('disabled')} multiple={bool('multiple')} maxCount={num('maxCount', 5)} listType={choice('listType', 'text')} beforeUpload={() => false}><Button disabled={bool('disabled')} icon={<UploadOutlined/>}>{e.text}</Button></Upload><p className="prototype-upload-note">仅演示文件列表，文件不会上传</p></div>; break;
    case 'avatar': node = <Avatar size={Math.min(e.width, e.height)} shape={choice('shape', 'circle')} src={safeImage(str('src')) || undefined} style={{ background: e.fill === '#ffffff' ? '#edeaff' : e.fill, color: e.color }}>{str('content', e.text)}</Avatar>; break;
    case 'badge': node = <Badge count={num('count', 5)} dot={bool('dot')} showZero={bool('showZero')}><div className="prototype-badge-target">{e.text}</div></Badge>; break;
    case 'calendar': node = <Calendar value={date(String(live)) || date(str('value')) || undefined} fullscreen={bool('fullscreen')} onChange={next => update(next.format('YYYY-MM-DD'))}/>; break;
    case 'card': node = <Card title={str('title')} extra={str('extra')} hoverable={bool('hoverable')} loading={bool('loading')} style={{ height: '100%', background: e.fill, color: e.color }}>{content}</Card>; break;
    case 'carousel': node = <Carousel autoplay={preview && bool('autoplay')} effect={choice('effect', 'scrollx')} arrows={bool('arrows')}>{items.map(item => <div key={item.id}><div className="prototype-carousel-slide" style={{ height: e.height }}>{item.label}<p>{item.description}</p></div></div>)}</Carousel>; break;
    case 'collapse': node = <Collapse accordion={bool('accordion')} ghost={bool('ghost')} defaultActiveKey={items[0]?.id ? [items[0].id] : []} items={items.map(item => ({ key: item.id, label: item.label, children: item.description || '面板内容' }))}/>; break;
    case 'descriptions': node = <Descriptions title={str('title')} bordered={bool('bordered')} column={num('column', 2)} items={items.map(item => ({ key: item.id, label: item.label, children: item.description || '—' }))}/>; break;
    case 'empty': node = <Empty description={str('description', e.text)}/>; break;
    case 'image': node = <Image width="100%" height="100%" src={safeImage(str('src')) || placeholderImage} fallback={placeholderImage} preview={preview && bool('preview')} alt={e.text} style={{ objectFit: 'cover' }}/>; break;
    case 'list': node = <List size={choice('size', 'default')} bordered={bool('bordered')} header={str('header') || undefined} dataSource={items} renderItem={item => <List.Item><List.Item.Meta title={item.label} description={item.description}/></List.Item>}/>; break;
    case 'popover': node = <Popover title={str('title')} content={content} placement={choice('placement', 'top')} trigger="click">{trigger()}</Popover>; break;
    case 'qrCode': node = <QRCode type="svg" value={str('value', 'Forma') || 'Forma'} size={Math.max(40, Math.min(e.width, e.height))} errorLevel={choice('errorLevel', 'M')} status={choice('status', 'active')}/>; break;
    case 'segmented': node = <Segmented aria-label={e.name} options={opts} value={live} block={bool('block')} disabled={bool('disabled')} onChange={next => update(String(next))}/>; break;
    case 'statistic': node = <Statistic title={str('title', e.text)} value={num('value')} precision={num('precision')} prefix={str('prefix')} suffix={str('suffix')} valueStyle={{ color: e.color }}/>; break;
    case 'tag': node = <Tag color={str('color', 'blue')} closable={bool('closable')} style={{ fontSize: e.fontSize, padding: '4px 10px' }}>{e.text}</Tag>; break;
    case 'timeline': node = <Timeline mode={choice('mode', 'left')} reverse={bool('reverse')} items={items.map(item => ({ children: <>{item.label}{item.description && <p>{item.description}</p>}</> }))}/>; break;
    case 'tooltip': node = <Tooltip title={str('title', e.text)} placement={choice('placement', 'top')}>{trigger()}</Tooltip>; break;
    case 'tour': node = <>{trigger(e.text, () => setOpen(true))}{preview && <Tour open={open} onClose={() => setOpen(false)} steps={items.map(item => ({ title: item.label, description: item.description }))}/>}</>; break;
    case 'alert': node = <Alert message={e.text} description={str('description')} type={notificationType} showIcon={bool('showIcon')} closable={bool('closable')}/>; break;
    case 'drawer': node = preview ? <>{trigger(e.text, () => setOpen(true))}<Drawer title={str('title')} placement={choice('placement', 'right')} open={open} onClose={() => setOpen(false)}>{content}</Drawer></> : <Drawer title={str('title')} placement={choice('placement', 'right')} open getContainer={false} mask={false} keyboard={false} autoFocus={false} push={false} rootStyle={{ position: 'absolute', inset: 0 }} width="100%" height="100%">{content}</Drawer>; break;
    case 'modal': node = preview ? <>{trigger(e.text, () => setOpen(true))}<Modal title={str('title')} open={open} okText={str('okText', '确定')} cancelText={str('cancelText', '取消')} onOk={() => { setOpen(false); action(); }} onCancel={() => setOpen(false)}>{content}</Modal></> : <Modal rootClassName="prototype-inline-modal" open getContainer={false} mask={false} keyboard={false} focusTriggerAfterClose={false} title={str('title')} width="100%" okText={str('okText', '确定')} cancelText={str('cancelText', '取消')} styles={{ wrapper: { position: 'absolute', inset: 0, overflow: 'hidden' } }} style={{ top: 0, margin: 0, paddingBottom: 0, maxWidth: '100%' }}>{content}</Modal>; break;
    case 'message': node = trigger(e.text, () => { if (preview) { void message.open({ type: notificationType, content, duration: num('duration', 3) }); action(); } }); break;
    case 'notification': node = trigger(e.text, () => { if (preview) { notification.open({ type: notificationType, message: str('title'), description: content, placement: choice('placement', 'topRight') }); action(); } }); break;
    case 'popconfirm': node = <Popconfirm title={str('title')} description={content} okText={str('okText', '确定')} cancelText={str('cancelText', '取消')} onConfirm={() => { if (e.action !== 'none') action(); else if (preview) void message.success('已确认（原型演示）'); }}>{trigger(e.text, () => {})}</Popconfirm>; break;
    case 'progress': node = <Progress percent={num('percent', 65)} type={choice('type', 'line')} status={choice('status', 'normal')} showInfo={bool('showInfo')} size={str('type', 'line') === 'line' ? undefined : Math.min(e.width, e.height)}/>; break;
    case 'result': node = <Result title={str('title', e.text)} subTitle={content} status={choice('status', 'success')}/>; break;
    case 'skeleton': node = <Skeleton active={bool('active')} avatar={bool('avatar')} paragraph={{ rows: num('rows', 3) }}/>; break;
    case 'spin': node = <Spin spinning size={choice('size', 'default')} tip={str('tip')}><div style={{ height: e.height, width: '100%' }}/></Spin>; break;
    case 'watermark': node = <Watermark content={content} rotate={num('rotate', -22)}><div style={{ height: e.height, background: e.fill }}/></Watermark>; break;
    case 'affix': node = <div className="prototype-affix-scroll"><div style={{ minHeight: 200 }}><Affix offsetTop={num('offsetTop')} target={() => document.querySelector<HTMLElement>(`[data-component-scroll="${e.id}"] .prototype-affix-scroll`) || window}>{trigger()}</Affix></div></div>; break;
    default: node = <Empty description="组件暂不可用"/>;
  }
  return <ConfigProvider theme={{ token: { fontSize: Math.max(12, e.fontSize), borderRadius: e.radius } }}><div className={`prototype-antd-component prototype-${e.kind} ${preview ? 'is-preview' : 'is-editor'}`} data-component-kind={e.kind} data-component-scroll={e.id} style={{ width: '100%', height: '100%', color: e.color, fontSize: Math.max(12, e.fontSize) }}>{node}</div></ConfigProvider>;
}

// Only image schemes; no javascript URLs or executable markup.
function safeImage(value: string) { return /^(https?:\/\/|data:image\/(png|jpeg|gif|webp|svg\+xml);|blob:|\/)/i.test(value) && !value.startsWith('//') ? value : ''; }
const placeholderImage = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#f0edff"/><path d="M230 260l65-80 45 50 40-35 65 65z" fill="#c3baff"/><circle cx="400" cy="130" r="24" fill="#c3baff"/><text x="320" y="325" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#8578b9">Image</text></svg>');
