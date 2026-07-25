import type { Viewport } from '../../machine/ts/rompack/format';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { OverlayRenderer } from './overlay_renderer';
import type { CartEditor } from '../cart_editor';
import { createCartEditor } from '../cart_editor';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import type { GameView } from '../../machine/ts/render/gameview';
import { createRuntimeDebuggerState, type RuntimeDebuggerState } from './debugger_state';
import type { GateGroup } from '../../machine/ts/common/taskgate';
import { RuntimeNativeBridge } from './native_bridge';
import { taskGate } from '../../machine/ts/common/taskgate';

export const DEFAULT_IDE_FONT_VARIANT: FontVariant = 'tiny';
export type OverlayResolutionMode = 'offscreen' | 'viewport';

export type RuntimeIdeState = {
	editor: CartEditor;
	overlayRenderer: OverlayRenderer;
	activeFontVariant: FontVariant;
	overlayResolutionMode: OverlayResolutionMode;
	overlayActive: boolean;
	overlayDrawFrameOwner: 'ide' | null;
	editorRenderTargetBaselineActive: boolean;
	editorRenderTargetBaselineWidth: number;
	editorRenderTargetBaselineHeight: number;
	lastIdeInputFrame: number;
	debugger: RuntimeDebuggerState;
	shortcutDisposers: Array<() => void>;
	luaGate: GateGroup;
	nativeBridge: RuntimeNativeBridge;
};

export function createRuntimeIdeState(runtime: Runtime, viewport: Viewport): RuntimeIdeState {
	const overlayRenderer = new OverlayRenderer();
	const activeFontVariant = DEFAULT_IDE_FONT_VARIANT;
	const editor = createCartEditor(runtime, viewport, activeFontVariant);
	const state: RuntimeIdeState = {
		editor,
		overlayRenderer,
		activeFontVariant,
		overlayResolutionMode: 'viewport',
		overlayActive: false,
		overlayDrawFrameOwner: null,
		editorRenderTargetBaselineActive: false,
		editorRenderTargetBaselineWidth: 0,
		editorRenderTargetBaselineHeight: 0,
		lastIdeInputFrame: -1,
		debugger: createRuntimeDebuggerState(),
		shortcutDisposers: [],
		luaGate: taskGate.group('ide:lua'),
		nativeBridge: new RuntimeNativeBridge(runtime),
	};
	overlayRenderer.setViewportSize(viewport);
	editor.updateViewport(viewport);
	return state;
}

export function setOverlayResolutionMode(state: RuntimeIdeState, view: GameView, value: OverlayResolutionMode): void {
	state.overlayResolutionMode = value;
	state.overlayRenderer.setRenderingViewportType(view, value);
	state.editor.updateViewport(state.overlayRenderer.viewportSize);
}
