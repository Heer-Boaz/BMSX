import type { CartEditor } from './ide/cart_editor';
import type { FontVariant } from './font';
import type { RuntimeErrorDetails } from './ide/types';
import type { FaultSnapshot } from './ide/render/render_error_overlay';
import type { Viewport } from '../rompack/rompack';
import type { Runtime } from './runtime';

export function createLuaNativeEditor(runtime: Runtime): CartEditor {
	return {
		activate(): void {
		},
		deactivate(): void {
		},
		get isActive(): boolean {
			return false;
		},
		get exists(): boolean {
			return true;
		},
		tickInput(): void {
		},
		update(_deltaSeconds: number): void {
		},
		draw(): void {
		},
		shutdown(): void {
		},
		updateViewport(_viewport: Viewport): void {
		},
		setFontVariant(_variant: FontVariant): void {
		},
		showRuntimeErrorInChunk(_path: string, _line: number, _column: number, _message: string, _details?: RuntimeErrorDetails): void {
		},
		showRuntimeError(_line: number, _column: number, _message: string, _details?: RuntimeErrorDetails, _path?: string): void {
		},
		clearRuntimeErrorOverlay(): void {
		},
		clearAllRuntimeErrorOverlays(): void {
		},
		getSourceForChunk(path: string): string {
			return runtime.api.get_lua_resource_source(path);
		},
		clearWorkspaceDirtyBuffers(): void {
		},
		renderFaultOverlay(): void {
		},
		renderRuntimeFaultOverlay(_options: {
			snapshot: FaultSnapshot;
			luaRuntimeFailed: boolean;
			needsFlush: boolean;
			force?: boolean;
		}): boolean {
			return false;
		},
	};
}
