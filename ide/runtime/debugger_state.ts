export type RuntimeDebuggerState = {
	breakpoints: Map<string, Set<number>>;
};

export function createRuntimeDebuggerState(): RuntimeDebuggerState {
	return {
		breakpoints: new Map<string, Set<number>>(),
	};
}
