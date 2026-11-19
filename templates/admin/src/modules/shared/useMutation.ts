import { useEffect, useRef, useState } from 'react';

/** Explicit submit only, one in-flight write, no retries; errors remain rejected. */
export function useMutation<Input, Output>(submit: (input: Input, signal: AbortSignal) => Promise<Output>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  async function execute(input: Input) {
    if (active.current) throw Error('操作正在处理中，请勿重复提交');
    const controller = new AbortController(); active.current = controller;
    setPending(true); setError(undefined);
    try {
      const result = await submit(input, controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error(String(cause));
      if (active.current === controller && !controller.signal.aborted) setError(failure);
      throw failure;
    } finally {
      if (active.current === controller) { active.current = null; setPending(false); }
    }
  }
  return { execute, pending, error };
}
