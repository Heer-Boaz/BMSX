import { OverlayPipelineController } from '../core/pipelines/overlay_controller';

class DebuggerOverlayManager {
	private depth = 0;

	public push(): void {
		if (this.depth === 0) {
			OverlayPipelineController.setRequest('debugger', { includePresentation: true });
		}
		this.depth++;
	}

	public pop(): void {
		if (this.depth === 0) {
			return;
		}
		this.depth--;
		if (this.depth === 0) {
			OverlayPipelineController.setRequest('debugger', null);
		}
	}
}

export const debuggerOverlayManager = new DebuggerOverlayManager();
