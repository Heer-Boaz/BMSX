import type { EditorCommandRunner } from '../../ide/common/commands';
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
import { restoreCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import type {
	BehaviorLensInput,
	CodeEditorInput,
	EditorInput,
	ScenarioLabInput,
} from '../../ide/workbench/ui/tab/model';
import { EditorPane } from '../../ide/workbench/services/editor/editor_pane';
import { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import type { CloseEditors } from '../../ide/workbench/services/editor/editor_close';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../ide/input/focus';

class TestEditorPane<TInput extends EditorInput> extends EditorPane<TInput> {
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
		if (navigationSelection !== undefined) restoreCodeEditorView(this.input, navigationSelection.snapshot);
	}
}

function activateViewInput(_input: EditorInput): void {
}

/** Mechanical group fixtures explicitly retire views without workspace close admission. */
const retireTestEditors: CloseEditors = targets => {
	for (const { group, input } of targets) group.removeEditor(input);
	return Promise.resolve(true);
};

/** Editor-group lifecycle used by tests that exercise workspace and navigation owners. */
export function createTestEditorGroup(
	commands: EditorCommandRunner = { isEnabled: () => false, execute() {} },
	codePane?: (scope: InputFocusScope) => EditorPane<CodeEditorInput>,
	closeEditors: CloseEditors = retireTestEditors,
): EditorGroupView {
	const group = new EditorGroupView({
		home: scope => new TestEditorPane<Extract<EditorInput, { kind: 'home' }>>(scope, activateViewInput),
		play_session: scope => new TestEditorPane<Extract<EditorInput, { kind: 'play_session' }>>(scope, activateViewInput),
		animation: scope => new TestEditorPane<Extract<EditorInput, { kind: 'animation' }>>(scope, activateViewInput),
		host_error: scope => new TestEditorPane<Extract<EditorInput, { kind: 'host_error' }>>(scope, activateViewInput),
		build_log: scope => new TestEditorPane<Extract<EditorInput, { kind: 'build_log' }>>(scope, activateViewInput),
		rom_inspector: scope => new TestEditorPane<RomInspectorInput>(scope, activateViewInput),
		event_viewer: scope => new TestEditorPane<EventViewerInput>(scope, activateViewInput),
		gte_debugger: scope => new TestEditorPane<Extract<EditorInput, { kind: 'gte_debugger' }>>(scope, activateViewInput),
		gpu_debugger: scope => new TestEditorPane<Extract<EditorInput, { kind: 'gpu_debugger' }>>(scope, activateViewInput),
		terminal: scope => new TestEditorPane<TerminalInput>(scope, activateViewInput),
		actor_lab: scope => new TestEditorPane<ActorLabInput>(scope, activateViewInput),
		game_view: scope => new TestEditorPane<GameViewInput>(scope, activateViewInput),
		conversation_observer: scope => new TestEditorPane<ConversationObserverInput>(scope, activateViewInput),
		assistant: scope => new TestEditorPane<AssistantInput>(scope, activateViewInput),
		workspace_edit_review: scope => new TestEditorPane<WorkspaceEditReviewInput>(scope, activateViewInput),
		code_editor: scope => codePane === undefined ? new TestCodeEditorPane(scope) : codePane(scope),
		resource_view: scope => new ResourceViewerEditorPane(scope),
		aem_editor: scope => new TestEditorPane<AemEditorInput>(scope, activateViewInput),
		lua_program: scope => new TestEditorPane<LuaProgramInput>(scope, activateViewInput),
		behavior_lens: scope => new TestEditorPane<BehaviorLensInput>(scope, activateViewInput),
		scenario_lab: scope => new TestEditorPane<ScenarioLabInput>(scope, activateViewInput),
		scene_editor: scope => new TestEditorPane<SceneEditorInput>(scope, activateViewInput),
		cart_map: scope => new TestEditorPane<CartMapInput>(scope, activateViewInput),
	}, commands, closeEditors);
	return group;
}
