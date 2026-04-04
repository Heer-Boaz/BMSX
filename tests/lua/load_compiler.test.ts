import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileLoadChunk } from '../../src/bmsx/emulator/lua_load_compiler';
import { Table } from '../../src/bmsx/emulator/cpu';
import { StringPool } from '../../src/bmsx/emulator/string_pool';

test('compileLoadChunk supports negative numeric literals in generated assignments', () => {
	const stringPool = new StringPool();
	const runtime = {
		createApiRuntimeError(message: string) {
			return new Error(message);
		},
		internString(value: string) {
			return stringPool.intern(value);
		},
	} as any;
	const loader = compileLoadChunk(runtime, [
		'return function(target)',
		'\ttarget["sprite_component"]["offset"]["x"] = -8',
		'end',
	].join('\n'), 'timeline_apply.frame');
	const loaded: any[] = [];
	loader.invoke([], loaded);
	assert.equal(loaded.length, 1);
	const apply = loaded[0];
	const target = new Table(0, 1);
	const sprite = new Table(0, 1);
	const offset = new Table(0, 1);
	sprite.set(stringPool.intern('offset'), offset);
	target.set(stringPool.intern('sprite_component'), sprite);
	apply.invoke([target], []);
	assert.equal(offset.get(stringPool.intern('x')), -8);
});
