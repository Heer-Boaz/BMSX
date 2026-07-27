import type { Viewport } from '../../machine/ts/rompack/format';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import type { GameView } from '../../machine/ts/render/gameview';
import type { GateGroup } from '../../machine/ts/common/taskgate';
import { taskGate } from '../../machine/ts/common/taskgate';
import { RuntimeCartEditor, type CartEditor } from '../cart_editor';
import { createRuntimeDebuggerState, type RuntimeDebuggerState } from './debugger_state';
import { createRuntimeFaultState, type RuntimeFaultState } from './fault_state';
import { RuntimeLuaTooling } from './lua_tooling';
import { OverlayRenderer } from './overlay_renderer';
import type { RuntimeSourceState } from './sources';

export const DEFAULT_IDE_FONT_VARIANT: FontVariant = 'tiny';
export type OverlayResolutionMode = 'offscreen' | 'viewport';

export class RuntimeIdeState {
	public readonly editor: CartEditor;
	public readonly overlayRenderer = new OverlayRenderer();
	public lastIdeInputFrame = -1;
	public readonly debugger: RuntimeDebuggerState = createRuntimeDebuggerState();
	public shortcutDisposers: Array<() => void> = [];
	public readonly luaGate: GateGroup = taskGate.group('ide:lua');
	public readonly luaTooling: RuntimeLuaTooling;
	public readonly fault: RuntimeFaultState = createRuntimeFaultState();

	public constructor(
		runtime: Runtime,
		viewport: Viewport,
		public readonly sources: RuntimeSourceState,
	) {
		this.luaTooling = new RuntimeLuaTooling(runtime, sources);
		this.editor = new RuntimeCartEditor(
			runtime,
			viewport,
			DEFAULT_IDE_FONT_VARIANT,
			sources,
			this.fault,
			this.luaTooling,
			this.debugger,
			this.luaGate,
			this.overlayRenderer,
		);
		this.overlayRenderer.setViewportSize(viewport);
		this.editor.updateViewport(viewport);
	}
}

export function setOverlayResolutionMode(
	renderer: OverlayRenderer,
	editor: CartEditor,
	view: GameView,
	value: OverlayResolutionMode,
): void {
	renderer.setRenderingViewportType(view, value);
	editor.updateViewport(renderer.viewportSize);
}
