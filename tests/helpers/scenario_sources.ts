import type {
	LuaSourceRecord,
	LuaSourceRegistry,
} from '../../ide/runtime/source_registry';
import { createLuaSourceRegistry, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import { createTestRuntimeSourceState } from './runtime_sources';

function scenarioSourceRegistry(
	projectRootPath: string,
	records: readonly LuaSourceRecord[],
): LuaSourceRegistry {
	const registry = createLuaSourceRegistry(projectRootPath, '');
	for (let index = 0; index < records.length; index += 1) {
		registerLuaSourceRecord(registry, records[index]);
	}
	return registry;
}

export function createScenarioTestSourceRecord(
	path: string,
	timestamp: number,
	source = `return { kind = 'unit', tests = { sample = function() end } }`,
	normalizedSourcePath = `carts/nemesis_s/${path}`,
): LuaSourceRecord {
	return {
		resid: scenarioTestAssetId(path),
		type: 'lua',
		src: source,
		base_src: source,
		base_update_timestamp: timestamp,
		source_path: path,
		normalized_source_path: normalizedSourcePath,
		module_path: path.slice(0, -4),
		update_timestamp: timestamp,
		generated: false,
		sourceKind: 'source-only', program_module: false,
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
