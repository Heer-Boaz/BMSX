import type { NodeSpec } from "../../ecs/pipeline";

export type ConsoleOverlaySpecOptions = {
	includeConsole?: boolean;
	includeEditor?: boolean;
	includePresentation?: boolean;
};

/**
 * Pipeline variant tailored for console/editor overlays.
 * Keeps rendering systems active while omitting gameplay/physics updates.
 */
export function buildConsoleOverlaySpec(options: ConsoleOverlaySpecOptions): NodeSpec[] {
	const includeConsole = options.includeConsole === true;
	const includeEditor = options.includeEditor === true;
	const includePresentation = options.includePresentation !== false || includeConsole || includeEditor;
	const nodes: NodeSpec[] = [];
	if (includeConsole) {
		nodes.push({ ref: 'bmsxConsole.mode' });
	}
	if (includeEditor) {
		nodes.push({ ref: 'bmsxConsole.editor', after: includeConsole ? ['bmsxConsole.mode'] : undefined });
	}
	if (includePresentation) {
		nodes.push({ ref: 'transform' });
		nodes.push({ ref: 'textRender' });
		nodes.push({ ref: 'spriteRender', after: ['textRender'] });
		nodes.push({ ref: 'meshRender', after: ['spriteRender'] });
		nodes.push({ ref: 'renderSubmit', after: ['meshRender'] });
	}
	if (includeConsole || includeEditor) {
		nodes.push({ ref: 'bmsxConsole.draw', after: ['renderSubmit'] });
	}
	return nodes;
}

export function consoleEditorSpec(): NodeSpec[] {
	return buildConsoleOverlaySpec({ includeConsole: true, includeEditor: true });
}
