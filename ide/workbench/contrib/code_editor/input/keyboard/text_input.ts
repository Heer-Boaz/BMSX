import type { Input } from '../../../../../../hosts/common/input/manager';
import { handleEditorBreakpointInput } from '../../../../../input/keyboard/debug_input';
import { handleEditorNavigationKeys } from './navigation_input';
import { handleEditorEditingKeys } from './editing_input';
import type { CodeEditorControl } from '../../../../../editor/ui/code_editor_control';
import type { BreakpointController } from '../../../debugger/controller';
import type { KeyInputEvent } from '../../../../../../hosts/common/input/text';

export function handleSourceInput(code: CodeEditorControl, input: KeyInputEvent, breakpoints: BreakpointController): void {
	if (handleEditorBreakpointInput(code, input, breakpoints)) return;
	handleEditorNavigationKeys(code, input);
	handleEditorEditingKeys(code, input);
}

export function applyEditorInputOverrides(input: Input, active: boolean, captureKeys: readonly string[]): void {
	input.debugHotkeysPaused = active;
	for (const key of captureKeys) input.setKeyboardCapture(key, active);
}
