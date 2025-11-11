export type DebuggerRuntimeAccessor = () => unknown;

export const DEBUGGER_RUNTIME_ACCESSOR_KEY = '__bmsxDebuggerRuntimeAccessor';

type AccessorHost = {
	[DEBUGGER_RUNTIME_ACCESSOR_KEY]?: DebuggerRuntimeAccessor;
};

export function setDebuggerRuntimeAccessor(accessor: DebuggerRuntimeAccessor | null): void {
	const host = globalThis as AccessorHost;
	if (!accessor) {
		delete host[DEBUGGER_RUNTIME_ACCESSOR_KEY];
		return;
	}
	host[DEBUGGER_RUNTIME_ACCESSOR_KEY] = accessor;
}

export function getDebuggerRuntimeAccessor(): DebuggerRuntimeAccessor | null {
	const host = globalThis as AccessorHost;
	const accessor = host[DEBUGGER_RUNTIME_ACCESSOR_KEY];
	return typeof accessor === 'function' ? accessor : null;
}
