import { $ } from '../game';
import type { NodeSpec } from '../../ecs/pipeline';
import {
	consoleModeSpec,
	consoleEditorSpec,
	editorModeSpec,
	presentationOnlySpec,
	type ConsoleOverlaySpecOptions,
} from './console_editor';

type OverlayRequest = ConsoleOverlaySpecOptions;

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
		const merged: OverlayRequest = {
			includeConsole: false,
			includeEditor: false,
			includePresentation: false,
		};
		for (const request of this.requests.values()) {
			if (request.includeConsole) merged.includeConsole = true;
			if (request.includeEditor) merged.includeEditor = true;
			if (request.includePresentation) merged.includePresentation = true;
			if (request.includeConsoleDraw === false) merged.includeConsoleDraw = false;
		}
		const presentationEnabled = merged.includePresentation !== false;
		$.view.setPresentationPassesEnabled(presentationEnabled);
		let spec: NodeSpec[] = [];
		if (merged.includeConsole && merged.includeEditor) {
			spec = consoleEditorSpec({ includePresentation: merged.includePresentation, includeConsoleDraw: merged.includeConsoleDraw });
		} else if (merged.includeConsole) {
			spec = consoleModeSpec({ includePresentation: merged.includePresentation, includeConsoleDraw: merged.includeConsoleDraw });
		} else if (merged.includeEditor) {
			spec = editorModeSpec({ includePresentation: merged.includePresentation, includeConsoleDraw: merged.includeConsoleDraw });
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
		if ($.debug) {
			console.log('[OverlayPipeline] rebuild', { merged });
		}
		$.set_pipeline_override(spec);
	}
}

export const OverlayPipelineController = new OverlayPipelineControllerImpl();
