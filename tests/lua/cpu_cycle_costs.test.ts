import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { createBuiltinFunction } from '../../machine/ts/machine/cpu/value';

test('builtin cost resolution uses fixed VM primitive tiers', () => {
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.Next).cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.Error).cost, { base: 2, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.PCall).cost, { base: 4, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.StringChar).cost, { base: 2, perArg: 0, perRet: 0 });
});
