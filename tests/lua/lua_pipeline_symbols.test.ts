import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Table, StringValue } from '../../machine/ts/machine/cpu/cpu';
import { StringPool } from '../../machine/ts/machine/cpu/string_pool';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../machine/ts/lua/source_registry';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { listSymbols } from '../../machine/ts/ide/runtime/lua_pipeline';
import { machineManager } from '../../machine/ts/core/machine_manager';

function makeRegistry(sourcePaths: readonly string[]): LuaSourceRegistry {
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: '',
		namespace: 'test',
		projectRootPath: '',
		can_boot_from_source: false,
	};
	for (let index = 0; index < sourcePaths.length; index += 1) {
		const sourcePath = sourcePaths[index];
		registerLuaSourceRecord(registry, {
			resid: sourcePath,
			type: 'lua',
			source_path: sourcePath,
			module_path: sourcePath,
			src: '',
			base_src: '',
			update_timestamp: 0,
		});
	}
	return registry;
}

test('listSymbols hides compiler-generated module export slots through loader module paths', () => {
	const stringPool = new StringPool();
	const globals = new Table(0, 8);
	globals.set(StringValue.get(stringPool.intern('system__font__get')), true);
	globals.set(StringValue.get(stringPool.intern('room__index__spawn')), true);
	globals.set(StringValue.get(stringPool.intern('font__get')), true);
	globals.set(StringValue.get(stringPool.intern('player_score')), true);
	const systemLuaSources = makeRegistry(['system/font.lua']);
	const cartLuaSources = makeRegistry(['carts/pietious/room/index.lua']);
	(machineManager as any).sourceState = {
		systemLuaSources,
		cartLuaSources,
		activeLuaSources: cartLuaSources,
		currentPath: cartLuaSources.entry_path,
		luaSourceRegistries: [cartLuaSources, systemLuaSources],
		luaSourceSearchRegistries: [cartLuaSources, systemLuaSources],
		moduleCompileLuaSources: [cartLuaSources, systemLuaSources],
	};
	const runtime = {
		machine: {
			cpu: {
				syncGlobalSlotsToTable(): void {},
				globals,
				stringPool,
			},
		},
	} as Runtime;

	const names = listSymbols(runtime).map(symbol => symbol.name);

	assert.equal(names.includes('system__font__get'), false);
	assert.equal(names.includes('room__index__spawn'), false);
	assert.equal(names.includes('font__get'), true);
	assert.equal(names.includes('player_score'), true);
});
