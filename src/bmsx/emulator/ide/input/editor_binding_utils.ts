export type EditorKeyHandler = () => boolean;

export function runEditorKeyHandlers(handlers: readonly EditorKeyHandler[]): boolean {
	for (let index = 0; index < handlers.length; index += 1) {
		if (handlers[index]()) {
			return true;
		}
	}
	return false;
}
