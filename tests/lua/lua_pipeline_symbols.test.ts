import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StringValue } from '../../machine/ts/machine/cpu/value';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { listSymbols } from '../../ide/runtime/lua_pipeline';
import {
	createTestRuntime,
	createTestRuntimeRomPayload,
	createTestRuntimeSourceState,
} from '../helpers/runtime_sources';

function makeRegistry(sourcePaths: readonly string[]): LuaSourceRegistry {
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: '',
		projectRootPath: '',
		can_boot_from_source: false,
		revision: 0,
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
			base_update_timestamp: 0,
			update_timestamp: 0,
			generated: false,
		});
	}
	return registry;
}

test('listSymbols hides compiler-generated module export slots through loader module paths', () => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const { globals, stringPool } = runtime.machine.cpu;
	globals.set(StringValue.get(stringPool.intern('system__font__get')), true);
	globals.set(StringValue.get(stringPool.intern('room__index__spawn')), true);
	globals.set(StringValue.get(stringPool.intern('font__get')), true);
	globals.set(StringValue.get(stringPool.intern('player_score')), true);
	const systemLuaSources = makeRegistry(['system/font.lua']);
	const cartLuaSources = makeRegistry(['carts/pietious/room/index.lua']);
	const sources = createTestRuntimeSourceState(
		systemLuaSources,
		[cartLuaSources, null],
		0,
	);

	const names = listSymbols(sources, runtime).map(symbol => symbol.name);

	assert.equal(names.includes('system__font__get'), false);
	assert.equal(names.includes('room__index__spawn'), false);
	assert.equal(names.includes('font__get'), true);
	assert.equal(names.includes('player_score'), true);
});
