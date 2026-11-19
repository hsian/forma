# 接口适配示例

以下是结构示例，字段和成功规则必须核对实际文档，不会自动注册为业务接口。

```ts
// src/services/customer/list.ts
import { BusinessError, defineEndpoint } from '../endpoint';

interface Customer { id: string; name: string }
interface Input { keyword: string; page: number; pageSize: number }
interface Response { ok: boolean; message?: string; result?: { rows: Customer[]; count: number } }

export const listCustomers = defineEndpoint<Input, Response, { items: Customer[]; total: number }>({
  id: 'customer.list',
  request: input => ({ path: 'customers', options: {
    params: { name: input.keyword, current: input.page, size: input.pageSize },
  } }),
  adapt: response => {
    if (!response?.ok) throw new BusinessError(response?.message || '查询客户失败', response);
    const value = response.result;
    if (!value || !Array.isArray(value.rows) || value.rows.some(row => !row || typeof row.id !== 'string' || typeof row.name !== 'string') || !Number.isSafeInteger(value.count) || value.count < 0) {
      throw new BusinessError('客户列表响应与接口文档不一致', response);
    }
    return { items: value.rows, total: value.count };
  },
});
```

业务模块通过 `useQuery(useCallback(signal => listCustomers.execute(query, { signal }), [query]))` 查询；query 必须保持稳定，或按 keyword/page/pageSize 分别列出依赖。UI 使用 `QueryBoundary` 并传入 loading、error、empty 和 reload。另一接口返回数组时，编写自己的 adapt，不能复用上面 result.rows 的提取假设。

模拟实现用 `withMock(listCustomers, async () => ({ items: [], total: 0 }), import.meta.env.VITE_USE_MOCK === 'true')` 显式启用。真实联调时关闭此开关；不要把模拟数据用于生产验收。
