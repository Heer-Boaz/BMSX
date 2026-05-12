import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Table, StringValue } from '../../src/bmsx/machine/cpu/cpu';
import { StringPool } from '../../src/bmsx/machine/cpu/string_pool';
import type { LuaSourceRegistry } from '../../src/bmsx/machine/program/sources';
import type { Runtime } from '../../src/bmsx/machine/runtime/runtime';
import { listSymbols } from '../../src/bmsx/ide/runtime/lua_pipeline';

function makeRegistry(sourcePaths: readonly string[]): LuaSourceRegistry {
	const path2lua: LuaSourceRegistry['path2lua'] = {};
	for (let index = 0; index < sourcePaths.length; index += 1) {
		const sourcePath = sourcePaths[index];
		path2lua[sourcePath] = {
			resid: sourcePath,
			type: 'lua',
			source_path: sourcePath,
			module_path: sourcePath,
			src: '',
			base_src: '',
			update_timestamp: 0,
		};
	}
	return {
		path2lua,
		module2lua: {},
		entry_path: '',
		namespace: 'test',
		projectRootPath: '',
		can_boot_from_source: false,
	};
}

test('listSymbols hides compiler-generated module export slots through loader module paths', () => {
	const stringPool = new StringPool();
	const globals = new Table(0, 8);
	globals.set(StringValue.get(stringPool.intern('bios__font__get')), true);
	globals.set(StringValue.get(stringPool.intern('room__index__spawn')), true);
	globals.set(StringValue.get(stringPool.intern('font__get')), true);
	globals.set(StringValue.get(stringPool.intern('player_score')), true);
	const runtime = {
		machine: {
			cpu: {
				syncGlobalSlotsToTable(): void {},
				globals,
				stringPool,
			},
		},
		systemLuaSources: makeRegistry(['bios/font.lua']),
		cartLuaSources: makeRegistry(['src/carts/pietious/room/index.lua']),
	} as Runtime;

	const names = listSymbols(runtime).map(symbol => symbol.name);

	assert.equal(names.includes('bios__font__get'), false);
	assert.equal(names.includes('room__index__spawn'), false);
	assert.equal(names.includes('font__get'), true);
	assert.equal(names.includes('player_score'), true);
});
