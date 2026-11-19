import type { ReactNode } from 'react';
import { Alert, Button, Empty, Spin } from 'antd';

/** Shared presentation for queries; accepts state, never calls an endpoint itself. */
export function QueryBoundary({ loading, error, empty, onRetry, children }: { loading: boolean; error?: Error; empty?: boolean; onRetry?: () => void; children: ReactNode }) {
  if (error) return <Alert type="error" showIcon message={error.message} action={onRetry && <Button onClick={onRetry}>重试</Button>}/>;
  if (loading) return <div role="status" aria-label="正在加载"><Spin/></div>;
  if (empty) return <Empty description="暂无数据"/>;
  return <>{children}</>;
}
