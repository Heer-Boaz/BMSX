import { $ } from '../game';
import type { NodeSpec } from '../../ecs/pipeline';
import { buildConsoleOverlaySpec, type ConsoleOverlaySpecOptions } from './console_editor';

type OverlayRequest = ConsoleOverlaySpecOptions & { includePresentation?: boolean };

class OverlayPipelineControllerImpl {
	private readonly requests = new Map<string, OverlayRequest>();

	public setRequest(id: string, request: OverlayRequest | null): void {
		if (!request) {
			this.requests.delete(id);
		} else {
			this.requests.set(id, { ...request });
		}
		if ($.debug) {
			console.log('[OverlayPipeline] setRequest', {
				id,
				includeConsole: request?.includeConsole ?? false,
				includeEditor: request?.includeEditor ?? false,
				includePresentation: request?.includePresentation ?? false,
			});
		}
		this.rebuild();
	}

	private rebuild(): void {
		if (this.requests.size === 0) {
			$.set_pipeline_override(null);
			return;
		}
		const merged: OverlayRequest = { includeConsole: false, includeEditor: false, includePresentation: false };
		for (const request of this.requests.values()) {
			if (request.includeConsole) merged.includeConsole = true;
			if (request.includeEditor) merged.includeEditor = true;
			if (request.includePresentation) merged.includePresentation = true;
		}
		const spec: NodeSpec[] = buildConsoleOverlaySpec(merged);
		if (spec.length === 0) {
			$.set_pipeline_override(null);
			return;
		}
		if ($.debug) {
			console.log('[OverlayPipeline] rebuild', { merged });
		}
		$.set_pipeline_override(spec);
	}
}

export const OverlayPipelineController = new OverlayPipelineControllerImpl();
