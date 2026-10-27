import { WORKBENCH_TEXT_EDITOR_ID } from '../code_editor/editor_input';
import {
	RuntimeDebuggerStopReason,
	type RuntimeDebuggerState,
} from '../../../runtime/debugger_state';
import { showEditorMessage } from '../../../common/feedback_state';
import type { CartEditor } from '../../../cart_editor';
import type { CodeEditorControl } from '../../../editor/ui/code_editor_control';
import {
	blua32SourceRangeAtPc,
} from '../../../../toolchain/ts/rompack/blua32_symbols';
import { toLuaModulePath } from '../../../../toolchain/ts/lua/module_path';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { focusCapturedRuntimeSource, setExecutionStopHighlightForCurrentContext } from '../../../runtime_error/navigation';
import { editorTextModelService } from '../../../editor/model/model_service';
import { centerCursorVertically, setCursorPosition } from '../../../editor/ui/view/caret/caret';
import { clearEditorPointerSelectionState } from '../../../input/pointer/state';
import type { CodeEditorPane } from '../code_editor/editor_pane';

export class BreakpointController {
	public constructor(private readonly state: RuntimeDebuggerState) {}

	public toggleBreakpointForEditorRow(code: CodeEditorControl, row: number = code.view.cursorRow): boolean {
		const context = code;
		if (context.model.mode !== 'lua') {
			return false;
		}
		if (row < 0 || row >= code.model.buffer.getLineCount()) {
			return false;
		}
		const resource = context.model.resource;
		const lineNumber = row + 1;
		const added = this.state.breakpoints.toggle(resource, lineNumber);
		const binding = added ? this.state.breakpoints.read(resource).find(point => point.line === lineNumber)! : undefined;
		const pending = binding !== undefined && binding.status !== 'bound';
		const verb = added ? pending ? `unbound (${binding!.status})` : 'set' : 'cleared';
		showEditorMessage(`Breakpoint ${verb} at ${resource.path}:${lineNumber}`, pending ? 'warning' : 'info', 1.4);
		return true;
	}
}

export async function presentRuntimeDebuggerStop(
	editor: CartEditor,
	state: RuntimeDebuggerState,
	catalog: WorkspaceSourceCatalog,
): Promise<void> {
	state.stopPresentationPending = false;
	const stop = state.source.stop!, media = stop.media;
	const image = (stop.domain === -1 ? media.system : media.cartridgeSlots[stop.domain])!;
	const range = blua32SourceRangeAtPc(
		image.symbols!,
		image.layout.header.textAddress,
		stop.pc,
	)!;
	const source = image.sources.get(toLuaModulePath(range.path));
	if (source === undefined) {
		showEditorMessage('Paused without retained source text.', 'info', 1.4);
		return;
	}
	const resource = {
		contextId: image.sourceContextId,
		path: source.displayPath,
	};
	const group = editor.editorParts.editorDestination(editor.editorParts.activeGroup, { resource, editorId: WORKBENCH_TEXT_EDITOR_ID });
	const receipt = await focusCapturedRuntimeSource(editor.navigation, group, catalog, resource, source);
	if (state.source.stop !== stop || receipt === undefined || receipt.generation !== group.panes.openGeneration
		|| receipt.model.version !== receipt.version || editorTextModelService.get(resource) !== receipt.model) return;
	const code = (group.panes.getPane('code_editor') as CodeEditorPane).code;
	code.view.selectionAnchor = null; clearEditorPointerSelectionState(code);
	setCursorPosition(code, range.start.line - 1, range.start.column - 1);
	setExecutionStopHighlightForCurrentContext(group, range.start.line - 1);
	centerCursorVertically(code);
	showEditorMessage(
		stop.reason === RuntimeDebuggerStopReason.Breakpoint
			? 'Paused on breakpoint'
			: 'Paused after step',
		'info',
		1.4,
	);
}
