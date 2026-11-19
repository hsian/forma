/** Page-facing contracts only. Backend response envelopes belong in services. */
export interface PageResult<Row> { items: Row[]; total: number }
export interface PageQuery { page: number; pageSize: number }
