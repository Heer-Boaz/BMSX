import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileLoadChunk } from '../../machine/ts/src/machine/program/load_compiler';
import { StringValue, Table } from '../../machine/ts/src/machine/cpu/cpu';
import { StringPool } from '../../machine/ts/src/machine/cpu/string_pool';

test('compileLoadChunk supports negative numeric literals in generated assignments', () => {
	const stringPool = new StringPool();
	const runtime = {
		createApiRuntimeError(message: string) {
			return new Error(message);
		},
		internString(value: string) {
			return StringValue.get(stringPool.intern(value));
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
	sprite.set(StringValue.get(stringPool.intern('offset')), offset);
	target.set(StringValue.get(stringPool.intern('sprite_component')), sprite);
	apply.invoke([target], []);
	assert.equal(offset.get(StringValue.get(stringPool.intern('x'))), -8);
});

test('compileLoadChunk keeps negative numeric indices on the generic table path', () => {
	const stringPool = new StringPool();
	const runtime = {
		createApiRuntimeError(message: string) {
			return new Error(message);
		},
		internString(value: string) {
			return StringValue.get(stringPool.intern(value));
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

test('compileLoadChunk keeps & as the string-id unary operator for generated field assignments', () => {
	const stringPool = new StringPool();
	const runtime = {
		createApiRuntimeError(message: string) {
			return new Error(message);
		},
		internString(value: string) {
			return StringValue.get(stringPool.intern(value));
		},
	} as any;
	const loader = compileLoadChunk(runtime, [
		'return function(target)',
		'\ttarget[&"field"] = &"value"',
		'end',
	].join('\n'), 'timeline_apply.string_id_field');
	const loaded: any[] = [];
	loader.invoke([], loaded);
	assert.equal(loaded.length, 1);
	const apply = loaded[0];
	const target = new Table(0, 1);
	apply.invoke([target], []);
	assert.equal(target.get(StringValue.get(stringPool.intern('field'))), StringValue.get(stringPool.intern('value')));
});

test('compileLoadChunk reads assignment values from parameter paths', () => {
	const stringPool = new StringPool();
	const runtime = {
		createApiRuntimeError(message: string) {
			return new Error(message);
		},
		internString(value: string) {
			return StringValue.get(stringPool.intern(value));
		},
	} as any;
	const loader = compileLoadChunk(runtime, [
		'return function(target, frame)',
		'\ttarget["visual"]["color"] = frame["visual"]["color"]',
		'end',
	].join('\n'), 'timeline_apply.parameter_value');
	const loaded: any[] = [];
	loader.invoke([], loaded);
	assert.equal(loaded.length, 1);
	const apply = loaded[0];
	const target = new Table(0, 1);
	const targetVisual = new Table(0, 1);
	target.set(StringValue.get(stringPool.intern('visual')), targetVisual);
	const frame = new Table(0, 1);
	const frameVisual = new Table(0, 1);
	const color = 0xff010203;
	frameVisual.set(StringValue.get(stringPool.intern('color')), color);
	frame.set(StringValue.get(stringPool.intern('visual')), frameVisual);
	apply.invoke([target, frame], []);
	assert.equal(targetVisual.get(StringValue.get(stringPool.intern('color'))), color);
});
