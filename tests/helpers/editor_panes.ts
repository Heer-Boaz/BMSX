import type { PlayerInput } from '../../hosts/common/input/player';
import type { PointerSnapshot } from '../../ide/common/models';
import type { EditorTextSelection } from '../../ide/editor/navigation/text_selection';
import { activateCodeEditorTab } from '../../ide/workbench/ui/code_tab/activation';
import type {
	BehaviorLensTabDescriptor,
	CodeEditorTabDescriptor,
	EditorTabDescriptor,
	ResourceViewerTabDescriptor,
	ScenarioLabTabDescriptor,
} from '../../ide/workbench/ui/tab/model';
import { EditorPane } from '../../ide/workbench/services/editor/editor_pane';
import { EditorPanes } from '../../ide/workbench/services/editor/editor_panes';

class TestEditorPane<TInput extends EditorTabDescriptor> extends EditorPane<TInput> {
	public constructor(
		private readonly activateInput: (
			input: TInput,
			selection?: EditorTextSelection,
		) => void,
	) {
		super();
	}

	// disable-next-line single_line_method_pattern -- Test panes exercise the production input lifecycle through the supplied activation contract.
	protected activate(selection?: EditorTextSelection): void {
		this.activateInput(this.input, selection);
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

function activateViewInput(_input: EditorTabDescriptor): void {
}

/** Editor-group lifecycle used by tests that exercise workspace and navigation owners. */
export function createTestEditorPanes(): EditorPanes {
	return new EditorPanes({
		code_editor: () => new TestEditorPane<CodeEditorTabDescriptor>(activateCodeEditorTab),
		resource_view: () => new TestEditorPane<ResourceViewerTabDescriptor>(activateViewInput),
		behavior_lens: () => new TestEditorPane<BehaviorLensTabDescriptor>(activateViewInput),
		scenario_lab: () => new TestEditorPane<ScenarioLabTabDescriptor>(activateViewInput),
	});
}
