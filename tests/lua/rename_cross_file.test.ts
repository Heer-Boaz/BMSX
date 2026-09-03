import assert from 'node:assert/strict';
import { test } from 'node:test';

import { editorTextModelService } from '../../ide/editor/model/model_service';
import { createLuaSemanticFrontendFromSnapshot, LuaSemanticWorkspace } from '../../ide/editor/contrib/intellisense/semantic/workspace/index';
import { getOrCreateSemanticProject, resetSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { CrossFileRenameManager } from '../../ide/workbench/contrib/code_editor/rename/operations';
import { buildCodeTabId } from '../../ide/workbench/ui/code_tab/contexts';
import { codeEditorInputManager } from '../../ide/workbench/ui/code_tab/input_manager';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import type { ResourceViewerTabDescriptor } from '../../ide/workbench/ui/tab/model';
import { SYSTEM_RESOURCE_DOMAIN } from '../../ide/common/resource';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';
import { resolveRuntimeResource } from '../../ide/runtime/sources';

test('cross file rename updates a retained background model without opening an editor input', (t) => {
	const files = new Map<string, string>([
		['main.lua', [
			'state = { value = 1 }',
			'',
			'function update()',
			'\tstate.value = state.value + 1',
			'end',
		].join('\n')],
		['usage.lua', 'print(state.value)'],
	]);
	const mainSource = files.get('main.lua')!;
	const usageSource = files.get('usage.lua')!;
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entrySourcePath: 'main.lua',
		projectRootPath: '',
		can_boot_from_source: true,
		revision: 0,
	};
	registerLuaSourceRecord(registry, {
		resid: 'usage.lua',
		type: 'lua',
		source_path: 'usage.lua',
		normalized_source_path: 'usage.lua',
		module_path: 'usage',
		src: usageSource,
		base_src: usageSource,
		base_update_timestamp: 0,
		update_timestamp: 0,
		generated: false,
		program_module: true,
	});
	const sources = createTestRuntimeSourceState(
		registry,
		[null, null],
		SYSTEM_RESOURCE_DOMAIN,
	);

	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', mainSource);
	workspace.updateFile('usage.lua', usageSource);
	resetSemanticProject(SYSTEM_RESOURCE_DOMAIN);

	const usageResource = resolveRuntimeResource(sources, {
		domain: SYSTEM_RESOURCE_DOMAIN,
		path: 'usage.lua',
	})!;
	const resourceTab: ResourceViewerTabDescriptor = {
		id: 'resource:system\0usage.lua',
		kind: 'resource_view',
		title: 'usage.lua',
		closable: true,
		resource: {
			resource: usageResource,
			lines: [],
			error: '',
			title: 'usage.lua',
			scroll: 0,
		},
	};
	editorTabGroup.initialize(resourceTab);
	t.after(() => {
		editorTabGroup.clear();
		codeEditorInputManager.clear();
		editorTextModelService.clear();
	});

	const definitionCol = mainSource.indexOf('state') + 1;
	const resolution = createLuaSemanticFrontendFromSnapshot(workspace.getSnapshot()).findReferencesByPosition('main.lua', 1, definitionCol);
	assert.ok(resolution);

	const otherRanges = resolution!.references
		.filter(ref => ref.file === 'usage.lua')
		.map(ref => ref.range);
	assert.ok(otherRanges.length > 0);

	const manager = new CrossFileRenameManager(sources);
	const replacements = manager.applyRenameToChunk(
		SYSTEM_RESOURCE_DOMAIN,
		'usage.lua',
		otherRanges,
		'worldState',
		'main.lua',
	);
	assert.equal(replacements, otherRanges.length);

	const usageModel = editorTextModelService.get(usageResource)!;
	assert.equal(usageModel.dirty, true);
	assert.equal(usageModel.buffer.getText(), 'print(worldState.value)');
	assert.equal(editorTabGroup.tabs.length, 1);
	assert.equal(editorTabGroup.activeTab, resourceTab);
	assert.equal(codeEditorInputManager.get(buildCodeTabId(usageResource)), undefined);

	const updatedData = getOrCreateSemanticProject(SYSTEM_RESOURCE_DOMAIN).getFileData('usage.lua');
	assert.ok(updatedData);
	assert.equal(updatedData!.source.trim(), 'print(worldState.value)');

	usageModel.undo();
	assert.equal(usageModel.buffer.getText(), usageSource);

});
