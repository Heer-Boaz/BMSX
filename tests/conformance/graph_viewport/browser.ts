import { createWebGLBackend, createWebGPUBackend } from '../../../hosts/browser/backend';
import { BrowserVideoOutput } from '../../../hosts/browser/video_output';
import { Input } from '../../../hosts/common/input/manager';
import { HeadlessInputHub } from '../../../hosts/node/headless/input';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { Machine } from '../../../machine/ts/machine/machine';
import { Memory } from '../../../machine/ts/machine/memory/memory';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import type { GPUBackend } from '../../../machine/ts/render/backend/backend';
import { RenderPassLibrary } from '../../../machine/ts/render/backend/pass/library';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { Host2DKind, type Host2DRef } from '../../../machine/ts/render/host_overlay/commands';
import type { HostOverlayFrame } from '../../../machine/ts/render/host_overlay/overlay_queue';
import { Font } from '../../../machine/ts/render/shared/bmsx_font';
import { LAYER_2D_IDE } from '../../../machine/ts/render/shared/layers';
import { RectRenderKind } from '../../../machine/ts/render/shared/submissions';
import { VideoPresenter } from '../../../machine/ts/render/video_presenter';
import { OverlayRenderer } from '../../../ide/runtime/overlay_renderer';
import { api } from '../../../ide/runtime/overlay_api';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { computeEditorPointerButtonMask, POINTER_PRIMARY_JUST_PRESSED } from '../../../ide/input/pointer/buttons';
import { readEditorPointerSnapshot } from '../../../ide/input/pointer/frame';
import { inputFocus } from '../../../ide/input/focus';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { createWorkbenchGraphNode, createWorkbenchGraphEdge, createWorkbenchGraphModel, type WorkbenchGraphModel } from '../../../ide/workbench/ui/graph/model';
import { WorkbenchGraphViewport } from '../../../ide/workbench/ui/graph/viewport';
import { WorkbenchGraphPointerResult } from '../../../ide/workbench/ui/graph/control';
import { createGraphFixturePanes } from './pane';
import { hostOverlayPrimitives } from '../../helpers/host_overlay_primitives';
export { exerciseCompoundGraph } from './compound';

function check(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

const WIDTH = 384;
const HEIGHT = 288;
const full = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };
const clip = { left: 11, top: 9, right: 43, bottom: 34 };

export async function createFixture(canvas: HTMLCanvasElement, kind: 'software' | 'webgl2' | 'webgpu') {
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	let backend: GPUBackend;
	let publish = () => {};
	let healthy = () => {};
	switch (kind) {
		case 'software': {
			const software = new HeadlessGPUBackend(WIDTH, HEIGHT, PSX_MACHINE_SPEC.gxGpuVramBytes);
			backend = software;
			const context = canvas.getContext('2d')!;
			publish = () => context.putImageData(new ImageData(Uint8ClampedArray.from(software.borrowPresentedPixels()), canvas.width, canvas.height), 0, 0);
			break;
		}
		case 'webgl2': {
			const webgl = createWebGLBackend(canvas, PSX_MACHINE_SPEC.gxGpuVramBytes);
			backend = webgl;
			healthy = () => check(webgl.gl.getError() === webgl.gl.NO_ERROR, 'WebGL2 graphics error');
			break;
		}
		case 'webgpu': {
			const webgpu = await createWebGPUBackend(canvas, (await navigator.gpu.requestAdapter())!, PSX_MACHINE_SPEC.gxGpuVramBytes);
			backend = webgpu;
			const errors: string[] = [];
			webgpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
			healthy = () => check(errors.length === 0, errors.join('\n'));
			break;
		}
	}
	backend.resizePresentationTarget(WIDTH, HEIGHT);
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1);
	input.connectInputDevice({ id: 'pointer:0', kind: 'pointer' });
	const player = input.getPlayerInput(1);
	// A reset, non-executing machine supplies real GX output. No ROM packer or cart fixture.
	const machine = new Machine(new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes), input, PSX_MACHINE_SPEC);
	machine.resetDevices();
	const display = new BrowserVideoOutput(canvas, null);
	const presenter = new VideoPresenter(display, backend, WIDTH, HEIGHT);
	presenter.crt_postprocessing_enabled = false;
	presenter.default_font = new Font({ variant: 'tiny' });
	const passes = new RenderPassLibrary(backend, presenter);
	presenter.initialize(passes);
	presenter.initializeDefaultTextures();
	const renderer = new OverlayRenderer(presenter.hostOverlayQueue);
	const font = presenter.default_font;
	const first = createWorkbenchGraphNode(font, 'PARTIALLY VISIBLE\nLEFT AND TOP', -28, -7);
	const middle = createWorkbenchGraphNode(font, 'RETAINED NODE\nSHARED GEOMETRY', 130, 75);
	const last = createWorkbenchGraphNode(font, 'PARTIAL RIGHT\nAND BOTTOM', 326, 208);
	const edge = createWorkbenchGraphEdge([-35, 160, 355, 160, 355, 240]);
	const model = createWorkbenchGraphModel(font, [first, middle, last], [edge, createWorkbenchGraphEdge([50, -30, 310, 240])]);
	const view = new WorkbenchGraphViewport<WorkbenchGraphModel>(model);
	const second = new WorkbenchGraphViewport(model);
	view.layout(8, 24, 376, 240);
	second.layout(8, 24, 376, 240);
	editorViewState.viewportWidth = WIDTH;
	editorViewState.viewportHeight = HEIGHT;
	const { panes, pane, inputs } = createGraphFixturePanes([view, second]);
	panes.openEditor(inputs[0]);
	let pressId = 0;
	const draw = () => {
		renderer.beginFrame(presenter);
		api.beginFrame(renderer);
		api.fill_rect_color(0, 0, WIDTH, HEIGHT, 0, 0xff20252d);
		panes.activePane.draw();
		renderer.itemRun('GRAPH VIEWPORT / TINY FONT', 0, 26, 8, 8, 0, font, 0xffffffff, LAYER_2D_IDE);
		renderer.endFrame();
		presenter.present(machine.gxGpu.readDeviceOutput(), clock.now() / 1000, 0.02);
		publish();
		healthy();
	};
	const step = () => {
		clock.advance(20);
		input.pollInput();
		const mask = computeEditorPointerButtonMask(player);
		const snapshot = readEditorPointerSnapshot(display, player);
		if (!pointerCapture.dispatch(snapshot, false)) panes.activePane.handlePointer(snapshot, (mask & POINTER_PRIMARY_JUST_PRESSED) !== 0, false, player, clock.now(), false);
		inputFocus.handleKeyboard(player);
		draw();
	};
	const move = (x: number, y: number) => {
		const rect = display.measureDisplay();
		input.inputAxis2('pointer:0', 'pointer_position', rect.left + x * rect.width / WIDTH, rect.top + y * rect.height / HEIGHT, clock.now());
	};
	const button = (down: boolean) => input.inputButton('pointer:0', 'pointer_primary', down, down ? 1 : 0, clock.now(), ++pressId);
	const exercise = () => {
		move(150, 110); step(); button(true); step();
		check(view.selection === middle, 'physical click selects retained node');
		button(false); step(); button(true); step();
		check(pane.result === WorkbenchGraphPointerResult.Activate, 'second physical click activates the same retained node');
		button(false); step(); move(70, 184); step(); button(true); step();
		check(view.selection === edge, 'physical click selects the visible route');
		button(false); step(); move(80, 225); step(); button(true); step(); move(100, 230); step();
		check(view.scrollX === -20 && view.scrollY === -5, 'blank canvas drag pans');
		panes.openEditor(inputs[1]); move(120, 230); step();
		check(second.scrollX === 0 && second.scrollY === 0 && second.selection === null, 'switching input while held does not begin a new gesture');
		panes.openEditor(inputs[0]); move(140, 230); step();
		check(view.scrollX === -20 && view.scrollY === -5, 'returning to input retains viewport, not its old capture');
		button(false); step();
		view.setModel({ ...model }, null);
		view.scrollX = view.scrollY = 0;
		move(150, 110); step(); button(true); step(); button(false); step();
		const held = model.nodes;
		input.inputButton('keyboard:0', 'ArrowRight', true, 1, clock.now(), ++pressId); step();
		input.inputButton('keyboard:0', 'ArrowRight', false, 0, clock.now(), ++pressId); step();
		check(view.scrollX === 16 && view.model.nodes === held, 'focus-local keyboard pans without laying out again');
		view.scrollX = view.scrollY = 0;
		for (let index = 0; index < 30; index += 1) step();
		check(view.model.nodes === held, 'idle frames retain geometry');
		return { nodes: model.nodes.length, edges: model.edges.length, width: WIDTH, height: HEIGHT };
	};
	const background = { kind: RectRenderKind.Fill, area: { ...full, z: 0 }, color: 0xff000000, layer: LAYER_2D_IDE };
	const kinds = [Host2DKind.Rect, Host2DKind.Clip, Host2DKind.Rect];
	const refs: Host2DRef[] = [background, full, background];
	const frame: HostOverlayFrame = { logicalWidth: WIDTH, logicalHeight: HEIGHT,
		commandKinds: kinds, commandRefs: refs, commandCount: 3 };
	return {
		exercise, draw,
		view, font, move, button, step,
		healthy,
		resize(width: number, height: number) {
			// Retain the editor's logical layout choice while the game target changes.
			renderer.setViewportSize({ width: WIDTH, height: HEIGHT });
			canvas.width = width;
			canvas.height = height;
			presenter.setRenderTargetSize(width, height);
			renderer.beginFrame(presenter);
			renderer.fillRect(0, 0, width, height, 0, 0xff000000, LAYER_2D_IDE);
			renderer.pushClipRect(width / 4, height / 4, width * 3 / 4, height * 3 / 4);
			renderer.fillRect(0, 0, width, height, 0, 0xffffffff, LAYER_2D_IDE);
			renderer.popClipRect();
			renderer.endFrame();
			presenter.present(machine.gxGpu.readDeviceOutput(), 0, 0.02);
			publish();
			const state = passes.getState('host_overlay');
			check(state.width === width && state.height === height, 'the presenter, not an editor viewport override, owns target dimensions');
			check(state.overlayWidth === width && state.overlayHeight === height, 'commands retain the frame logical space');
		},
		primitives: hostOverlayPrimitives.map(([name]) => name),
		clip,
		renderPrimitive(index: number, clipped: boolean) {
			const [, kind, command] = hostOverlayPrimitives[index];
			kinds[2] = kind;
			refs[1] = clipped ? clip : full;
			refs[2] = command;
			presenter.hostOverlayQueue.publishOverlayFrame(frame);
			presenter.present(machine.gxGpu.readDeviceOutput(), 0, 0.02);
			publish();
			healthy();
		},
	};
}
