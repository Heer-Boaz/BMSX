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
		this.rebuild();
	}
	public clearAllRequests(): void {
		if (this.requests.size === 0) return;
		this.requests.clear();
		this.rebuild();
	}

	private rebuild(): void {
		if (this.requests.size === 0) {
			$.setPipelineOverride(null);
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
			$.setPipelineOverride(null);
			return;
		}
		$.setPipelineOverride(spec);
	}
}

export const OverlayPipelineController = new OverlayPipelineControllerImpl();
