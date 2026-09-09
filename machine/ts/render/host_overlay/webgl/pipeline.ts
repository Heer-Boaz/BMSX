import type { RenderPassLibrary } from '../../backend/pass/library';
import type {
	Host2DPipelineState,
	HostMenuPipelineState,
	HostOverlayPipelineState,
	PassEncoder,
	RenderPassDesc,
	RenderPassStateRegistry,
} from '../../backend/backend';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms, type FrameUniformState } from '../../backend/frame_uniforms';
import { RGBA8_SRGB_TEXTURE_PARAMS } from '../../backend/texture_params';
import type { WebGLBackend } from '../../backend/webgl/backend';
import {
	HOST_OVERLAY_INSTANCE_FLOAT_BYTES,
	HOST_OVERLAY_INSTANCE_FLOATS,
	HostOverlayQuadStream,
} from '../quad_stream';
import { createHostMenuState, createHostOverlayState, writeHostMenuState, writeHostOverlayState } from '../pipeline';
import { HOST_SYSTEM_ATLAS } from '../atlas';
import { HostOverlayClipState } from '../clip';
import vertexShaderCode from './shaders/host_overlay.vert.glsl';
import fragmentShaderCode from './shaders/host_overlay.frag.glsl';

type HostOverlayRuntime = {
	gl: WebGL2RenderingContext;
	program: WebGLProgram;
	vao: WebGLVertexArrayObject;
	cornerBuffer: WebGLBuffer;
	instanceFloatBuffer: WebGLBuffer;
	instanceTextureKindBuffer: WebGLBuffer;
	hostAtlasTexture: WebGLTexture;
	stream: HostOverlayQuadStream;
	instanceCapacity: number;
	frameUniforms: FrameUniformState<WebGLBuffer>;
	clip: HostOverlayClipState;
	floatAttributeLocations: number[];
	textureKindLocation: number;
	instanceStart: number;
};

const HOST_OVERLAY_TEXTURE_UNIT = 0;
const HOST_OVERLAY_DRAW_PASS: PassEncoder = { fbo: null, desc: { label: 'host_overlay' } as RenderPassDesc };
const UNIT_QUAD_CORNERS = new Float32Array([
	0, 0,
	0, 1,
	1, 0,
	1, 0,
	0, 1,
	1, 1,
]);

const INSTANCE_ATTRIBUTES = [
	{ name: 'i_origin', size: 2, offset: 0 },
	{ name: 'i_axis_x', size: 2, offset: 2 * Float32Array.BYTES_PER_ELEMENT },
	{ name: 'i_axis_y', size: 2, offset: 4 * Float32Array.BYTES_PER_ELEMENT },
	{ name: 'i_uv0', size: 2, offset: 6 * Float32Array.BYTES_PER_ELEMENT },
	{ name: 'i_uv1', size: 2, offset: 8 * Float32Array.BYTES_PER_ELEMENT },
	{ name: 'i_color', size: 4, offset: 10 * Float32Array.BYTES_PER_ELEMENT },
];

// WebGL2 has no base-instance draw. The pass owns its VAO's instance origins.
function bindInstanceStart(backend: WebGLBackend, state: HostOverlayRuntime, start: number): void {
	if (state.instanceStart === start) return;
	const gl = state.gl;
	backend.bindArrayBuffer(state.instanceFloatBuffer);
	for (let index = 0; index < INSTANCE_ATTRIBUTES.length; index += 1) {
		const attribute = INSTANCE_ATTRIBUTES[index];
		gl.vertexAttribPointer(state.floatAttributeLocations[index], attribute.size, gl.FLOAT, false,
			HOST_OVERLAY_INSTANCE_FLOAT_BYTES, start * HOST_OVERLAY_INSTANCE_FLOAT_BYTES + attribute.offset);
	}
	backend.bindArrayBuffer(state.instanceTextureKindBuffer);
	gl.vertexAttribIPointer(state.textureKindLocation, 1, gl.UNSIGNED_INT, Uint32Array.BYTES_PER_ELEMENT,
		start * Uint32Array.BYTES_PER_ELEMENT);
	state.instanceStart = start;
}

function createRuntime(backend: WebGLBackend, program: WebGLProgram, frameUniforms: FrameUniformState<WebGLBuffer>): HostOverlayRuntime {
	const gl = backend.gl as WebGL2RenderingContext;
	const stream = new HostOverlayQuadStream();
	const vao = backend.createVertexArray() as WebGLVertexArrayObject;
	const cornerBuffer = backend.createVertexBuffer(UNIT_QUAD_CORNERS, 'static') as WebGLBuffer;
	const instanceFloatBuffer = backend.createVertexBuffer(stream.floatData, 'dynamic') as WebGLBuffer;
	const instanceTextureKindBuffer = backend.createVertexBuffer(stream.textureKinds, 'dynamic') as WebGLBuffer;
	const hostAtlasTexture = backend.createTexture(HOST_SYSTEM_ATLAS.pixels, HOST_SYSTEM_ATLAS.width, HOST_SYSTEM_ATLAS.height, RGBA8_SRGB_TEXTURE_PARAMS) as WebGLTexture;

	backend.bindVertexArray(vao);
	backend.bindArrayBuffer(cornerBuffer);
	const cornerLocation = gl.getAttribLocation(program, 'a_corner');
	gl.enableVertexAttribArray(cornerLocation);
	gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);
	backend.bindArrayBuffer(instanceFloatBuffer);
	const floatAttributeLocations: number[] = [];
	for (const attribute of INSTANCE_ATTRIBUTES) {
		const location = gl.getAttribLocation(program, attribute.name);
		floatAttributeLocations.push(location);
		gl.enableVertexAttribArray(location);
		gl.vertexAttribPointer(location, attribute.size, gl.FLOAT, false, HOST_OVERLAY_INSTANCE_FLOAT_BYTES, attribute.offset);
		gl.vertexAttribDivisor(location, 1);
	}
	backend.bindArrayBuffer(instanceTextureKindBuffer);
	const textureKindLocation = gl.getAttribLocation(program, 'i_texture_kind');
	gl.enableVertexAttribArray(textureKindLocation);
	gl.vertexAttribIPointer(textureKindLocation, 1, gl.UNSIGNED_INT, Uint32Array.BYTES_PER_ELEMENT, 0);
	gl.vertexAttribDivisor(textureKindLocation, 1);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(null);
	backend.useProgram(program);
	gl.uniform1i(gl.getUniformLocation(program, 'u_texture0'), HOST_OVERLAY_TEXTURE_UNIT);

	return {
		gl,
		program,
		vao,
		cornerBuffer,
		instanceFloatBuffer,
		instanceTextureKindBuffer,
		hostAtlasTexture,
		stream,
		instanceCapacity: stream.capacity,
		frameUniforms,
		clip: new HostOverlayClipState(),
		floatAttributeLocations,
		textureKindLocation,
		instanceStart: 0,
	};
}

function destroyRuntime(backend: WebGLBackend, runtimeToDestroy: HostOverlayRuntime): void {
	backend.destroyBuffer(runtimeToDestroy.cornerBuffer);
	backend.destroyBuffer(runtimeToDestroy.instanceFloatBuffer);
	backend.destroyBuffer(runtimeToDestroy.instanceTextureKindBuffer);
	backend.deleteVertexArray(runtimeToDestroy.vao);
	backend.destroyTexture(runtimeToDestroy.hostAtlasTexture);
}

function bindPassState(backend: WebGLBackend, state: HostOverlayRuntime, passState: Host2DPipelineState): void {
	const gl = backend.gl as WebGL2RenderingContext;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	backend.useProgram(state.program);
	updateAndBindFrameUniforms(state.frameUniforms, backend, passState.width, passState.height, passState.overlayWidth, passState.overlayHeight, passState.time, passState.delta);
	backend.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
	backend.setViewportRect(0, 0, passState.width, passState.height);
	backend.setAlphaBlended2DState(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	backend.setActiveTexture(HOST_OVERLAY_TEXTURE_UNIT);
	backend.bindTexture2D(state.hostAtlasTexture);
	backend.bindVertexArray(state.vao);
}

function renderStream(backend: WebGLBackend, state: HostOverlayRuntime, passState: Host2DPipelineState): void {
	const stream = state.stream;
	const count = stream.count;
	if (count === 0) {
		return;
	}
	bindPassState(backend, state, passState);
	if (state.instanceCapacity !== stream.capacity) {
		backend.updateVertexBuffer(state.instanceFloatBuffer, stream.floatData);
		backend.updateVertexBuffer(state.instanceTextureKindBuffer, stream.textureKinds);
		state.instanceCapacity = stream.capacity;
	} else {
		backend.updateVertexBuffer(state.instanceFloatBuffer, stream.floatData, 0, 0, count * HOST_OVERLAY_INSTANCE_FLOATS);
		backend.updateVertexBuffer(state.instanceTextureKindBuffer, stream.textureKinds, 0, 0, count);
	}
	const gl = state.gl;
	const clip = state.clip;
	clip.reset(passState.overlayWidth, passState.overlayHeight, passState.width, passState.height);
	gl.enable(gl.SCISSOR_TEST);
	for (let index = 0; index < stream.batchCount; index += 1) {
		const batch = stream.batches[index];
		const end = index + 1 < stream.batchCount ? stream.batches[index + 1].start : count;
		clip.set(batch.clip);
		if (end === batch.start || clip.left === clip.right || clip.top === clip.bottom) continue;
		gl.scissor(clip.left, passState.height - clip.bottom, clip.right - clip.left, clip.bottom - clip.top);
		bindInstanceStart(backend, state, batch.start);
		backend.drawInstanced(HOST_OVERLAY_DRAW_PASS, 6, end - batch.start, 0, 0);
	}
	gl.disable(gl.SCISSOR_TEST);
	backend.bindVertexArray(null);
	backend.setBlendEnabled(false);
	backend.setDepthMask(true);
}

function renderOverlay(backend: WebGLBackend, state: HostOverlayRuntime, passState: HostOverlayPipelineState): void {
	const stream = state.stream;
	stream.reset(passState.overlayWidth, passState.overlayHeight);
	for (let index = 0; index < passState.commandCount; index += 1) {
		stream.appendEntry(passState.commandKinds[index], passState.commandRefs[index]);
	}
	renderStream(backend, state, passState);
}

function renderHostMenu(backend: WebGLBackend, state: HostOverlayRuntime, passState: HostMenuPipelineState): void {
	const stream = state.stream;
	stream.reset(passState.overlayWidth, passState.overlayHeight);
	for (let index = 0; index < passState.commandCount; index += 1) {
		stream.appendEntry(passState.commandKinds[index], passState.commandRefs[index]);
	}
	renderStream(backend, state, passState);
}

export function registerHostOverlayPassesWebGL(registry: RenderPassLibrary, frameUniforms: FrameUniformState<WebGLBuffer>): void {
	let runtime: HostOverlayRuntime;
	registry.register({
		id: 'host_overlay',
		name: 'HostOverlay',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
		present: true,
		initialState: createHostOverlayState(),
		graph: { writeState: writeHostOverlayState },
		bootstrap: (backend) => {
			const webgl = backend as WebGLBackend;
			runtime = createRuntime(webgl, webgl.gl.getParameter(webgl.gl.CURRENT_PROGRAM) as WebGLProgram, frameUniforms);
		},
		teardown: (backend) => {
			destroyRuntime(backend as WebGLBackend, runtime);
		},
		shouldExecute: presenter => presenter.hostOverlayQueue.hasPendingOverlayFrame(),
		exec: (backend: WebGLBackend, _fbo, state: RenderPassStateRegistry['host_overlay']) => {
			renderOverlay(backend, runtime, state);
		},
	});
	registry.register({
		id: 'host_menu',
		name: 'HostMenu',
		sharedPipelineWith: 'host_overlay',
		present: true,
		initialState: createHostMenuState(),
		graph: { writeState: writeHostMenuState },
		shouldExecute: presenter => presenter.hostOverlayQueue.hasPendingHostMenuFrame(),
		exec: (backend: WebGLBackend, _fbo, state: RenderPassStateRegistry['host_menu']) => {
			renderHostMenu(backend, runtime, state);
		},
	});
}
