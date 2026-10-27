import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { RomInspectorInput } from '../../ide/workbench/contrib/rom_inspector/editor_input';
import type { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import type { EventViewerInput } from '../../ide/workbench/contrib/events/editor_input';
import type { LuaProgramInput } from '../../ide/workbench/contrib/lua_program/editor_input';
import type { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import type { ConversationObserverInput } from '../../ide/workbench/contrib/conversations/editor_input';
import type { RectBounds } from '../../machine/ts/common/rect';
import type { TerminalInput } from '../../ide/workbench/contrib/terminal/editor_input';
import type { AssistantInput } from '../../ide/workbench/contrib/assistant/editor_input';
import type { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import type { ActorLabInput } from '../../ide/workbench/contrib/actor_lab/editor_input';
import type { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import type { WorkspaceEditReviewInput } from '../../ide/workbench/contrib/edit_review/editor_input';
import type { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PointerInputSnapshot, WheelInputSnapshot } from '../../ide/common/models';
import type { EditorTextSelection } from '../../ide/editor/navigation/text_selection';
import { EditorPane } from '../../ide/workbench/services/editor/editor_pane';
import { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import type {
	BehaviorLensInput,
	EditorInput,
	ScenarioLabInput,
} from '../../ide/workbench/ui/tab/model';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../ide/input/focus';
import { openBuildLog } from '../../ide/workbench/contrib/builds/editor_input';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';

class RecordingEditorPane<TInput extends EditorInput> extends EditorPane<TInput> {
	public override get companionGameMinimumWidth(): undefined { return undefined; }

	public readonly focusTarget: InputFocusTarget;
	private readonly unbindKeyboard: () => void;
	public constructor(scope: InputFocusScope) {
		super();
		this.focusTarget = inputFocus.createTarget(null, scope);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
	}
	public setInputCount = 0;
	public activationCount = 0;
	public clearInputCount = 0;
	public updateCount = 0;
	public drawCount = 0;
	public keyboardCount = 0;
	public pointerCount = 0;
	public wheelCount = 0;
	public statusCount = 0;
	public selection: EditorTextSelection | undefined;

	public focus(): void {
		this.focusTarget.focus();
	}

	public dispose(): void {
		this.unbindKeyboard();
	}

	public override setInput(input: TInput, bounds: Readonly<RectBounds>, selection?: EditorTextSelection): void {
		this.setInputCount += 1;
		super.setInput(input, bounds, selection);
	}

	public override setOptions(selection?: EditorTextSelection): void {
		super.setOptions(selection);
		if (selection !== undefined) this.selection = selection;
	}

	public override clearInput(): void {
		this.clearInputCount += 1;
		super.clearInput();
	}

	protected activate(): void {
		this.activationCount += 1;
	}

	public override update(): void {
		this.updateCount += 1;
	}

	public draw(): void {
		this.drawCount += 1;
	}

	public handleKeyboard(_event: KeyInputEvent): void {
		this.keyboardCount += 1;
	}

	public handlePointer(
		_snapshot: PointerInputSnapshot,
		_justPressed: boolean,
		_pointerSecondaryJustPressed: boolean,
		_now: number,
		_gotoModifierActive: boolean,
	): void {
		this.pointerCount += 1;
	}

	public handleWheel(_event: WheelInputSnapshot): void {
		this.wheelCount += 1;
	}

	public drawStatusBar(_bounds: Readonly<RectBounds>, _textColor: number): void {
		this.statusCount += 1;
	}
}

function codeInput(id: 'code:0\0a.lua' | 'code:0\0b.lua'): CodeEditorInput {
	const path = id.slice('code:0\0'.length);
	return new CodeEditorInput(new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { resid: path, type: 'lua' } }, 'lua', ''));
}

function resourceInput(): ResourceViewerInput {
	return new ResourceViewerInput(createScenarioTestSourceState([]).catalog, { contextLabel: 'Fixture project', sourceFilePath: 'image.png', location: { kind: 'workspace' as const, path: 'image.png' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'image.png', source: { type: 'image', resid: 'image' } });
}

function createEditorPanes() {
	let codePane: RecordingEditorPane<CodeEditorInput>;
	let resourcePane: RecordingEditorPane<ResourceViewerInput>;
	let codeFactoryCount = 0;
	let resourceFactoryCount = 0;
	const group = new EditorGroupView({
		home: scope => new RecordingEditorPane<HomeInput>(scope),
		play_session: scope => new RecordingEditorPane(scope),
		animation: scope => new RecordingEditorPane<Extract<EditorInput, { kind: 'animation' }>>(scope),
		host_error: scope => new RecordingEditorPane<Extract<EditorInput, { kind: 'host_error' }>>(scope),
		build_log: scope => new RecordingEditorPane<Extract<EditorInput, { kind: 'build_log' }>>(scope),
		rom_inspector: scope => new RecordingEditorPane<RomInspectorInput>(scope),
		event_viewer: scope => new RecordingEditorPane<EventViewerInput>(scope),
		gte_debugger: scope => new RecordingEditorPane<Extract<EditorInput, { kind: 'gte_debugger' }>>(scope),
		gpu_debugger: scope => new RecordingEditorPane<Extract<EditorInput, { kind: 'gpu_debugger' }>>(scope),
		terminal: scope => new RecordingEditorPane<TerminalInput>(scope),
		actor_lab: scope => new RecordingEditorPane<ActorLabInput>(scope),
		game_view: scope => new RecordingEditorPane<GameViewInput>(scope),
		conversation_observer: scope => new RecordingEditorPane<ConversationObserverInput>(scope),
		aem_editor: scope => new RecordingEditorPane<AemEditorInput>(scope),
		lua_program: scope => new RecordingEditorPane<LuaProgramInput>(scope),
		assistant: scope => new RecordingEditorPane<AssistantInput>(scope),
		workspace_edit_review: scope => new RecordingEditorPane<WorkspaceEditReviewInput>(scope),
		code_editor: scope => {
			codeFactoryCount += 1;
			codePane = new RecordingEditorPane<CodeEditorInput>(scope);
			return codePane;
		},
		resource_view: scope => {
			resourceFactoryCount += 1;
			resourcePane = new RecordingEditorPane<ResourceViewerInput>(scope);
			return resourcePane;
		},
		behavior_lens: scope => new RecordingEditorPane<BehaviorLensInput>(scope),
		scenario_lab: scope => new RecordingEditorPane<ScenarioLabInput>(scope),
		scene_editor: scope => new RecordingEditorPane<SceneEditorInput>(scope),
		cart_map: scope => new RecordingEditorPane<CartMapInput>(scope),
	}, { isEnabled: () => false, execute() {} }, async targets => {
		for (const { group, input } of targets) group.removeEditor(input);
		return true;
	});
	return {
		group,
		codePane: () => codePane!,
		resourcePane: () => resourcePane!,
		codeFactoryCount: () => codeFactoryCount,
		resourceFactoryCount: () => resourceFactoryCount,
	};
}

test('an attached input receives its current layout before its control can acquire focus', t => {
	const harness = createEditorPanes();
	t.after(() => { harness.group.dispose(); inputFocus.setTarget(null); });
	const presented = new WeakMap<object, EditorInput>();
	t.mock.method(RecordingEditorPane.prototype, 'layout', function (this: RecordingEditorPane<EditorInput>, bounds: Readonly<RectBounds>) {
		EditorPane.prototype.layout.call(this, bounds);
		presented.set(this, this.input);
	});
	t.mock.method(RecordingEditorPane.prototype, 'focus', function (this: RecordingEditorPane<EditorInput>) {
		assert.equal(presented.get(this), this.input, 'focus admission must consume the attached input\'s published layout');
		this.focusTarget.focus();
	});
	harness.group.panes.layout({ left: 0, top: 10, right: 384, bottom: 270 });
	harness.group.panes.openEditor(codeInput('code:0\0a.lua'));
	assert.equal(harness.codePane().focusTarget.hasFocus, true);
	harness.group.panes.openEditor(resourceInput());
	assert.equal(harness.resourcePane().focusTarget.hasFocus, true);
	harness.group.panes.openEditor(codeInput('code:0\0b.lua'));
	assert.equal(harness.codePane().focusTarget.hasFocus, true);
});

test('Build Output opens the actual request identity once, retains its document, and never reuses a closed transient input', async t => {
	const harness = createEditorPanes();
	t.after(() => { harness.group.dispose(); inputFocus.setTarget(null); });
	const job: StudioBuildJob = { request: { requestId: 'request-42', target: 'nemesis_s', debug: true, optLevel: 0 },
		state: 'failed', phase: 'compile', acceptedAt: 10, updatedAt: 20, version: { generation: 1, sequence: 2 }, error: 'Compiler error' };
	const next: StudioBuildJob = { ...job, request: { ...job.request, requestId: 'request-43' } };
	const requested: string[] = [];
	const builds: WorkspaceBuilds = {
		jobs: [job, next], pending: [], targets: async () => ['nemesis_s'],
		submit: async () => { throw new Error('Opening output must never submit a build'); },
		get: async id => { requested.push(id); return id === job.request.requestId ? job : next; },
		log: async () => 'Exact\r\noutput\n',
		cancel: async () => { throw new Error('Opening output must never cancel a build'); },
		forget: () => { throw new Error('Opening output must never discard a receipt'); },
	};
	const first = openBuildLog(harness.group, builds, job);
	await first.refresh();
	assert.equal(first.id, 'build-log:request-42'); assert.equal(harness.group.panes.activePane!.input, first);
	assert.equal(first.resource, undefined); assert.equal(first.serializable, false); assert.equal(first.isDirty(), false);
	assert.equal('workingCopy' in first, false, 'a durable build receipt is not an authored working copy');
	const document = first.error!; document.select(0, 8);
	assert.equal(document.copy(), 'Compiler');
	const reopened = openBuildLog(harness.group, builds, job);
	assert.equal(reopened, first); assert.equal(reopened.document, document); assert.equal(document.copy(), 'Compiler');
	assert.equal(harness.group.model.tabs.length, 1, 'the request ID, not its target label, owns the open tab');
	const other = openBuildLog(harness.group, builds, next);
	assert.notEqual(other, first); assert.equal(other.id, 'build-log:request-43'); assert.equal(harness.group.model.tabs.length, 2);
	assert.equal(other.job.request.target, first.job.request.target, 'same-target jobs still have independent identities');
	harness.group.close(first.id);
	assert.equal(harness.group.model.findById(first.id), undefined);
	const replacement = openBuildLog(harness.group, builds, job);
	assert.notEqual(replacement, first); assert.notEqual(replacement.error, document);
	assert.equal(replacement.document.selectionStart, 0); assert.equal(replacement.document.copy(), null);
	assert.ok(requested.every(id => id === 'request-42' || id === 'request-43'));
});

test('closing the last tab detaches its pane before disposal and leaves the group empty', () => {
	const harness = createEditorPanes();
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'a.lua', location: { kind: 'workspace', path: 'a.lua' },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'a.lua', source: { resid: 'a.lua', type: 'lua' } }, 'lua', '');
	class ClosingInput extends CodeEditorInput {
		public disposals = 0;
		public override dispose(): void {
			assert.equal(harness.codePane().input, null, 'the control cannot still use the input being disposed');
			this.disposals += 1;
			super.dispose();
		}
	}
	const input = new ClosingInput(model);
	harness.group.model.initialize(input);
	harness.group.panes.openEditor(input);
	try {
		harness.group.close(input.id);
		assert.equal(input.disposals, 1);
		assert.equal(harness.group.model.tabs.length, 0);
		assert.equal(harness.group.model.activeTab, null);
		assert.equal(harness.group.panes.activePane, null);
	} finally {
		harness.group.dispose(); model.dispose();
	}
});

test('editor panes retain one lazy pane per input kind and apply the input lifecycle', () => {
	const harness = createEditorPanes();
	const first = codeInput('code:0\0a.lua');
	const second = codeInput('code:0\0b.lua');
	const selection = { row: 7, startColumn: 2, endColumn: 5 };
	const codeClearInputCounts: number[] = [];

	assert.equal(harness.codeFactoryCount(), 0);
	assert.equal(harness.resourceFactoryCount(), 0);
	harness.group.panes.openEditor(first);
	const codePane = harness.codePane();
	assert.equal(harness.codeFactoryCount(), 1);
	assert.equal(codePane.setInputCount, 1);

	harness.group.panes.openEditor(first, { selection });
	assert.strictEqual(codePane.selection, selection);
	assert.equal(codePane.activationCount, 1, 'options do not repeat input attachment');

	harness.group.panes.openEditor(second);
	assert.equal(harness.codeFactoryCount(), 1);
	// disable-next-line repeated_expression_pattern -- Successive reads prove the clearInput transition count after each lifecycle operation.
	codeClearInputCounts.push(codePane.clearInputCount);
	assert.equal(codePane.setInputCount, 2);
	assert.strictEqual(codePane.input, second);

	harness.group.panes.openEditor(resourceInput());
	const resourcePane = harness.resourcePane();
	assert.equal(harness.resourceFactoryCount(), 1);
	codeClearInputCounts.push(codePane.clearInputCount);
	assert.equal(resourcePane.setInputCount, 1);

	harness.group.panes.openEditor(first);
	assert.equal(harness.codeFactoryCount(), 1);
	assert.equal(resourcePane.clearInputCount, 1);
	assert.equal(codePane.setInputCount, 3);

	harness.group.panes.clearEditor();
	codeClearInputCounts.push(codePane.clearInputCount);
	harness.group.panes.clearEditor();
	codeClearInputCounts.push(codePane.clearInputCount);
	assert.deepEqual(codeClearInputCounts, [1, 2, 3, 3]);
});

test('input blur completes against the old attached resource before the next pane attaches', () => {
	const harness = createEditorPanes();
	const first = codeInput('code:0\0a.lua');
	const second = codeInput('code:0\0b.lua');
	harness.group.panes.openEditor(first);
	const pane = harness.codePane();
	let blurs = 0;
	const unsubscribe = pane.focusTarget.onDidBlur(() => {
		assert.equal(pane.input, first);
		assert.equal(pane.clearInputCount, 0);
		blurs += 1;
	});
	harness.group.panes.openEditor(second);
	assert.equal(blurs, 1);
	assert.equal(pane.input, second);
	assert.equal(pane.focusTarget.hasFocus, true);
	unsubscribe();
	harness.group.dispose();
	assert.equal(inputFocus.target, null);
});

test('same-input navigation blurs the old control before changing selection, while tab focus does not reactivate it', t => {
	const harness = createEditorPanes();
	const input = codeInput('code:0\0a.lua');
	t.after(() => { harness.group.dispose(); input.dispose(); input.workingCopy.dispose(); });
	const selection = { row: 2, startColumn: 1, endColumn: 3 };
	harness.group.panes.openEditor(input, { selection });
	const pane = harness.codePane();
	const field = inputFocus.createTarget(pane.focusTarget);
	let blurs = 0;
	const unbind = field.onDidBlur(() => {
		assert.equal(pane.input, input);
		assert.equal(pane.selection, selection);
		blurs += 1;
	});
	t.after(unbind);
	field.focus();
	harness.group.panes.openEditor(input);
	assert.equal(blurs, 1);
	assert.equal(pane.selection, selection);
	field.focus();
	const next = { row: 7, startColumn: 0, endColumn: 1 };
	const destination = inputFocus.createTarget(pane.focusTarget);
	const setOptions = pane.setOptions.bind(pane);
	t.mock.method(pane, 'setOptions', (selection: EditorTextSelection) => {
		assert.equal(inputFocus.target, null, 'navigation applies only after the old control has blurred');
		setOptions(selection);
		// A navigation location may switch which concrete control receives focus.
		t.mock.method(pane, 'focus', () => destination.focus());
	});
	harness.group.panes.openEditor(input, { selection: next });
	assert.equal(blurs, 2);
	assert.equal(pane.selection, next);
	assert.equal(pane.setInputCount, 1);
	assert.equal(pane.activationCount, 1);
	assert.equal(inputFocus.target, destination);
});

test('editor pane hot paths dispatch directly to the retained active pane', () => {
	const harness = createEditorPanes();
	const snapshot = {} as PointerInputSnapshot;
	harness.group.panes.openEditor(resourceInput());

	const activePane = harness.group.panes.activePane;
	activePane.update(0.02);
	activePane.draw();
	activePane.handleKeyboard(new KeyInputEvent('KeyA', KeyModifier.none));
	activePane.handlePointer({ ...snapshot, modifiers: KeyModifier.none, spaceDown: false }, true, false, 42, false);
	activePane.handleWheel({ ...snapshot, deltaX: 0, deltaY: 3 });
	activePane.drawStatusBar({ left: 14, top: 280, right: 384, bottom: 288 }, 0xffffffff);

	const pane = harness.resourcePane();
	assert.equal(pane.updateCount, 1);
	assert.equal(pane.drawCount, 1);
	assert.equal(pane.keyboardCount, 1);
	assert.equal(pane.pointerCount, 1);
	assert.equal(pane.wheelCount, 1);
	assert.equal(pane.statusCount, 1);
	assert.equal(harness.resourceFactoryCount(), 1);
});


test('concrete groups retain independent controls, focus ancestry and capture lifetimes', t => {
	const first = createEditorPanes(), second = createEditorPanes();
	t.after(() => { first.group.dispose(); second.group.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null); });
	const firstInput = resourceInput(), secondInput = resourceInput();
	first.group.openEditor(firstInput);
	second.group.openEditor(secondInput);
	const firstPane = first.resourcePane(), secondPane = second.resourcePane();
	assert.notEqual(firstPane, secondPane);
	assert.equal(first.group.model.activeTab, firstInput);
	assert.equal(second.group.model.activeTab, secondInput);
	assert.equal(firstPane.focusTarget.scope, first.group.focusScope);
	assert.equal(secondPane.focusTarget.scope, second.group.focusScope);
	assert.equal(inputFocus.target, secondPane.focusTarget);
	let cancelled = 0, released = 0;
	const target = { handleCapturedPointer() {}, cancelPointer() { cancelled++; }, releaseCapturedPointer() { released++; } };
	const down = { valid: true, insideViewport: true, viewportX: 0, viewportY: 0,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	pointerCapture.beginRoute(second.group.captureScope, down);
	pointerCapture.capture(target, PointerButton.Primary, second.group.captureScope);
	first.group.clear();
	assert.equal(first.group.panes.activePane, null);
	assert.equal(first.group.model.tabs.length, 0);
	assert.equal(second.group.panes.activePane, secondPane);
	assert.equal(second.group.model.activeTab, secondInput);
	assert.equal(inputFocus.target, secondPane.focusTarget);
	assert.equal(pointerCapture.active, true);
	assert.equal(cancelled, 0);
	second.group.clear();
	assert.equal(pointerCapture.active, false);
	assert.equal(pointerCapture.draining, true);
	assert.equal(inputFocus.target, null);
	assert.equal(cancelled, 1);
	assert.equal(released, 0);
	pointerCapture.dispatch({ ...down, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary },
		false, 1, second.group.captureScope);
	assert.equal(released, 0, 'retiring a group cancels rather than commits its pending gesture');
});
