export type BlinkState = {
	blinkTimer: number;
	cursorVisible: boolean;
};

export function resetBlinkState(state: BlinkState): void {
	state.blinkTimer = 0;
	state.cursorVisible = true;
}

export function advanceToggleBlink(state: BlinkState, deltaSeconds: number, intervalSeconds: number): void {
	state.blinkTimer += deltaSeconds;
	while (state.blinkTimer >= intervalSeconds) {
		state.blinkTimer -= intervalSeconds;
		state.cursorVisible = !state.cursorVisible;
	}
}

export function advancePhaseBlink(state: BlinkState, deltaSeconds: number, periodSeconds: number): void {
	state.blinkTimer += deltaSeconds;
	while (state.blinkTimer >= periodSeconds) {
		state.blinkTimer -= periodSeconds;
	}
	state.cursorVisible = state.blinkTimer < periodSeconds * 0.5;
}
