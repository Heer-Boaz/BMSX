import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { encodeScreenshotPng } from '../../hosts/node/headless/screenshot';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { AssistantInput } from '../../ide/workbench/contrib/assistant/editor_input';
import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import { AssistantConversation } from '../../ide/workbench/services/assistant/conversation';
import { WorkspaceToolService } from '../../ide/workbench/services/assistant/tool_service';
import { ResourceDiagnosticsService } from '../../ide/workbench/services/diagnostics/resource_diagnostics';
import { ScenarioRunService } from '../../ide/workbench/services/testing/scenario_runs';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { WorkspaceEditProposal } from '../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../ide/workbench/services/working_copy/source_context';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createTestRuntime } from '../helpers/runtime_sources';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { EditorCommandRunner } from '../../ide/common/commands';
import * as colors from '../../ide/common/constants';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { api } from '../../ide/runtime/overlay_api';
import { AssistantTurnToolbar } from '../../ide/workbench/contrib/assistant/turn_toolbar';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { renderWorkbenchActionBar } from '../../ide/workbench/render/action_bar';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import type { RectBounds } from '../../machine/ts/common/rect';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';

const captureDirectory = process.env.BMSX_UI_CAPTURE_DIR;
if (captureDirectory !== undefined) mkdirSync(captureDirectory, { recursive: true });

/** Typed transcript publication only: there is no connection factory or provider. */
class TranscriptProducer extends AssistantConversation {
	public proposal(proposal: WorkspaceEditProposal): void { this.append('proposal', proposal.title, proposal); }
	public reset(): void { this.resetTranscript(); }
	public running(): void { this.state = 'running'; this.changed(); }
}

function fixture(t: TestContext) {
	const models = new EditorTextModelService(), clock = new VirtualHeadlessClock();
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('cart.lua', 1, 'return old\n')]);
	const model = models.retain(sources.luaResources[0], 'lua', 'return old\n');
	const image = linkTestSystemBlua32(compileLuaSource('return nil', 'toolbar', 0));
	const runtime = createTestRuntime(image.romBytes); runtime.machine.cpu.reset();
	const guest = new SuspendedGuestSession(runtime), f = createRuntimeInspectionFixture(runtime, sources, guest, models);
	const diagnostics = new ResourceDiagnosticsService(models, sources, clock);
	const runs = new ScenarioRunService(models, sources, new Map(), runtime.model, () => assert.fail('no target creation'));
	const saves = new TextFileSaveService(models, clock, sources, guest, runtime, f.tasks);
	const tools = new WorkspaceToolService(models, sources, diagnostics, runs, f.inspection, f.frameNavigation, f.gameCapture,
		f.luaEvaluation, f.debuggerExecution, f.actorExecution, new BehaviorSourceDocuments(models, sources), saves, f.boots,
		f.hotResumes, f.events, f.gteHistory, f.gpuHistory, clock);
	const conversation = new TranscriptProducer(models, sources, tools), input = new AssistantInput(conversation);
	const proposal = (title: string) => new WorkspaceEditProposal(title, new WorkspaceSourceContext(models, sources), {
		kind: 'edit', edits: new Map([[model, { version: model.version, edits: [{ offset: 0, deleteLength: 0, text: '-- proposal\n' }] }]]),
	});
	t.after(async () => { input.dispose(); conversation.dispose(); tools.dispose(); await saves.shutdown(); await f.boots.shutdown();
		runs.dispose(); diagnostics.dispose(); f.presenter.dispose(); models.clear(); });
	assert.equal(conversation.available, false);
	return { input, conversation, proposal, model, runtime };
}

test('the Assistant turn bar has one retained responsive overflow owner', t => {
	const { input } = fixture(t);
	assert.ok(input.turnActions.overflow, 'turn actions must fit a constrained pane instead of extending outside it');
});

function toolbarFixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny', theme = 'light') {
	const f = fixture(t), { input, conversation } = f;
	const previousTheme = colors.getActiveIdeThemeVariant();
	configureFontVariant(new VirtualHeadlessClock(), variant, null); colors.setIdeThemeVariant(theme);
	const area = { left: 0, top: 24, right: 384, bottom: 274 }, surfaces = new WorkbenchSurfaceService();
	Object.assign(input.layout, area, { rowHeight: editorViewState.lineHeight, font: editorViewState.font });
	input.footerTop = 256;
	const parent = inputFocus.createTarget(); parent.bindKeyboard(() => {});
	const opened: WorkspaceEditProposal[] = [], executed: string[] = [];
	parent.registerCommand('assistant.review', { isEnabled: () => input.selection.proposal !== undefined,
		run: () => { opened.push(input.selection.proposal!); } });
	for (const command of ['assistant.send', 'assistant.queue', 'assistant.direct', 'assistant.stop'] as const)
		parent.registerCommand(command, { isEnabled: () => command === 'assistant.stop' ? conversation.state === 'running' : input.draftHasText,
			run: () => { executed.push(command); } });
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const owner = surfaces.attach({ role: 'content', captureScope: parent.scope.surfaceScope, getBounds: () => input.layout,
		getClip: () => input.layout, isVisible: () => true, draw: () => {
			api.fill_rect(input.layout.left, input.layout.top, input.layout.right, input.layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
			renderWorkbenchActionBar(input.turnActions, editorViewState.font.renderFont(), colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		} });
	const menu = new ContextMenuController(inputFocus, pointerCapture, lifetime => {
		if (lifetime === undefined) return;
		lifetime.add(surfaces.attach({ role: 'transient', outsidePress: 'consume', lifetimeOwner: owner, captureScope: menu.pointerScope,
			getBounds: () => menu.model.bounds, getClip: () => area, isVisible: () => menu.visible, draw() {},
			onRetire: () => { if (!lifetime.isDisposed) { pointerCapture.cancelScope(menu.pointerScope); menu.hide(); } } }));
	});
	const toolbar = new AssistantTurnToolbar(commands, parent, () => input.draft.focusTarget.focus(), menu, surfaces, owner, () => area);
	const overlay = createHostOverlayFixture(384, 288);
	overlay.presenter.initialize(new RenderPassLibrary(overlay.backend, overlay.presenter));
	const unbind = inputFocus.bindScopeAdmission(scope => {
		const surface = surfaces.findByScope(scope.surfaceScope); return surface !== undefined && surfaces.isAdmitted(surface);
	});
	const key = (code: string, down: boolean) => inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, down));
	const press = (code: string) => { key(code, true); key(code, false); };
	const layout = (width = input.layout.right) => { input.layout.right = width; toolbar.update(true); };
	const point = (rect: Readonly<RectBounds>, held = 0, down = 0, up = 0): PointerInputSnapshot => ({ valid: true, insideViewport: true,
		viewportX: rect.left + 1, viewportY: rect.top + 1, modifiers: KeyModifier.none, spaceDown: false,
		pressedButtons: held, justPressedButtons: down, justReleasedButtons: up });
	let time = 0;
	const pointer = (rect: Readonly<RectBounds>, held = 0, down = 0, up = 0) => {
		const snapshot = point(rect, held, down, up);
		if (!pointerCapture.dispatch(snapshot, false, ++time)) toolbar.control.handlePointer(snapshot);
	};
	const open = (keyboard = false) => {
		if (keyboard) { toolbar.control.focusTarget.focus(); press('End'); press('Enter'); }
		else pointer(input.turnActions.overflow!.button.bounds, PointerButton.Primary, PointerButton.Primary, PointerButton.Primary);
		assert.equal(menu.visible, true);
		menu.model.layout(384, 288, 8, editorViewState.font.renderFont(), text => editorViewState.font.measure(text)); menu.update();
	};
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++)
			if (frame.commandKinds[index] === Host2DKind.Glyphs) glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
		return glyphs;
	};
	toolbar.setInput(input, parent); parent.focus(); layout();
	t.after(() => { toolbar.dispose(); menu.dispose(); unbind(); surfaces.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null);
		overlay.presenter.dispose(); colors.setIdeThemeVariant(previousTheme); });
	return { ...f, area, surfaces, owner, parent, toolbar, menu, opened, executed, layout, key, press, pointer, open, draw, overlay };
}

for (const theme of ['light', 'dark']) for (const variant of ['tiny', 'msx'] as const)
	test(`${theme}/${variant} running Stop remains primary and every turn action has one bounded reachable owner`, t => {
		const f = toolbarFixture(t, variant, theme), bar = f.input.turnActions;
		f.conversation.proposal(f.proposal('First proposal')); f.conversation.running(); setFieldText(f.input.draft, 'queued message', false);
		let phase = 0;
		for (const width of [384, variant === 'tiny' ? 78 : 118, 384]) {
			f.layout(width);
			const primary = bar.items.filter(item => item.visible && !item.overflowed);
			assert.equal(primary[0].command, 'assistant.stop');
			for (const item of [...primary, ...(bar.overflow!.button.visible ? [bar.overflow!.button] : [])])
				assert.ok(item.bounds.left >= f.input.layout.left + 4 && item.bounds.right <= width - 4, `${item.label} remains in the pane`);
			const painted = f.draw();
			for (const item of primary) {
				const label = painted.find(run => run.items === item.label)!;
				assert.ok(label, 'the real action renderer paints each fitted semantic label');
				assert.equal(label.color, resolveThemeTokenColor(item.enabled ? colors.COLOR_HEADER_BUTTON_TEXT : colors.COLOR_HEADER_BUTTON_TEXT_DISABLED));
			}
			if (captureDirectory !== undefined) {
				const { renderer, presenter, backend } = f.overlay;
				renderer.beginFrame(presenter); api.beginFrame(renderer); f.surfaces.draw(api); renderer.endFrame();
				presenter.configurePresentation('completed', false);
				presenter.present(f.runtime.machine.gxGpu.readDeviceOutput(), 0, 0);
				const state = phase === 0 ? 'wide' : phase === 1 ? 'minimum' : 'wide-restored';
				writeFileSync(join(captureDirectory, `assistant-toolbar-${theme}-${variant}-${phase}-${state}.png`),
					encodeScreenshotPng(384, 288, backend.borrowPresentedPixels()));
			}
			phase++;
			if (width === 384) assert.equal(bar.overflow!.button.visible, false);
			else {
				assert.equal(bar.overflow!.button.visible, true);
				assert.deepEqual(bar.overflow!.items.filter(item => item.type === 'command').map(item => item.command),
					bar.items.filter(item => item.visible && item.overflowed).map(item => item.command));
				f.open(); f.press('Escape'); assert.equal(inputFocus.target, f.parent);
				f.open(true); f.press('Escape'); assert.equal(inputFocus.target, f.toolbar.control.focusTarget);
			}
		}
	});

test('Review pointer and keyboard holds retire before exact proposal selection or publication changes', t => {
	const f = toolbarFixture(t), first = f.proposal('Same title'), second = f.proposal('Same title');
	f.conversation.proposal(first); f.conversation.proposal(second); f.input.selection.select(f.conversation.entries[0]); f.toolbar.update(false);
	const review = f.input.turnActions.items.find(item => item.command === 'assistant.review')!;
	f.pointer(review.bounds, PointerButton.Primary, PointerButton.Primary);
	assert.equal(f.input.turnActions.pressedCommand, 'assistant.review');
	f.input.selection.select(f.conversation.entries[1]);
	assert.equal(f.input.turnActions.pressedCommand, null, 'retirement is synchronous, before a frame update or release');
	f.pointer(review.bounds, 0, 0, PointerButton.Primary); assert.deepEqual(f.opened, []);
	f.toolbar.control.focusTarget.focus(); f.press('End'); f.key('Enter', true);
	assert.equal(f.input.turnActions.pressedCommand, 'assistant.review');
	const third = f.proposal('Same title'); f.conversation.proposal(third);
	assert.equal(f.input.turnActions.pressedCommand, null);
	f.key('Enter', false); assert.deepEqual(f.opened, []);
	f.press('Enter'); assert.deepEqual(f.opened, [third]);
	assert.equal(f.model.buffer.getText(), 'return old\n');
});

test('proposal changes retire only the owned overflow session and never retarget held menu Review', t => {
	const f = toolbarFixture(t), first = f.proposal('First'), second = f.proposal('Second');
	f.conversation.proposal(first); f.conversation.running(); f.layout(78); f.open(); f.press('End');
	assert.equal(f.menu.model.rows[f.menu.model.selectedIndex].command, 'assistant.review');
	f.key('Enter', true); f.conversation.proposal(second);
	assert.equal(f.menu.visible, false); f.key('Enter', false); assert.deepEqual(f.opened, []);
	f.open(); f.press('End'); f.press('Enter'); assert.deepEqual(f.opened, [second]);
	f.open(); f.press('Escape');
	f.menu.show(10, 10, [{ type: 'command', command: 'assistant.copy' }], { isEnabled: () => true, execute() {} });
	f.input.selection.select(f.conversation.entries[0]); assert.equal(f.menu.visible, true, 'a retired toolbar session cannot close another owner popup');
	f.menu.hide();
});

for (const activation of ['pointer', 'keyboard'] as const) for (const change of ['selection', 'publication', 'reset'] as const)
	test(`${activation} More retires before proposal ${change} rather than opening for another subject`, t => {
		const f = toolbarFixture(t), first = f.proposal('Same title'), second = f.proposal('Same title');
		f.conversation.proposal(first); f.conversation.proposal(second); f.input.selection.select(f.conversation.entries[0]);
		f.conversation.running(); f.layout(78);
		const more = f.input.turnActions.overflow!.button;
		assert.equal(more.visible, true);
		if (activation === 'pointer') f.pointer(more.bounds, PointerButton.Primary, PointerButton.Primary);
		else { f.toolbar.control.focusTarget.focus(); f.press('End'); f.key('Enter', true); }
		assert.equal(f.input.turnActions.pressedCommand, more.command);
		if (change === 'selection') f.input.selection.select(f.conversation.entries[1]);
		else if (change === 'publication') f.conversation.proposal(f.proposal('Same title'));
		else f.conversation.reset();
		assert.equal(f.input.turnActions.pressedCommand, null, 'retirement precedes any next frame or old release');
		if (activation === 'pointer') f.pointer(more.bounds, 0, 0, PointerButton.Primary);
		else f.key('Enter', false);
		assert.equal(f.menu.visible, false, 'a menu for another proposal requires a fresh activation');
		assert.deepEqual(f.opened, []);
	});

for (const activation of ['pointer', 'keyboard'] as const)
	test(`${activation} More retains an admitted attempt for the same exact proposal`, t => {
		const f = toolbarFixture(t), proposal = f.proposal('One exact proposal');
		f.conversation.proposal(proposal); f.conversation.proposal(proposal); f.input.selection.select(f.conversation.entries[0]);
		f.conversation.running(); f.layout(78);
		const more = f.input.turnActions.overflow!.button;
		if (activation === 'pointer') f.pointer(more.bounds, PointerButton.Primary, PointerButton.Primary);
		else { f.toolbar.control.focusTarget.focus(); f.press('End'); f.key('Enter', true); }
		f.input.selection.select(f.conversation.entries[1]);
		assert.equal(f.input.turnActions.pressedCommand, more.command, 'entry indexing is not proposal identity');
		if (activation === 'pointer') f.pointer(more.bounds, 0, 0, PointerButton.Primary);
		else f.key('Enter', false);
		assert.equal(f.menu.visible, true);
		f.press('Escape');
	});

for (const activation of ['pointer', 'keyboard'] as const)
	test(`${activation} Stop remains admitted when only the selected proposal changes`, t => {
		const f = toolbarFixture(t); f.conversation.proposal(f.proposal('First')); f.conversation.running(); f.layout(78);
		const stop = f.input.turnActions.items.find(item => item.command === 'assistant.stop')!;
		if (activation === 'pointer') f.pointer(stop.bounds, PointerButton.Primary, PointerButton.Primary);
		else { f.toolbar.control.focusTarget.focus(); f.press('Home'); f.key('Enter', true); }
		assert.equal(f.input.turnActions.pressedCommand, 'assistant.stop');
		f.conversation.proposal(f.proposal('Second'));
		assert.equal(f.input.turnActions.pressedCommand, 'assistant.stop', 'Review identity does not own Stop');
		if (activation === 'pointer') f.pointer(stop.bounds, 0, 0, PointerButton.Primary);
		else f.key('Enter', false);
		assert.deepEqual(f.executed, ['assistant.stop']);
	});

test('same exact proposal retains its attempt, while reset drains Review and does not cancel Send', t => {
	const f = toolbarFixture(t), proposal = f.proposal('One proposal');
	f.conversation.proposal(proposal); f.conversation.proposal(proposal); f.input.selection.select(f.conversation.entries[0]); f.toolbar.update(false);
	const review = f.input.turnActions.items.find(item => item.command === 'assistant.review')!;
	f.pointer(review.bounds, PointerButton.Primary, PointerButton.Primary); f.input.selection.select(f.conversation.entries[1]);
	assert.equal(f.input.turnActions.pressedCommand, 'assistant.review');
	f.pointer(review.bounds, 0, 0, PointerButton.Primary); assert.deepEqual(f.opened, [proposal]);
	f.pointer(review.bounds, PointerButton.Primary, PointerButton.Primary); f.conversation.reset();
	assert.equal(f.input.selection.proposal, undefined); assert.equal(f.input.turnActions.pressedCommand, null);
	f.pointer(review.bounds, 0, 0, PointerButton.Primary); assert.deepEqual(f.opened, [proposal]);
	setFieldText(f.input.draft, '/help', false); f.toolbar.update(false);
	const send = f.input.turnActions.items.find(item => item.command === 'assistant.send')!;
	f.pointer(send.bounds, PointerButton.Primary, PointerButton.Primary); f.conversation.proposal(f.proposal('New review'));
	assert.equal(f.input.turnActions.pressedCommand, 'assistant.send', 'proposal identity does not own unrelated turn commands');
	f.pointer(send.bounds, 0, 0, PointerButton.Primary); assert.deepEqual(f.executed, ['assistant.send']);
});

test('owned full-title feedback is retained, modal-admitted and retired with the toolbar', t => {
	const f = toolbarFixture(t); f.conversation.proposal(f.proposal('Review')); f.toolbar.update(false);
	const review = f.input.turnActions.items.find(item => item.command === 'assistant.review')!;
	f.pointer(review.bounds); f.toolbar.update(false);
	const first = f.draw().find(run => run.items === review.tooltip); assert.ok(first);
	const advance = t.mock.method(editorViewState.font, 'advance');
	for (let index = 0; index < 1000; index++) f.toolbar.update(false);
	assert.equal(advance.mock.callCount(), 0, 'clean toolbar updates do not remeasure retained labels or feedback');
	assert.equal(f.draw().find(run => run.items === review.tooltip)!.items, first.items);
	f.conversation.running(); f.layout(78); f.open(); f.toolbar.update(false);
	assert.equal(f.draw().some(run => run.items === review.tooltip), false, 'no tooltip over an owned menu');
	f.press('Escape'); f.layout(384); f.pointer(review.bounds); f.toolbar.update(false); assert.ok(f.draw().some(run => run.items === review.tooltip));
	f.toolbar.clearInput(); assert.equal(f.draw().some(run => run.items === review.tooltip), false);
	assert.equal(pointerHover.has(f.toolbar.control), false);
});

test('proposal retirement precedes publication and toolbar detachment retires only its own interactions', t => {
	const f = toolbarFixture(t), first = f.proposal('First'), second = f.proposal('Second');
	f.conversation.proposal(first); f.conversation.proposal(second); f.input.selection.select(f.conversation.entries[0]);
	let observed = 0;
	const unbind = f.input.selection.onWillChangeProposal(() => {
		assert.equal(f.input.selection.proposal, first);
		assert.equal(f.input.selection.entry, f.conversation.entries[0]);
		observed++;
	});
	f.input.selection.select(f.conversation.entries[1]); unbind(); assert.equal(observed, 1); assert.equal(f.input.selection.proposal, second);
	f.conversation.running(); f.layout(78); f.open();
	f.toolbar.clearInput(); assert.equal(f.menu.visible, false); assert.equal(pointerHover.has(f.toolbar.control), false);
	f.toolbar.setInput(f.input, f.parent); f.layout(384);
	const review = f.input.turnActions.items.find(item => item.command === 'assistant.review')!;
	f.pointer(review.bounds, PointerButton.Primary, PointerButton.Primary);
	f.toolbar.clearInput(); assert.equal(f.input.turnActions.pressedCommand, null);
	f.input.selection.select(f.conversation.entries[0]);
	pointerCapture.dispatch({ valid: true, insideViewport: true, viewportX: review.bounds.left + 1, viewportY: review.bounds.top + 1,
		pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 100);
	assert.deepEqual(f.opened, []);
});
