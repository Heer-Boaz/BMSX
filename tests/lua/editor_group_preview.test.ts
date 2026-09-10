import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { EditorTabGroupModel, editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import { openEditorTab } from '../../ide/workbench/ui/tabs';
import { createTestEditorPanes } from '../helpers/editor_panes';
import { navigationState } from '../../ide/navigation/navigation_history';

function scene(path: string) {
	return new SceneEditorInput(new EditorTextModel({ domain: 0, path, source: { type: 'lua', resid: path } }, 'lua', 'return {}'));
}

test('one group preview replaces only its clean predecessor and keeps its tab position', () => {
	const group = new EditorTabGroupModel();
	const first = scene('first.lua'), second = scene('second.lua'), third = scene('third.lua');
	group.add(first, { pinned: false }); group.add(second);
	let closed = 0;
	first.onWillDispose(() => { closed += 1; });
	group.add(third, { pinned: false });
	assert.deepEqual(group.tabs, [third, second]);
	assert.equal(group.previewTab, third); assert.equal(closed, 1);
	assert.match(group.getLabel(third), /^PREVIEW:/);
	group.pin(third);
	assert.equal(group.previewTab, null); assert.doesNotMatch(group.getLabel(third), /^PREVIEW:/);
	group.clear();
});

test('editing a shared model promotes its preview; Undo to clean never unpins it', () => {
	const group = new EditorTabGroupModel();
	const visual = scene('shared.lua');
	const code = new CodeEditorInput({ id: 'code:0\0shared.lua', title: 'shared.lua', model: visual.workingCopy,
		view: createCodeEditorViewState(), runtimeErrorOverlay: null, executionStopRow: null });
	group.add(code); group.add(visual, { pinned: false });
	code.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- edit\n' }]);
	assert.equal(group.previewTab, null); assert.equal(visual.isDirty(), true);
	code.workingCopy.undo(); assert.equal(visual.isDirty(), false); assert.equal(group.previewTab, null);
	const next = scene('next.lua'); group.add(next, { pinned: false });
	assert.ok(group.tabs.includes(visual));
	group.clear();
	// Disposed input listeners no longer retain the group or publish labels.
	visual.setLabel('closed', 'old.lua');
	visual.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- closed\n' }]);
	assert.equal(group.tabs.length, 0); assert.equal(group.previewTab, null);
});

test('already dirty documents cannot become previews; duplicate labels disambiguate at metadata boundaries', () => {
	const group = new EditorTabGroupModel();
	const a = scene('a.lua'), b = scene('b.lua');
	a.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	group.add(a, { pinned: false }); assert.equal(group.previewTab, null);
	assert.equal(group.getLabel(a), 'SCENE EDITOR');
	group.add(b);
	assert.match(group.getLabel(a), /a\.lua/); assert.match(group.getLabel(b), /b\.lua/);
	b.setLabel('renamed', 'new.lua');
	assert.equal(group.getLabel(a), 'SCENE EDITOR'); assert.equal(group.getLabel(b), 'renamed');
	group.clear();
});

test('workbench preview replacement detaches the pane before disposal, and history cannot retain a closed preview', t => {
	const panes = createTestEditorPanes();
	t.after(() => { panes.dispose(); editorTabGroup.clear(); });
	const kept = scene('kept.lua'), first = scene('preview.lua'), next = scene('next.lua');
	openEditorTab(panes, kept); openEditorTab(panes, first, { pinned: false });
	let detached = false;
	first.onWillDispose(() => { detached = panes.activePane?.input !== first; });
	openEditorTab(panes, next, { pinned: false });
	assert.equal(detached, true); assert.equal(panes.activePane?.input, next);
	assert.ok(navigationState.back.every(entry => !entry.isDisposed && (entry.target.kind !== 'input' || entry.target.input !== first)));
	openEditorTab(panes, next); assert.equal(editorTabGroup.previewTab, null);
	openEditorTab(panes, kept, { pinned: false });
	assert.equal(editorTabGroup.previewTab, null, 'preview opening an already kept input does not unpin it');
});
