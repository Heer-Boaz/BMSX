import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { editorFeedbackState } from '../../ide/common/feedback_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { inputFocus } from '../../ide/input/focus';
import { createNavigationEntry, navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import { EditorOpeningRequest, type PreparedEditorInput, type ProspectiveEditorOpenSource } from '../../ide/workbench/services/editor/editor_opening';
import type { EditorOpenDestination } from '../../ide/workbench/services/editor/editor_parts';
import type { WorkbenchSurface } from '../../ide/workbench/services/windows/model';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { createActualSourcePanes } from '../helpers/source_panes';

/** A source lease and deferred production, without inventing an attached source editor. */
function pendingOpening() {
	let finish!: (prepared: PreparedEditorInput | undefined) => void;
	let begin!: (group: EditorGroupView) => void;
	const pending = new Promise<PreparedEditorInput | undefined>(resolve => { finish = resolve; });
	const started = new Promise<EditorGroupView>(resolve => { begin = resolve; });
	const state = { current: true, resolutions: 0, receiver: undefined as EditorGroupView | undefined };
	const source: ProspectiveEditorOpenSource = {
		kind: 'opening', isCurrent: () => state.current, findExisting: () => undefined,
		resolve: group => { state.resolutions++; state.receiver = group; begin(group); return pending; },
	};
	return { source, state, finish, started };
}

test('explicit opening placement beats ordinary affinity without moving the matching sibling view', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const identity = f.firstInput.toResourceEditor();
	let resolved: EditorGroupView | undefined;
	const source: ProspectiveEditorOpenSource = {
		kind: 'opening', isCurrent: () => true, findExisting: group => group.model.findByResourceEditor(identity),
		resolve: group => { resolved = group; return { input: new CodeEditorInput(f.firstInput.workingCopy) }; },
	};
	const admitted = await parts.openAt(source, { kind: 'group', group: f.secondGroup });
	assert.ok(resolved === f.secondGroup && admitted instanceof CodeEditorInput && admitted !== f.firstInput);
	assert.ok(parts.findGroup(f.firstInput) === f.firstGroup && parts.findGroup(admitted) === f.secondGroup);
	assert.ok(f.secondGroup.panes.activePane?.input === admitted && admitted.workingCopy === f.firstInput.workingCopy);
	assert.equal(parts.documents.length, 2); assert.equal(f.secondPart.groups.length, 1);
});

test('opening publishes the requested tab gap and prepared selection on its exact retained receiver', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, target = f.secondGroup;
	const home = new HomeInput(null); target.openEditor(home);
	const candidate = new CodeEditorInput(f.firstInput.workingCopy);
	let released = 0, observed = 0, coherent = true;
	t.after(target.model.onDidChange(change => {
		if (change !== 'editors' || !target.model.contains(candidate)) return;
		observed++; coherent = coherent && target.model.tabs[0] === f.secondInput && target.model.tabs[1] === candidate && target.model.tabs[2] === home;
	}));
	const source: ProspectiveEditorOpenSource = {
		kind: 'opening', isCurrent: () => true, findExisting: () => undefined,
		resolve: () => ({ input: candidate, options: { selection: { row: 1, startColumn: 2, endColumn: 8 } }, dispose: () => { released++; } }),
	};
	const admitted = await parts.openAt(source, { kind: 'group', group: target, index: 1 });
	assert.ok(admitted === candidate && target.panes.activePane?.input === candidate);
	assert.equal(observed, 1); assert.equal(coherent, true); assert.equal(released, 1);
	assert.ok(target.model.previewTab !== candidate);
	assert.equal(candidate.context.view.cursorRow, 1); assert.equal(candidate.context.view.cursorColumn, 2);
	assert.deepEqual(candidate.context.view.selectionAnchor, { row: 1, column: 8 });
});

test('opening a matching receiver retains its identity and tab position rather than returning a disposed offer', async t => {
	const f = createActualSourcePanes(t, true), target = f.secondGroup;
	const home = new HomeInput(null); target.openEditor(home);
	const identity = f.firstInput.toResourceEditor();
	let disposed = 0;
	const source: ProspectiveEditorOpenSource = {
		kind: 'opening', isCurrent: () => true, findExisting: group => group.model.findByResourceEditor(identity),
		resolve: () => {
			const candidate = new CodeEditorInput(f.firstInput.workingCopy); candidate.onWillDispose(() => { disposed++; });
			return { input: candidate };
		},
	};
	const admitted = await f.editor.editorParts.openAt(source, { kind: 'group', group: target });
	assert.ok(admitted === f.secondInput && target.model.tabs[0] === admitted && target.model.tabs[1] === home);
	assert.ok(target.panes.activePane?.input === admitted); assert.equal(disposed, 1);
});

test('a prepared navigation selection is consumed by the actual coalesced view before its source lease retires', async t => {
	const f = createActualSourcePanes(t, true), candidate = new CodeEditorInput(f.firstInput.workingCopy);
	candidate.context.view.cursorRow = 1; candidate.context.view.cursorColumn = 7;
	const selection = new CodeEditorNavigationSelection(candidate);
	candidate.context.view.cursorRow = 0; candidate.context.view.cursorColumn = 0;
	let released = 0;
	const source: ProspectiveEditorOpenSource = { kind: 'opening', isCurrent: () => true,
		findExisting: group => group.model.findById(candidate.id),
		resolve: () => ({ input: candidate, options: { navigationSelection: selection }, dispose: () => { released++; selection.dispose(); } }),
	};
	assert.ok(await f.editor.editorParts.openAt(source, { kind: 'group', group: f.secondGroup }) === f.secondInput);
	assert.equal(f.secondInput.context.view.cursorRow, 1); assert.equal(f.secondInput.context.view.cursorColumn, 7); assert.equal(released, 1);
});

for (const kind of ['split', 'window'] as const) test(`${kind} opening keeps prospective controls unpresented and topology unpublished while resolution waits`, async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = pendingOpening();
	const groups = parts.groups.length, documents = parts.documents.length, provisional: WorkbenchSurface[] = [];
	const attach = f.editor.surfaces.attach.bind(f.editor.surfaces);
	t.mock.method(f.editor.surfaces, 'attach', options => { const surface = attach(options); provisional.push(surface); return surface; });
	let published = 0, coherent = true;
	t.after(parts.onDidChange(() => {
		if (kind === 'split' ? f.secondPart.groups.length === 1 : parts.documents.length === documents) return;
		published++;
		const receiver = request.state.receiver;
		coherent = coherent && receiver !== undefined && parts.groups.includes(receiver) && receiver.model.tabs.length === 1 && receiver.panes.activePane?.input === receiver.model.activeTab;
	}));
	const destination: EditorOpenDestination = kind === 'split'
		? { kind, group: f.secondGroup, direction: 'right' } : { kind, reference: f.secondGroup };
	const pending = parts.openAt(request.source, destination);
	await request.started;
	assert.equal(request.state.resolutions, 1);
	assert.ok(request.state.receiver !== undefined && request.state.receiver !== f.secondGroup && request.state.receiver !== f.firstGroup);
	assert.equal(parts.groups.length, groups); assert.equal(parts.documents.length, documents); assert.equal(f.secondPart.groups.length, 1);
	assert.equal(published, 0); assert.ok(provisional.every(surface => !surface.visible));
	const candidate = new CodeEditorInput(f.firstInput.workingCopy); request.finish({ input: candidate });
	const admitted = await pending, receiver = request.state.receiver!;
	assert.ok(admitted === candidate && parts.findGroup(candidate) === receiver && receiver.panes.activePane?.input === candidate);
	assert.ok(published > 0 && coherent); assert.equal(parts.groups.length, groups + 1);
	assert.equal(parts.documents.length, documents + (kind === 'window' ? 1 : 0));
	assert.ok(receiver.surface.visible && receiver.paneSurface.visible);
});

for (const kind of ['split', 'window'] as const) test(`${kind} undefined production publishes no empty group or window and retires all provisional controls`, async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = pendingOpening();
	const groups = parts.groups.length, documents = parts.documents.length, provisional: WorkbenchSurface[] = [];
	const attach = f.editor.surfaces.attach.bind(f.editor.surfaces);
	t.mock.method(f.editor.surfaces, 'attach', options => { const surface = attach(options); provisional.push(surface); return surface; });
	const destination: EditorOpenDestination = kind === 'split'
		? { kind, group: f.secondGroup, direction: 'right' } : { kind, reference: f.secondGroup };
	const pending = parts.openAt(request.source, destination); await request.started; request.finish(undefined);
	assert.ok(await pending === undefined);
	assert.equal(parts.groups.length, groups); assert.equal(parts.documents.length, documents); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(provisional.every(surface => surface.retired));
	assert.ok(f.firstGroup.panes.activePane?.input === f.firstInput && f.secondGroup.panes.activePane?.input === f.secondInput);
});

test('a retired source lease rejects before producer work or prospective construction', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = pendingOpening();
	const generation = f.secondGroup.panes.openGeneration;
	request.state.current = false;
	let attached = 0; const attach = f.editor.surfaces.attach.bind(f.editor.surfaces);
	t.mock.method(f.editor.surfaces, 'attach', options => { attached++; return attach(options); });
	for (const destination of [{ kind: 'group', group: f.secondGroup }, { kind: 'split', group: f.secondGroup, direction: 'right' },
		{ kind: 'window', reference: f.secondGroup }] as const) assert.ok(await parts.openAt(request.source, destination) === undefined);
	assert.equal(request.state.resolutions, 0); assert.equal(attached, 0); assert.equal(parts.documents.length, 2); assert.equal(f.secondPart.groups.length, 1);
	assert.equal(f.secondGroup.panes.openGeneration, generation);
});

test('entry preflight publication of a newer target request cancels before producer work', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, newer = new HostErrorInput('entry-preflight newer request');
	let publish = true, resolutions = 0;
	const source: ProspectiveEditorOpenSource = { kind: 'opening',
		isCurrent: () => { if (publish) { publish = false; f.secondGroup.openEditor(newer); } return true; },
		findExisting: () => undefined, resolve: () => { resolutions++; return { input: new CodeEditorInput(f.firstInput.workingCopy) }; },
	};
	assert.ok(await parts.openAt(source, { kind: 'group', group: f.secondGroup }) === undefined);
	assert.equal(resolutions, 0); assert.ok(f.secondGroup.panes.activePane?.input === newer);
});

test('entry preflight publication of foreign focus preserves that focus through accepted background attachment', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.second.focus(); let publish = true;
	const candidate = new CodeEditorInput(f.firstInput.workingCopy);
	const source: ProspectiveEditorOpenSource = { kind: 'opening',
		isCurrent: () => { if (publish) { publish = false; f.first.focus(); } return true; },
		findExisting: () => undefined, resolve: () => ({ input: candidate }),
	};
	assert.ok(await parts.openAt(source, { kind: 'group', group: f.secondGroup }) === candidate);
	assert.ok(f.secondGroup.panes.activePane?.input === candidate);
	assert.ok(inputFocus.admittedTarget === f.first.commandTarget && parts.activePart === f.firstPart && parts.activeGroup === f.firstGroup);
});

for (const kind of ['split', 'window'] as const) test(`${kind} source retirement during resolution retires its offer without publishing placement`, async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = pendingOpening();
	const destination: EditorOpenDestination = kind === 'split'
		? { kind, group: f.secondGroup, direction: 'right' } : { kind, reference: f.secondGroup };
	const pending = parts.openAt(request.source, destination); await request.started;
	const candidate = new CodeEditorInput(f.firstInput.workingCopy);
	let disposed = 0, released = 0; candidate.onWillDispose(() => { disposed++; });
	request.state.current = false; request.finish({ input: candidate, dispose: () => { released++; } });
	assert.ok(await pending === undefined); assert.equal(disposed, 1); assert.equal(released, 1);
	assert.equal(parts.documents.length, 2); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(request.state.receiver!.surface.retired);
});

test('a newer receiver opening during asynchronous production owns the pane and rejects only the late offer', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = pendingOpening();
	const pending = parts.openAt(request.source, { kind: 'group', group: f.secondGroup });
	await request.started;
	const newer = new HostErrorInput('newer receiver request'); f.secondGroup.openEditor(newer);
	const candidate = new CodeEditorInput(f.firstInput.workingCopy); let disposed = 0; candidate.onWillDispose(() => { disposed++; });
	request.finish({ input: candidate });
	assert.ok(await pending === undefined); assert.equal(disposed, 1);
	assert.ok(f.secondGroup.model.activeTab === newer && f.secondGroup.panes.activePane?.input === newer);
});

test('source-current publication after resolution cannot overwrite a newer receiver opening', async t => {
	const f = createActualSourcePanes(t), request = pendingOpening(), newer = new HostErrorInput('source-current newer request');
	let publish = false;
	request.source.isCurrent = () => {
		// Files declaration admission can synchronize its index and publish listeners here.
		if (publish) { publish = false; f.secondGroup.openEditor(newer); }
		return request.state.current;
	};
	const pending = f.editor.editorParts.openAt(request.source, { kind: 'group', group: f.secondGroup });
	await request.started;
	const candidate = new CodeEditorInput(f.firstInput.workingCopy); let disposed = 0; candidate.onWillDispose(() => { disposed++; });
	publish = true; request.finish({ input: candidate });
	assert.ok(await pending === undefined); assert.equal(disposed, 1);
	assert.ok(f.secondGroup.panes.activePane?.input === newer);
});

for (const kind of ['split', 'window'] as const) test(`${kind} anchor supersession during production cancels the prospective receiver without publishing it`, async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = pendingOpening();
	const destination: EditorOpenDestination = kind === 'split'
		? { kind, group: f.secondGroup, direction: 'right' } : { kind, reference: f.secondGroup };
	const pending = parts.openAt(request.source, destination), receiver = await request.started;
	const newer = new HostErrorInput('newer anchor request'); f.secondGroup.openEditor(newer);
	const candidate = new CodeEditorInput(f.firstInput.workingCopy); let disposed = 0; candidate.onWillDispose(() => { disposed++; });
	request.finish({ input: candidate });
	assert.ok(await pending === undefined); assert.equal(disposed, 1); assert.equal(receiver.surface.retired, true);
	assert.equal(parts.documents.length, 2); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(f.secondGroup.panes.activePane?.input === newer);
});

test('a superseded opening request cannot dispose an input already retained by its different actual receiver', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	let disposed = 0; f.firstInput.onWillDispose(() => { disposed++; });
	const request = EditorOpeningRequest.begin(f.secondGroup, {})!; t.after(() => request.dispose());
	const newer = new HostErrorInput('newer anchor request'); f.secondGroup.openEditor(newer);
	assert.ok(request.admit(f.firstInput, undefined, f.firstGroup) === undefined); assert.equal(disposed, 0);
	assert.ok(parts.findGroup(f.firstInput) === f.firstGroup && f.firstGroup.panes.activePane?.input === f.firstInput);
	assert.ok(f.secondGroup.panes.activePane?.input === newer); assert.equal(f.secondPart.groups.length, 1);
});

for (const kind of ['group', 'split', 'window'] as const) test(`${kind} opening preserves new foreign focus acquired while resolution waits`, async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = pendingOpening();
	f.second.focus();
	const destination: EditorOpenDestination = kind === 'group' ? { kind, group: f.secondGroup }
		: kind === 'split' ? { kind, group: f.secondGroup, direction: 'right' } : { kind, reference: f.secondGroup };
	const pending = parts.openAt(request.source, destination), receiver = await request.started;
	f.first.focus(); const candidate = new CodeEditorInput(f.firstInput.workingCopy); request.finish({ input: candidate });
	assert.ok(await pending === candidate && receiver.panes.activePane?.input === candidate);
	assert.ok(inputFocus.admittedTarget === f.first.commandTarget && parts.activeGroup === f.firstGroup);
});

test('an asynchronous background attachment preserves the newer sibling maximization and active group', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = pendingOpening(), part = f.secondPart;
	const sibling = part.splitGroup(f.secondGroup, 'right'), siblingInput = new CodeEditorInput(f.firstInput.workingCopy);
	sibling.openEditor(siblingInput, { preserveFocus: true }); f.update(); f.second.focus();
	const pending = parts.openAt(request.source, { kind: 'group', group: f.secondGroup }); await request.started;
	sibling.focus(); part.arrangement.toggleMaximize(sibling); f.update();
	assert.ok(part.arrangement.maximized === sibling && parts.activeGroup === sibling);
	const candidate = new CodeEditorInput(f.firstInput.workingCopy); request.finish({ input: candidate });
	assert.ok(await pending === candidate && f.secondGroup.panes.activePane?.input === candidate);
	assert.ok(part.arrangement.maximized === sibling);
	assert.ok(inputFocus.admittedTarget === sibling.panes.activePane?.commandTarget && parts.activePart === part && part.activeGroup === sibling);
});

test('a destination invalid draft vetoes prospective placement before model production or construction', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, request = pendingOpening();
	const control = new ValueInput(f.second.commandTarget, INTEGER_INPUT_FORMAT, () => {});
	t.after(() => { control.cancel(); control.dispose(); });
	control.setValue(1); control.layout(f.secondGroup.panes.contentBounds);
	control.field.focusTarget.focus(); setFieldText(control.field, 'invalid', true);
	assert.ok(await parts.openAt(request.source, { kind: 'split', group: f.secondGroup, direction: 'right' }) === undefined);
	assert.equal(request.state.resolutions, 0); assert.equal(control.pending, true);
	assert.equal(f.secondPart.groups.length, 1); assert.equal(parts.documents.length, 2);
	assert.ok(inputFocus.admittedTarget === control.field.focusTarget && f.secondGroup.panes.activePane?.input === f.secondInput);
});

test('canonical model-add callbacks cannot replace a newer receiver request during placement production', async t => {
	const f = createActualSourcePanes(t, false, [['incoming.lua', 'return 7\n']]), parts = f.editor.editorParts;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'incoming.lua' })!;
	const newer = new HostErrorInput('model-add newer request'); let disposed = 0;
	t.after(editorTextModelService.onDidAddModel(model => { if (model.resource === resource) f.secondGroup.openEditor(newer); }));
	const source: ProspectiveEditorOpenSource = {
		kind: 'opening', isCurrent: () => true, findExisting: () => undefined,
		resolve: () => {
			const input = resolveLuaCodeEditorInput(f.sources.catalog, resource); input.onWillDispose(() => { disposed++; });
			return { input };
		},
	};
	assert.ok(await parts.openAt(source, { kind: 'group', group: f.secondGroup }) === undefined);
	assert.equal(disposed, 1); assert.ok(f.secondGroup.panes.activePane?.input === newer);
});

test('raw group admission checks the newer opening published by its predicate after destination draft acceptance', t => {
	const f = createActualSourcePanes(t), candidate = new CodeEditorInput(f.firstInput.workingCopy), newer = new HostErrorInput('draft-predicate newer request');
	let armed = false, disposed = 0; candidate.onWillDispose(() => { disposed++; });
	const control = new ValueInput(f.second.commandTarget, INTEGER_INPUT_FORMAT, () => { armed = true; });
	t.after(() => { control.cancel(); control.dispose(); });
	control.setValue(1); control.layout(f.secondGroup.panes.contentBounds);
	control.field.focusTarget.focus(); setFieldText(control.field, '2', true);
	assert.ok(f.secondGroup.openEditor(candidate, { isCurrent: () => {
		if (armed) { armed = false; f.secondGroup.openEditor(newer); }
		return true;
	} }) === undefined);
	assert.equal(control.pending, false); assert.equal(disposed, 1);
	assert.ok(f.secondGroup.panes.activePane?.input === newer);
});

test('raw group admission preserves foreign focus published by its predicate after destination draft acceptance', t => {
	const f = createActualSourcePanes(t), candidate = new CodeEditorInput(f.firstInput.workingCopy);
	let armed = false;
	const control = new ValueInput(f.second.commandTarget, INTEGER_INPUT_FORMAT, () => { armed = true; });
	t.after(() => { control.cancel(); control.dispose(); });
	control.setValue(1); control.layout(f.secondGroup.panes.contentBounds);
	control.field.focusTarget.focus(); setFieldText(control.field, '2', true);
	const opened = f.secondGroup.openEditor(candidate, { isCurrent: () => {
		if (armed) { armed = false; f.first.focus(); }
		return true;
	} });
	assert.ok(opened !== undefined); assert.equal(opened.activated, false); assert.equal(opened.generation, f.secondGroup.panes.openGeneration);
	assert.equal(control.pending, false);
	assert.ok(f.secondGroup.panes.activePane?.input === candidate && f.secondGroup.model.activeTab === candidate);
	assert.ok(inputFocus.admittedTarget === f.first.commandTarget && f.editor.editorParts.activePart === f.firstPart);
});

test('asynchronous opening reports late draft-current background admission without consuming navigation history', async t => {
	const f = createActualSourcePanes(t), candidate = new CodeEditorInput(f.firstInput.workingCopy);
	let armed = false, finish!: (input: CodeEditorInput) => void;
	const control = new ValueInput(f.second.commandTarget, INTEGER_INPUT_FORMAT, () => { armed = true; });
	t.after(() => { control.cancel(); control.dispose(); });
	control.setValue(1); control.layout(f.secondGroup.panes.contentBounds); f.second.focus();
	control.field.focusTarget.focus(); setFieldText(control.field, '2', true);
	resetNavigationHistoryState(); t.after(resetNavigationHistoryState);
	const forward = createNavigationEntry()!; navigationState.forward.push(forward);
	const pending = f.secondGroup.openResolvedEditor(() => new Promise<CodeEditorInput>(resolve => { finish = resolve; }), {
		isCurrent: () => { if (armed) { armed = false; f.first.focus(); } return true; },
	});
	finish(candidate); const opened = await pending;
	assert.ok(opened !== undefined); assert.equal(opened.activated, false); assert.equal(opened.generation, f.secondGroup.panes.openGeneration);
	assert.equal(control.pending, false); assert.ok(f.secondGroup.panes.activePane?.input === candidate);
	assert.ok(inputFocus.admittedTarget === f.first.commandTarget && f.editor.editorParts.activePart === f.firstPart);
	assert.equal(navigationState.back.length, 0); assert.equal(navigationState.forward.length, 1);
	assert.ok(navigationState.forward[0] === forward && !forward.isDisposed);
});

for (const route of ['raw', 'resolved'] as const) test(`${route} opening reports the pane-show listener's background disposition without consuming history`, async t => {
	const f = createActualSourcePanes(t), candidate = new CodeEditorInput(f.firstInput.workingCopy);
	f.second.focus(); resetNavigationHistoryState(); t.after(resetNavigationHistoryState);
	const forward = createNavigationEntry()!; navigationState.forward.push(forward);
	t.after(f.secondGroup.panes.onWillShowEditor(() => { f.first.focus(); }));
	const opened = route === 'raw' ? f.secondGroup.openEditor(candidate) : await f.secondGroup.openResolvedEditor(async () => candidate);
	assert.ok(opened !== undefined); assert.equal(opened.activated, false); assert.equal(opened.generation, f.secondGroup.panes.openGeneration);
	assert.ok(f.secondGroup.panes.activePane?.input === candidate && f.secondGroup.model.activeTab === candidate);
	assert.ok(inputFocus.admittedTarget === f.first.commandTarget && f.editor.editorParts.activePart === f.firstPart && f.editor.editorParts.activeGroup === f.firstGroup);
	assert.equal(navigationState.back.length, 0); assert.equal(navigationState.forward.length, 1);
	assert.ok(navigationState.forward[0] === forward && !forward.isDisposed);
});

for (const kind of ['split', 'window'] as const) test(`${kind} opening preserves resolver rejection for its caller and retires unpublished placement`, async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, failure = new Error('resource read rejected');
	const source: ProspectiveEditorOpenSource = { kind: 'opening', isCurrent: () => true, findExisting: () => undefined,
		resolve: async () => { throw failure; } };
	const destination: EditorOpenDestination = kind === 'split'
		? { kind, group: f.secondGroup, direction: 'right' } : { kind, reference: f.secondGroup };
	await assert.rejects(parts.openAt(source, destination), error => error === failure);
	assert.equal(parts.documents.length, 2); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(f.secondGroup.panes.activePane?.input === f.secondInput);
});

test('a physical opening drop reports asynchronous resolver failure through the existing editor feedback owner', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, failure = new Error('workspace resource read denied');
	editorFeedbackState.message.visible = false; t.after(() => { editorFeedbackState.message.visible = false; });
	const bounds = f.secondGroup.panes.contentBounds;
	const snapshot: PointerInputSnapshot = { viewportX: bounds.left + 1, viewportY: (bounds.top + bounds.bottom) / 2,
		valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0, modifiers: KeyModifier.none, spaceDown: false };
	const source: ProspectiveEditorOpenSource = { kind: 'opening', isCurrent: () => true, findExisting: () => undefined,
		resolve: async () => { throw failure; } };
	parts.dropTarget.drop(source, snapshot, 0); await setImmediate();
	assert.equal(editorFeedbackState.message.visible, true); assert.equal(editorFeedbackState.message.kind, 'error');
	assert.ok(editorFeedbackState.message.text.includes(failure.message), 'the resolver failure survives in the user-visible diagnostic');
	assert.equal(parts.documents.length, 2); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(f.secondGroup.panes.activePane?.input === f.secondInput);
});

test('common opening begin cancels a newer group request published by its entry predicate', t => {
	const f = createActualSourcePanes(t), newer = new HostErrorInput('begin-predicate newer request');
	const opening = EditorOpeningRequest.begin(f.secondGroup, { isCurrent: () => { f.secondGroup.openEditor(newer); return true; } });
	t.after(() => opening?.dispose());
	assert.ok(opening === undefined); assert.ok(f.secondGroup.panes.activePane?.input === newer);
});

test('common opening begin captures foreign focus intent before its entry predicate publishes', t => {
	const f = createActualSourcePanes(t), candidate = new CodeEditorInput(f.firstInput.workingCopy);
	f.second.focus(); let publish = true;
	const opening = EditorOpeningRequest.begin(f.secondGroup, { isCurrent: () => {
		if (publish) { publish = false; f.first.focus(); }
		return true;
	} });
	t.after(() => opening?.dispose()); assert.ok(opening !== undefined);
	assert.ok(opening.admit(candidate) === candidate && f.secondGroup.panes.activePane?.input === candidate);
	assert.ok(inputFocus.admittedTarget === f.first.commandTarget && f.editor.editorParts.activePart === f.firstPart);
});

test('a false common entry predicate leaves the group opening generation and attachment unchanged', t => {
	const f = createActualSourcePanes(t), generation = f.secondGroup.panes.openGeneration;
	assert.ok(EditorOpeningRequest.begin(f.secondGroup, { isCurrent: () => false }) === undefined);
	assert.equal(f.secondGroup.panes.openGeneration, generation); assert.ok(f.secondGroup.panes.activePane?.input === f.secondInput);
});

test('unopened source hover provides a real target without resolving text, attaching a view or constructing a group', t => {
	const f = createActualSourcePanes(t, false, [['incoming.lua', 'return 7\n']]), parts = f.editor.editorParts;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'incoming.lua' })!;
	const target = f.secondGroup, bounds = target.tabStrip.layoutState.viewportBounds;
	const snapshot: PointerInputSnapshot = { viewportX: bounds.right - 1, viewportY: (bounds.top + bounds.bottom) / 2,
		valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0, modifiers: KeyModifier.none, spaceDown: false };
	let resolutions = 0, attached = 0;
	const attach = f.editor.surfaces.attach.bind(f.editor.surfaces);
	t.mock.method(f.editor.surfaces, 'attach', options => { attached++; return attach(options); });
	const source: ProspectiveEditorOpenSource = { kind: 'opening', isCurrent: () => true, findExisting: () => undefined,
		resolve: () => { resolutions++; return { input: resolveLuaCodeEditorInput(f.sources.catalog, resource) }; } };
	const pane = target.panes.activePane, focus = inputFocus.target;
	parts.dropTarget.update(source, snapshot, 0, false); parts.dropTarget.refresh();
	assert.equal(target.tabStrip.dropTargeted, true); assert.equal(resolutions, 0); assert.equal(attached, 0);
	assert.ok(editorTextModelService.get(resource) === undefined);
	assert.ok(target.panes.activePane === pane && target.model.activeTab === f.secondInput && inputFocus.target === focus);
	assert.equal(parts.documents.length, 2); assert.equal(f.secondPart.groups.length, 1);
	parts.dropTarget.clear(); assert.equal(target.tabStrip.dropTargeted, false);
});

for (const phase of ['update', 'refresh', 'drop'] as const) test(`source-current cancellation during ${phase} cannot revive its feedback or resolve an opening`, t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, target = f.secondGroup;
	const bounds = target.tabStrip.layoutState.viewportBounds;
	const snapshot: PointerInputSnapshot = { viewportX: bounds.right - 1, viewportY: (bounds.top + bounds.bottom) / 2,
		valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0, modifiers: KeyModifier.none, spaceDown: false };
	let cancel = false, resolutions = 0;
	const source: ProspectiveEditorOpenSource = { kind: 'opening',
		isCurrent: () => { if (cancel) parts.dropTarget.clear(); return true; }, findExisting: () => undefined,
		resolve: () => { resolutions++; return { input: new CodeEditorInput(f.firstInput.workingCopy) }; },
	};
	if (phase !== 'update') {
		parts.dropTarget.update(source, snapshot, 0, false);
		assert.equal(target.tabStrip.dropTargeted, true);
	}
	cancel = true;
	if (phase === 'update') parts.dropTarget.update(source, snapshot, 1, false);
	else if (phase === 'refresh') parts.dropTarget.refresh();
	else parts.dropTarget.drop(source, snapshot, 1);
	assert.equal(target.tabStrip.dropTargeted, false); assert.equal(resolutions, 0);
	assert.equal(parts.documents.length, 2); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(target.panes.activePane?.input === f.secondInput);
});
