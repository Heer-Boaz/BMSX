import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CodeTabContext } from '../../ide/workbench/ui/code_tab/model';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { createLuaSemanticFrontendFromSnapshot, LuaSemanticWorkspace } from '../../ide/editor/contrib/intellisense/semantic/workspace/index';
import { getOrCreateSemanticProject, resetSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { CrossFileRenameManager } from '../../ide/workbench/contrib/code_editor/rename/operations';
import { buildCodeTabId, clearCodeTabContexts, registerCodeTabContext } from '../../ide/workbench/ui/code_tab/contexts';
import { codeTabSessionState } from '../../ide/workbench/ui/code_tab/session_state';
import { tabSessionState } from '../../ide/workbench/ui/tab/session_state';
import {
	SYSTEM_RESOURCE_DOMAIN,
	type RuntimeResource,
} from '../../ide/common/resource';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';
import { resolveRuntimeResource } from '../../ide/runtime/sources';

function codeContext(resource: RuntimeResource, source: string): CodeTabContext {
	const buffer = new PieceTreeBuffer(source);
	return {
		id: buildCodeTabId(resource),
		title: resource.path,
		resource,
		mode: 'lua',
		buffer,
		cursorRow: 0,
		cursorColumn: 0,
		scrollRow: 0,
		scrollColumn: 0,
		selectionAnchor: null,
		lastSavedSource: source,
		saveGeneration: 0,
		appliedGeneration: 0,
		undoStack: [],
		redoStack: [],
		lastHistoryKey: null,
		lastHistoryTimestamp: 0,
		savePointDepth: 0,
		dirty: false,
		runtimeErrorOverlay: null,
		executionStopRow: null,
		runtimeSyncState: 'synced',
		runtimeSyncMessage: null,
		textVersion: buffer.version,
	};
}

test('cross file rename updates an existing code tab and semantic workspace', () => {
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
		module_path: 'usage',
		src: usageSource,
		base_src: usageSource,
		base_update_timestamp: 0,
		update_timestamp: 0,
		generated: false,
	});
	const sources = createTestRuntimeSourceState(
		registry,
		[null, null],
		SYSTEM_RESOURCE_DOMAIN,
	);

	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', mainSource);
	workspace.updateFile('usage.lua', usageSource);
	clearCodeTabContexts();
	tabSessionState.tabs.length = 0;
	codeTabSessionState.activeContextId = null;
	tabSessionState.activeTabId = null;
	resetSemanticProject(SYSTEM_RESOURCE_DOMAIN);

	const usageResource = resolveRuntimeResource(sources, {
		domain: SYSTEM_RESOURCE_DOMAIN,
		path: 'usage.lua',
	})!;
	const usageContext = codeContext(usageResource, usageSource);
	registerCodeTabContext(usageContext);
	tabSessionState.tabs.push({
		id: usageContext.id,
		kind: 'code_editor',
		title: usageContext.title,
		closable: true,
		dirty: false,
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

	assert.equal(usageContext.dirty, true);
	assert.equal(usageContext.buffer.getText(), 'print(worldState.value)');
	assert.equal(tabSessionState.tabs[0]!.dirty, true);

	const updatedData = getOrCreateSemanticProject(SYSTEM_RESOURCE_DOMAIN).getFileData('usage.lua');
	assert.ok(updatedData);
	assert.equal(updatedData!.source.trim(), 'print(worldState.value)');

});
