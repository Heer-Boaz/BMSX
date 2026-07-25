import type { RuntimeFaultState } from './fault_state';
import type { RuntimeIdeState } from './state';
import type { RuntimeSourceState } from './sources';

class RuntimeWorkbenchState {
	public sources!: RuntimeSourceState;
	public ide!: RuntimeIdeState;
	public fault!: RuntimeFaultState;
}

export const runtimeWorkbenchState = new RuntimeWorkbenchState();
