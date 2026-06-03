import { consoleCore } from '../../../core/console';

// Global toggle for WebGL error checking. Disabled in normal builds.
export const CATCH_WEBGL_ERROR = false;

export function checkWebGLError(infoText: string): number {
	if (!CATCH_WEBGL_ERROR) {
		return 0;
	}
	const gl = consoleCore.view.nativeCtx as WebGLRenderingContext;
	const error = gl.getError();
	if (error !== gl.NO_ERROR) {
		console.error(`WebGL error: ${webGLErrorName(gl, error)}: ${infoText}`);
	}
	return error;
}

function webGLErrorName(gl: WebGLRenderingContext, error: number): string {
	switch (error) {
		case gl.NO_ERROR: return 'NO_ERROR';
		case gl.INVALID_ENUM: return 'INVALID_ENUM';
		case gl.INVALID_VALUE: return 'INVALID_VALUE';
		case gl.INVALID_OPERATION: return 'INVALID_OPERATION';
		case gl.OUT_OF_MEMORY: return 'OUT_OF_MEMORY';
		case gl.CONTEXT_LOST_WEBGL: return 'CONTEXT_LOST_WEBGL';
		case gl.INVALID_FRAMEBUFFER_OPERATION: return 'INVALID_FRAMEBUFFER_OPERATION';
		default: return 'UNKNOWN_ERROR';
	}
}
