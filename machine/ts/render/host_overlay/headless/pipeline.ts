import type { RenderPassLibrary } from '../../backend/pass/library';
import { hasPendingHostMenuFrame, hasPendingOverlayFrame } from '../overlay_queue';
import { createHostMenuState, createHostOverlayState, writeHostMenuState, writeHostOverlayState } from '../pipeline';
import { drawHeadlessHostMenuLayer, drawHeadlessHostOverlayFrame } from '../../headless/passes';

export function registerHostOverlayPass_Headless(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_overlay',
		name: 'HeadlessHostOverlay',
		stateOnly: true,
		initialState: createHostOverlayState(),
		graph: { writes: ['frame_color'], writeState: writeHostOverlayState },
		shouldExecute: () => hasPendingOverlayFrame(),
		exec: (_backend, _fbo, state) => {
			drawHeadlessHostOverlayFrame(state.commands);
		},
	});
}

export function registerHostMenuPass_Headless(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_menu',
		name: 'HeadlessHostMenu',
		stateOnly: true,
		initialState: createHostMenuState(),
		graph: { writes: ['frame_color'], writeState: writeHostMenuState },
		shouldExecute: () => hasPendingHostMenuFrame(),
		exec: (_backend, _fbo, state) => {
			drawHeadlessHostMenuLayer(state);
		},
	});
}
