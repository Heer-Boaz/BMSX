import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildLuaSemanticFrontend } from '../../src/bmsx/emulator/lua_semantic_frontend';

test('LuaSemanticFrontend accepts shared runtime globals without diagnostics', () => {
	const source = 'return assets, sys_vdp_stream_base, cart_manifest';
	const frontend = buildLuaSemanticFrontend([{ path: 'globals.lua', source }]);
	assert.deepEqual(frontend.getFile('globals.lua').diagnostics, []);
});

test('LuaSemanticFrontend preserves shadowed locals instead of retargeting them to outer const bindings', () => {
	const source = [
		'local outer<const> = 1',
		'local function read_shadow()',
		'\tlocal outer = 2',
		'\touter = outer + 1',
		'\treturn outer',
		'end',
		'return read_shadow()',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'shadow.lua', source }]);
	assert.deepEqual(frontend.getFile('shadow.lua').diagnostics, []);
});

test('LuaSemanticFrontend allows direct indexed memory-map access', () => {
	const source = [
		'local base = 0',
		'return mem[base], mem8[base], mem32le[base], memf32le[base]',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'mem.lua', source }]);
	assert.deepEqual(frontend.getFile('mem.lua').diagnostics, []);
});

test('LuaSemanticFrontend does not flag member access on call results as undefined globals', () => {
	const source = [
		'local state = { nested = { transition_guards = 1 } }',
		'function state:get_nested()',
		'\treturn self.nested',
		'end',
		'return state:get_nested().transition_guards',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'members.lua', source }]);
	assert.deepEqual(frontend.getFile('members.lua').diagnostics, []);
});

test('LuaSemanticFrontend treats implicit global writes inside nested scopes as globals', () => {
	const source = [
		'while true do',
		'\tvdp_stream_cursor = sys_vdp_stream_base',
		'\tlocal used_bytes<const> = vdp_stream_cursor - sys_vdp_stream_base',
		'\tbreak',
		'end',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'globalscope.lua', source }]);
	assert.deepEqual(frontend.getFile('globalscope.lua').diagnostics, []);
});

test('LuaSemanticFrontend allows omitted trailing optional arguments for user functions', () => {
	const source = [
		'local function add(a, b, c)',
		'\tif c then',
		'\t\treturn a + b + c',
		'\tend',
		'\treturn a + b',
		'end',
		'return add(1, 2)',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'optional_args.lua', source }]);
	assert.deepEqual(frontend.getFile('optional_args.lua').diagnostics, []);
});

test('LuaSemanticFrontend does not bind method self to an out-of-scope sibling local', () => {
	const source = [
		'local t = {}',
		'function t.new()',
		'\tlocal self<const> = {}',
		'\treturn self',
		'end',
		'function t:add_space(space_id)',
		'\treturn self',
		'end',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'method_self.lua', source }], { canonicalization: 'lower' });
	const file = frontend.getFile('method_self.lua');
	const ref = file.getReference({
		path: 'method_self.lua',
		start: { line: 7, column: 9 },
		end: { line: 7, column: 12 },
	});
	assert.equal(ref.kind, 'unresolved');
});
