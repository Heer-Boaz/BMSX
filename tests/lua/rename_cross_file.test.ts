import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CodeTabContext, ResourceDescriptor, SearchMatch } from '../../machine/ts/ide/common/models';
import { PieceTreeBuffer } from '../../machine/ts/ide/editor/text/piece_tree_buffer';
import { createLuaSemanticFrontendFromSnapshot, LuaSemanticWorkspace } from '../../machine/ts/ide/editor/contrib/intellisense/semantic/workspace';
import { getOrCreateSemanticWorkspace, resetSemanticWorkspace } from '../../machine/ts/ide/editor/contrib/intellisense/semantic/workspace/state';
import { CrossFileRenameManager, convertRangeToSearchMatch } from '../../machine/ts/ide/editor/contrib/rename/operations';
import { buildCodeTabId, clearCodeTabContexts, registerCodeTabContext } from '../../machine/ts/ide/workbench/ui/code_tab/contexts';
import { codeTabSessionState } from '../../machine/ts/ide/workbench/ui/code_tab/session_state';
import { tabSessionState } from '../../machine/ts/ide/workbench/ui/tab/session_state';
import { machineManager } from '../../machine/ts/core/machine_manager';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../machine/ts/lua/source_registry';

function codeContext(descriptor: ResourceDescriptor, source: string): CodeTabContext {
	const buffer = new PieceTreeBuffer(source);
	return {
		id: buildCodeTabId(descriptor),
		title: descriptor.path,
		descriptor,
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

	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', mainSource);
	workspace.updateFile('usage.lua', usageSource);
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: 'main.lua',
		namespace: 'test',
		projectRootPath: '',
		can_boot_from_source: true,
	};
	registerLuaSourceRecord(registry, {
		resid: 'usage.lua',
		type: 'lua',
		source_path: 'usage.lua',
		module_path: 'usage',
		src: usageSource,
		base_src: usageSource,
		update_timestamp: 0,
	});
	(machineManager as any).sourceState = {
		systemLuaSources: registry,
		cartLuaSources: null,
		activeLuaSources: registry,
		currentPath: registry.entry_path,
		luaSourceRegistries: [registry],
		luaSourceSearchRegistries: [registry],
		moduleCompileLuaSources: [registry],
	};

	clearCodeTabContexts();
	tabSessionState.tabs.length = 0;
	codeTabSessionState.activeContextId = null;
	tabSessionState.activeTabId = null;
	resetSemanticWorkspace();

	const usageDescriptor: ResourceDescriptor = { path: 'usage.lua', type: 'lua', asset_id: 'usage.lua' };
	const usageContext = codeContext(usageDescriptor, usageSource);
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

	const manager = new CrossFileRenameManager();
	const replacements = manager.applyRenameToChunk('usage.lua', otherRanges, 'worldState', 'main.lua');
	assert.equal(replacements, otherRanges.length);

	assert.equal(usageContext.dirty, true);
	assert.equal(usageContext.buffer.getText(), 'print(worldState.value)');
	assert.equal(tabSessionState.tabs[0]!.dirty, true);

	const updatedData = getOrCreateSemanticWorkspace().getFileData('usage.lua');
	assert.ok(updatedData);
	assert.equal(updatedData!.source.trim(), 'print(worldState.value)');

	const match: SearchMatch = convertRangeToSearchMatch({
		path: 'usage.lua',
		start: { line: 1, column: 7 },
		end: { line: 1, column: 17 },
	});
	assert.equal(match.start, 6);
	assert.equal(match.end, 17);
});
