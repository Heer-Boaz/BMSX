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

test('LuaSemanticFrontend resolves navigation targets by lexical scope instead of first textual occurrence', () => {
	const source = [
		'local value = 1',
		'local function outer()',
		'\tlocal value = 2',
		'\treturn value',
		'end',
		'return value',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'scope.lua', source }]);
	const file = frontend.getFile('scope.lua');
	const innerTarget = file.getNavigationTargetAt(findPosition(source, '\treturn value', 'value'));
	assert.deepEqual(innerTarget.range, {
		path: 'scope.lua',
		start: { line: 3, column: 8 },
		end: { line: 3, column: 12 },
	});
	const outerTarget = file.getNavigationTargetAt({ line: 6, column: 8 });
	assert.deepEqual(outerTarget.range, {
		path: 'scope.lua',
		start: { line: 1, column: 7 },
		end: { line: 1, column: 11 },
	});
});

test('LuaSemanticFrontend keeps ordinary strings and comments out of identifier navigation', () => {
	const source = [
		'local target = 1',
		'-- target',
		'local text = "target"',
		'return target',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'literals.lua', source }]);
	const file = frontend.getFile('literals.lua');
	assert.equal(file.getNavigationTargetAt(findPosition(source, '-- target', 'target')), null);
	assert.equal(file.getNavigationTargetAt(findPosition(source, 'local text = "target"', 'target')), null);
	const liveTarget = file.getNavigationTargetAt(findPosition(source, 'return target', 'target'));
	assert.deepEqual(liveTarget.range, {
		path: 'literals.lua',
		start: { line: 1, column: 7 },
		end: { line: 1, column: 12 },
	});
});

test('LuaSemanticFrontend resolves require strings to their target module files', () => {
	const entrySource = [
		'local util<const> = require("lib/util")',
		'return util',
	].join('\n');
	const utilSource = [
		'local M = {}',
		'return M',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([
		{ path: 'main.lua', source: entrySource },
		{ path: 'lib/util.lua', source: utilSource },
	]);
	const file = frontend.getFile('main.lua');
	const target = file.getNavigationTargetAt(findPosition(entrySource, 'require("lib/util")', 'lib/util'));
	assert.deepEqual(target, {
		kind: 'require_module',
		moduleName: 'lib/util',
		range: {
			path: 'lib/util.lua',
			start: { line: 1, column: 1 },
			end: { line: 2, column: 9 },
		},
	});
});

function findPosition(source: string, lineFragment: string, needle: string): { line: number; column: number } {
	const lines = source.split('\n');
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex];
		const fragmentIndex = line.indexOf(lineFragment);
		if (fragmentIndex === -1) {
			continue;
		}
		const needleIndex = line.indexOf(needle, fragmentIndex);
		if (needleIndex === -1) {
			break;
		}
		return {
			line: lineIndex + 1,
			column: needleIndex + 1,
		};
	}
	throw new Error(`Unable to find '${needle}' inside '${lineFragment}'.`);
}
