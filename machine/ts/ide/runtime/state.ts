import type { Viewport } from '../../rompack/format';
import type { Runtime } from '../../machine/runtime/runtime';
import { OverlayRenderer } from './overlay_renderer';
import type { TerminalMode } from '../terminal/ui/mode';
import { TerminalMode as TerminalModeCtor } from '../terminal/ui/mode';
import type { CartEditor } from '../cart_editor';
import { createCartEditor } from '../cart_editor';
import type { FontVariant } from '../../render/shared/bmsx_font';
import type { GameView } from '../../render/gameview';
import { createRuntimeDebuggerState, type RuntimeDebuggerState } from './debugger_state';
import type { GateGroup } from '../../common/taskgate';
import { RuntimeNativeBridge } from './native_bridge';
import { taskGate } from '../../common/taskgate';

export const DEFAULT_IDE_FONT_VARIANT: FontVariant = 'tiny';
export type OverlayResolutionMode = 'offscreen' | 'viewport';

export type RuntimeIdeState = {
	editor: CartEditor;
	terminal: TerminalMode;
	overlayRenderer: OverlayRenderer;
	activeFontVariant: FontVariant;
	overlayResolutionMode: OverlayResolutionMode;
	overlayActive: boolean;
	overlayDrawFrameOwner: 'terminal' | 'ide' | null;
	editorRenderTargetBaselineActive: boolean;
	editorRenderTargetBaselineWidth: number;
	editorRenderTargetBaselineHeight: number;
	lastIdeInputFrame: number;
	lastTerminalInputFrame: number;
	debugger: RuntimeDebuggerState;
	shortcutDisposers: Array<() => void>;
	luaGate: GateGroup;
	includeJsStackTraces: boolean;
	nativeBridge: RuntimeNativeBridge;
};

export function createRuntimeIdeState(runtime: Runtime, viewport: Viewport): RuntimeIdeState {
	const overlayRenderer = new OverlayRenderer();
	const activeFontVariant = DEFAULT_IDE_FONT_VARIANT;
	const terminal = new TerminalModeCtor(runtime, activeFontVariant);
	const editor = createCartEditor(runtime, viewport, activeFontVariant);
	const state: RuntimeIdeState = {
		editor,
		terminal,
		overlayRenderer,
		activeFontVariant,
		overlayResolutionMode: 'viewport',
		overlayActive: false,
		overlayDrawFrameOwner: null,
		editorRenderTargetBaselineActive: false,
		editorRenderTargetBaselineWidth: 0,
		editorRenderTargetBaselineHeight: 0,
		lastIdeInputFrame: -1,
		lastTerminalInputFrame: -1,
		debugger: createRuntimeDebuggerState(),
		shortcutDisposers: [],
		luaGate: taskGate.group('ide:lua'),
		includeJsStackTraces: false,
		nativeBridge: new RuntimeNativeBridge(runtime),
	};
	overlayRenderer.setViewportSize(viewport);
	editor.updateViewport(viewport);
	return state;
}

export function flushRuntimeLuaOutputToTerminal(runtime: Runtime, state: RuntimeIdeState): void {
	const lines = runtime.luaOutputLines;
	if (lines.length === 0) {
		return;
	}
	const terminal = state.terminal;
	for (let index = 0; index < lines.length; index += 1) {
		terminal.appendStdout(lines[index]);
	}
	lines.length = 0;
}

export function setOverlayResolutionMode(state: RuntimeIdeState, view: GameView, value: OverlayResolutionMode): void {
	state.overlayResolutionMode = value;
	state.overlayRenderer.setRenderingViewportType(view, value);
	state.editor.updateViewport(state.overlayRenderer.viewportSize);
}
