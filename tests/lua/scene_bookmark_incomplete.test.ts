import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneBookmark } from '../../ide/workbench/contrib/scene_editor/scene_bookmark';
import { SceneNavigationLocation } from '../../ide/workbench/contrib/scene_editor/scene_navigation';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { NavigationHistoryEntry, navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { createSceneDocumentFixture } from '../helpers/scene_document_fixture';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('first', { objects = { { member_id = 'actor', definition_id = 'actor' } } })
scenes.register('second', { objects = { { member_id = 'other', definition_id = 'actor' } } })
`;

async function fixture(t: test.TestContext) {
	const f = await createSceneDocumentFixture(t, SOURCE, []);
	const input = f.primary.input; assert.ok(input instanceof SceneEditorInput);
	assert.equal(selectSceneOutlineRow(input.view.hierarchy, 1), true); f.update();
	const bookmark = new SceneBookmark(input.view.authoring, input.view); t.after(() => bookmark.dispose());
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof CodeEditorPane); pane.focus();
	return { ...f, bookmark };
}

test('Scene bookmark refuses incomplete Source without retiring its tracked occurrence or member', async t => {
	const f = await fixture(t), selected = f.bookmark.view.selected;
	assert.ok(selected?.kind === 'member');
	const offset = f.model.buffer.getText().indexOf("'first'") + "'first".length;
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + 1, ''), true); f.update();
	assert.notEqual(f.ide.sceneSources.get(f.model).analysis.chunk.syntaxError, null);
	assert.equal(f.bookmark.resolve(f.ide.sceneSources), undefined);
	assert.equal(f.bookmark.isDisposed, false);
	assert.ok(f.bookmark.view.selected?.kind === 'member');
	assert.equal(f.editor.textTarget!.replaceText(offset, offset, "'"), true); f.update();
	let resolved = f.bookmark.resolve(f.ide.sceneSources); assert.ok(resolved !== undefined);
	assert.ok(resolved.scene === f.ide.sceneSources.get(f.model).scenes[0]);
	assert.ok(f.bookmark.view.selected?.kind === 'member');
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	assert.equal(f.bookmark.resolve(f.ide.sceneSources), undefined); assert.equal(f.bookmark.isDisposed, false);
	f.key('KeyY', KeyModifier.ctrl); f.update();
	resolved = f.bookmark.resolve(f.ide.sceneSources); assert.ok(resolved !== undefined);
	assert.ok(resolved.scene === f.ide.sceneSources.get(f.model).scenes[0]);
	assert.ok(f.bookmark.view.selected?.kind === 'member');
});

test('an unrelated syntax error does not block an exactly recognized Scene bookmark', async t => {
	const f = await fixture(t), offset = f.model.buffer.length;
	assert.equal(f.editor.textTarget!.replaceText(offset, offset, "local incomplete = '"), true); f.update();
	const document = f.ide.sceneSources.get(f.model);
	assert.notEqual(document.analysis.chunk.syntaxError, null);
	assert.ok(document.scenes.length > 0, 'the recovery parser still projects an earlier registration');
	const current = f.bookmark.resolve(f.ide.sceneSources); assert.ok(current !== undefined);
	assert.ok(current.scene === document.scenes[0]);
	assert.equal(f.bookmark.isDisposed, false); assert.ok(f.bookmark.view.selected?.kind === 'member');
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	const resolved = f.bookmark.resolve(f.ide.sceneSources); assert.ok(resolved !== undefined);
	assert.ok(resolved.scene === f.ide.sceneSources.get(f.model).scenes[0]);
});

test('a bookmark captured while Source is incomplete retains only the exact mapped occurrence', async t => {
	const f = await fixture(t), input = f.primary.input; assert.ok(input instanceof SceneEditorInput);
	const offset = f.model.buffer.getText().indexOf("'first'") + "'first".length;
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + 1, ''), true); f.update();
	const bookmark = new SceneBookmark(input.view.authoring, input.view); t.after(() => bookmark.dispose());
	assert.equal(bookmark.isDisposed, false); assert.ok(bookmark.view.selected?.kind === 'member');
	assert.equal(bookmark.resolve(f.ide.sceneSources), undefined);
	assert.equal(f.editor.textTarget!.replaceText(offset, offset, "'"), true); f.update();
	const resolved = bookmark.resolve(f.ide.sceneSources); assert.ok(resolved !== undefined);
	assert.ok(resolved.scene === f.ide.sceneSources.get(f.model).scenes[0]);
	assert.ok(bookmark.view.selected?.kind === 'member');
});

test('Back retains an incomplete Scene destination until its exact source occurrence is recognized', async t => {
	const f = await fixture(t), input = f.primary.input; assert.ok(input instanceof SceneEditorInput);
	const location = new SceneNavigationLocation(input, f.group, f.editor.sceneEditor);
	resetNavigationHistoryState(); t.after(() => resetNavigationHistoryState());
	const entry = new NavigationHistoryEntry({ kind: 'location', location }); navigationState.back.push(entry);
	const offset = f.model.buffer.getText().indexOf("'first'") + "'first".length;
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + 1, ''), true); f.update();
	await f.editor.navigation.goBackward(); f.update();
	assert.equal(location.isDisposed, false); assert.ok(navigationState.back.includes(entry));
	assert.equal(f.editor.textTarget!.replaceText(offset, offset, "'"), true); f.update();
	await f.editor.navigation.goBackward(); f.update();
	assert.equal(entry.isDisposed, true); assert.equal(navigationState.back.includes(entry), false);
	assert.ok(f.group.model.activeTab === input);
});

test('a valid Source with no matching registration suspends the bookmark until Undo', async t => {
	const f = await fixture(t), name = 'scenes.register', offset = f.model.buffer.getText().indexOf(name);
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + name.length, 'scenes.not_here'), true); f.update();
	assert.equal(f.ide.sceneSources.get(f.model).analysis.chunk.syntaxError, null);
	assert.equal(f.bookmark.resolve(f.ide.sceneSources), undefined); assert.equal(f.bookmark.isDisposed, false);
	assert.ok(f.bookmark.view.selected?.kind === 'member');
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	assert.ok(f.bookmark.resolve(f.ide.sceneSources) !== undefined); assert.equal(f.bookmark.isDisposed, false);
});

test('a temporarily unrecognized registration regains its bookmark through Undo without an intervening navigation', async t => {
	const f = await fixture(t), name = 'scenes.register', offset = f.model.buffer.getText().indexOf(name);
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + name.length, 'scenes.not_here'), true); f.update();
	assert.equal(f.ide.sceneSources.get(f.model).analysis.chunk.syntaxError, null);
	assert.equal(f.bookmark.isDisposed, false);
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	assert.ok(f.bookmark.resolve(f.ide.sceneSources) !== undefined); assert.equal(f.bookmark.isDisposed, false);
});

test('a bookmark outlives its closed Scene input and follows shared Source generations', async t => {
	const f = await fixture(t), input = f.primary.input;
	assert.equal(await f.group.close(input.id), true);
	assert.equal(f.bookmark.isDisposed, false);
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof CodeEditorPane); pane.focus();
	const name = 'scenes.register', offset = f.model.buffer.getText().indexOf(name);
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + name.length, 'scenes.not_here'), true); f.update();
	assert.equal(f.bookmark.isDisposed, false); assert.equal(f.bookmark.resolve(f.ide.sceneSources), undefined);
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	assert.ok(f.bookmark.resolve(f.ide.sceneSources) !== undefined); assert.equal(f.bookmark.isDisposed, false);
});

test('replacing the entire tracked Scene occurrence retires its bookmark before Undo can recreate it', async t => {
	const f = await fixture(t), document = f.ide.sceneSources.get(f.model);
	const range = luaSourceRangeToTextRange(f.model.buffer, document.scenes[0].range);
	assert.equal(f.editor.textTarget!.replaceText(range.start, range.end, '{}'), true); f.update();
	assert.equal(f.bookmark.isDisposed, true);
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	assert.equal(f.bookmark.resolve(f.ide.sceneSources), undefined); assert.equal(f.bookmark.isDisposed, true);
});
