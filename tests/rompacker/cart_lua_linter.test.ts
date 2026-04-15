import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { lintCartLuaSources } from '../../scripts/rompacker/cart_lua_linter';

async function withLuaLintFixture(name: string, source: string, run: (root: string) => Promise<void>): Promise<void> {
	const root = join(process.cwd(), 'tests', '.tmp', name);
	const filePath = join(root, 'sample.lua');
	try {
		await rm(root, { recursive: true, force: true });
		await mkdir(root, { recursive: true });
		await writeFile(filePath, source);
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('cart lua linter rejects const copies from globals module aliases', async () => {
	await withLuaLintFixture(
		'cart_lua_linter_globals_const_copy',
		[
			"local globals<const> = require('globals')",
			'local bg_id<const> = globals.bg_id',
		].join('\n'),
		async root => {
			await assert.rejects(
				lintCartLuaSources({ roots: [root], profile: 'cart' }),
				/Local copies of constants are forbidden \("bg_id"\)\./,
			);
		},
	);
});

test('cart lua linter rejects chained const copies from constants module aliases', async () => {
	await withLuaLintFixture(
		'cart_lua_linter_chained_const_copy',
		[
			"local constants<const> = require('constants')",
			'local room<const> = constants.room',
			'local tile_size<const> = room.tile_size',
		].join('\n'),
		async root => {
			await assert.rejects(
				lintCartLuaSources({ roots: [root], profile: 'cart' }),
				error => {
					assert.match(String(error), /Local copies of constants are forbidden \("room"\)\./);
					assert.match(String(error), /Local copies of constants are forbidden \("tile_size"\)\./);
					return true;
				},
			);
		},
	);
});

test('cart lua linter allows const module imports without member copies', async () => {
	await withLuaLintFixture(
		'cart_lua_linter_const_module_import',
		"local globals<const> = require('globals')\nreturn globals",
		async root => {
			await lintCartLuaSources({ roots: [root], profile: 'cart' });
		},
	);
});

test('cart lua linter treats local const function expressions as named functions for named-function rules', async () => {
	const cases = [
		{
			name: 'visual_update',
			source: [
				'local update_visual<const> = function()',
				'\treturn state.flag',
				'end',
			].join('\n'),
			expected: /update_visual\/sync_\*_components\/apply_pose\/refresh_presentation_if_changed-style code is forbidden \("update_visual"\)/,
		},
		{
			name: 'getter_setter',
			source: [
				'local get_flag<const> = function()',
				'\treturn state.flag',
				'end',
			].join('\n'),
			expected: /Getter\/setter wrapper pattern is forbidden \("get_flag"\)\./,
		},
		{
			name: 'comparison_wrapper_getter',
			source: [
				'local is_ready<const> = function()',
				'\treturn state.value == 1',
				'end',
			].join('\n'),
			expected: /Single-value comparison wrapper is forbidden \("is_ready"\)\./,
		},
		{
			name: 'builtin_recreation',
			source: [
				'local wrap_abs<const> = function(value)',
				'\treturn math.abs(value)',
				'end',
			].join('\n'),
			expected: /Recreating existing built-in behavior is forbidden \("wrap_abs"\)\./,
		},
		{
			name: 'bool01_duplicate',
			source: [
				'local bool01_copy<const> = function(value)',
				'\tif value then',
				"\t\treturn '1'",
				'\tend',
				"\treturn '0'",
				'end',
			].join('\n'),
			expected: /Duplicate of global bool01 is forbidden \("bool01_copy"\)\./,
		},
		{
			name: 'pure_copy',
			source: [
				'local copy_stats<const> = function(source)',
				'\treturn { hp = source.hp, mp = source.mp }',
				'end',
			].join('\n'),
			expected: /Defensive pure-copy function is forbidden \("copy_stats"\)\./,
		},
		{
			name: 'inline_static_lookup_table',
			source: [
				'local lookup_score<const> = function(key)',
				"\treturn (({ a = 1, b = 2 })[key] or 0) + 1",
				'end',
			].join('\n'),
			expected: /Inline static lookup table expression inside function is forbidden \(in "lookup_score"\)\./,
		},
		{
			name: 'handler_identity_dispatch',
			source: [
				'local dispatch_handler<const> = function(event)',
				'\tlocal handler<const> = handlers[event.kind]',
				'\tif handler == special_handler then',
				'\t\treturn handler(event)',
				'\tend',
				'\treturn handler()',
				'end',
			].join('\n'),
			expected: /Handler-identity dispatch branching with mixed call signatures is forbidden \("dispatch_handler"\)\./,
		},
	] as const;

	for (const testCase of cases) {
		await withLuaLintFixture(
			`cart_lua_linter_named_local_const_function_${testCase.name}`,
			testCase.source,
			async root => {
				await assert.rejects(
					lintCartLuaSources({ roots: [root], profile: 'cart' }),
					testCase.expected,
				);
			},
		);
	}
});

test('cart lua linter explains direct guard alternative for or-nil fallback pattern', async () => {
	await withLuaLintFixture(
		'cart_lua_linter_or_nil_message',
		[
			'local result<const> = source ~= nil and build(source) or nil',
			'return result',
		].join('\n'),
		async root => {
			await assert.rejects(
				lintCartLuaSources({ roots: [root], profile: 'cart' }),
				/"or nil" fallback pattern is forbidden[\s\S]*guard on that value directly[\s\S]*tracks and compile_tracks\(tracks\)[\s\S]*real if\/else/,
			);
		},
	);
});

test('cart lua linter rejects locals that shadow outer require aliases', async () => {
	await withLuaLintFixture(
		'cart_lua_linter_shadowed_require_alias',
		[
			"local font<const> = require('font')",
			'local overlay<const> = {}',
			'function overlay:draw()',
			'\tlocal font<const> = self.text_font',
			'\treturn font.id',
			'end',
		].join('\n'),
		async root => {
			await assert.rejects(
				lintCartLuaSources({ roots: [root], profile: 'cart' }),
				/Local "font" shadows outer module alias from require\('font'\)/,
			);
		},
	);
});

test('cart lua linter allows renamed local handles next to require aliases', async () => {
	await withLuaLintFixture(
		'cart_lua_linter_shadowed_require_alias_allowed',
		[
			"local font<const> = require('font')",
			'local overlay<const> = {}',
			'function overlay:draw()',
			'\tlocal text_font<const> = self.text_font',
			'\treturn font.measure_line_width(text_font, "abc")',
			'end',
		].join('\n'),
		async root => {
			await lintCartLuaSources({ roots: [root], profile: 'cart' });
		},
	);
});
