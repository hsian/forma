# 工程维护约定

依赖方向：页面 → 业务模块 → 接口适配 → 请求底层。通用展示组件不调用接口，utils 保持纯函数，配置不依赖页面。应用入口负责组合，各业务域只复用 shared，不相互引用内部实现。

先读 `capabilities.json`，再搜索已有代码，最后决定复用或新增。公共能力的用途、类型和示例应随实现更新；不要建立只有名称没有实现的能力清单。

## 文件归属

| 路径 | 维护方式 |
| --- | --- |
| src/pages/generated、.forma/snapshot.json、.forma/generated-files.json | Forma 生成；禁止手动修改，沿用哈希冲突保护 |
| .forma/runtime | 固定运行器；版本升级单独处理 |
| src/config、src/services/request.ts、scripts、package.json、环境配置 | 技术维护者维护；同步页面不覆盖 |
| src/services/业务域、src/modules/业务域 | 工具按需求生成并持续维护；技术人员修改后需先核对差异 |
| src/components、src/utils、src/modules/shared | 公共能力，优先复用；修改时检查所有调用方 |
| src/extensions | 手写/特殊页面扩展；Forma 同步不覆盖 |

当前页面生成器仅自动管理 generated 页面，不会根据此文档自动生成接口绑定或改写业务模块。工具对业务文件的修改需要检查差异，不能把整个 src 重新生成。现有项目不会因为新模板发布而被覆盖升级。

## 完成标准

运行 `npm run check` 检查分层与类型，再运行 `npm run build`。分层检查覆盖静态相对导入、导出、字面量动态导入和常见直接 fetch 调用，是维护约束，不是安全隔离器。

按需求验证：首次加载、空数据、加载失败重试、分页筛选、详情回显、表单校验、重复提交、保存失败保留表单、成功后刷新，以及权限错误。写操作不自动重试；审批/付款等操作由后端授权，并在测试环境验收。
