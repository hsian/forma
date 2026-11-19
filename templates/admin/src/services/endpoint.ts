import { request } from './request';
import type { RequestOptions } from '../../.forma/runtime/request';

export class BusinessError extends Error {
  constructor(message: string, public readonly details?: unknown) { super(message); this.name = 'BusinessError'; }
}
export interface Endpoint<Input, Output, Response = unknown> {
  /** Stable business capability ID, not a UI label or backend method name. */
  id: string;
  execute(input: Input, options?: { signal?: AbortSignal }): Promise<Output>;
}
export interface EndpointDefinition<Input, Response, Output> {
  id: string;
  request(input: Input): { path: string; options?: Omit<RequestOptions, 'signal'> };
  /** Validate and extract this endpoint's response; no global code/data assumptions. */
  adapt(response: Response): Output;
}
export function defineEndpoint<Input, Response, Output>(definition: EndpointDefinition<Input, Response, Output>, transport = request): Endpoint<Input, Output, Response> {
  return {
    id: definition.id,
    async execute(input, options) {
      const spec = definition.request(input);
      const response = await transport<Response>(spec.path, { ...spec.options, signal: options?.signal });
      return definition.adapt(response);
    },
  };
}

/** Opt-in mock implementation. No automatic fallback after a real request fails. */
export function withMock<Input, Output>(endpoint: Endpoint<Input, Output>, mock: Endpoint<Input, Output>['execute'], enabled: boolean): Endpoint<Input, Output> {
  return enabled ? { id: endpoint.id, execute: async (input, options) => {
    options?.signal?.throwIfAborted();
    const result = await mock(input, options);
    options?.signal?.throwIfAborted();
    return result;
  } } : endpoint;
}
