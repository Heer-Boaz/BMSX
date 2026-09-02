import type {
	LuaSourceRecord,
	LuaSourceRegistry,
} from '../../ide/runtime/source_registry';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import { createTestRuntimeSourceState } from './runtime_sources';

function scenarioSourceRegistry(
	projectRootPath: string,
	records: readonly LuaSourceRecord[],
): LuaSourceRegistry {
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entrySourcePath: '',
		projectRootPath,
		can_boot_from_source: false,
		revision: 0,
	};
	for (let index = 0; index < records.length; index += 1) {
		registerLuaSourceRecord(registry, records[index]);
	}
	return registry;
}

export function createScenarioTestSourceRecord(
	path: string,
	timestamp: number,
): LuaSourceRecord {
	return {
		resid: scenarioTestAssetId(path),
		type: 'lua',
		src: `-- ${path}`,
		base_src: `-- ${path}`,
		base_update_timestamp: timestamp,
		source_path: path,
		normalized_source_path: path,
		module_path: path.slice(0, -4),
		update_timestamp: timestamp,
		generated: false,
		program_module: false,
	};
}

export function createScenarioTestSourceState(
	records: readonly LuaSourceRecord[],
): RuntimeSourceState {
	return createTestRuntimeSourceState(
		scenarioSourceRegistry('machine/bios', []),
		[scenarioSourceRegistry('carts/nemesis_s', records), null],
		0,
	);
}
