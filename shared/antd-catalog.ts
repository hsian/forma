// Serializable component metadata shared by the palette, inspector, validator and AI.
// App/ConfigProvider/Grid hooks are infrastructure; Grid is represented with Row/Col.
export interface ComponentItem { id: string; label: string; description?: string; parentId?: string; disabled?: boolean }
export type ComponentValue = string | number | boolean | ComponentItem[];
export type ComponentConfig = Record<string, ComponentValue>;
export interface ComponentField {
  key: string; label: string; type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'option' | 'items' | 'color';
  options?: { value: string; label: string }[]; min?: number; max?: number;
}
export interface ComponentDefinition {
  label: string; component: string; group: string; size: [number, number];
  defaults: ComponentConfig; fields: ComponentField[];
}
const text = (key: string, label: string): ComponentField => ({ key, label, type: 'text' });
const area = (key = 'content', label = '内容'): ComponentField => ({ key, label, type: 'textarea' });
const flag = (key: string, label: string): ComponentField => ({ key, label, type: 'boolean' });
const number = (key: string, label: string, min = 0, max = 10000): ComponentField => ({ key, label, type: 'number', min, max });
const select = (key: string, label: string, values: string[]): ComponentField => ({ key, label, type: 'select', options: values.map(value => ({ value, label: value })) });
const items: ComponentField = { key: 'items', label: '条目', type: 'items' };
const disabled = flag('disabled', '禁用');
const size = select('size', '控件大小', ['small', 'middle', 'large']);
const status = select('status', '状态', ['success', 'info', 'warning', 'error']);
const direction = select('direction', '方向', ['horizontal', 'vertical']);
const options: ComponentItem[] = [{ id: 'one', label: '选项一', description: '第一项的说明' }, { id: 'two', label: '选项二', description: '第二项的说明' }, { id: 'three', label: '选项三', description: '第三项的说明' }];
function define(label: string, component: string, group: string, size: [number, number], defaults: ComponentConfig = {}, fields: ComponentField[] = []): ComponentDefinition {
  return { label, component, group, size, defaults, fields };
}
const list = { items: options };
const inputFields = [disabled, flag('allowClear', '允许清除'), size];
const numericFields = [number('value', '默认值', -100000, 100000), number('min', '最小值', -100000, 100000), number('max', '最大值', -100000, 100000), disabled];
export const antdCatalog = {
  button: define('按钮', 'Button', '通用', [120, 36], { type: 'default', disabled: false, loading: false }, [select('type', '按钮类型', ['default', 'primary', 'dashed', 'text', 'link']), disabled, flag('loading', '加载中'), flag('danger', '危险按钮'), size]),
  floatButton: define('悬浮按钮', 'FloatButton', '通用', [48, 48], { type: 'primary', tooltip: '快捷操作' }, [select('type', '按钮类型', ['default', 'primary']), text('tooltip', '悬浮提示'), select('shape', '形状', ['circle', 'square'])]),
  icon: define('图标', 'Icon', '通用', [40, 40], { icon: 'StarOutlined' }, [select('icon', '图标', ['StarOutlined', 'HeartOutlined', 'UserOutlined', 'SearchOutlined', 'SettingOutlined', 'PlusOutlined', 'CheckCircleOutlined', 'InfoCircleOutlined', 'HomeOutlined', 'BellOutlined', 'FileOutlined', 'FolderOutlined']), flag('spin', '旋转')]),
  typography: define('排版', 'Typography', '通用', [320, 96], { variant: 'paragraph', copyable: false }, [select('variant', '文字类型', ['title', 'paragraph', 'text', 'link']), flag('copyable', '允许复制'), flag('strong', '加粗'), flag('italic', '斜体'), flag('underline', '下划线')]),
  divider: define('分割线', 'Divider', '布局', [320, 40], { dashed: false, orientation: 'center' }, [flag('dashed', '虚线'), select('orientation', '文字位置', ['left', 'center', 'right'])]),
  flex: define('弹性布局', 'Flex', '布局', [420, 120], { ...list, gap: 12, vertical: false }, [items, number('gap', '间距', 0, 100), flag('vertical', '纵向排列'), select('justify', '主轴对齐', ['flex-start', 'center', 'flex-end', 'space-between', 'space-around']), select('align', '交叉轴对齐', ['stretch', 'flex-start', 'center', 'flex-end'])]),
  grid: define('栅格', 'Grid', '布局', [480, 160], { ...list, gutter: 12, columns: 3 }, [items, number('columns', '列数', 1, 12), number('gutter', '栅格间隔', 0, 100)]),
  layout: define('布局', 'Layout', '布局', [480, 300], { header: '顶部导航', sider: '侧边导航', content: '内容区域', footer: '页脚', showSider: true }, [text('header', '顶部内容'), text('sider', '侧栏内容'), area(), text('footer', '页脚内容'), flag('showSider', '显示侧栏')]),
  space: define('间距', 'Space', '布局', [360, 100], { ...list, direction: 'horizontal', gap: 12 }, [items, direction, number('gap', '间距', 0, 100)]),
  splitter: define('分隔面板', 'Splitter', '布局', [460, 220], { first: '面板一', second: '面板二', direction: 'horizontal' }, [text('first', '面板一'), text('second', '面板二'), direction]),
  anchor: define('锚点', 'Anchor', '导航', [200, 150], list, [items, direction]),
  breadcrumb: define('面包屑', 'Breadcrumb', '导航', [360, 32], { ...list, separator: '/' }, [items, text('separator', '分隔符')]),
  dropdown: define('下拉菜单', 'Dropdown', '导航', [150, 36], list, [items, disabled, select('placement', '菜单位置', ['bottomLeft', 'bottomRight', 'topLeft', 'topRight'])]),
  menu: define('导航菜单', 'Menu', '导航', [240, 180], { ...list, mode: 'inline', theme: 'light' }, [items, select('mode', '菜单模式', ['inline', 'vertical', 'horizontal']), select('theme', '主题', ['light', 'dark']), disabled]),
  pagination: define('分页', 'Pagination', '导航', [440, 40], { total: 100, pageSize: 10, current: 1, showSizeChanger: true }, [number('total', '总条数'), number('pageSize', '每页条数', 1, 1000), number('current', '默认页码', 1), flag('showSizeChanger', '切换每页条数'), flag('simple', '简洁模式'), disabled]),
  steps: define('步骤条', 'Steps', '导航', [480, 80], { ...list, current: 1, direction: 'horizontal' }, [items, number('current', '当前步骤（从 0 起）', 0, 99), direction, select('status', '状态', ['wait', 'process', 'finish', 'error'])]),
  tabs: define('页签', 'Tabs', '导航', [480, 48], { type: 'line', tabPosition: 'top' }, [select('type', '页签类型', ['line', 'card']), select('tabPosition', '页签位置', ['top', 'bottom', 'left', 'right'])]),
  autoComplete: define('自动完成', 'AutoComplete', '数据录入', [240, 36], { ...list, disabled: false, allowClear: true }, [items, ...inputFields]),
  cascader: define('级联选择', 'Cascader', '数据录入', [260, 36], { items: [{ id: 'zhejiang', label: '浙江' }, { id: 'hangzhou', label: '杭州', parentId: 'zhejiang' }, { id: 'jiangsu', label: '江苏' }, { id: 'nanjing', label: '南京', parentId: 'jiangsu' }], allowClear: true }, [items, disabled, flag('multiple', '多选'), flag('allowClear', '允许清除')]),
  checkbox: define('复选框组', 'Checkbox.Group', '数据录入', [440, 120]),
  checkboxSingle: define('复选框', 'Checkbox', '数据录入', [180, 32], { checked: false }, [flag('checked', '默认勾选'), disabled]),
  colorPicker: define('颜色选择器', 'ColorPicker', '数据录入', [180, 36], { value: '#635bff', showText: true }, [{ key: 'value', label: '默认颜色', type: 'color' }, flag('showText', '显示色值'), disabled]),
  datePicker: define('日期选择器', 'DatePicker', '数据录入', [240, 36], { value: '', picker: 'date', format: 'YYYY-MM-DD', allowClear: true }, [text('value', '默认日期（YYYY-MM-DD）'), select('picker', '选择类型', ['date', 'week', 'month', 'quarter', 'year']), text('format', '显示格式'), flag('showTime', '选择时间'), ...inputFields]),
  rangePicker: define('日期范围', 'DatePicker.RangePicker', '数据录入', [360, 36], { start: '', end: '', format: 'YYYY-MM-DD' }, [text('start', '开始日期（YYYY-MM-DD）'), text('end', '结束日期（YYYY-MM-DD）'), text('format', '显示格式'), flag('showTime', '选择时间'), disabled]),
  form: define('表单', 'Form', '数据录入', [360, 240], { ...list, layout: 'vertical', submitText: '提交', required: true }, [items, select('layout', '表单布局', ['vertical', 'horizontal', 'inline']), text('submitText', '提交按钮文字'), flag('required', '必填'), disabled]),
  input: define('输入框', 'Input', '数据录入', [240, 36], { allowClear: false }, inputFields),
  textArea: define('多行输入', 'Input.TextArea', '数据录入', [300, 110], { value: '', maxLength: 500, showCount: true }, [area('value', '默认内容'), number('maxLength', '最大长度', 1, 100000), flag('showCount', '显示字数'), disabled]),
  inputSearch: define('搜索框', 'Input.Search', '数据录入', [300, 36], { enterButton: '搜索' }, [text('enterButton', '搜索按钮文字'), ...inputFields]),
  inputPassword: define('密码输入', 'Input.Password', '数据录入', [240, 36], { visibilityToggle: true }, [flag('visibilityToggle', '显示密码切换'), ...inputFields]),
  inputOtp: define('验证码输入', 'Input.OTP', '数据录入', [260, 40], { length: 6, mask: false }, [number('length', '验证码长度', 1, 12), flag('mask', '隐藏字符'), disabled, size]),
  inputNumber: define('数字输入框', 'InputNumber', '数据录入', [180, 36], { value: 0, min: 0, max: 100, step: 1 }, [...numericFields, number('step', '步长', 0.01, 10000), size]),
  mentions: define('提及', 'Mentions', '数据录入', [300, 72], { ...list, prefix: '@' }, [items, text('prefix', '触发字符'), disabled]),
  radio: define('单选框组', 'Radio', '数据录入', [340, 40], { ...list, value: 'one', optionType: 'default' }, [items, { key: 'value', label: '默认选中项', type: 'option' }, select('optionType', '显示类型', ['default', 'button']), disabled]),
  rate: define('评分', 'Rate', '数据录入', [220, 40], { value: 3, count: 5, allowHalf: true }, [number('value', '默认评分', 0, 20), number('count', '星星数量', 1, 20), flag('allowHalf', '允许半星'), disabled]),
  select: define('Select 选择器', 'Select', '数据录入', [200, 36]),
  slider: define('滑动输入条', 'Slider', '数据录入', [300, 40], { value: 30, min: 0, max: 100, step: 1 }, [...numericFields, number('step', '步长', 0.01, 10000)]),
  switch: define('开关', 'Switch', '数据录入', [60, 32], { checked: true, checkedChildren: '', unCheckedChildren: '' }, [flag('checked', '默认开启'), text('checkedChildren', '开启文字'), text('unCheckedChildren', '关闭文字'), disabled, flag('loading', '加载中')]),
  timePicker: define('时间选择器', 'TimePicker', '数据录入', [200, 36], { value: '', format: 'HH:mm:ss' }, [text('value', '默认时间（HH:mm:ss）'), text('format', '显示格式'), disabled]),
  timeRangePicker: define('时间范围', 'TimePicker.RangePicker', '数据录入', [320, 36], { start: '', end: '', format: 'HH:mm:ss' }, [text('start', '开始时间（HH:mm:ss）'), text('end', '结束时间（HH:mm:ss）'), text('format', '显示格式'), disabled]),
  transfer: define('穿梭框', 'Transfer', '数据录入', [500, 260], { ...list, showSearch: true }, [items, flag('showSearch', '显示搜索'), disabled]),
  treeSelect: define('树选择', 'TreeSelect', '数据录入', [260, 36], { items: [{ id: 'team', label: '团队' }, { id: 'design', label: '设计组', parentId: 'team' }, { id: 'dev', label: '研发组', parentId: 'team' }], multiple: false, allowClear: true }, [items, flag('multiple', '多选'), disabled, flag('allowClear', '允许清除')]),
  upload: define('上传', 'Upload', '数据录入', [300, 150], { listType: 'text', multiple: false, maxCount: 5 }, [select('listType', '列表类型', ['text', 'picture', 'picture-card']), flag('multiple', '多文件'), number('maxCount', '最多文件数', 1, 100), disabled]),
  avatar: define('头像', 'Avatar', '数据展示', [64, 64], { shape: 'circle', content: '用' }, [select('shape', '形状', ['circle', 'square']), text('content', '头像文字'), text('src', '图片地址')]),
  badge: define('徽标', 'Badge', '数据展示', [100, 48], { count: 5, dot: false, showZero: false }, [number('count', '数量'), flag('dot', '圆点模式'), flag('showZero', '显示零')]),
  calendar: define('日历', 'Calendar', '数据展示', [380, 320], { value: '2026-10-01', fullscreen: false }, [text('value', '默认日期（YYYY-MM-DD）'), flag('fullscreen', '全屏日历')]),
  card: define('卡片', 'Card', '数据展示', [320, 220], { title: '卡片标题', content: '在这里填写卡片内容。', extra: '更多', hoverable: false }, [text('title', '卡片标题'), area(), text('extra', '右上角文字'), flag('hoverable', '悬浮效果'), flag('loading', '加载中')]),
  carousel: define('走马灯', 'Carousel', '数据展示', [420, 220], { ...list, autoplay: false, effect: 'scrollx' }, [items, flag('autoplay', '自动轮播'), select('effect', '切换效果', ['scrollx', 'fade']), flag('arrows', '显示箭头')]),
  collapse: define('折叠面板', 'Collapse', '数据展示', [360, 200], { ...list, accordion: false }, [items, flag('accordion', '手风琴模式'), flag('ghost', '透明背景')]),
  descriptions: define('描述列表', 'Descriptions', '数据展示', [440, 220], { ...list, title: '详细信息', column: 2, bordered: true }, [items, text('title', '标题'), number('column', '列数', 1, 4), flag('bordered', '显示边框')]),
  empty: define('空状态', 'Empty', '数据展示', [240, 170], { description: '暂无数据' }, [area('description', '提示内容')]),
  image: define('图片', 'Image', '数据展示', [320, 200], { src: '', preview: true }, [text('src', '图片地址'), flag('preview', '允许放大预览')]),
  list: define('列表', 'List', '数据展示', [360, 240], { ...list, bordered: true, header: '列表标题' }, [items, text('header', '标题'), flag('bordered', '显示边框'), select('size', '控件大小', ['small', 'default', 'large'])]),
  popover: define('气泡卡片', 'Popover', '数据展示', [160, 36], { title: '提示标题', content: '这里是气泡卡片内容。', placement: 'top' }, [text('title', '标题'), area(), select('placement', '显示位置', ['top', 'bottom', 'left', 'right'])]),
  qrCode: define('二维码', 'QRCode', '数据展示', [180, 180], { value: 'https://ant.design', errorLevel: 'M' }, [text('value', '二维码内容'), select('errorLevel', '容错级别', ['L', 'M', 'Q', 'H']), select('status', '状态', ['active', 'expired', 'loading', 'scanned'])]),
  segmented: define('分段控制器', 'Segmented', '数据展示', [320, 40], { ...list, value: 'one', block: true }, [items, { key: 'value', label: '默认选中项', type: 'option' }, flag('block', '撑满宽度'), disabled]),
  statistic: define('统计数值', 'Statistic', '数据展示', [220, 100], { title: '总计', value: 1280, precision: 0, prefix: '', suffix: '项' }, [text('title', '标题'), number('value', '数值', -100000000, 100000000), number('precision', '小数位数', 0, 6), text('prefix', '前缀'), text('suffix', '后缀')]),
  table: define('表格', 'Table', '数据展示', [700, 260]),
  tag: define('标签', 'Tag', '数据展示', [100, 32], { color: 'blue', closable: false }, [select('color', '标签颜色', ['default', 'blue', 'green', 'purple', 'red', 'orange', 'success', 'warning', 'error']), flag('closable', '允许关闭')]),
  timeline: define('时间轴', 'Timeline', '数据展示', [300, 220], { ...list, mode: 'left' }, [items, select('mode', '排列方式', ['left', 'right', 'alternate']), flag('reverse', '倒序')]),
  tooltip: define('文字提示', 'Tooltip', '数据展示', [160, 36], { title: '这是一条文字提示', placement: 'top' }, [text('title', '提示内容'), select('placement', '显示位置', ['top', 'bottom', 'left', 'right'])]),
  tour: define('漫游引导', 'Tour', '数据展示', [160, 36], list, [items]),
  tree: define('树', 'Tree', '数据展示', [220, 350]),
  alert: define('警告提示', 'Alert', '反馈', [380, 90], { status: 'info', description: '这里是详细说明。', showIcon: true, closable: false }, [status, area('description', '详细说明'), flag('showIcon', '显示图标'), flag('closable', '允许关闭')]),
  drawer: define('抽屉', 'Drawer', '反馈', [420, 320], { title: '抽屉标题', content: '在这里填写抽屉内容。', placement: 'right' }, [text('title', '抽屉标题'), area(), select('placement', '弹出方向', ['left', 'right', 'top', 'bottom'])]),
  message: define('全局提示', 'message', '反馈', [180, 36], { status: 'success', content: '操作成功', duration: 3 }, [status, area(), number('duration', '显示时长（秒）', 1, 30)]),
  modal: define('对话框', 'Modal', '反馈', [420, 260], { title: '对话框标题', content: '在这里填写对话框内容。', okText: '确定', cancelText: '取消' }, [text('title', '对话框标题'), area(), text('okText', '确认文字'), text('cancelText', '取消文字')]),
  notification: define('通知提醒', 'notification', '反馈', [180, 36], { title: '通知标题', content: '您有一条新的通知。', status: 'info', placement: 'topRight' }, [text('title', '通知标题'), area(), status, select('placement', '显示位置', ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'])]),
  popconfirm: define('气泡确认框', 'Popconfirm', '反馈', [180, 36], { title: '确认执行此操作？', content: '请确认后继续。', okText: '确定', cancelText: '取消' }, [text('title', '确认标题'), area(), text('okText', '确认文字'), text('cancelText', '取消文字')]),
  progress: define('进度条', 'Progress', '反馈', [280, 48], { percent: 65, type: 'line', status: 'normal', showInfo: true }, [number('percent', '进度（%）', 0, 100), select('type', '进度类型', ['line', 'circle', 'dashboard']), select('status', '状态', ['normal', 'success', 'exception', 'active']), flag('showInfo', '显示进度文字')]),
  result: define('结果', 'Result', '反馈', [420, 280], { title: '操作成功', content: '请继续下一步操作。', status: 'success' }, [text('title', '结果标题'), area(), select('status', '结果类型', ['success', 'error', 'info', 'warning', '403', '404', '500'])]),
  skeleton: define('骨架屏', 'Skeleton', '反馈', [360, 180], { active: true, avatar: true, rows: 3 }, [flag('active', '动画效果'), flag('avatar', '显示头像'), number('rows', '段落行数', 1, 10)]),
  spin: define('加载中', 'Spin', '反馈', [180, 100], { tip: '加载中…', size: 'default' }, [text('tip', '提示内容'), select('size', '大小', ['small', 'default', 'large'])]),
  watermark: define('水印', 'Watermark', '反馈', [360, 220], { content: '内部资料', rotate: -22 }, [text('content', '水印内容'), number('rotate', '旋转角度', -180, 180)]),
  affix: define('固钉', 'Affix', '其他', [200, 44], { offsetTop: 0 }, [number('offsetTop', '顶部偏移', 0, 500)]),
  backTop: define('回到顶部', 'BackTop', '其他', [48, 48], { tooltip: '回到顶部' }, [text('tooltip', '悬浮提示')]),
} satisfies Record<string, ComponentDefinition>;

export type AntdKind = keyof typeof antdCatalog;
export const antdKinds = Object.keys(antdCatalog) as AntdKind[];
export const componentGroups = ['通用', '布局', '导航', '数据录入', '数据展示', '反馈', '其他'];
export const getComponentDefinition = (kind: string): ComponentDefinition | undefined => (antdCatalog as Record<string, ComponentDefinition>)[kind];
export function componentDefaults(kind: string): ComponentConfig { return structuredClone(getComponentDefinition(kind)?.defaults || {}); }
export function componentConfig(kind: string, config?: ComponentConfig): ComponentConfig { return { ...getComponentDefinition(kind)?.defaults, ...config }; }

// Reject unsupported fields and unsafe/nonserializable values without evaluating code.
export function componentIssues(kind: string, config: ComponentConfig): { key: string; message: string }[] {
  const definition = getComponentDefinition(kind);
  const issues: { key: string; message: string }[] = [];
  for (const [key, value] of Object.entries(config)) {
    const field = definition?.fields.find(f => f.key === key);
    if (!field) { issues.push({ key, message: `不支持的组件属性：${key}` }); continue; }
    const valid = field.type === 'boolean' ? typeof value === 'boolean'
      : field.type === 'number' ? typeof value === 'number' && Number.isFinite(value) && value >= (field.min ?? -Infinity) && value <= (field.max ?? Infinity)
      : field.type === 'items' ? Array.isArray(value)
      : typeof value === 'string' && (field.type !== 'select' || !!field.options?.some(o => o.value === value)) && (field.type !== 'color' || /^#[\da-f]{6}$/i.test(value));
    if (!valid) issues.push({ key, message: `${field.label}的值不合法` });
    if (field.type === 'items' && Array.isArray(value)) {
      const ids = new Set(value.map(item => item.id));
      if (ids.size !== value.length) issues.push({ key, message: '条目 ID 必须唯一' });
      for (const item of value) {
        const seen = new Set([item.id]); let parent = item.parentId;
        while (parent) {
          if (seen.has(parent) || !ids.has(parent)) { issues.push({ key, message: '条目上级不存在或形成循环' }); break; }
          seen.add(parent); parent = value.find(other => other.id === parent)?.parentId;
        }
      }
    }
  }
  const effective = componentConfig(kind, config);
  for (const field of definition?.fields || []) if (field.type === 'option' && effective[field.key] && !(Array.isArray(effective.items) && effective.items.some(item => item.id === effective[field.key]))) issues.push({ key: field.key, message: '默认选中项不存在' });
  if (typeof effective.min === 'number' && typeof effective.max === 'number' && effective.min > effective.max) issues.push({ key: 'max', message: '最大值不能小于最小值' });
  return issues;
}
