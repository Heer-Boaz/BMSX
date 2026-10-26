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
import { EditorPanes } from '../../ide/workbench/services/editor/editor_panes';
import type {
	BehaviorLensInput,
	EditorInput,
	ScenarioLabInput,
} from '../../ide/workbench/ui/tab/model';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import type { CodeTabContext } from '../../ide/workbench/ui/code_tab/model';
import { inputFocus } from '../../ide/input/focus';
import { closeTab } from '../../ide/workbench/ui/tabs';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import { codeEditorInputManager } from '../../ide/workbench/ui/code_tab/input_manager';
import { openBuildLog } from '../../ide/workbench/contrib/builds/editor_input';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';

class RecordingEditorPane<TInput extends EditorInput> extends EditorPane<TInput> {
	public override get companionGameMinimumWidth(): undefined { return undefined; }

	public readonly focusTarget = inputFocus.createTarget();
	private readonly unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
	public setInputCount = 0;
	public activationCount = 0;
	public setOptionsCount = 0;
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
		this.setOptionsCount += 1;
		super.setOptions(selection);
		this.selection = selection;
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
	const context: CodeTabContext = {
		id,
		title: id,
		model: new EditorTextModel({ location: { kind: 'workspace' as const, path },
			domain: 0,
			path,
			source: { resid: path, type: 'lua' },
		}, 'lua', ''),
		view: createCodeEditorViewState(),
		runtimeErrorOverlay: null,
		executionStopRow: null,
	};
	return new CodeEditorInput(context);
}

function resourceInput(): ResourceViewerInput {
	return new ResourceViewerInput({
		resource: { location: { kind: 'workspace' as const, path: 'image.png' }, domain: 0, path: 'image.png', source: { type: 'image', resid: 'image' } },
		title: 'image.png',
		lines: [], error: null,
	});
}

function createEditorPanes() {
	let codePane: RecordingEditorPane<CodeEditorInput>;
	let resourcePane: RecordingEditorPane<ResourceViewerInput>;
	let codeFactoryCount = 0;
	let resourceFactoryCount = 0;
	const editorPanes = new EditorPanes({
		home: () => new RecordingEditorPane<HomeInput>(),
		play_session: () => new RecordingEditorPane(),
		animation: () => new RecordingEditorPane<Extract<EditorInput, { kind: 'animation' }>>(),
		host_error: () => new RecordingEditorPane<Extract<EditorInput, { kind: 'host_error' }>>(),
		build_log: () => new RecordingEditorPane<Extract<EditorInput, { kind: 'build_log' }>>(),
		rom_inspector: () => new RecordingEditorPane<RomInspectorInput>(),
		event_viewer: () => new RecordingEditorPane<EventViewerInput>(),
		gte_debugger: () => new RecordingEditorPane<Extract<EditorInput, { kind: 'gte_debugger' }>>(),
		gpu_debugger: () => new RecordingEditorPane<Extract<EditorInput, { kind: 'gpu_debugger' }>>(),
		terminal: () => new RecordingEditorPane<TerminalInput>(),
		actor_lab: () => new RecordingEditorPane<ActorLabInput>(),
		game_view: () => new RecordingEditorPane<GameViewInput>(),
		conversation_observer: () => new RecordingEditorPane<ConversationObserverInput>(),
		aem_editor: () => new RecordingEditorPane<AemEditorInput>(),
		lua_program: () => new RecordingEditorPane<LuaProgramInput>(),
		assistant: () => new RecordingEditorPane<AssistantInput>(),
		workspace_edit_review: () => new RecordingEditorPane<WorkspaceEditReviewInput>(),
		code_editor: () => {
			codeFactoryCount += 1;
			codePane = new RecordingEditorPane<CodeEditorInput>();
			return codePane;
		},
		resource_view: () => {
			resourceFactoryCount += 1;
			resourcePane = new RecordingEditorPane<ResourceViewerInput>();
			return resourcePane;
		},
		behavior_lens: () => new RecordingEditorPane<BehaviorLensInput>(),
		scenario_lab: () => new RecordingEditorPane<ScenarioLabInput>(),
		scene_editor: () => new RecordingEditorPane<SceneEditorInput>(),
		cart_map: () => new RecordingEditorPane<CartMapInput>(),
	});
	return {
		editorPanes,
		codePane: () => codePane!,
		resourcePane: () => resourcePane!,
		codeFactoryCount: () => codeFactoryCount,
		resourceFactoryCount: () => resourceFactoryCount,
	};
}

test('an attached input receives its current layout before its control can acquire focus', t => {
	const harness = createEditorPanes();
	t.after(() => { harness.editorPanes.dispose(); inputFocus.setTarget(null); });
	const presented = new WeakMap<object, EditorInput>();
	t.mock.method(RecordingEditorPane.prototype, 'layout', function (this: RecordingEditorPane<EditorInput>, bounds: Readonly<RectBounds>) {
		EditorPane.prototype.layout.call(this, bounds);
		presented.set(this, this.input);
	});
	t.mock.method(RecordingEditorPane.prototype, 'focus', function (this: RecordingEditorPane<EditorInput>) {
		assert.equal(presented.get(this), this.input, 'focus admission must consume the attached input\'s published layout');
		this.focusTarget.focus();
	});
	harness.editorPanes.layout({ left: 0, top: 10, right: 384, bottom: 270 });
	harness.editorPanes.openEditor(codeInput('code:0\0a.lua'));
	assert.equal(harness.codePane().focusTarget.hasFocus, true);
	harness.editorPanes.openEditor(resourceInput());
	assert.equal(harness.resourcePane().focusTarget.hasFocus, true);
	harness.editorPanes.openEditor(codeInput('code:0\0b.lua'));
	assert.equal(harness.codePane().focusTarget.hasFocus, true);
});

test('Build Output opens the actual request identity once, retains its document, and never reuses a closed transient input', async t => {
	const harness = createEditorPanes();
	editorTabGroup.clear();
	t.after(() => { harness.editorPanes.clearEditor(); editorTabGroup.clear(); harness.editorPanes.dispose(); inputFocus.setTarget(null); });
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
	const first = openBuildLog(harness.editorPanes, builds, job);
	await first.refresh();
	assert.equal(first.id, 'build-log:request-42'); assert.equal(harness.editorPanes.activePane!.input, first);
	assert.equal(first.resource, undefined); assert.equal(first.serializable, false); assert.equal(first.isDirty(), false);
	assert.equal('workingCopy' in first, false, 'a durable build receipt is not an authored working copy');
	const document = first.error!; document.select(0, 8);
	assert.equal(document.copy(), 'Compiler');
	const reopened = openBuildLog(harness.editorPanes, builds, job);
	assert.equal(reopened, first); assert.equal(reopened.document, document); assert.equal(document.copy(), 'Compiler');
	assert.equal(editorTabGroup.tabs.length, 1, 'the request ID, not its target label, owns the open tab');
	const other = openBuildLog(harness.editorPanes, builds, next);
	assert.notEqual(other, first); assert.equal(other.id, 'build-log:request-43'); assert.equal(editorTabGroup.tabs.length, 2);
	assert.equal(other.job.request.target, first.job.request.target, 'same-target jobs still have independent identities');
	closeTab(harness.editorPanes, first.id);
	assert.equal(editorTabGroup.findById(first.id), undefined);
	const replacement = openBuildLog(harness.editorPanes, builds, job);
	assert.notEqual(replacement, first); assert.notEqual(replacement.error, document);
	assert.equal(replacement.document.selectionStart, 0); assert.equal(replacement.document.copy(), null);
	assert.ok(requested.every(id => id === 'request-42' || id === 'request-43'));
});

test('closing the last tab detaches its pane before disposal and leaves the group empty', () => {
	const harness = createEditorPanes();
	const context = codeInput('code:0\0a.lua').context;
	class ClosingInput extends CodeEditorInput {
		public disposals = 0;
		public override dispose(): void {
			assert.equal(harness.codePane().input, null, 'the control cannot still use the input being disposed');
			this.disposals += 1;
			super.dispose();
		}
	}
	const input = new ClosingInput(context);
	codeEditorInputManager.register(context);
	editorTabGroup.initialize(input);
	harness.editorPanes.openEditor(input);
	try {
		closeTab(harness.editorPanes, input.id);
		assert.equal(input.disposals, 1);
		assert.equal(editorTabGroup.tabs.length, 0);
		assert.equal(editorTabGroup.activeTab, null);
		assert.equal(harness.editorPanes.activePane, null);
	} finally {
		harness.editorPanes.dispose();
		editorTabGroup.clear(); codeEditorInputManager.clear(); context.model.dispose();
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
	harness.editorPanes.openEditor(first);
	const codePane = harness.codePane();
	assert.equal(harness.codeFactoryCount(), 1);
	assert.equal(codePane.setInputCount, 1);

	harness.editorPanes.openEditor(first, selection);
	assert.equal(codePane.setOptionsCount, 1);
	assert.strictEqual(codePane.selection, selection);
	assert.equal(codePane.activationCount, 1, 'options do not repeat input attachment');

	harness.editorPanes.openEditor(second);
	assert.equal(harness.codeFactoryCount(), 1);
	// disable-next-line repeated_expression_pattern -- Successive reads prove the clearInput transition count after each lifecycle operation.
	codeClearInputCounts.push(codePane.clearInputCount);
	assert.equal(codePane.setInputCount, 2);
	assert.strictEqual(codePane.input, second);

	harness.editorPanes.openEditor(resourceInput());
	const resourcePane = harness.resourcePane();
	assert.equal(harness.resourceFactoryCount(), 1);
	codeClearInputCounts.push(codePane.clearInputCount);
	assert.equal(resourcePane.setInputCount, 1);

	harness.editorPanes.openEditor(first);
	assert.equal(harness.codeFactoryCount(), 1);
	assert.equal(resourcePane.clearInputCount, 1);
	assert.equal(codePane.setInputCount, 3);

	harness.editorPanes.clearEditor();
	codeClearInputCounts.push(codePane.clearInputCount);
	harness.editorPanes.clearEditor();
	codeClearInputCounts.push(codePane.clearInputCount);
	assert.deepEqual(codeClearInputCounts, [1, 2, 3, 3]);
});

test('input blur completes against the old attached resource before the next pane attaches', () => {
	const harness = createEditorPanes();
	const first = codeInput('code:0\0a.lua');
	const second = codeInput('code:0\0b.lua');
	harness.editorPanes.openEditor(first);
	const pane = harness.codePane();
	let blurs = 0;
	const unsubscribe = pane.focusTarget.onDidBlur(() => {
		assert.equal(pane.input, first);
		assert.equal(pane.clearInputCount, 0);
		blurs += 1;
	});
	harness.editorPanes.openEditor(second);
	assert.equal(blurs, 1);
	assert.equal(pane.input, second);
	assert.equal(pane.focusTarget.hasFocus, true);
	unsubscribe();
	harness.editorPanes.dispose();
	assert.equal(inputFocus.target, null);
});

test('same-input navigation blurs the old control before changing selection, while tab focus does not reactivate it', t => {
	const harness = createEditorPanes();
	const input = codeInput('code:0\0a.lua');
	t.after(() => { harness.editorPanes.dispose(); input.dispose(); input.context.model.dispose(); });
	const selection = { row: 2, startColumn: 1, endColumn: 3 };
	harness.editorPanes.openEditor(input, selection);
	const pane = harness.codePane();
	const field = inputFocus.createTarget(pane.focusTarget);
	let blurs = 0;
	const unbind = field.onDidBlur(() => {
		assert.equal(pane.input, input);
		assert.equal(pane.selection, selection);
		assert.equal(pane.setOptionsCount, 1);
		blurs += 1;
	});
	t.after(unbind);
	field.focus();
	harness.editorPanes.openEditor(input);
	assert.equal(blurs, 1);
	assert.equal(pane.setOptionsCount, 1);
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
	harness.editorPanes.openEditor(input, next);
	assert.equal(blurs, 2);
	assert.equal(pane.selection, next);
	assert.equal(pane.setOptionsCount, 2);
	assert.equal(pane.setInputCount, 1);
	assert.equal(pane.activationCount, 1);
	assert.equal(inputFocus.target, destination);
});

test('editor pane hot paths dispatch directly to the retained active pane', () => {
	const harness = createEditorPanes();
	const snapshot = {} as PointerInputSnapshot;
	harness.editorPanes.openEditor(resourceInput());

	const activePane = harness.editorPanes.activePane;
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
