import type { TimerHandle } from '../../../platform/platform';

export const workspaceState = {
	autosaveEnabled: false,
	autosaveSignature: null as string,
	autosaveHandle: null as TimerHandle | { cancel(): void },
	autosaveRunning: false,
	autosaveQueued: false,
	disposeExitListener: null as { unsubscribe(): void },
	serverConnected: false,
};
