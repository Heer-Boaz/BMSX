import { $ } from '../../core/game';

import particleFS from '../3d/shaders/particle.frag.glsl';
import particleVS from '../3d/shaders/particle.vert.glsl';
import type { PassEncoder, RenderContext, TextureHandle } from '../backend/pipeline_interfaces';
import { ParticlePipelineState, RenderPassLibrary } from '../backend/renderpasslib';
import { TEXTURE_UNIT_PARTICLE } from '../backend/webgl/webgl.constants';
import { WebGLBackend } from '../backend/webgl/webgl_backend';
import type { Camera } from './camera3d';
import { M4 } from './math3d';
import {
	beginParticleQueue,
	forEachParticleQueue,
	particleQueueBackSize,
	particleQueueFrontSize,
	submit_particle as enqueueParticle,
} from '../shared/render_queues';
import type { ParticleRenderSubmission } from '../shared/render_types';
import { updateFallbackCamera, FALLBACK_CAMERA } from '../shared/fallback_camera';

const camRight = new Float32Array(3);
const camUp = new Float32Array(3);
let particleAmbientModeDefault: 0 | 1 = 0;
let particleAmbientFactorDefault = 1.0;

export function setAmbientDefaults(mode: 0 | 1, factor = 1.0): void {
	particleAmbientModeDefault = mode;
	particleAmbientFactorDefault = Math.max(0, Math.min(1, factor));
}

const MAX_PARTICLES = 1000;
const INSTANCE_FLOATS = 8; // vec4(position+size) + vec4(color)
const BYTES_PER_FLOAT = 4;
const INSTANCE_BYTES = INSTANCE_FLOATS * BYTES_PER_FLOAT;
let particleProgram: WebGLProgram; let vao: WebGLVertexArrayObject; let quadBuffer: WebGLBuffer; let instanceBuffers: WebGLBuffer[] = []; let viewProjLocation: WebGLUniformLocation; let cameraRightLocation: WebGLUniformLocation; let cameraUpLocation: WebGLUniformLocation; let textureLocation: WebGLUniformLocation; let ambientModeLocation: WebGLUniformLocation; let ambientFactorLocation: WebGLUniformLocation; let defaultTexture: TextureHandle; const instanceData = new Float32Array(MAX_PARTICLES * INSTANCE_FLOATS);
let framePage = 0;

const fallbackParticleState: ParticlePipelineState = {
	width: FALLBACK_CAMERA.width,
	height: FALLBACK_CAMERA.height,
	viewProj: FALLBACK_CAMERA.viewProj,
	camRight: FALLBACK_CAMERA.camRight,
	camUp: FALLBACK_CAMERA.camUp,
};

const cameraParticleState: ParticlePipelineState = {
	width: 1,
	height: 1,
	viewProj: new Float32Array(16),
	camRight: new Float32Array(3),
	camUp: new Float32Array(3),
};

function updateOrthographicParticleState(width: number, height: number): ParticlePipelineState {
	const fallback = updateFallbackCamera(width, height);
	fallbackParticleState.width = fallback.width;
	fallbackParticleState.height = fallback.height;
	return fallbackParticleState;
}

function updateCameraParticleState(width: number, height: number, cam: Camera): ParticlePipelineState {
	if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
		throw new Error(`[ParticlesPipeline] Invalid particle camera dimensions (${width}x${height}).`);
	}
	cameraParticleState.width = width;
	cameraParticleState.height = height;
	cameraParticleState.viewProj = cam.viewProjection;
	M4.viewRightUpInto(cam.view, cameraParticleState.camRight, cameraParticleState.camUp);
	return cameraParticleState;
}

function resolveParticleState(state: ParticlePipelineState, context: RenderContext): ParticlePipelineState {
	if (!state) {
		return updateOrthographicParticleState(context.offscreenCanvasSize.x, context.offscreenCanvasSize.y);
	}
	if (!Number.isFinite(state.width) || state.width <= 0 || !Number.isFinite(state.height) || state.height <= 0) {
		throw new Error('[ParticlesPipeline] Pipeline state has invalid dimensions; ensure GameView sizes are initialized before rendering particles.');
	}
	return state;
}

export function init(backend: WebGLBackend): void {
	const gl = backend.gl;
	vao = backend.createVertexArray() as WebGLVertexArrayObject;
	const quad = new Float32Array([-0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5]);
	quadBuffer = backend.createVertexBuffer(quad, 'static') as WebGLBuffer;
	instanceBuffers = [0, 1, 2].map(() => backend.createVertexBuffer(new Float32Array(MAX_PARTICLES * INSTANCE_FLOATS), 'dynamic') as WebGLBuffer);
	const whitePixel = new Uint8Array([255, 255, 255, 255]);
	const tex = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, whitePixel);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.bindTexture(gl.TEXTURE_2D, null);
	defaultTexture = tex;
}

export function setupParticleUniforms(backend: WebGLBackend): void {
	const gl = backend.gl;
	// Pick up program created/bound by GPUBackend/GraphicsPipelineManager
	if (!particleProgram) {
		const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
		if (!current) throw new Error('Particle shader program not bound during bootstrap');
		particleProgram = current;
	}
	viewProjLocation = gl.getUniformLocation(particleProgram, 'u_viewProjection')!;
	cameraRightLocation = gl.getUniformLocation(particleProgram, 'u_cameraRight')!;
	cameraUpLocation = gl.getUniformLocation(particleProgram, 'u_cameraUp')!;
	textureLocation = gl.getUniformLocation(particleProgram, 'u_texture')!;
	ambientModeLocation = gl.getUniformLocation(particleProgram, 'u_particleAmbientMode')!;
	ambientFactorLocation = gl.getUniformLocation(particleProgram, 'u_particleAmbientFactor')!;
}

export function setupParticleLocations(backend: WebGLBackend): void {
	const gl = backend.gl;
	backend.bindVertexArray(vao);
	// Static quad buffer at attrib 0
	backend.bindArrayBuffer(quadBuffer);
	backend.enableVertexAttrib(0);
	backend.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	// Instance attributes 1 & 2 are (re)bound once per frame for the selected buffer
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(null);
}
interface ParticleRuntime {
	backend: WebGLBackend;
	gl: WebGL2RenderingContext;
	context: RenderContext;
}

export function renderParticleBatch(runtime: ParticleRuntime, framebuffer: WebGLFramebuffer, state: ParticlePipelineState): void {
	const { backend, gl, context } = runtime;
	const pending = beginParticleQueue();
	if (pending === 0) return;
	const resolvedState = resolveParticleState(state, context);
	camRight.set(resolvedState.camRight);
	camUp.set(resolvedState.camUp);
	const batches = new Map<TextureHandle, Map<string, ParticleRenderSubmission[]>>();
	forEachParticleQueue((p) => {
		if (!p) return;
		const tex = (p.texture as TextureHandle) ?? defaultTexture;
		let byAmbient = batches.get(tex);
		if (!byAmbient) { byAmbient = new Map(); batches.set(tex, byAmbient); }
		const mode = (p.ambient_mode ?? particleAmbientModeDefault) | 0;
		const factor = Math.max(0, Math.min(1, p.ambient_factor ?? particleAmbientFactorDefault));
		const key = mode + ':' + factor.toFixed(2);
		let arr = byAmbient.get(key);
		if (!arr) { arr = []; byAmbient.set(key, arr); }
		arr.push({ ...p, ambient_mode: mode as 0 | 1, ambient_factor: factor, texture: tex });
	});
	if (!Number.isFinite(resolvedState.width) || !Number.isFinite(resolvedState.height)) {
		throw new Error(`[ParticlesPipeline] Invalid viewport dimensions (${resolvedState.width}x${resolvedState.height}).`);
	}
	backend.setViewport({ x: 0, y: 0, w: resolvedState.width, h: resolvedState.height });
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.depthMask(false);
	gl.uniformMatrix4fv(viewProjLocation, false, resolvedState.viewProj);
	gl.uniform3fv(cameraRightLocation, camRight);
	gl.uniform3fv(cameraUpLocation, camUp);
	gl.uniform1i(textureLocation, TEXTURE_UNIT_PARTICLE);
	gl.uniform1i(ambientModeLocation, 0);
	gl.uniform1f(ambientFactorLocation, 1.0);
	backend.bindVertexArray(vao);
	framePage = (framePage + 1) % 3;
	const instBuf = instanceBuffers[framePage];
	backend.bindArrayBuffer(instBuf);
	backend.enableVertexAttrib(1); backend.enableVertexAttrib(2);
	backend.vertexAttribPointer(1, 4, gl.FLOAT, false, INSTANCE_BYTES, 0);
	backend.vertexAttribDivisor(1, 1);
	backend.vertexAttribPointer(2, 4, gl.FLOAT, false, INSTANCE_BYTES, 4 * BYTES_PER_FLOAT);
	backend.vertexAttribDivisor(2, 1);
	for (const [tex, byAmbient] of batches) {
		for (const [ambKey, arr] of byAmbient) {
			const batchCount = Math.min(arr.length, MAX_PARTICLES);
			const [modeStr, factorStr] = ambKey.split(':');
			gl.uniform1i(ambientModeLocation, parseInt(modeStr, 10) | 0);
			gl.uniform1f(ambientFactorLocation, parseFloat(factorStr));
			for (let i = 0; i < batchCount; i++) {
				const p = arr[i]; if (!p) continue;
				const base = i * INSTANCE_FLOATS;
				instanceData[base] = p.position[0];
				instanceData[base + 1] = p.position[1];
				instanceData[base + 2] = p.position[2];
				instanceData[base + 3] = p.size;
				instanceData[base + 4] = p.color.r;
				instanceData[base + 5] = p.color.g;
				instanceData[base + 6] = p.color.b;
				instanceData[base + 7] = p.color.a;
			}
			backend.bindArrayBuffer(instBuf);
			backend.updateVertexBuffer(instBuf, instanceData.subarray(0, batchCount * INSTANCE_FLOATS), 0);
			context.activeTexUnit = TEXTURE_UNIT_PARTICLE;
			context.bind2DTex(tex);
			const passStub: PassEncoder = { fbo: framebuffer, desc: { label: 'particles' } };
			backend.drawInstanced(passStub, 6, batchCount, 0, 0);
		}
	}
	backend.bindVertexArray(null);
	gl.depthMask(true);
}
export function setDefaultParticleTexture(tex: TextureHandle): void { defaultTexture = tex; }
// New submission helper (prefer over touching particlesToDraw)
export function submit_particle(p: ParticleRenderSubmission): void {
	enqueueParticle({ ...p });
}
export function getQueuedParticleCount(): number { return particleQueueBackSize(); }
export function getParticleQueueDebug(): { front: number; back: number } { return { front: particleQueueFrontSize(), back: particleQueueBackSize() }; }

export function registerParticlesPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'particles',
		label: 'particles',
		name: 'Particles',
		vsCode: particleVS,
		fsCode: particleFS,
		bindingLayout: { uniforms: ['FrameUniforms'] },
		bootstrap: (backend) => {
			const webglBackend = backend as WebGLBackend;
			init(webglBackend);
			setupParticleLocations(webglBackend);
			setupParticleUniforms(webglBackend);
		},
		writesDepth: true,
		shouldExecute: () => !!getQueuedParticleCount(),
		exec: (backend, fbo, s) => {
			const webglBackend = backend as WebGLBackend;
			const runtime: ParticleRuntime = { backend: webglBackend, gl: webglBackend.gl as WebGL2RenderingContext, context: $.view };
			renderParticleBatch(runtime, fbo as WebGLFramebuffer, s as ParticlePipelineState);
		},
		prepare: (_backend, _state) => {
			const gv = $.view;
			const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
			const cam = $.world.activeCamera3D;
			if (!cam) {
				registry.setState('particles', updateOrthographicParticleState(width, height));
				return;
			}
			registry.setState('particles', updateCameraParticleState(width, height, cam));
		},
	});
}
