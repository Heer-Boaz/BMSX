import { $ } from "../game";
import { TickGroup } from "../../ecs/ecsystem";
import { DefaultECSPipelineRegistry, type NodeSpec } from "../../ecs/pipeline";
import { BMSX_CART_DRAW_SYSTEM_ID, BMSX_CART_UPDATE_SYSTEM_ID } from '../../vm/vm_systems';
export type VMOverlaySpecOptions = {
	includeTerminal?: boolean;
	includeIDE?: boolean;
	includePresentation?: boolean;
	includeCartDraw?: boolean;
};

type ModeSpecOptions = Omit<VMOverlaySpecOptions, 'includeTerminal' | 'includeIDE'>;

/**
 * Pipeline variant tailored for vm/editor overlays.
 * Keeps rendering systems active while omitting gameplay/physics updates.
 */
export function buildVMOverlaySpec(options: VMOverlaySpecOptions): NodeSpec[] {
	const includeVM = options.includeTerminal === true;
	const includeEditor = options.includeIDE === true;
	const includeVMFrame = includeVM || includeEditor;
	const includePresentation = options.includePresentation !== false || includeVMFrame;
	const includeVMDraw = options.includeCartDraw !== false && includeVMFrame;
	const nodes: NodeSpec[] = [];
	if (includeVMFrame) {
		nodes.push({ ref: BMSX_CART_UPDATE_SYSTEM_ID });
	}
	if (!includePresentation) {
		if (includeVMDraw) {
			nodes.push({ ref: BMSX_CART_DRAW_SYSTEM_ID });
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
		if (!includeVMDraw && node.ref === BMSX_CART_DRAW_SYSTEM_ID) {
			continue;
		}
		nodes.push({
			ref: node.ref,
			group: node.group,
			priority: node.priority,
			when: node.when,
		});
	}
	const hasVMFrame = nodes.some(node => node.ref === BMSX_CART_DRAW_SYSTEM_ID);
	if (includeVMDraw && !hasVMFrame) {
		nodes.push({ ref: BMSX_CART_DRAW_SYSTEM_ID });
	}
	return nodes;
}

export function interactiveVMSpec(options?: ModeSpecOptions): NodeSpec[] {
	return buildVMOverlaySpec({ ...(options ?? {}), includeTerminal: true, includeIDE: false });
}

export function editorModeSpec(options?: ModeSpecOptions): NodeSpec[] {
	return buildVMOverlaySpec({ ...(options ?? {}), includeTerminal: false, includeIDE: true });
}

export function consoleEditorSpec(options?: ModeSpecOptions): NodeSpec[] {
	return buildVMOverlaySpec({ ...(options ?? {}), includeTerminal: true, includeIDE: true });
}

export function presentationOnlySpec(): NodeSpec[] {
	return buildVMOverlaySpec({ includePresentation: true, includeCartDraw: false });
}

type OverlayRequest = VMOverlaySpecOptions;
class OverlayPipelineControllerImpl {
	private readonly requests = new Map<string, OverlayRequest>();

	public setRequest(id: string, request: OverlayRequest): void {
		if (!request) {
			this.requests.delete(id);
		} else {
			this.requests.set(id, { ...request });
		}
		this.rebuild();
	}

	private rebuild(): void {
		if (this.requests.size === 0) {
			$.set_pipeline_override(null);
			return;
		}
		const merged: OverlayRequest = {
			includeTerminal: false,
			includeIDE: false,
			includePresentation: false,
		};
		for (const request of this.requests.values()) {
			if (request.includeTerminal) merged.includeTerminal = true;
			if (request.includeIDE) merged.includeIDE = true;
			if (request.includePresentation) merged.includePresentation = true;
			if (request.includeCartDraw === false) merged.includeCartDraw = false;
		}
		const presentationEnabled = merged.includePresentation !== false;
		$.view.setPresentationPassesEnabled(presentationEnabled);
		let spec: NodeSpec[] = [];
		if (merged.includeTerminal && merged.includeIDE) {
			spec = consoleEditorSpec({ includePresentation: merged.includePresentation, includeCartDraw: merged.includeCartDraw });
		} else if (merged.includeTerminal) {
			spec = interactiveVMSpec({ includePresentation: merged.includePresentation, includeCartDraw: merged.includeCartDraw });
		} else if (merged.includeIDE) {
			spec = editorModeSpec({ includePresentation: merged.includePresentation, includeCartDraw: merged.includeCartDraw });
		} else if (merged.includePresentation) {
			spec = presentationOnlySpec();
		} else {
			$.set_pipeline_override(null);
			return;
		}
		if (spec.length === 0) {
			$.set_pipeline_override(null);
			return;
		}
		// if ($.debug) {
		// 	console.log('[OverlayPipeline] rebuild', { merged });
		// }
		$.set_pipeline_override(spec);
	}
}

export const OverlayPipelineController = new OverlayPipelineControllerImpl();
