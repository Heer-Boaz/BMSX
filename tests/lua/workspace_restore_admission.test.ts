import assert from 'node:assert/strict';
import test from 'node:test';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { inputFocus } from '../../ide/input/focus';
import { createActualSourcePanes } from '../helpers/source_panes';

test('a document opening admitted during source hydration supersedes an older workspace restore request', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const state = parts.serialize(f.editor.editorInputSerializers);
	parts.clear();
	const request = parts.beginRestore(); t.after(() => request.dispose());
	const incoming = new CodeEditorInput(f.firstInput.workingCopy);
	parts.main.activeGroup.openEditor(incoming);
	assert.equal(request.isCurrent(), false);
	assert.equal(await request.restore(state, f.editor.editorInputSerializers), false);
	assert.ok(parts.main.activeGroup.model.activeTab === incoming);
	assert.equal(parts.documents.length, 0);
});

test('an unresolved newer document opening prevents older restored candidates from replacing its group', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	parts.main.activeGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const state = parts.serialize(f.editor.editorInputSerializers);
	parts.clear();
	let admitRecovered!: () => void, admitOpening!: () => void;
	const recoveredReady = new Promise<void>(resolve => { admitRecovered = resolve; });
	const openingReady = new Promise<void>(resolve => { admitOpening = resolve; });
	const serializer = f.editor.editorInputSerializers.code_editor;
	const serializers = { ...f.editor.editorInputSerializers, code_editor: {
		serialize: serializer.serialize.bind(serializer),
		async deserialize(value: string) { await recoveredReady; return serializer.deserialize(value); },
	} };
	const group = parts.main.activeGroup, request = parts.beginRestore();
	t.after(() => request.dispose());
	const recovery = request.restore(state, serializers);
	const incoming = new CodeEditorInput(f.firstInput.workingCopy);
	const opening = group.openResolvedEditor(async () => { await openingReady; return incoming; });
	assert.equal(request.isCurrent(), false);
	admitRecovered(); assert.equal(await recovery, false);
	assert.ok(parts.main.activeGroup === group);
	assert.equal(parts.documents.length, 0);
	admitOpening(); assert.ok(await opening !== undefined);
	assert.ok(group.model.activeTab === incoming);
	assert.equal(group.model.tabs.length, 1);
	assert.ok(inputFocus.admittedTarget === group.panes.activePane!.commandTarget);
});
