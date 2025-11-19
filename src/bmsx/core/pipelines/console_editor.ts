import type { NodeSpec } from "../../ecs/pipeline";
import { GAMEPLAY_PRESENTATION_NODE_REFS } from "./gameplay";

export type ConsoleOverlaySpecOptions = {
	includeConsole?: boolean;
	includeEditor?: boolean;
	includePresentation?: boolean;
	includeConsoleDraw?: boolean;
};

type ModeSpecOptions = Omit<ConsoleOverlaySpecOptions, 'includeConsole' | 'includeEditor'>;

const PRESENTATION_NODES: NodeSpec[] = GAMEPLAY_PRESENTATION_NODE_REFS.map(ref => ({ ref }));

const CONSOLE_MODE_NODE: NodeSpec = { ref: 'bmsxConsole.mode' };
const CONSOLE_EDITOR_NODE: NodeSpec = { ref: 'bmsxConsole.editor' };
const CONSOLE_UPDATE_NODE: NodeSpec = { ref: 'bmsxConsole.update' };
const CONSOLE_DRAW_NODE: NodeSpec = { ref: 'bmsxConsole.draw' };

const cloneNode = (node: NodeSpec): NodeSpec => ({
	ref: node.ref,
	group: node.group,
	priority: node.priority,
	when: node.when,
});

const pushNode = (target: NodeSpec[], node: NodeSpec): void => {
	target.push(cloneNode(node));
};

const pushNodes = (target: NodeSpec[], nodes: NodeSpec[]): void => {
	for (const node of nodes) {
		pushNode(target, node);
	}
};

/**
 * Pipeline variant tailored for console/editor overlays.
 * Keeps rendering systems active while omitting gameplay/physics updates.
 */
export function buildConsoleOverlaySpec(options: ConsoleOverlaySpecOptions): NodeSpec[] {
	const includeConsole = options.includeConsole === true;
	const includeEditor = options.includeEditor === true;
	const includePresentation = options.includePresentation !== false || includeConsole || includeEditor;
	const includeConsoleDraw = options.includeConsoleDraw !== false;
	const nodes: NodeSpec[] = [];
	if (includeConsole) {
		pushNode(nodes, CONSOLE_MODE_NODE);
	}
	if (includeEditor) {
		pushNode(nodes, CONSOLE_EDITOR_NODE);
	}
	if (includeConsole || includeEditor) {
		pushNode(nodes, CONSOLE_UPDATE_NODE);
		if (includeConsoleDraw) {
			pushNode(nodes, CONSOLE_DRAW_NODE);
		}
	}
	if (includePresentation) {
		pushNodes(nodes, PRESENTATION_NODES);
	}
	return nodes;
}

export function consoleModeSpec(options?: ModeSpecOptions): NodeSpec[] {
	return buildConsoleOverlaySpec({ ...(options ?? {}), includeConsole: true, includeEditor: false });
}

export function editorModeSpec(options?: ModeSpecOptions): NodeSpec[] {
	return buildConsoleOverlaySpec({ ...(options ?? {}), includeConsole: false, includeEditor: true });
}

export function consoleEditorSpec(options?: ModeSpecOptions): NodeSpec[] {
	return buildConsoleOverlaySpec({ ...(options ?? {}), includeConsole: true, includeEditor: true });
}

export function presentationOnlySpec(): NodeSpec[] {
	const nodes: NodeSpec[] = [];
	pushNodes(nodes, PRESENTATION_NODES);
	return nodes;
}
