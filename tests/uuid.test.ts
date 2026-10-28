import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { randomId } from '../shared/uuid.js';

test('局域网 HTTP 缺少 randomUUID 时仍生成可被服务端接受的 UUID v4', () => {
  const source = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
  const ids = Array.from({ length: 1000 }, () => randomId(source));
  for (const id of ids) {
    assert.equal(z.uuid().safeParse(id).success, true);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
  assert.equal(new Set(ids).size, ids.length);
});
