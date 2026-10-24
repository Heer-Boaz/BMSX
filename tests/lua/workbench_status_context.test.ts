import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { editorFeedbackState } from '../../ide/common/feedback_state';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { resourceIdentityKey } from '../../ide/common/resource';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { inputFocus, type InputFocusTarget } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { RuntimeLuaEvaluation } from '../../ide/runtime/lua_evaluation';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { problemsPanel } from '../../ide/workbench/contrib/problems/panel/controller';
import { renderStatusBar } from '../../ide/workbench/render/status_bar';
import { buildStatusLeftInfo } from '../../ide/workbench/render/status_bar_info';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext, variant: 'tiny' | 'msx') {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	editorFeedbackState.message.visible = false; problemsPanel.hide();
	const record = createScenarioTestSourceRecord('status.lua', 1, 'return 1\nreturn 2\n');
	const sources = createScenarioTestSourceState([record]);
	const resource = sources.resourceByIdentity.get(resourceIdentityKey({ domain: 0, path: 'status.lua' }))!;
	const model = editorTextModelService.retain(resource, 'lua', record.src);
	const view = createCodeEditorViewState(); activeCodeEditor.attach(model, view);
	activeCodeEditor.focusTarget.focus();
	const filesFocus = inputFocus.createTarget(), state = { visible: true, mode: 'resources' as 'resources' | 'command' };
	const mode = t.mock.fn(() => state.mode), filter = t.mock.fn(() => 'lua_only' as const);
	const resources: Parameters<typeof renderStatusBar>[0] = {
		focusTarget: filesFocus, isVisible: () => state.visible, getMode: mode, getFilterMode: filter,
	};
	const overlay = createHostOverlayFixture(384, 288), fault = createRuntimeFaultState();
	const evaluation = new RuntimeLuaEvaluation(null, null, null, null, fault, null, null, null);
	const status = t.mock.fn(() => { buildStatusLeftInfo(); });
	const pane: NonNullable<Parameters<typeof renderStatusBar>[2]> = { drawStatusBar: status };
	const lineCount = t.mock.method(model.buffer, 'getLineCount');
	const menu = new ContextMenuController(inputFocus, pointerCapture), quick = new QuickInputController(menu);
	const paint = (owner: InputFocusTarget | null) => {
		refreshWorkbenchLayout(); overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		renderStatusBar(resources, fault, pane, evaluation, 'standalone', owner);
		overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
	};
	t.after(() => {
		quick.dispose(); menu.dispose(); problemsPanel.hide(); problemsPanel.setDiagnostics([], { ready: 0, pending: 0, unsupported: 0, failed: 0 });
		inputFocus.setTarget(null); activeCodeEditor.detach(); editorTextModelService.clear(); pointerCapture.cancel();
	});
	return { model, view, filesFocus, state, mode, filter, status, lineCount, menu, quick, paint };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} visible side panels do not replace the active source status owner`, t => {
		const f = fixture(t, variant);
		problemsPanel.show();
		f.paint(activeCodeEditor.focusTarget);
		assert.equal(f.status.mock.callCount(), 1);
		assert.equal(f.lineCount.mock.callCount(), 1, 'source status consumes the actual source document despite visible Problems');
		assert.equal(f.mode.mock.callCount(), 0); assert.equal(f.filter.mock.callCount(), 0);
		assert.equal(activeCodeEditor.model, f.model); assert.equal(activeCodeEditor.view, f.view);
	});

	test(`${variant} the explicit Files or Problems owner selects that context without touching source status`, t => {
		const f = fixture(t, variant);
		f.filesFocus.focus(); f.paint(f.filesFocus);
		assert.equal(f.status.mock.callCount(), 0); assert.equal(f.mode.mock.callCount(), 1); assert.equal(f.filter.mock.callCount(), 1);
		problemsPanel.show(); problemsPanel.setDiagnostics([{ model: f.model, version: f.model.version, row: 1,
			startColumn: 2, endColumn: 3, message: 'diagnostic', severity: 'error' }], { ready: 1, pending: 0, unsupported: 0, failed: 0 });
		problemsPanel.setSelectionIndex(0); problemsPanel.setFocused(true);
		f.paint(problemsPanel.focusTarget);
		assert.equal(f.status.mock.callCount(), 0); assert.equal(f.mode.mock.callCount(), 1);
		assert.equal(f.lineCount.mock.callCount(), 0, 'a selected diagnostic is not the source cursor status');
	});

	test(`${variant} actual popup invocation ownership preserves source and Files context while popup fields have focus`, t => {
		const f = fixture(t, variant);
		f.quick.pick('choices', '', () => new TextQuickPickProvider([{ label: 'choice', description: '', detail: '' }]), () => {});
		assert.equal(inputFocus.target, f.quick.field.focusTarget);
		f.paint(f.quick.invocationOrigin!.commandContext);
		assert.equal(f.status.mock.callCount(), 1); assert.equal(f.mode.mock.callCount(), 0);
		f.quick.hide(); f.filesFocus.focus();
		f.menu.show(30, 40, [], { isEnabled: () => false, execute: () => {} });
		assert.equal(inputFocus.target, f.menu.focusTarget);
		assert.equal(f.menu.invocationOrigin, f.filesFocus);
		f.paint(f.menu.invocationOrigin!.commandContext);
		assert.equal(f.status.mock.callCount(), 1); assert.equal(f.mode.mock.callCount(), 1);
		assert.equal(f.filter.mock.callCount(), 1);
	});

	test(`${variant} hidden panels cannot claim status through a retained former target`, t => {
		const f = fixture(t, variant); f.state.visible = false;
		f.paint(f.filesFocus);
		assert.equal(f.status.mock.callCount(), 1); assert.equal(f.mode.mock.callCount(), 0);
	});

	test(`${variant} actual workbench composition resolves nested popup origins before choosing the status owner`, async t => {
		const host = createHostFrameFixture();
		const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('status.lua', 1, 'return 1\nreturn 2\n')]);
		const unused = (): never => { throw new Error('Status composition does not request domain execution.'); };
		const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
			{ measureDisplay: () => ({ left: 0, top: 0, width: 384, height: 288 }) },
			host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
			new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 384, height: 288 }, sources, new Map(), unused, unused, unused);
		const editor = ide.editor;
		t.after(async () => {
			inputFocus.setTarget(null); problemsPanel.hide();
			await editor.shutdown(); editorTabGroup.clear(); host.audio.dispose(); host.input.dispose();
		});
		editorRuntimeState.active = true; editorFeedbackState.message.visible = false;
		await editor.navigation.openResource(sources.resourceByIdentity.get(resourceIdentityKey({ domain: 0, path: 'status.lua' }))!);
		configureFontVariant(host.clock, variant, null); editor.resourcePanel.setFontMetrics(editorViewState.font);
		const pane = editor.editorPanes.activePane!, status = t.mock.method(pane, 'drawStatusBar');
		const model = activeCodeEditor.model, view = activeCodeEditor.view;
		const draw = () => {
			editor.update(0); ide.overlayRenderer.beginFrame(host.presenter); api.beginFrame(ide.overlayRenderer);
			editor.draw(); ide.overlayRenderer.endFrame(); host.presenter.hostOverlayQueue.consumeOverlayFrame();
		};
		editor.resourcePanel.show(); pane.focus(); draw();
		assert.equal(status.mock.callCount(), 1, 'visible Files does not own the source status');
		editor.quickInput.pick('choices', '', () => new TextQuickPickProvider([{ label: 'choice', description: '', detail: '' }]), () => {});
		editor.contextMenu.show(30, 40, [], editor.commands);
		assert.equal(inputFocus.target, editor.contextMenu.focusTarget);
		assert.equal(editor.contextMenu.invocationOrigin, editor.quickInput.field.focusTarget);
		assert.equal(editor.quickInput.invocationOrigin, activeCodeEditor.focusTarget);
		draw(); assert.equal(status.mock.callCount(), 2);
		editor.contextMenu.hide(); editor.quickInput.hide();
		editor.resourcePanel.setFocused(true);
		editor.quickInput.pick('choices', '', () => new TextQuickPickProvider([{ label: 'choice', description: '', detail: '' }]), () => {});
		assert.equal(editor.quickInput.invocationOrigin, editor.resourcePanel.focusTarget);
		draw(); assert.equal(status.mock.callCount(), 2, 'Files remains the context behind its own picker');
		editor.quickInput.hide(); pane.focus();
		const prompt = editor.actionPrompt.show('close');
		editor.contextMenu.show(30, 40, [], editor.commands);
		assert.equal(editor.contextMenu.invocationOrigin, editor.actionPrompt.focusTarget);
		assert.equal(editor.actionPrompt.invocationOrigin, activeCodeEditor.focusTarget);
		draw(); assert.equal(status.mock.callCount(), 3);
		editor.contextMenu.hide(); editor.actionPrompt.close(); await prompt;
		problemsPanel.show();
		problemsPanel.setDiagnostics([{ model: model!, version: model!.version, row: 1, startColumn: 2, endColumn: 3,
			message: 'diagnostic', severity: 'error' }], { ready: 1, pending: 0, unsupported: 0, failed: 0 });
		problemsPanel.setSelectionIndex(0);
		problemsPanel.focusTarget.getCommand('problems.coverage')!.run();
		assert.notEqual(inputFocus.target, problemsPanel.focusTarget);
		assert.equal(inputFocus.target!.commandContext, problemsPanel.focusTarget, 'the actual header action target declares its semantic panel');
		draw(); assert.equal(status.mock.callCount(), 3);
		editor.quickInput.pick('choices', '', () => new TextQuickPickProvider([{ label: 'choice', description: '', detail: '' }]), () => {});
		assert.equal(editor.quickInput.invocationOrigin!.commandContext, problemsPanel.focusTarget);
		draw(); assert.equal(status.mock.callCount(), 3, 'a picker invoked by the header keeps the selected diagnostic context');
		editor.quickInput.hide();
		assert.equal(activeCodeEditor.model, model); assert.equal(activeCodeEditor.view, view);
	});
}
