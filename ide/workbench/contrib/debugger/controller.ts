import {
	RuntimeDebuggerStopReason,
	type RuntimeDebuggerState,
} from '../../../runtime/debugger_state';
import { showEditorMessage } from '../../../common/feedback_state';
import type { CartEditor } from '../../../cart_editor';
import { getActiveCodeTabContext } from '../../ui/code_tab/contexts';
import * as constants from '../../../common/constants';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
import {
	blua32SourceRangeAtPc,
} from '../../../../toolchain/ts/rompack/blua32_symbols';
import { blua32ToolingImageForDomain } from '../../../../toolchain/ts/rompack/blua32_media';
import { resolveRuntimeLuaSource } from '../../../runtime/sources';
import { focusExecutionStop } from '../../../runtime_error/navigation';

export class BreakpointController {
	public constructor(private readonly state: RuntimeDebuggerState) {}

	public toggleBreakpointForEditorRow(row: number = activeCodeEditor.view.cursorRow): boolean {
		const context = getActiveCodeTabContext();
		if (context.model.mode !== 'lua') {
			return false;
		}
		if (row < 0 || row >= activeCodeEditor.model.buffer.getLineCount()) {
			return false;
		}
		const resource = context.model.resource;
		if (!resource.path) {
			showEditorMessage('No active path available for breakpoints.', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		const lineNumber = row + 1;
		const added = this.state.breakpoints.toggle(resource, lineNumber);
		const binding = added ? this.state.breakpoints.read(resource).find(point => point.line === lineNumber)! : undefined;
		const pending = binding !== undefined && binding.status !== 'bound';
		const verb = added ? pending ? `unbound (${binding!.status})` : 'set' : 'cleared';
		showEditorMessage(`Breakpoint ${verb} at ${resource.path}:${lineNumber}`, pending ? constants.COLOR_STATUS_WARNING : constants.COLOR_STATUS_TEXT, 1.4);
		return true;
	}
}

export async function presentRuntimeDebuggerStop(
	editor: CartEditor,
	state: RuntimeDebuggerState,
): Promise<void> {
	state.stopPresentationPending = false;
	const image = blua32ToolingImageForDomain(
		state.sources.currentBlua32Media,
		state.source.stop!.domain,
	)!;
	const range = blua32SourceRangeAtPc(
		image.symbols!,
		image.layout.header.textAddress,
		state.source.stop!.pc,
	)!;
	const source = resolveRuntimeLuaSource(state.sources, {
		domain: state.source.stop!.domain,
		path: range.path,
	})!;
	const generation = await focusExecutionStop(editor, {
		domain: source.domain,
		path: source.record.source_path,
	}, range.start.line, range.start.column);
	if (generation !== editor.editorPanes.openGeneration) return;
	showEditorMessage(
		state.source.stop!.reason === RuntimeDebuggerStopReason.Breakpoint
			? 'Paused on breakpoint'
			: 'Paused after step',
		constants.COLOR_STATUS_TEXT,
		1.4,
	);
}
