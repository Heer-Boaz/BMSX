import type { RenderPassLibrary } from '../backend/pass/library';
import type { HostMenuPipelineState } from '../backend/interfaces';
import { WebGLBackend } from '../backend/webgl/backend';
import { consoleCore } from '../../core/console';
import { beginHostMenuQueue, forEachHostMenuQueue } from './queue';
import {
	createHostOverlayRuntime_WebGL,
	renderHost2DEntries_WebGL,
	type HostOverlayRuntime,
} from '../editor/host_overlay_pipeline';
import vertexShaderCode from '../2d/shaders/2d.vert.glsl';
import fragmentShaderCode from '../editor/shaders/host_overlay.frag.glsl';

let runtime: HostOverlayRuntime | null = null;

export function registerHostMenuPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_menu',
		name: 'HostMenu',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
		present: true,
		graph: { skip: true },
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
			renderHost2DEntries_WebGL(backend, runtime!, state, forEachHostMenuQueue);
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
		graph: { skip: true },
		shouldExecute: () => false,
		exec: () => { },
	});
}
