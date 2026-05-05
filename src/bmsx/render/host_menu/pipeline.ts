import type { RenderPassLibrary } from '../backend/pass/library';
import type { HostMenuPipelineState } from '../backend/interfaces';
import { WebGLBackend } from '../backend/webgl/backend';
import { consoleCore } from '../../core/console';
import { beginHostMenuQueue, hostMenuQueueKind, hostMenuQueueRef } from './queue';
import {
	beginHost2DEntries_WebGL,
	createHostOverlayRuntime_WebGL,
	drawHost2DCommand_WebGL,
	endHost2DEntries_WebGL,
	type Host2DBoundTextureState,
	type HostOverlayRuntime,
} from '../host_overlay/pipeline';
import { drawHeadlessHostMenuLayer } from '../headless/passes';
import vertexShaderCode from '../2d/shaders/2d.vert.glsl';
import fragmentShaderCode from '../host_overlay/shaders/host_overlay.frag.glsl';

let runtime: HostOverlayRuntime | null = null;

export function registerHostMenuPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_menu',
		name: 'HostMenu',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
		present: true,
		bootstrap: (backend) => {
			runtime = createHostOverlayRuntime_WebGL(backend as WebGLBackend);
		},
		shouldExecute: () => beginHostMenuQueue() !== 0,
		prepare: () => {
			const state: HostMenuPipelineState = {
				width: consoleCore.view.offscreenCanvasSize.x,
				height: consoleCore.view.offscreenCanvasSize.y,
				overlayWidth: consoleCore.view.viewportSize.x,
				overlayHeight: consoleCore.view.viewportSize.y,
				time: consoleCore.platform.clock.now() / 1000,
				delta: consoleCore.deltatime_seconds,
			};
			registry.setState('host_menu', state);
		},
		exec: (backend: WebGLBackend, _fbo, state: HostMenuPipelineState) => {
			let boundTextures: Host2DBoundTextureState = beginHost2DEntries_WebGL(backend, runtime!, state);
			const count = beginHostMenuQueue();
			for (let index = 0; index < count; index += 1) {
				boundTextures = drawHost2DCommand_WebGL(backend, runtime!, hostMenuQueueKind(index), hostMenuQueueRef(index), boundTextures);
			}
			endHost2DEntries_WebGL(backend);
		},
	});
}

export function registerHostMenuPass_WebGPU(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_menu',
		name: 'HostMenu',
		stateOnly: true,
		graph: { skip: true },
		shouldExecute: () => false,
		exec: () => { },
	});
}

export function registerHostMenuPass_Headless(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_menu',
		name: 'HeadlessHostMenu',
		stateOnly: true,
		graph: { writes: ['frame_color'] },
		shouldExecute: () => beginHostMenuQueue() !== 0,
		exec: () => {
			drawHeadlessHostMenuLayer();
		},
	});
}
