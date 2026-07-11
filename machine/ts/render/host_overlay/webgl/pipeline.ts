import type { RenderPassLibrary } from '../../backend/pass/library';
import type {
	Host2DPipelineState,
	HostMenuPipelineState,
	HostOverlayPipelineState,
	PassEncoder,
	RenderPassDesc,
	RenderPassStateRegistry,
} from '../../backend/backend';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from '../../backend/frame_uniforms';
import { RGBA8_SRGB_TEXTURE_PARAMS } from '../../backend/texture_params';
import type { WebGLBackend } from '../../backend/webgl/backend';
import {
	HOST_OVERLAY_INSTANCE_FLOAT_BYTES,
	HOST_OVERLAY_INSTANCE_FLOATS,
	HostOverlayQuadStream,
} from '../quad_stream';
import { hasPendingHostMenuFrame, hasPendingOverlayFrame } from '../overlay_queue';
import { createHostMenuState, createHostOverlayState, writeHostMenuState, writeHostOverlayState } from '../pipeline';
import {
	HOST_SYSTEM_ATLAS_HEIGHT,
	HOST_SYSTEM_ATLAS_WIDTH,
	hostSystemAtlasPixels,
} from '../../../rompack/host_system_atlas';
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

let runtime: HostOverlayRuntime | null = null;

function bindFloatAttribute(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, size: number, offset: number): void {
	const location = gl.getAttribLocation(program, name);
	gl.enableVertexAttribArray(location);
	gl.vertexAttribPointer(location, size, gl.FLOAT, false, HOST_OVERLAY_INSTANCE_FLOAT_BYTES, offset);
	gl.vertexAttribDivisor(location, 1);
}

function createRuntime(backend: WebGLBackend, program: WebGLProgram): HostOverlayRuntime {
	const gl = backend.gl as WebGL2RenderingContext;
	const stream = new HostOverlayQuadStream();
	const vao = backend.createVertexArray() as WebGLVertexArrayObject;
	const cornerBuffer = backend.createVertexBuffer(UNIT_QUAD_CORNERS, 'static') as WebGLBuffer;
	const instanceFloatBuffer = backend.createVertexBuffer(stream.floatData, 'dynamic') as WebGLBuffer;
	const instanceTextureKindBuffer = backend.createVertexBuffer(stream.textureKinds, 'dynamic') as WebGLBuffer;
	const hostAtlasTexture = backend.createTexture(hostSystemAtlasPixels(), HOST_SYSTEM_ATLAS_WIDTH, HOST_SYSTEM_ATLAS_HEIGHT, RGBA8_SRGB_TEXTURE_PARAMS) as WebGLTexture;

	backend.bindVertexArray(vao);
	backend.bindArrayBuffer(cornerBuffer);
	const cornerLocation = gl.getAttribLocation(program, 'a_corner');
	gl.enableVertexAttribArray(cornerLocation);
	gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);
	backend.bindArrayBuffer(instanceFloatBuffer);
	bindFloatAttribute(gl, program, 'i_origin', 2, 0);
	bindFloatAttribute(gl, program, 'i_axis_x', 2, 2 * Float32Array.BYTES_PER_ELEMENT);
	bindFloatAttribute(gl, program, 'i_axis_y', 2, 4 * Float32Array.BYTES_PER_ELEMENT);
	bindFloatAttribute(gl, program, 'i_uv0', 2, 6 * Float32Array.BYTES_PER_ELEMENT);
	bindFloatAttribute(gl, program, 'i_uv1', 2, 8 * Float32Array.BYTES_PER_ELEMENT);
	bindFloatAttribute(gl, program, 'i_color', 4, 10 * Float32Array.BYTES_PER_ELEMENT);
	backend.bindArrayBuffer(instanceTextureKindBuffer);
	const textureKindLocation = gl.getAttribLocation(program, 'i_texture_kind');
	gl.enableVertexAttribArray(textureKindLocation);
	gl.vertexAttribIPointer(textureKindLocation, 1, gl.UNSIGNED_INT, Uint32Array.BYTES_PER_ELEMENT, 0);
	gl.vertexAttribDivisor(textureKindLocation, 1);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(null);
	gl.useProgram(program);
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
	};
}

function destroyRuntime(runtimeToDestroy: HostOverlayRuntime): void {
	const gl = runtimeToDestroy.gl;
	gl.deleteBuffer(runtimeToDestroy.cornerBuffer);
	gl.deleteBuffer(runtimeToDestroy.instanceFloatBuffer);
	gl.deleteBuffer(runtimeToDestroy.instanceTextureKindBuffer);
	gl.deleteVertexArray(runtimeToDestroy.vao);
	gl.deleteTexture(runtimeToDestroy.hostAtlasTexture);
}

function bootstrapRuntime(backend: WebGLBackend): void {
	const gl = backend.gl as WebGL2RenderingContext;
	if (runtime !== null) {
		destroyRuntime(runtime);
	}
	runtime = createRuntime(backend, gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram);
}

function bindPassState(backend: WebGLBackend, state: HostOverlayRuntime, passState: Host2DPipelineState): void {
	const gl = backend.gl as WebGL2RenderingContext;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.useProgram(state.program);
	updateAndBindFrameUniforms(backend, passState.width, passState.height, passState.overlayWidth, passState.overlayHeight, passState.time, passState.delta);
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
	backend.drawInstanced(HOST_OVERLAY_DRAW_PASS, 6, count, 0, 0);
	backend.bindVertexArray(null);
	backend.setBlendEnabled(false);
	backend.setDepthMask(true);
}

function renderOverlay(backend: WebGLBackend, state: HostOverlayRuntime, passState: HostOverlayPipelineState): void {
	const stream = state.stream;
	stream.reset();
	for (let index = 0; index < passState.commands.length; index += 1) {
		stream.appendSubmission(passState.commands[index]);
	}
	renderStream(backend, state, passState);
}

function renderHostMenu(backend: WebGLBackend, state: HostOverlayRuntime, passState: HostMenuPipelineState): void {
	const stream = state.stream;
	stream.reset();
	for (let index = 0; index < passState.commandCount; index += 1) {
		stream.appendEntry(passState.commandKinds[index], passState.commandRefs[index]);
	}
	renderStream(backend, state, passState);
}

export function registerHostOverlayPass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_overlay',
		name: 'HostOverlay',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
		present: true,
		initialState: createHostOverlayState(),
		graph: { writeState: writeHostOverlayState },
		bootstrap: (backend) => {
			bootstrapRuntime(backend as WebGLBackend);
		},
		shouldExecute: () => hasPendingOverlayFrame(),
		exec: (backend: WebGLBackend, _fbo, state: RenderPassStateRegistry['host_overlay']) => {
			renderOverlay(backend, runtime as HostOverlayRuntime, state);
		},
	});
}

export function registerHostMenuPass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_menu',
		name: 'HostMenu',
		sharedPipelineWith: 'host_overlay',
		present: true,
		initialState: createHostMenuState(),
		graph: { writeState: writeHostMenuState },
		shouldExecute: () => hasPendingHostMenuFrame(),
		exec: (backend: WebGLBackend, _fbo, state: RenderPassStateRegistry['host_menu']) => {
			renderHostMenu(backend, runtime as HostOverlayRuntime, state);
		},
	});
}
