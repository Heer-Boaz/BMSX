import { $ } from "../game";
import { TickGroup } from "../../ecs/ecsystem";
import { DefaultECSPipelineRegistry, type NodeSpec } from "../../ecs/pipeline";

export type ConsoleOverlaySpecOptions = {
	includeConsole?: boolean;
	includeEditor?: boolean;
	includePresentation?: boolean;
	includeConsoleDraw?: boolean;
};

type ModeSpecOptions = Omit<ConsoleOverlaySpecOptions, 'includeConsole' | 'includeEditor'>;

const CONSOLE_FRAME_REF = 'bmsxConsole.frame';
const CONSOLE_FRAME_NODE: NodeSpec = { ref: CONSOLE_FRAME_REF };

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

const collectPresentationNodes = (includeConsoleFrame: boolean, includeConsoleDraw?: boolean): NodeSpec[] => {
	const spec = $.get_gameplay_pipeline_spec();
	const nodes: NodeSpec[] = [];
	for (const node of spec) {
		const desc = DefaultECSPipelineRegistry.get(node.ref)!;
		const group = node.group ?? desc.group;
		if (group !== TickGroup.Presentation) continue;
		if (node.ref === CONSOLE_FRAME_REF && (!includeConsoleFrame || includeConsoleDraw === false)) continue;
		nodes.push(cloneNode(node));
	}
	return nodes;
};

/**
 * Pipeline variant tailored for console/editor overlays.
 * Keeps rendering systems active while omitting gameplay/physics updates.
 */
export function buildConsoleOverlaySpec(options: ConsoleOverlaySpecOptions): NodeSpec[] {
	const includeConsole = options.includeConsole === true;
	const includeEditor = options.includeEditor === true;
	const includeConsoleFrame = includeConsole || includeEditor;
	const includePresentation = options.includePresentation !== false || includeConsoleFrame;
	const nodes: NodeSpec[] = [];
	if (includePresentation) {
		const presentationNodes = collectPresentationNodes(includeConsoleFrame, options.includeConsoleDraw);
		const hasConsoleFrame = presentationNodes.some(node => node.ref === CONSOLE_FRAME_REF);
		if (includeConsoleFrame && options.includeConsoleDraw !== false && !hasConsoleFrame) {
			pushNode(presentationNodes, CONSOLE_FRAME_NODE);
		}
		pushNodes(nodes, presentationNodes);
	} else if (includeConsoleFrame && options.includeConsoleDraw !== false) {
		pushNode(nodes, CONSOLE_FRAME_NODE);
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
	return collectPresentationNodes(false);
}
