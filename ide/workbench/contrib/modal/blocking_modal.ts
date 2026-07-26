import type { PointerSnapshot } from '../../../common/models';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import {
	closeActionPrompt,
	drawActionPromptOverlay,
	handleActionPromptInput,
	handleActionPromptPointer,
	hasActionPrompt,
} from './action_prompt';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { RuntimeNativeBridge } from '../../../runtime/native_bridge';
import type { GateGroup } from '../../../../machine/ts/common/taskgate';
import type { OverlayRenderer } from '../../../runtime/overlay_renderer';

export function hasBlockingWorkbenchModal(): boolean {
	return hasActionPrompt();
}

export function closeBlockingWorkbenchModal(): boolean {
	if (hasActionPrompt()) {
		closeActionPrompt();
		return true;
	}
	return false;
}

export function handleBlockingWorkbenchModalInput(
	editor: CartEditor,
	sources: RuntimeSourceState,
	nativeBridge: RuntimeNativeBridge,
	fault: RuntimeFaultState,
	luaGate: GateGroup,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
): void {
	if (hasActionPrompt()) {
		handleActionPromptInput(
			editor,
			sources,
			fault,
			nativeBridge,
			luaGate,
			overlayRenderer,
			runtime,
		);
	}
}

export function handleBlockingWorkbenchModalPointer(
	editor: CartEditor,
	sources: RuntimeSourceState,
	nativeBridge: RuntimeNativeBridge,
	fault: RuntimeFaultState,
	luaGate: GateGroup,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	snapshot: PointerSnapshot,
): boolean {
	if (!hasActionPrompt()) {
		return false;
	}
	handleActionPromptPointer(
		editor,
		sources,
		fault,
		nativeBridge,
		luaGate,
		overlayRenderer,
		runtime,
		snapshot,
	);
	return true;
}

export function drawBlockingWorkbenchModal(): void {
	if (hasActionPrompt()) {
		drawActionPromptOverlay();
	}
}
