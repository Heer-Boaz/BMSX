import { navigateToRuntimeErrorFrameTarget } from '../../../workbench/contrib/debugger/ide_debugger';
import { rebuildRuntimeErrorOverlayView } from '../../contrib/runtime_error/runtime_error_overlay';
import type { RuntimeErrorOverlay } from '../../../common/types';
import type { RuntimeErrorOverlayClickResult } from '../../render/render_error_overlay';

export function collapseRuntimeErrorOverlay(overlay: RuntimeErrorOverlay): void {
	setRuntimeErrorOverlayExpanded(overlay, false);
}

export function handleRuntimeErrorOverlayPointerClick(overlay: RuntimeErrorOverlay, hoverLine: number): void {
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
			navigateToRuntimeErrorFrameTarget(clickResult.frame);
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

function setRuntimeErrorOverlayExpanded(overlay: RuntimeErrorOverlay, expanded: boolean): void {
	overlay.expanded = expanded;
	rebuildRuntimeErrorOverlayView(overlay);
}
