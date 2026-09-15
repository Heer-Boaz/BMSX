import type { RenderPassLibrary } from '../../backend/pass/library';
import { createHostMenuState, createHostOverlayState, writeHostMenuState, writeHostOverlayState } from '../pipeline';
import { drawHeadlessHostMenuLayer, drawHeadlessHostOverlayFrame } from '../../headless/passes';
import type { HeadlessGPUBackend } from '../../headless/backend';

export function registerHostOverlayPass_Headless(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_overlay',
		name: 'HeadlessHostOverlay',
		present: true,
		initialState: createHostOverlayState(),
		graph: { writeState: writeHostOverlayState },
		shouldExecute: presenter => presenter.hostOverlayQueue.hasPendingOverlayFrame(),
		exec: (backend, _fbo, state) => {
			drawHeadlessHostOverlayFrame(backend as HeadlessGPUBackend, state);
		},
	});
}

export function registerHostMenuPass_Headless(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_menu',
		name: 'HeadlessHostMenu',
		present: true,
		initialState: createHostMenuState(),
		graph: { writeState: writeHostMenuState },
		shouldExecute: presenter => presenter.hostOverlayQueue.hasPendingHostMenuFrame(),
		exec: (backend, _fbo, state) => {
			drawHeadlessHostMenuLayer(backend as HeadlessGPUBackend, state);
		},
	});
}
