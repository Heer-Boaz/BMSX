import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import type { EditorDiagnostic } from '../../ide/common/models';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { BuildOutputActivity } from '../../ide/workbench/contrib/builds/activity';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { findWorkbenchWindowSurface, minimizedWorkbenchWindowCount } from '../../ide/workbench/ui/window/control';
import { measureWorkbenchTextViewMinimumWidth } from '../../ide/workbench/ui/text_view/layout';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { createActualSourcePanes } from '../helpers/source_panes';

const OUTPUT = 'first needle\nsecond needle\nthird needle\n';

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['diagnostics.lua', 'return 1\n'.repeat(80)]]);
	f.editor.setFontVariant('tiny');
	const job: StudioBuildJob = { request: { requestId: 'window-reader', target: 'fixture-product', debug: true, optLevel: 0 },
		state: 'completed', phase: 'published', acceptedAt: 0, updatedAt: 1, version: { generation: 1, sequence: 1 } };
	let reads = 0;
	const builds: WorkspaceBuilds = { jobs: [job], pending: [], targets: async () => ['fixture-product'],
		get: async () => job, log: async () => { reads++; return OUTPUT; },
		submit: async () => assert.fail('moving a reader cannot submit a build'),
		cancel: async () => assert.fail('moving a reader cannot cancel a build'),
		forget: () => assert.fail('moving a reader cannot discard a build') };
	f.editor.builds = builds;
	const main = f.editor.mainWorkspace, output = main.activities.clientWithId('builds.output');
	assert.ok(output instanceof BuildOutputActivity);
	const result = f.editor.buildOutputs!.get(job); await result.refresh(); output.select(result);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'diagnostics.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), problems = f.editor.problems;
	f.editor.diagnostics.computePending();
	const diagnostics: EditorDiagnostic[] = Array.from({ length: 80 }, (_, row) => ({ model, version: model.version,
		row, startColumn: 0, endColumn: 1, severity: 'error', message: 'Retained source diagnostic.' }));
	problems.setDiagnostics(diagnostics, { ready: 1, pending: 0, unsupported: 0, failed: 0 });
	main.regionLayout.activityHeight = 90; main.openActivity('problems'); f.update();
	return { ...f, main, output, result, problems, diagnostics, model, reads: () => reads };
}

test('moving the whole activity area retains native readers, their subjects and independent reading state', async t => {
	const f = await fixture(t), { main, output, problems } = f;
	problems.setSelectionIndex(60); problems.revealSelection(problems.layoutState, problems.contentWidth);
	const selected = problems.selectedDiagnostic, scroll = problems.getScrollIndex(); assert.ok(scroll > 0);
	main.openActivity('builds.output'); const body = output.commandTarget;
	f.key('KeyF', KeyModifier.ctrl); const field = inputFocus.admittedTarget!, query = field.textInput!;
	assert.equal(query.replaceText(0, query.readText().text.length, 'needle'), true);
	f.update(); f.key('Enter'); f.key('Escape');
	assert.equal(body.clipboard!.copy!(), 'needle');
	const activity = main.activities, surface = activity.surface, scope = activity.scope, reads = f.reads();
	const documents = [...f.editor.editorParts.documents], tabs = documents.map(part => [...part.activeGroup.model.tabs]);
	for (const placement of ['floatingWindow', 'dockedMain'] as const) {
		assert.equal(main.setActivityPlacement(placement), true); f.update();
		assert.ok(main.activities === activity && activity.surface === surface && activity.scope === scope);
		assert.ok(surface.lifetimeOwner === main.surface && main.scope.contains(body.scope));
		assert.ok(main.activity === output && output.commandTarget === body && output.selectedResult === f.result);
		assert.equal(findWorkbenchWindowSurface(body, f.editor.surfaces), placement === 'floatingWindow' ? main.activityWindow.surface : main.surface);
		assert.equal(body.clipboard!.copy!(), 'needle');
		assert.ok(inputFocus.admittedTarget === body, `${placement} retains the focused native reader`);
		f.key('KeyF', KeyModifier.ctrl); assert.ok(inputFocus.admittedTarget === field, `${placement} reopens the retained query field`);
		assert.equal(query.readText().text, 'needle'); f.key('Escape');
		main.openActivity('problems'); f.update();
		assert.ok(problems.selectedDiagnostic === selected); assert.equal(problems.getScrollIndex(), scroll);
		assert.equal(f.editor.commands.isEnabled('editor.source', problems.focusTarget), true);
		main.openActivity('builds.output');
	}
	assert.equal(f.reads(), reads, 'placement does not reacquire the workspace build observation');
	assert.deepEqual(f.editor.editorParts.documents, documents);
	for (let index = 0; index < documents.length; index++) assert.deepEqual(documents[index].activeGroup.model.tabs, tabs[index]);
	assert.equal(f.model.dirty, false); assert.equal(f.firstInput.workingCopy.dirty, false);
});

test('physical window commands from the activity reader operate on its shell and the window picker restores that same reader', async t => {
	const f = await fixture(t), { main, output } = f, commands = f.editor.commands;
	f.first.focus(); main.openActivity('builds.output');
	commands.execute('workspace.activity.float', output.commandTarget); f.update();
	const window = main.activityWindow, body = output.commandTarget, documentWindow = f.firstPart.window!;
	const documentPlacement = documentWindow.model.placement;
	assert.ok(findWorkbenchWindowSurface(body, f.editor.surfaces) === window.surface);
	commands.execute('window.maximize', body); f.update();
	assert.equal(window.model.placement, 'maximized'); assert.equal(documentWindow.model.placement, documentPlacement);
	commands.execute('window.restore', body); f.update(); assert.equal(window.model.placement, 'normal');
	const count = minimizedWorkbenchWindowCount(f.editor.surfaces), surface = window.surface, reads = f.reads();
	commands.execute('window.minimize', body); f.update();
	assert.equal(window.model.minimized, true); assert.equal(main.activityDisplayed, false);
	assert.equal(documentWindow.model.minimized, false); assert.equal(window.isOpen, true);
	assert.equal(minimizedWorkbenchWindowCount(f.editor.surfaces), count + 1);
	assert.ok(window.surface === surface && f.editor.surfaces.windowSurfaces.includes(surface!));
	commands.execute('window.restoreMinimized', inputFocus.admittedTarget);
	const picker = f.editor.quickInput;
	assert.equal(picker.visible, true);
	const index = picker.model.list.rows.findIndex(row => 'window' in row.item && row.item.window === window);
	assert.ok(index >= 0); picker.model.list.selectionIndex = index; f.key('Enter');
	assert.equal(picker.visible, false); assert.equal(window.model.minimized, false); assert.equal(main.activityDisplayed, true);
	assert.ok(inputFocus.admittedTarget === body && main.activity === output && output.selectedResult === f.result);
	assert.equal(minimizedWorkbenchWindowCount(f.editor.surfaces), count); assert.equal(f.reads(), reads);
	commands.execute('window.minimize', body); f.update();
	commands.execute('builds.output', inputFocus.admittedTarget); f.update();
	assert.equal(window.model.minimized, false); assert.equal(main.regionLayout.activityVisible, true);
	assert.ok(main.activityWindow === window && inputFocus.admittedTarget === body && main.activity === output);
	assert.equal(f.reads(), reads);
});

test('floating Problems keeps its selected canonical diagnostic as Source while its physical owner is the activity window', async t => {
	const f = await fixture(t), { main, problems } = f;
	f.first.focus(); main.openActivity('problems'); problems.setSelectionIndex(20);
	main.setActivityPlacement('floatingWindow'); f.update();
	assert.ok(main.scope.contains(problems.focusTarget.scope));
	assert.ok(findWorkbenchWindowSurface(problems.focusTarget, f.editor.surfaces) === main.activityWindow.surface);
	const cycles = f.host.runtime.machine.scheduler.nowCycles, document = f.firstGroup.model.activeTab;
	f.editor.commands.execute('editor.source', problems.focusTarget);
	await Promise.resolve(); await Promise.resolve(); f.update();
	const input = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	assert.equal(input.context.view.cursorRow, 20); assert.equal(input.context.view.cursorColumn, 0);
	assert.ok(f.firstGroup.model.contains(document!)); assert.equal(main.activityPlacement, 'floatingWindow');
	assert.equal(f.model.dirty, false); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

for (const activity of ['problems', 'builds.output'] as const) for (const presentation of ['hiddenFloating', 'liveDocked'] as const)
	test(`${presentation} ${activity} window commands never borrow another active Source window`, async t => {
		const f = await fixture(t), { main } = f, commands = f.editor.commands;
		main.openActivity(activity);
		if (presentation === 'hiddenFloating') main.setActivityPlacement('floatingWindow');
		const origin = main.activity!.commandTarget;
		if (presentation === 'hiddenFloating') main.setActivityVisible(false);
		else assert.ok(findWorkbenchWindowSurface(origin, f.editor.surfaces) === main.surface);
		f.second.focus();
		const window = f.secondPart.window!, model = window.model, surface = window.surface;
		const requestedBounds = { ...model.requestedBounds }, placement = model.placement, minimized = model.minimized;
		const documents = [...f.editor.editorParts.documents], foreground = inputFocus.admittedTarget;
		for (const command of ['window.maximize', 'window.minimize', 'window.hide'] as const) {
			assert.equal(commands.isEnabled(command, origin), false);
			commands.execute(command, origin); f.update();
			assert.ok(window.surface === surface && window.isOpen && !f.secondPart.retired);
			assert.equal(model.placement, placement); assert.equal(model.minimized, minimized);
			assert.deepEqual(model.requestedBounds, requestedBounds);
			assert.ok(inputFocus.admittedTarget === foreground && f.editor.editorParts.activePart === f.secondPart);
			assert.deepEqual(f.editor.editorParts.documents, documents);
		}
		assert.equal(main.activityDisplayed, presentation === 'liveDocked');
		assert.equal(main.regionLayout.activityVisible, presentation === 'liveDocked');
	});

for (const variant of ['tiny', 'msx'] as const) for (const activityId of ['problems', 'builds.output'] as const)
	test(`${variant} ${activityId} floating resize preserves its intrinsic reading width and reachable selector/Close controls`, async t => {
		const f = await fixture(t), { main } = f;
		f.editor.setFontVariant(variant); main.openActivity(activityId); main.setActivityPlacement('floatingWindow'); f.update();
		const window = main.activityWindow, model = window.model, body = main.activity!.commandTarget;
		assert.ok(model.minimumWidth >= measureWorkbenchTextViewMinimumWidth(editorViewState.font));
		const right = model.bounds.right - 1, y = (model.bounds.top + model.bounds.bottom) / 2, left = model.bounds.left;
		const press = { x: right, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
			releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 };
		f.editor.dispatchPointer(press); assert.equal(pointerCapture.active, true);
		f.editor.dispatchPointer({ ...press, x: left, pressedButtons: 0 });
		f.editor.dispatchPointer({ ...press, x: left, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary }); f.update();
		// This verifies the native resize owner's hard minimum, not an incidental UI position.
		assert.equal(model.bounds.right - model.bounds.left, model.minimumWidth);
		assert.equal(body.focus(), true); assert.ok(inputFocus.admittedTarget === body);
		if (activityId === 'builds.output') {
			f.key('KeyF', KeyModifier.ctrl); assert.ok(inputFocus.admittedTarget!.textInput !== undefined); f.key('Escape');
		}
		const selector = main.activities.commandTarget; assert.equal(selector.focus(), true);
		f.key('Tab'); assert.ok(inputFocus.admittedTarget !== selector && inputFocus.admittedTarget !== body);
		f.key('Enter'); assert.equal(main.activityDisplayed, false);
		f.editor.commands.execute(activityId, inputFocus.admittedTarget); f.update();
		assert.equal(main.activityDisplayed, true); assert.ok(main.activity!.commandTarget === body);
	});

for (const placement of ['dockedMain', 'floatingWindow'] as const)
	test(`Close hides the ${placement} area without disposing either reader and its reveal command reopens in place`, async t => {
		const f = await fixture(t), { main, output, problems } = f, commands = f.editor.commands;
		problems.setSelectionIndex(20); const selected = problems.selectedDiagnostic;
		main.openActivity('builds.output'); main.setActivityPlacement(placement); f.update();
		const body = output.commandTarget, result = output.selectedResult, documents = [...f.editor.editorParts.documents], reads = f.reads();
		f.key('KeyF', KeyModifier.ctrl); const field = inputFocus.admittedTarget!, query = field.textInput!;
		assert.equal(query.replaceText(0, query.readText().text.length, 'needle'), true);
		f.update(); f.key('Enter'); f.key('Escape'); assert.equal(body.clipboard!.copy!(), 'needle');
		commands.execute(placement === 'floatingWindow' ? 'window.hide' : 'workspace.activity.hide', body); f.update();
		assert.equal(main.activityDisplayed, false); assert.equal(main.regionLayout.activityVisible, false);
		assert.equal(main.activityPlacement, placement); assert.equal(body.focus(), false); assert.equal(f.result.isDisposed, false);
		assert.ok(output.selectedResult === result && problems.selectedDiagnostic === selected);
		commands.execute('builds.output', inputFocus.admittedTarget); f.update();
		assert.equal(main.activityPlacement, placement); assert.equal(main.activityDisplayed, true);
		assert.ok(main.activity === output && output.commandTarget === body && inputFocus.admittedTarget === body);
		assert.equal(body.clipboard!.copy!(), 'needle'); f.key('KeyF', KeyModifier.ctrl);
		assert.ok(inputFocus.admittedTarget === field); assert.equal(query.readText().text, 'needle'); f.key('Escape');
		assert.equal(f.reads(), reads); assert.deepEqual(f.editor.editorParts.documents, documents);
		main.openActivity('problems'); assert.ok(problems.selectedDiagnostic === selected && inputFocus.admittedTarget === problems.focusTarget);
	});
