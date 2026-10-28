import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { inputFocus } from '../../ide/input/focus';
import { navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { createActualSourcePanes } from '../helpers/source_panes';

test('synchronous model admission cannot replace a newer group opening', t => {
	const f = createActualSourcePanes(t, false, [['produced.lua', 'return 3\n']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'produced.lua' })!;
	const newer = new HostErrorInput('newer opening');
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource === resource) f.firstGroup.openEditor(newer);
	}));
	f.first.focus();
	let disposed = 0;
	const result = f.firstGroup.openProducedEditor(() => {
		const candidate = resolveLuaCodeEditorInput(f.sources.catalog, resource);
		candidate.onWillDispose(() => { disposed++; });
		return candidate;
	});
	assert.ok(result === undefined);
	assert.ok(f.firstGroup.model.activeTab === newer && f.firstGroup.panes.activePane?.input === newer);
	assert.equal(disposed, 1);
});

test('synchronous model admission preserves newer foreign focus while attaching in the background', t => {
	const f = createActualSourcePanes(t, false, [['produced.lua', 'return 3\n']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'produced.lua' })!;
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource === resource) f.second.focus();
	}));
	f.first.focus();
	const result = f.firstGroup.openProducedEditor(() => resolveLuaCodeEditorInput(f.sources.catalog, resource));
	assert.ok(result instanceof CodeEditorInput && result.workingCopy.resource === resource);
	assert.ok(f.firstGroup.panes.activePane?.input === result);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
});

test('produced openings return the retained coalesced receiver rather than the disposed offer', t => {
	const f = createActualSourcePanes(t), candidate = new CodeEditorInput(f.firstInput.workingCopy);
	let disposed = 0;
	candidate.onWillDispose(() => { disposed++; });
	f.first.focus();
	const result = f.firstGroup.openProducedEditor(() => candidate);
	assert.ok(result === f.firstInput && f.firstGroup.panes.activePane?.input === result);
	assert.equal(disposed, 1); assert.equal(f.firstGroup.model.contains(candidate), false);
});

test('undefined production leaves membership and departure history unchanged', t => {
	const f = createActualSourcePanes(t);
	f.first.focus(); resetNavigationHistoryState(); t.after(resetNavigationHistoryState);
	const generation = f.firstGroup.panes.openGeneration;
	const result = f.firstGroup.openProducedEditor(() => {
		assert.ok(f.firstGroup.panes.openGeneration > generation);
		assert.ok(f.firstGroup.panes.activePane?.input === f.firstInput);
		return undefined;
	});
	assert.ok(result === undefined);
	assert.ok(f.firstGroup.model.tabs.length === 1 && f.firstGroup.model.tabs[0] === f.firstInput);
	assert.equal(navigationState.back.length, 0); assert.equal(navigationState.forward.length, 0);
});

test('retired request subjects and closed group admission do not invoke a producer', t => {
	const f = createActualSourcePanes(t), generation = f.firstGroup.panes.openGeneration;
	let produced = 0;
	assert.ok(f.firstGroup.openProducedEditor(() => { produced++; return f.firstInput; }, { isCurrent: () => false }) === undefined);
	assert.equal(produced, 0); assert.equal(f.firstGroup.panes.openGeneration, generation);
	f.firstGroup.setOpenAdmission(false);
	assert.ok(f.firstGroup.openProducedEditor(() => { produced++; return f.firstInput; }) === undefined);
	assert.equal(produced, 0); assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('a subject revoked during production disposes only its unadmitted offer', t => {
	const f = createActualSourcePanes(t), candidate = new CodeEditorInput(f.secondInput.workingCopy);
	let current = true, disposed = 0;
	candidate.onWillDispose(() => { disposed++; });
	f.first.focus();
	assert.ok(f.firstGroup.openProducedEditor(() => { current = false; return candidate; }, { isCurrent: () => current }) === undefined);
	assert.equal(disposed, 1); assert.ok(f.firstGroup.panes.activePane?.input === f.firstInput);
});

test('a superseded producer cannot dispose an input already retained by its group', t => {
	const f = createActualSourcePanes(t), newer = new HostErrorInput('newer opening');
	let disposed = 0;
	f.firstInput.onWillDispose(() => { disposed++; });
	f.first.focus();
	assert.ok(f.firstGroup.openProducedEditor(() => {
		f.firstGroup.openEditor(newer);
		return f.firstInput;
	}) === undefined);
	assert.equal(disposed, 0); assert.ok(f.firstGroup.model.contains(f.firstInput));
	assert.ok(f.firstGroup.panes.activePane?.input === newer);
});

test('the shared asynchronous opening lifetime also preserves a retained input returned after supersession', async t => {
	const f = createActualSourcePanes(t), newer = new HostErrorInput('newer opening');
	let resolve!: (input: CodeEditorInput) => void, disposed = 0;
	f.firstInput.onWillDispose(() => { disposed++; });
	f.first.focus();
	const pending = f.firstGroup.openResolvedEditor(() => new Promise<CodeEditorInput>(accept => { resolve = accept; }));
	f.firstGroup.openEditor(newer); resolve(f.firstInput);
	assert.equal(await pending, undefined); assert.equal(disposed, 0);
	assert.ok(f.firstGroup.model.contains(f.firstInput) && f.firstGroup.panes.activePane?.input === newer);
});

test('produced candidates use normal invalid-draft admission without losing the draft', t => {
	const f = createActualSourcePanes(t), candidate = new CodeEditorInput(f.secondInput.workingCopy);
	const control = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => {});
	t.after(() => { control.cancel(); control.dispose(); });
	control.setValue(1); control.layout(f.firstGroup.panes.contentBounds);
	control.field.focusTarget.focus(); setFieldText(control.field, 'invalid', true);
	let disposed = 0;
	candidate.onWillDispose(() => { disposed++; });
	assert.ok(f.firstGroup.openProducedEditor(() => candidate) === undefined);
	assert.equal(disposed, 1); assert.equal(control.pending, true);
	assert.ok(inputFocus.admittedTarget === control.field.focusTarget && f.firstGroup.panes.activePane?.input === f.firstInput);
});

test('destination draft publication can supersede a produced candidate before attachment', t => {
	const f = createActualSourcePanes(t), candidate = new CodeEditorInput(f.secondInput.workingCopy), newer = new HostErrorInput('draft-selected opening');
	const control = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => { f.firstGroup.openEditor(newer); });
	t.after(() => control.dispose());
	control.setValue(1); control.layout(f.firstGroup.panes.contentBounds);
	control.field.focusTarget.focus(); setFieldText(control.field, '2', true);
	let disposed = 0;
	candidate.onWillDispose(() => { disposed++; });
	assert.ok(f.firstGroup.openProducedEditor(() => candidate) === undefined);
	assert.equal(disposed, 1); assert.equal(control.pending, false);
	assert.ok(f.firstGroup.panes.activePane?.input === newer);
});

test('produced openings capture the departing Source location before model admission', t => {
	const f = createActualSourcePanes(t), candidate = new CodeEditorInput(f.secondInput.workingCopy);
	f.first.focus(); f.firstInput.context.view.cursorRow = 1; f.firstInput.context.view.cursorColumn = 7;
	resetNavigationHistoryState(); t.after(resetNavigationHistoryState);
	const result = f.firstGroup.openProducedEditor(() => candidate);
	assert.ok(result === candidate);
	assert.equal(navigationState.back.length, 1);
	const departure = navigationState.back[0];
	assert.ok(departure.owner === f.firstGroup && departure.target.kind === 'resource'
		&& departure.target.resource.path === f.firstInput.workingCopy.resource.path);
});
