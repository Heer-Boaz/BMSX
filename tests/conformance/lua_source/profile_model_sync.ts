import assert from 'node:assert/strict';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../../ide/runtime/source_registry';
import { BehaviorRegistrationIndex } from '../../../ide/workbench/contrib/behavior_lens/registration_index';
import { createTestRuntimeSourceState } from '../../helpers/runtime_sources';
import { medianMilliseconds } from '../../helpers/performance';

for (const modelCount of [1, 64, 256, 1024]) {
	resetSemanticProjects();
	editorTextModelService.clear();
	const registry: LuaSourceRegistry = {
		records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'module_0.lua',
		projectRootPath: 'carts/probe', can_boot_from_source: true, revision: 0,
	};
	const system: LuaSourceRegistry = {
		records: [], path2lua: {}, module2lua: {}, entrySourcePath: '',
		projectRootPath: 'machine/bios', can_boot_from_source: false, revision: 0,
	};
	for (let index = 0; index < modelCount; index += 1) {
		const path = `module_${index}.lua`;
		const source = `local fsm<const> = require('cartlib/fsm/library')\nfsm.register('id_${index}', { states = { idle = {} } })`;
		const record = {
			resid: path, type: 'lua' as const, src: source, base_src: source,
			base_update_timestamp: 0, source_path: path, normalized_source_path: path,
			module_path: `module_${index}`, update_timestamp: 0, generated: false, program_module: true,
		};
		registerLuaSourceRecord(registry, record);
		editorTextModelService.retain({ domain: 0, path, source: record }, 'lua', source);
	}
	const sources = createTestRuntimeSourceState(system, [registry, null], 0);
	const index = new BehaviorRegistrationIndex(sources);
	const retained = index.getRegistrations(0);
	assert.equal(retained.length, modelCount);
	let total = 0;
	const retainedQueryMicroseconds = medianMilliseconds(() => {
		for (let request = 0; request < 10000; request += 1) total += index.getRegistrations(0).length;
	}) / 10;
	assert.ok(total > 0);
	assert.equal(index.getRegistrations(0), retained);
	const changedModel = editorTextModelService.get({ domain: 0, path: 'module_0.lua' })!;
	const changedQueryMilliseconds = medianMilliseconds(() => {
		changedModel.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- edit\n' }]);
		assert.equal(index.getRegistrations(0).length, modelCount);
		changedModel.undo();
		assert.equal(index.getRegistrations(0).length, modelCount);
	});
	console.log(JSON.stringify({ modelCount, retainedQueryMicroseconds, editAndUndoQueryMilliseconds: changedQueryMilliseconds,
		boundary: 'retained real model service, semantic project and behavior registration index; 10000 warm reads per sample; edit+Undo includes two parses/binds/index rebuilds; no CPU or rendering' }));
}
resetSemanticProjects();
editorTextModelService.clear();
