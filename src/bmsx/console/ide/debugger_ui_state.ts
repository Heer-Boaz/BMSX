import { ide_state } from './ide_state';
import type { DebuggerLifecycleEvent, DebuggerExecutionState } from '../debugger_lifecycle';
import { subscribeDebuggerLifecycleEvents, getDebuggerExecutionState } from '../debugger_lifecycle';

let initialized = false;

export function initializeDebuggerUiState(): void {
	if (initialized) {
		return;
	}
	initialized = true;
	updateExecutionState(getDebuggerExecutionState());
	subscribeDebuggerLifecycleEvents(handleDebuggerLifecycleEvent);
}

function handleDebuggerLifecycleEvent(event: DebuggerLifecycleEvent): void {
	if (event.type === 'continued') {
		updateExecutionState('running');
		return;
	}
	updateExecutionState('paused');
}

function updateExecutionState(state: DebuggerExecutionState): void {
	if (ide_state.debuggerControls.executionState === state) {
		return;
	}
	ide_state.debuggerControls.executionState = state;
}
