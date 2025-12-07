import { centerCursorVertically, setCursorPosition } from './caret';
import { beginNavigationCapture, completeNavigation, setActiveRuntimeErrorOverlay, setExecutionStopHighlight, syncRuntimeErrorOverlayFromContext } from './vm_cart_editor';
import { activateCodeTab, getActiveCodeTabContext, setActiveTab } from './editor_tabs';
import { ide_state } from './ide_state';
import type { CodeTabContext, RuntimeErrorOverlay } from './types';
import { resetBlink } from './render/render_caret';

type RuntimeErrorOverlayTarget = { context: CodeTabContext; overlay: RuntimeErrorOverlay };

function resolveRuntimeErrorOverlayTarget(): RuntimeErrorOverlayTarget {
	const activeContext = getActiveCodeTabContext();
	if (activeContext && activeContext.runtimeErrorOverlay) {
		return { context: activeContext, overlay: activeContext.runtimeErrorOverlay };
	}
	for (const context of ide_state.codeTabContexts.values()) {
		if (context.runtimeErrorOverlay) {
			return { context, overlay: context.runtimeErrorOverlay };
		}
	}
	return null;
}

function ensureActiveContext(target: CodeTabContext): void {
	if (!target) {
		return;
	}
	if (ide_state.activeTabId !== target.id) {
		setActiveTab(target.id);
		return;
	}
	syncRuntimeErrorOverlayFromContext(target);
}

export function focusRuntimeErrorOverlay(): boolean {
	const target = resolveRuntimeErrorOverlayTarget();
	if (!target) {
		return false;
	}
	ensureActiveContext(target.context);
	if (!getActiveCodeTabContext()) {
		activateCodeTab();
	}
	const overlay = target.context.runtimeErrorOverlay;
	if (!overlay) {
		return false;
	}
	const navigationCheckpoint = beginNavigationCapture();
	overlay.hidden = false;
	overlay.hovered = false;
	overlay.hoverLine = -1;
	overlay.copyButtonHovered = false;
	overlay.layout = null;
	setActiveRuntimeErrorOverlay(overlay);
	setExecutionStopHighlight(overlay.row);
	ide_state.selectionAnchor = null;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.cursorRevealSuspended = false;
	ide_state.scrollbarController.cancel();
	setCursorPosition(overlay.row, overlay.column);
	centerCursorVertically();
	resetBlink();
	completeNavigation(navigationCheckpoint);
	return true;
}
