import type { RenderPassLibrary } from '../../backend/pass/library';
import { hostOverlayMenu } from '../../../core/host_overlay_menu';
import { consumeOverlayFrame, hasPendingOverlayFrame } from '../overlay_queue';
import { drawHeadlessHostMenuLayer, drawHeadlessHostOverlayFrame } from '../../headless/passes';

export function registerHostOverlayPass_Headless(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_overlay',
		name: 'HeadlessHostOverlay',
		stateOnly: true,
		graph: { writes: ['frame_color'] },
		shouldExecute: () => hasPendingOverlayFrame(),
		exec: () => {
			drawHeadlessHostOverlayFrame(consumeOverlayFrame().commands);
		},
	});
}

export function registerHostMenuPass_Headless(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_menu',
		name: 'HeadlessHostMenu',
		stateOnly: true,
		graph: { writes: ['frame_color'] },
		shouldExecute: () => hostOverlayMenu.queuedCommandCount() !== 0,
		exec: () => {
			drawHeadlessHostMenuLayer();
		},
	});
}
