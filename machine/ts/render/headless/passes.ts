import type { RenderPassLibrary } from '../backend/pass/library';
import type { GxCharacterPlanePipelineState, GxGpuPipelineState } from '../backend/backend';
import type { GameView } from '../gameview';
import type { Host2DSubmission } from '../shared/submissions';
import type { HeadlessPresentHost, HeadlessPresentedFrameBuffer } from './view';
import type { HostMenuPipelineState } from '../backend/backend';
import { renderHeadlessHost2DEntry, renderHeadlessHost2DSubmission } from './host_2d';
import { renderGxGpuSoftwareFrame } from '../backend/software/gx_gpu';
import { applyHeadlessDeviceQuantize } from '../post/device_quantize/headless/pipeline';
import { DeviceQuantizeMode } from '../post/device_quantize/mode';
import { GxCharacterPlaneSoftwarePipeline, renderGxCharacterPlaneSoftware } from '../backend/software/gx_character_plane';
import {
	createGxCharacterPlanePipelineState,
	shouldRenderGxCharacterPlane,
	writeGxCharacterPlanePipelineState,
} from '../gx/character_plane_state';

export function registerHeadlessPasses(registry: RenderPassLibrary, characterPlanePipeline: GxCharacterPlaneSoftwarePipeline): void {
	registerFramePasses(registry);
	registerHeadlessGxGpuPass(registry);
	registerHeadlessGxCharacterPlanePass(registry, characterPlanePipeline);
	registerHeadlessDeviceQuantizePass(registry);
}

export function registerHeadlessPresentPass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'headless_present',
		name: 'HeadlessPresent',
		stateOnly: true,
		graph: { reads: ['frame_color'] },
		exec: () => {
			presentHeadlessFrame(registry.view as GameView);
		},
	});
}

function registerFramePasses(registry: RenderPassLibrary): void {
	registry.register({
		id: 'frame_resolve',
		name: 'HeadlessFrameResolve',
		stateOnly: true,
		graph: { skip: true },
		exec: () => {
			const view = registry.view as GameView;
			resizeHeadlessFrame(view.offscreenCanvasSize.x, view.offscreenCanvasSize.y);
		},
	});
}

let headlessCompositePixels = new Uint8Array(0);
let headlessFrameWidth = 0;
let headlessFrameHeight = 0;
const headlessPresentedFrameBuffer: HeadlessPresentedFrameBuffer = {
	pixels: headlessCompositePixels,
	width: 0,
	height: 0,
};

function resizeHeadlessFrame(width: number, height: number): void {
	const byteLength = width * height * 4;
	if (headlessCompositePixels.byteLength !== byteLength) {
		headlessCompositePixels = new Uint8Array(byteLength);
	}
	headlessFrameWidth = width;
	headlessFrameHeight = height;
}

function registerHeadlessGxGpuPass(registry: RenderPassLibrary): void {
	const state: GxGpuPipelineState = {
		width: 0,
		height: 0,
		commandBuffer: registry.view.gxGpuCommandBuffer,
		readbackPort: registry.view.gxGpuReadbackPort,
		statusWord: registry.view.gxGpuStatusWord,
		displayModeWord: registry.view.gxGpuDisplayModeWord,
		displayStartWord: registry.view.gxGpuDisplayStartWord,
		vramSnapshotBytes: registry.view.gxGpuVramSnapshotBytes,
		vramSnapshotSerial: registry.view.gxGpuVramSnapshotSerial,
	};
	registry.register<GxGpuPipelineState>({
		id: 'gx_gpu',
		name: 'HeadlessGXGPU',
		stateOnly: true,
		initialState: state,
		graph: {
			writes: ['frame_color'],
			writeState: (ctx, gxGpuState) => {
				const view = ctx.view;
				gxGpuState.width = view.offscreenCanvasSize.x;
				gxGpuState.height = view.offscreenCanvasSize.y;
				gxGpuState.commandBuffer = view.gxGpuCommandBuffer;
				gxGpuState.readbackPort = view.gxGpuReadbackPort;
				gxGpuState.statusWord = view.gxGpuStatusWord;
				gxGpuState.displayModeWord = view.gxGpuDisplayModeWord;
				gxGpuState.displayStartWord = view.gxGpuDisplayStartWord;
				gxGpuState.vramSnapshotBytes = view.gxGpuVramSnapshotBytes;
				gxGpuState.vramSnapshotSerial = view.gxGpuVramSnapshotSerial;
			},
		},
		exec: (_backend, _fbo, state) => {
			renderGxGpuSoftwareFrame(state, headlessCompositePixels);
		},
	});
}

function registerHeadlessGxCharacterPlanePass(registry: RenderPassLibrary, pipeline: GxCharacterPlaneSoftwarePipeline): void {
	registry.register<GxCharacterPlanePipelineState>({
		id: 'gx_character_plane',
		name: 'HeadlessGXCharacterPlane',
		stateOnly: true,
		initialState: createGxCharacterPlanePipelineState(registry.view as GameView),
		graph: {
			writes: ['frame_color'],
			writeState: writeGxCharacterPlanePipelineState,
		},
		shouldExecute: shouldRenderGxCharacterPlane,
		exec: (_backend, _fbo, state) => {
			renderGxCharacterPlaneSoftware(pipeline, state, headlessCompositePixels);
		},
	});
}

export function drawHeadlessHostMenuLayer(frame: HostMenuPipelineState): void {
	for (let index = 0; index < frame.commandCount; index += 1) {
		renderHeadlessHost2DEntry(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, frame.commandKinds[index], frame.commandRefs[index]);
	}
}

export function drawHeadlessHostOverlayFrame(commands: readonly Host2DSubmission[]): void {
	for (let index = 0; index < commands.length; index += 1) {
		renderHeadlessHost2DSubmission(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, commands[index]);
	}
}

function registerHeadlessDeviceQuantizePass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'device_quantize',
		name: 'HeadlessDeviceQuantize',
		stateOnly: true,
		graph: { reads: ['frame_color'], writes: ['device_color'] },
		shouldExecute: (view) => view.deviceQuantizeMode !== DeviceQuantizeMode.None,
		exec: () => {
			const view = registry.view as GameView;
			applyHeadlessDeviceQuantize(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, view.deviceQuantizeMode);
		},
	});
}

function presentHeadlessFrame(view: GameView): void {
	for (let offset = 3; offset < headlessCompositePixels.length; offset += 4) {
		headlessCompositePixels[offset] = 255;
	}
	const host = view.host as unknown as HeadlessPresentHost;
	headlessPresentedFrameBuffer.pixels = headlessCompositePixels;
	headlessPresentedFrameBuffer.width = headlessFrameWidth;
	headlessPresentedFrameBuffer.height = headlessFrameHeight;
	host.presentFrameBuffer(headlessPresentedFrameBuffer);
}
