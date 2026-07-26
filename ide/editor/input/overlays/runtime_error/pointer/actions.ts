import { rebuildRuntimeErrorOverlayView } from '../../../../contrib/runtime_error/overlay';
import { RuntimeErrorOverlay } from '../../../../../common/models';
import { RuntimeErrorOverlayClickResult } from '../../../../render/error_overlay';
import type { CartEditor } from '../../../../../cart_editor';
import type { RuntimeSourceState } from '../../../../../runtime/sources';
import type { Runtime } from '../../../../../../machine/ts/machine/runtime/runtime';
import { navigateToRuntimeErrorFrameTarget } from '../../../../../runtime_error/navigation';

export function handleRuntimeErrorOverlayPointerClick(
	editor: CartEditor,
	sources: RuntimeSourceState,
	runtime: Runtime,
	overlay: RuntimeErrorOverlay,
	hoverLine: number,
): void {
	const clickResult = evaluateRuntimeErrorOverlayClick(overlay, hoverLine);
	switch (clickResult.kind) {
		case 'expand':
			setRuntimeErrorOverlayExpanded(overlay, true);
			return;
		case 'collapse':
			setRuntimeErrorOverlayExpanded(overlay, false);
			return;
		case 'navigate':
			setRuntimeErrorOverlayExpanded(overlay, false);
			navigateToRuntimeErrorFrameTarget(editor, sources, runtime, clickResult.frame);
			return;
		case 'noop':
		default:
			return;
	}
}

export function evaluateRuntimeErrorOverlayClick(
	overlay: RuntimeErrorOverlay,
	hoverLine: number
): RuntimeErrorOverlayClickResult {
	if (!overlay.expanded) {
		return { kind: 'expand' };
	}
	if (hoverLine < 0 || hoverLine >= overlay.lineDescriptors.length) {
		return { kind: 'collapse' };
	}
	const descriptor = overlay.lineDescriptors[hoverLine];
	if (descriptor.role === 'frame' && descriptor.frame) {
		if (descriptor.frame.origin === 'lua') {
			return { kind: 'navigate', frame: descriptor.frame };
		}
		return { kind: 'noop' };
	}
	return { kind: 'collapse' };
}

export function setRuntimeErrorOverlayExpanded(overlay: RuntimeErrorOverlay, expanded: boolean): void {
	overlay.expanded = expanded;
	rebuildRuntimeErrorOverlayView(overlay);
}
