import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorSourceLocation } from '../../ide/editor/navigation/source_location';
import { inputFocus } from '../../ide/input/focus';
import { navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['target.lua', 'local target = 1\nreturn target\n']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'target.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	f.first.focus(); resetNavigationHistoryState();
	const location = (): EditorSourceLocation => ({ model, modelVersion: model.version, selection: { row: 1, startColumn: 7, endColumn: 13 } });
	return { ...f, model, location };
}

test('asynchronous source discovery retains its sender without creating topology, history or focus before admission', async t => {
	const f = fixture(t), read = Promise.withResolvers<EditorSourceLocation | undefined>();
	const generation = f.firstGroup.panes.openGeneration, focused = inputFocus.admittedTarget;
	const pending = f.editor.navigation.openSource(f.firstGroup, () => {
		assert.equal(f.firstGroup.panes.openGeneration, generation); return read.promise;
	}, 'side');
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === f.first);
	assert.ok(inputFocus.admittedTarget === focused); assert.equal(f.firstPart.groups.length, 1);
	assert.equal(navigationState.back.length, 0); assert.equal(navigationState.forward.length, 0);
	read.resolve(f.location()); assert.ok(await pending !== undefined);
	const side = f.firstPart.groups.find(group => group !== f.firstGroup)!;
	assert.ok(side.model.activeTab instanceof CodeEditorInput && side.model.activeTab.workingCopy === f.model);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('a later asynchronous Source request from the same retained sender owns admission', async t => {
	const f = fixture(t), first = Promise.withResolvers<EditorSourceLocation | undefined>(), second = Promise.withResolvers<EditorSourceLocation | undefined>();
	const earlier = f.editor.navigation.openSource(f.firstGroup, () => first.promise, 'side');
	const newer = f.editor.navigation.openSource(f.firstGroup, () => second.promise, 'side');
	first.resolve(f.location()); assert.equal(await earlier, undefined);
	assert.equal(f.firstPart.groups.length, 1);
	second.resolve(f.location()); assert.ok(await newer !== undefined);
	assert.equal(f.firstPart.groups.length, 2);
});

for (const change of ['clear', 'rebind', 'reselect', 'foreignFocus', 'sourceEdit', 'closePart'] as const)
	test(`pending source discovery cannot acquire a destination after ${change}`, async t => {
		const f = fixture(t), read = Promise.withResolvers<EditorSourceLocation | undefined>(), location = f.location();
		const pending = f.editor.navigation.openSource(f.firstGroup, () => read.promise, 'side');
		const newer = new HostErrorInput('new source attachment');
		if (change === 'clear') f.firstGroup.clear();
		else if (change === 'rebind') f.firstGroup.openEditor(newer);
		else if (change === 'reselect') f.firstGroup.activate(f.firstInput.id);
		else if (change === 'foreignFocus') f.second.focus();
		else if (change === 'sourceEdit') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed while reading\n' }]);
		else assert.equal(await f.editor.editorParts.close(f.firstPart), true);
		const focus = inputFocus.admittedTarget;
		read.resolve(location); assert.equal(await pending, undefined);
		assert.equal(f.firstPart.groups.length, 1); assert.equal(f.secondPart.groups.length, 1);
		assert.ok(inputFocus.admittedTarget === focus);
		if (change === 'rebind') assert.ok(f.firstGroup.model.activeTab === newer);
	});

test('a newer opening published during the async sender receipt cannot be adopted by that older request', async t => {
	const f = fixture(t), read = Promise.withResolvers<EditorSourceLocation | undefined>(), newer = new HostErrorInput('reentrant source');
	const unbind = f.firstGroup.panes.onDidBeginOpen(() => { unbind(); f.firstGroup.openEditor(newer); }); t.after(unbind);
	const pending = f.editor.navigation.openSource(f.firstGroup, () => read.promise, 'side');
	read.resolve(f.location()); assert.equal(await pending, undefined);
	assert.equal(f.firstPart.groups.length, 1);
	assert.ok(f.firstGroup.model.activeTab === newer && f.firstGroup.panes.activePane?.input === newer);
});

test('asynchronous source failure propagates without opening a destination or consuming history', async t => {
	const f = fixture(t), failure = new Error('source observation failed');
	const pending = f.editor.navigation.openSource(f.firstGroup, () => Promise.reject(failure), 'side');
	await assert.rejects(pending!, error => error === failure);
	assert.equal(f.firstPart.groups.length, 1); assert.equal(navigationState.back.length, 0);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && inputFocus.admittedTarget === f.first.commandTarget);
});
