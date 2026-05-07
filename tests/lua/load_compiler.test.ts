import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileLoadChunk } from '../../src/bmsx/machine/program/load_compiler';
import { Table, valueString } from '../../src/bmsx/machine/cpu/cpu';
import { StringPool } from '../../src/bmsx/machine/cpu/string_pool';

test('compileLoadChunk supports negative numeric literals in generated assignments', () => {
	const stringPool = new StringPool();
	const runtime = {
		createApiRuntimeError(message: string) {
			return new Error(message);
		},
		internString(value: string) {
			return valueString(stringPool.intern(value));
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
	sprite.set(valueString(stringPool.intern('offset')), offset);
	target.set(valueString(stringPool.intern('sprite_component')), sprite);
	apply.invoke([target], []);
	assert.equal(offset.get(valueString(stringPool.intern('x'))), -8);
});

test('compileLoadChunk keeps negative numeric indices on the generic table path', () => {
	const stringPool = new StringPool();
	const runtime = {
		createApiRuntimeError(message: string) {
			return new Error(message);
		},
		internString(value: string) {
			return valueString(stringPool.intern(value));
		},
	} as any;
	const loader = compileLoadChunk(runtime, [
		'return function(target)',
		'\ttarget[-1] = 42',
		'end',
	].join('\n'), 'timeline_apply.negative_index');
	const loaded: any[] = [];
	loader.invoke([], loaded);
	assert.equal(loaded.length, 1);
	const apply = loaded[0];
	const target = new Table(0, 1);
	apply.invoke([target], []);
	assert.equal(target.get(-1), 42);
});
