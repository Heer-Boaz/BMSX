import type { AssistantInput } from '../../ide/workbench/contrib/assistant/editor_input';
import type { EditorPaneSelection } from '../../ide/workbench/services/editor/editor_selection';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import type { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import type { ActorLabInput } from '../../ide/workbench/contrib/actor_lab/editor_input';
import type { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import type { WorkspaceEditReviewInput } from '../../ide/workbench/contrib/edit_review/editor_input';
import type { PlayerInput } from '../../hosts/common/input/player';
import type { PointerSnapshot } from '../../ide/common/models';
import type { EditorTextSelection } from '../../ide/editor/navigation/text_selection';
import { activateCodeEditorTab } from '../../ide/workbench/ui/code_tab/activation';
import type {
	BehaviorLensInput,
	CodeEditorInput,
	EditorInput,
	ResourceViewerInput,
	ScenarioLabInput,
} from '../../ide/workbench/ui/tab/model';
import { EditorPane } from '../../ide/workbench/services/editor/editor_pane';
import { EditorPanes } from '../../ide/workbench/services/editor/editor_panes';
import { inputFocus } from '../../ide/input/focus';

class TestEditorPane<TInput extends EditorInput> extends EditorPane<TInput> {
	private readonly focusTarget = inputFocus.createTarget();
	private readonly unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
	public constructor(
		private readonly activateInput: (
			input: TInput,
			selection?: EditorTextSelection,
			navigationSelection?: EditorPaneSelection,
		) => void,
		captureSelection?: (input: TInput) => EditorPaneSelection,
	) {
		super();
		if (captureSelection !== undefined) this.getSelection = () => captureSelection(this.input);
	}

	// disable-next-line single_line_method_pattern -- Test panes exercise the production input lifecycle through the supplied activation contract.
	protected activate(selection?: EditorTextSelection, navigationSelection?: EditorPaneSelection): void {
		this.activateInput(this.input, selection, navigationSelection);
	}

	public focus(): void {
		this.focusTarget.focus();
	}

	public dispose(): void {
		this.unbindKeyboard();
	}

	public draw(): void {
	}

	public handleKeyboard(_playerInput: PlayerInput): void {
	}

	public handlePointer(
		_snapshot: PointerSnapshot,
		_justPressed: boolean,
		_pointerSecondaryJustPressed: boolean,
		_playerInput: PlayerInput,
		_now: number,
		_gotoModifierActive: boolean,
	): void {
	}

	public handleWheel(
		_direction: number,
		_steps: number,
		_activePointer: PointerSnapshot | null,
		_playerInput: PlayerInput,
	): void {
	}

	public drawStatusBar(_statusTop: number, _textColor: number): void {
	}
}

function activateViewInput(_input: EditorInput): void {
}

/** Editor-group lifecycle used by tests that exercise workspace and navigation owners. */
export function createTestEditorPanes(): EditorPanes {
	return new EditorPanes({
		actor_lab: () => new TestEditorPane<ActorLabInput>(activateViewInput),
		game_view: () => new TestEditorPane<GameViewInput>(activateViewInput),
		assistant: () => new TestEditorPane<AssistantInput>(activateViewInput),
		workspace_edit_review: () => new TestEditorPane<WorkspaceEditReviewInput>(activateViewInput),
		code_editor: () => new TestEditorPane<CodeEditorInput>(activateCodeEditorTab, input => new CodeEditorNavigationSelection(input)),
		resource_view: () => new TestEditorPane<ResourceViewerInput>(activateViewInput),
		behavior_lens: () => new TestEditorPane<BehaviorLensInput>(activateViewInput),
		scenario_lab: () => new TestEditorPane<ScenarioLabInput>(activateViewInput),
		scene_editor: () => new TestEditorPane<SceneEditorInput>(activateViewInput),
	});
}
