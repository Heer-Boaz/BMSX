import type { BrowserOnscreenGamepad } from './onscreen_gamepad';
import type { GamepadInput } from '../common/input/gamepad';

export type BrowserInputTraceRoute = 'controller' | 'canvas' | 'ignored';
export type BrowserInputResetReason = 'blur' | 'pagehide' | 'hidden' | 'teardown';

/** Observes native routing at the browser owner; never produces game input. */
export interface BrowserInputTraceObserver {
	readonly commonGamepad: GamepadInput | null;
	pointerRouted(event: PointerEvent, route: BrowserInputTraceRoute, before: number, after: number, commonBefore: number, commonAfter: number, completed: boolean): void;
	inputReset(reason: BrowserInputResetReason, before: number, after: number, commonBefore: number, commonAfter: number, completed: boolean): void;
}

/** Installed only by the diagnostic page's early script, before the player bundle. */
export interface BrowserInputDiagnostics extends BrowserInputTraceObserver {
	setController(controller: BrowserOnscreenGamepad | null): void;
	setCommonGamepad(gamepad: GamepadInput | null): void;
	setStatus(status: string): void;
	bootError(error: unknown): void;
}

declare global {
	interface Window {
		bmsxInputTrace?: BrowserInputDiagnostics;
	}
}
