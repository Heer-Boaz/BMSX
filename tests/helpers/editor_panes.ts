import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { ActionPrompt } from '../../ide/workbench/contrib/modal/action_prompt';
import type { EditorCommandRunner } from '../../ide/common/commands';
import type { TestContext } from 'node:test';
import { ResourceViewerEditorPane } from '../../ide/workbench/contrib/resources/editor_pane';
import type { KeyInputEvent } from '../../hosts/common/input/text';
import type { RomInspectorInput } from '../../ide/workbench/contrib/rom_inspector/editor_input';
import type { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import type { EventViewerInput } from '../../ide/workbench/contrib/events/editor_input';
import type { ConversationObserverInput } from '../../ide/workbench/contrib/conversations/editor_input';
import type { RectBounds } from '../../machine/ts/common/rect';
import type { TerminalInput } from '../../ide/workbench/contrib/terminal/editor_input';
import type { AssistantInput } from '../../ide/workbench/contrib/assistant/editor_input';
import type { EditorPaneSelection } from '../../ide/workbench/services/editor/editor_selection';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import type { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import type { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import type { LuaProgramInput } from '../../ide/workbench/contrib/lua_program/editor_input';
import type { ActorLabInput } from '../../ide/workbench/contrib/actor_lab/editor_input';
import type { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import type { WorkspaceEditReviewInput } from '../../ide/workbench/contrib/edit_review/editor_input';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../ide/common/models';
import type { EditorTextSelection } from '../../ide/editor/navigation/text_selection';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../ide/editor/editing/cursor/state';
import { restoreCodeEditorLocation } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import type { EditorInput } from '../../ide/workbench/common/editor_inputs';
import type { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import type { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { ScenarioLabInput } from '../../ide/workbench/contrib/scenario_lab/editor_input';
import { EditorPane } from '../../ide/workbench/services/editor/editor_pane';
import type { EditorPaneFactories } from '../../ide/workbench/services/editor/editor_panes';
import { EditorGroupView, type EditorGroupPresentation } from '../../ide/workbench/services/editor/editor_group';
import type { CloseEditors } from '../../ide/workbench/services/editor/editor_close';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../ide/input/focus';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { EditorParts } from '../../ide/workbench/services/editor/editor_parts';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { drawEditorText } from '../../ide/editor/render/text_renderer';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { measureText, measureTextRange } from '../../ide/editor/common/text/layout';

export const TEST_EDITOR_TAB_LAYOUT_CONTEXT = {
	get font() { return editorViewState.font.renderFont(); },
	get tabBarHeight() { return editorViewState.tabBarHeight; },
	get charAdvance() { return editorViewState.charAdvance; },
	measureText, measureTextRange,
};

export const TEST_EDITOR_TAB_RENDER_CONTEXT = {
	drawText(text: string, x: number, y: number, z: number, color: number): void {
		drawEditorText(editorViewState.font, text, x, y, z, color);
	},
};

/** Real retained container/surfaces for group lifecycle tests; no primary workbench aliases. */
export function createTestGroupPresentation(surfaces = new WorkbenchSurfaceService(),
	workArea: Readonly<RectBounds> = { left: 0, top: 0, right: 800, bottom: 600 }): EditorGroupPresentation {
	const focusScope = new InputFocusScope(Symbol('test editor container'), inputFocus.workbenchScope);
	const owner = surfaces.attach({ role: 'content', captureScope: focusScope.surfaceScope,
		isVisible: () => true, getBounds: () => workArea, getClip: () => workArea, draw() {} });
	return { surfaces, owner, focusScope, workArea, renderContext: TEST_EDITOR_TAB_RENDER_CONTEXT,
		dropTarget: { update() {}, drop() {}, clear() {} },
		contextMenu: new ContextMenuController(inputFocus, pointerCapture), layout: group => group.layout(group.bounds, group.clip, group.presented) };
}

class TestEditorPane<TInput extends EditorInput> extends EditorPane<TInput> {
	public override get commandTarget() { return this.focusTarget; }
	public override get companionGameMinimumWidth(): undefined { return undefined; }

	private readonly focusTarget: InputFocusTarget;
	private readonly unbindKeyboard: () => void;
	public constructor(
		scope: InputFocusScope,
		private readonly activateInput: (input: TInput) => void,
		captureSelection?: (input: TInput) => EditorPaneSelection,
	) {
		super();
		this.focusTarget = inputFocus.createTarget(null, scope);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		if (captureSelection !== undefined) this.getSelection = () => captureSelection(this.input);
	}

	// disable-next-line single_line_method_pattern -- Test panes exercise the production input lifecycle through the supplied activation contract.
	protected activate(): void {
		this.activateInput(this.input);
	}

	public focus(): void {
		this.focusTarget.focus();
	}

	public dispose(): void {
		this.unbindKeyboard();
	}

	public draw(): void {
	}

	public handleKeyboard(_event: KeyInputEvent): void {
	}

	public handlePointer(
		_snapshot: PointerInputSnapshot,
		_justPressed: boolean,
		_pointerSecondaryJustPressed: boolean,
		_now: number,
		_gotoModifierActive: boolean,
	): void {
	}

	public handleWheel(_event: WheelInputSnapshot): void {
	}

	public drawStatusBar(_bounds: Readonly<RectBounds>, _textColor: number): void {
	}
}

class TestCodeEditorPane extends TestEditorPane<CodeEditorInput> {
	public constructor(scope: InputFocusScope) {
		super(scope, input => input.initializeViewState(), input => new CodeEditorNavigationSelection(input));
	}
	public override setOptions(selection?: EditorTextSelection, navigationSelection?: CodeEditorNavigationSelection): void {
		const view = this.input.context.view;
		if (selection !== undefined) {
			setSingleCursorPosition(view, selection.row, selection.startColumn);
			setSingleCursorSelectionAnchor(view, selection.row, selection.endColumn);
		}
		if (navigationSelection !== undefined) restoreCodeEditorLocation(this.input, navigationSelection.snapshot);
	}
}

function activateViewInput(_input: EditorInput): void {
}

/** Mechanical group fixtures explicitly retire views without workspace close admission. */
const retireTestEditors: CloseEditors = targets => {
	for (const { group, input } of targets) group.removeEditor(input);
	return Promise.resolve(true);
};

/** Mechanical fixtures still use the real close/input-operation owner. */
export function createTestEditorCloseDependencies(t: TestContext, presentation: EditorGroupPresentation) {
	const models = new EditorTextModelService(), catalog = new WorkspaceSourceCatalog();
	const saves = new TextFileSaveService(models, new VirtualHeadlessClock(), catalog);
	const prompt = new ActionPrompt(inputFocus, pointerCapture, () => presentation.surfaces.changed(), undefined,
		{ kind: 'workspace', scope: presentation.focusScope, bounds: presentation.workArea });
	t.after(async () => { await saves.shutdown(); prompt.dispose(); models.clear(); catalog.dispose(); });
	return { models, saves, prompt };
}

/** Real frontend parts share one surface owner and popup family without constructing a machine. */
export function createTestEditorParts(
	t: TestContext,
	commands: EditorCommandRunner = { isEnabled: () => false, execute() {} },
	factories: EditorPaneFactories = createTestEditorPaneFactories(),
	workArea?: Readonly<RectBounds>,
): EditorParts {
	const surfaces = new WorkbenchSurfaceService(), presentation = createTestGroupPresentation(surfaces, workArea);
	const contextMenu = presentation.contextMenu;
	const parts = new EditorParts({
		surfaces, owner: presentation.owner, scope: presentation.focusScope, workArea: presentation.workArea,
		commands, contextMenu, renderContext: presentation.renderContext, factories, ...createTestEditorCloseDependencies(t, presentation),
		focusReturn: inputFocus.createTarget(null, presentation.focusScope),
		layoutMain: () => parts.main.layout(presentation.workArea),
	});
	t.after(() => { parts.dispose(); contextMenu.dispose(); surfaces.dispose(); });
	return parts;
}

/** Editor-group lifecycle used by tests that exercise workspace and navigation owners. */
export function createTestEditorGroup(
	commands: EditorCommandRunner = { isEnabled: () => false, execute() {} },
	codePane?: (scope: InputFocusScope, group: EditorGroupView) => EditorPane<CodeEditorInput>,
	closeEditors: CloseEditors = retireTestEditors,
	presentation: EditorGroupPresentation = createTestGroupPresentation(),
): EditorGroupView {
	return new EditorGroupView(createTestEditorPaneFactories(codePane), commands, closeEditors, presentation);
}

/** Parts and standalone groups use the same real group-local pane factories. */
export function createTestEditorPaneFactories(
	codePane?: (scope: InputFocusScope, group: EditorGroupView) => EditorPane<CodeEditorInput>,
): EditorPaneFactories {
	return {
		home: group => new TestEditorPane<Extract<EditorInput, { kind: 'home' }>>(group.focusScope, activateViewInput),
		play_session: group => new TestEditorPane<Extract<EditorInput, { kind: 'play_session' }>>(group.focusScope, activateViewInput),
		animation: group => new TestEditorPane<Extract<EditorInput, { kind: 'animation' }>>(group.focusScope, activateViewInput),
		host_error: group => new TestEditorPane<Extract<EditorInput, { kind: 'host_error' }>>(group.focusScope, activateViewInput),
		build_log: group => new TestEditorPane<Extract<EditorInput, { kind: 'build_log' }>>(group.focusScope, activateViewInput),
		rom_inspector: group => new TestEditorPane<RomInspectorInput>(group.focusScope, activateViewInput),
		event_viewer: group => new TestEditorPane<EventViewerInput>(group.focusScope, activateViewInput),
		gte_debugger: group => new TestEditorPane<Extract<EditorInput, { kind: 'gte_debugger' }>>(group.focusScope, activateViewInput),
		gpu_debugger: group => new TestEditorPane<Extract<EditorInput, { kind: 'gpu_debugger' }>>(group.focusScope, activateViewInput),
		terminal: group => new TestEditorPane<TerminalInput>(group.focusScope, activateViewInput),
		actor_lab: group => new TestEditorPane<ActorLabInput>(group.focusScope, activateViewInput),
		game_view: group => new TestEditorPane<GameViewInput>(group.focusScope, activateViewInput),
		conversation_observer: group => new TestEditorPane<ConversationObserverInput>(group.focusScope, activateViewInput),
		assistant: group => new TestEditorPane<AssistantInput>(group.focusScope, activateViewInput),
		workspace_edit_review: group => new TestEditorPane<WorkspaceEditReviewInput>(group.focusScope, activateViewInput),
		code_editor: group => codePane === undefined ? new TestCodeEditorPane(group.focusScope) : codePane(group.focusScope, group),
		resource_view: group => new ResourceViewerEditorPane(group.focusScope),
		aem_editor: group => new TestEditorPane<AemEditorInput>(group.focusScope, activateViewInput),
		lua_program: group => new TestEditorPane<LuaProgramInput>(group.focusScope, activateViewInput),
		behavior_lens: group => new TestEditorPane<BehaviorLensInput>(group.focusScope, activateViewInput),
		scenario_lab: group => new TestEditorPane<ScenarioLabInput>(group.focusScope, activateViewInput),
		scene_editor: group => new TestEditorPane<SceneEditorInput>(group.focusScope, activateViewInput),
		cart_map: group => new TestEditorPane<CartMapInput>(group.focusScope, activateViewInput),
	};
}
