import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { editorDiagnosticsState } from '../../ide/editor/contrib/diagnostics/state';
import type { CodeTabContext } from '../../ide/workbench/ui/code_tab/model';
import {
	codeEditorModelManager,
	CodeEditorModelManager,
} from '../../ide/workbench/ui/code_tab/model_manager';
import { collectDiagnosticsBatch } from '../../ide/workbench/contrib/code_editor/diagnostics/controller';
import { editorTabGroup, EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';

function codeContext(path: string): CodeTabContext {
	const source = 'return true';
	const buffer = new PieceTreeBuffer(source);
	return {
		id: `code:0\0${path}`,
		title: path,
		resource: {
			domain: 0,
			path,
			source: {
				resid: path,
				type: 'lua',
				source_path: path,
				generated: false,
			},
		},
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

test('editor group closure and text model retention have separate owners', () => {
	const context = codeContext('retained.lua');
	const models = new CodeEditorModelManager();
	models.register(context);
	const group = new EditorTabGroupModel();
	const tab = {
		id: context.id,
		kind: 'code_editor',
		title: context.title,
		closable: true,
		context,
	} as const;
	group.initialize(tab);
	group.removeAt(0);

	assert.equal(group.tabs.length, 0);
	assert.equal(group.activeTab, null);
	assert.strictEqual(models.get(context.id), context);
});

test('diagnostics select a retained dirty model while a non-code input is active', (t) => {
	editorTabGroup.clear();
	codeEditorModelManager.clear();
	editorDiagnosticsState.dirtyDiagnosticContexts.clear();
	const context = codeContext('background.lua');
	context.dirty = true;
	const resourceTab = {
		id: 'resource:0\0image.png',
		kind: 'resource_view',
		title: 'image.png',
		closable: true,
		resource: {
			resource: {
				domain: 0,
				path: 'image.png',
				source: {
					resid: 'image',
					type: 'image',
					source_path: 'image.png',
					generated: false,
				},
			},
			lines: [],
			error: '',
			title: 'image.png',
			scroll: 0,
		},
	} as const;
	codeEditorModelManager.register(context);
	editorTabGroup.initialize(resourceTab);
	editorDiagnosticsState.dirtyDiagnosticContexts.add(context.id);
	t.after(() => {
		editorTabGroup.clear();
		codeEditorModelManager.clear();
		editorDiagnosticsState.dirtyDiagnosticContexts.clear();
	});

	assert.deepEqual(collectDiagnosticsBatch(), [context.id]);
});
