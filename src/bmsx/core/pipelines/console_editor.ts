import { $ } from "../game";
import { TickGroup } from "../../ecs/ecsystem";
import { DefaultECSPipelineRegistry, type NodeSpec } from "../../ecs/pipeline";
import { CONSOLE_DRAW_SYSTEM_ID, CONSOLE_UPDATE_SYSTEM_ID } from "../../console/system_ids";

export type ConsoleOverlaySpecOptions = {
	includeConsole?: boolean;
	includeEditor?: boolean;
	includePresentation?: boolean;
	includeConsoleDraw?: boolean;
};

type ModeSpecOptions = Omit<ConsoleOverlaySpecOptions, 'includeConsole' | 'includeEditor'>;

/**
 * Pipeline variant tailored for console/editor overlays.
 * Keeps rendering systems active while omitting gameplay/physics updates.
 */
export function buildConsoleOverlaySpec(options: ConsoleOverlaySpecOptions): NodeSpec[] {
	const includeConsole = options.includeConsole === true;
	const includeEditor = options.includeEditor === true;
	const includeConsoleFrame = includeConsole || includeEditor;
	const includePresentation = options.includePresentation !== false || includeConsoleFrame;
	const includeConsoleDraw = options.includeConsoleDraw !== false && includeConsoleFrame;
	const nodes: NodeSpec[] = [];
	if (includeConsoleFrame) {
		nodes.push({ ref: CONSOLE_UPDATE_SYSTEM_ID });
	}
	if (!includePresentation) {
		if (includeConsoleDraw) {
			nodes.push({ ref: CONSOLE_DRAW_SYSTEM_ID });
		}
		return nodes;
	}
	const spec = $.get_gameplay_pipeline_spec();
	for (let index = 0; index < spec.length; index += 1) {
		const node = spec[index];
		const desc = DefaultECSPipelineRegistry.get(node.ref)!;
		const group = node.group ?? desc.group;
		if (group !== TickGroup.Presentation) {
			continue;
		}
		if (!includeConsoleDraw && node.ref === CONSOLE_DRAW_SYSTEM_ID) {
			continue;
		}
		nodes.push({
			ref: node.ref,
			group: node.group,
			priority: node.priority,
			when: node.when,
		});
	}
	const hasConsoleFrame = nodes.some(node => node.ref === CONSOLE_DRAW_SYSTEM_ID);
	if (includeConsoleDraw && !hasConsoleFrame) {
		nodes.push({ ref: CONSOLE_DRAW_SYSTEM_ID });
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
	return buildConsoleOverlaySpec({ includePresentation: true, includeConsoleDraw: false });
}
