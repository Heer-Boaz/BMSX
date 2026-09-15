import type { HeadlessRenderTargetHandle, PresentPipelineState } from '../../../backend/backend';
import type { RenderPassLibrary } from '../../../backend/pass/library';
import type { HeadlessGPUBackend } from '../../../headless/backend';
import {
	createPresentPassState,
	shouldUpdatePresentationHistoryA,
	shouldUpdatePresentationHistoryB,
	writePresentationHistoryPassState,
	writePresentPassState,
} from '../state';

/** Same offscreen/history/present ownership as the native software renderer. */
export function registerPresentationPasses(registry: RenderPassLibrary): void {
	const renderHistory = (backend: HeadlessGPUBackend, fbo: HeadlessRenderTargetHandle, state: PresentPipelineState): void => {
		backend.activateRenderTarget(fbo);
		backend.presentTexture(state.colorTex);
	};
	registry.register({
		id: 'presentation_history_a',
		name: 'PresentationHistoryA',
		initialState: createPresentPassState(),
		graph: { reads: ['frame_color', 'device_color'], writes: ['frame_history_a'], writeState: writePresentationHistoryPassState },
		shouldExecute: shouldUpdatePresentationHistoryA,
		exec: renderHistory,
	});
	registry.register({
		id: 'presentation_history_b',
		name: 'PresentationHistoryB',
		initialState: createPresentPassState(),
		graph: { reads: ['frame_color', 'device_color'], writes: ['frame_history_b'], writeState: writePresentationHistoryPassState },
		shouldExecute: shouldUpdatePresentationHistoryB,
		exec: renderHistory,
	});
	registry.register({
		id: 'present',
		name: 'HeadlessPresentTexture',
		present: true,
		initialState: createPresentPassState(),
		graph: { writeState: writePresentPassState },
		exec: (backend, _fbo, state) => {
			const headless = backend as HeadlessGPUBackend;
			headless.activateDefaultRenderTarget();
			headless.presentTexture(state.colorTex);
		},
	});
}
