import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CodeTabContext, SearchMatch } from '../../src/bmsx/console/ide/types';
import type { ConsoleResourceDescriptor } from '../../src/bmsx/console/types';
import { LuaSemanticWorkspace } from '../../src/bmsx/console/ide/semantic_workspace';
import { CrossFileRenameManager, convertRangeToSearchMatch, type CrossFileRenameDependencies } from '../../src/bmsx/console/ide/rename_cross_file';

function normalizeSource(source: string): string[] {
	return source.replace(/\r\n/g, '\n').split('\n');
}

test('cross file rename updates other chunks and workspace', () => {
	const workspace = new LuaSemanticWorkspace();
	const files = new Map<string, string>([
		['main.lua', [
			'state = { value = 1 }',
			'',
			'function update()',
			'\tstate.value = state.value + 1',
			'end',
		].join('\n')],
		['usage.lua', [
			'print(state.value)',
		].join('\n')],
	]);

	workspace.updateFile('main.lua', files.get('main.lua')!);
	workspace.updateFile('usage.lua', files.get('usage.lua')!);

	const contexts = new Map<string, CodeTabContext>();
	let entryTabId: string | null = null;
	const primaryAssetId: string | null = null;

	const makeContext = (descriptor: ConsoleResourceDescriptor): CodeTabContext => ({
		id: `lua:${descriptor.assetId}`,
		title: descriptor.assetId,
		descriptor,
		load: () => files.get(descriptor.assetId) ?? '',
		save: async (source: string) => {
			files.set(descriptor.assetId, source);
		},
		snapshot: null,
		lastSavedSource: files.get(descriptor.assetId) ?? '',
		saveGeneration: 0,
		appliedGeneration: 0,
		dirty: false,
		runtimeErrorOverlay: null,
		executionStopRow: null,
	});

	const dependencies: CrossFileRenameDependencies = {
		normalizeChunkReference(reference) {
			if (!reference) {
				return null;
			}
			let normalized = reference;
			if (normalized.startsWith('@')) {
				normalized = normalized.slice(1);
			}
			return normalized.replace(/\\/g, '/');
		},
		findResourceDescriptorForChunk(chunkPath) {
			const normalized = chunkPath.replace(/\\/g, '/');
			if (!files.has(normalized)) {
				throw new Error(`Missing chunk ${normalized}`);
			}
			return { path: normalized, type: 'lua', assetId: normalized };
		},
		createLuaCodeTabContext(descriptor) {
			return makeContext(descriptor);
		},
		createEntryTabContext() {
			return null;
		},
		getEntryTabId() {
			return entryTabId;
		},
		setEntryTabId(id) {
			entryTabId = id;
		},
		getPrimaryAssetId() {
			return primaryAssetId;
		},
		getCodeTabContext(id) {
			return contexts.get(id) ?? null;
		},
		setCodeTabContext(context) {
			contexts.set(context.id, context);
		},
		listCodeTabContexts() {
			return contexts.values();
		},
		splitLines(source) {
			return normalizeSource(source);
		},
		setTabDirty(tabId, dirty) {
			const context = contexts.get(tabId);
			if (context) {
				context.dirty = dirty;
			}
		},
	};

	const manager = new CrossFileRenameManager(dependencies, workspace);

	const definitionCol = files.get('main.lua')!.indexOf('state') + 1;
	const resolution = workspace.findReferencesByPosition('main.lua', 1, definitionCol);
	assert.ok(resolution);

	const otherRanges = resolution!.references
		.filter(ref => ref.file === 'usage.lua')
		.map(ref => ref.range);
	assert.ok(otherRanges.length > 0);

	const replacements = manager.applyRenameToChunk('usage.lua', otherRanges, 'worldState', 'main.lua');
	assert.equal(replacements, otherRanges.length);

	const usageContext = contexts.get('lua:usage.lua');
	assert.ok(usageContext);
	assert.ok(usageContext!.snapshot);
	assert.equal(usageContext!.snapshot!.dirty, true);
	assert.deepEqual(usageContext!.snapshot!.lines, ['print(worldState.value)']);

	const updatedData = workspace.getFileData('usage.lua');
	assert.ok(updatedData);
	assert.equal(updatedData!.source.trim(), 'print(worldState.value)');

	const match: SearchMatch | null = convertRangeToSearchMatch({
		chunkName: 'usage.lua',
		start: { line: 1, column: 7 },
		end: { line: 1, column: 17 },
	}, ['print(worldState.value)']);
	assert.ok(match);
	assert.equal(match!.start, 6);
	assert.equal(match!.end, 17);
});
