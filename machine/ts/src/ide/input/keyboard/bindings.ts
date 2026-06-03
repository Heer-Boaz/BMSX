import type { Runtime } from '../../../machine/runtime/runtime';

export type EditorKeyHandler = () => boolean;
export type RuntimeEditorKeyHandler = (runtime: Runtime) => boolean;

export function runEditorKeyHandlers(handlers: readonly EditorKeyHandler[]): boolean {
	for (let index = 0; index < handlers.length; index += 1) {
		if (handlers[index]()) {
			return true;
		}
	}
	return false;
}

export function runRuntimeEditorKeyHandlers(runtime: Runtime, handlers: readonly RuntimeEditorKeyHandler[]): boolean {
	for (let index = 0; index < handlers.length; index += 1) {
		if (handlers[index](runtime)) {
			return true;
		}
	}
	return false;
}
