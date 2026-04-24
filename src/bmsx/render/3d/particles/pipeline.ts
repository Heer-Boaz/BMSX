import { engineCore } from '../../../core/engine';

import particleFS from '../shaders/particle.frag.glsl';
import particleVS from '../shaders/particle.vert.glsl';
import type { PassEncoder, RenderContext, RenderPassStateRegistry } from '../../backend/interfaces';
import { RenderPassLibrary } from '../../backend/pass/library';
import { ParticlePipelineState } from '../../backend/interfaces';
import { TEXTURE_UNIT_ATLAS_ENGINE, TEXTURE_UNIT_ATLAS_PRIMARY, TEXTURE_UNIT_ATLAS_SECONDARY } from '../../backend/webgl/constants';
import { WebGLBackend } from '../../backend/webgl/backend';
import type { Camera } from '../camera';
import { M4 } from '../math';
import {
	beginParticleQueue,
	forEachParticleQueue,
	particleAmbientFactorDefault,
	particleAmbientModeDefault,
	particleQueueBackSize
} from '../../shared/queues';
import type { ParticleRenderSubmission } from '../../shared/submissions';
import { updateFallbackCamera, FALLBACK_CAMERA } from '../../shared/fallback_camera';
import { ENGINE_ATLAS_INDEX, ENGINE_ATLAS_TEXTURE_KEY } from '../../../rompack/format';
import { resolveActiveCamera3D } from '../../shared/hardware/camera';
import { clamp } from '../../../common/clamp';

const camRight = new Float32Array(3);
const camUp = new Float32Array(3);
const MAX_PARTICLES = 1000;
const INSTANCE_FLOATS = 13; // vec4(position+size) + vec4(color) + vec4(uvrect) + atlasId
const BYTES_PER_FLOAT = 4;
const INSTANCE_BYTES = INSTANCE_FLOATS * BYTES_PER_FLOAT;
let particleProgram: WebGLProgram; let vao: WebGLVertexArrayObject; let quadBuffer: WebGLBuffer; let instanceBuffers: WebGLBuffer[] = []; let viewProjLocation: WebGLUniformLocation; let cameraRightLocation: WebGLUniformLocation; let cameraUpLocation: WebGLUniformLocation; let texture0Location: WebGLUniformLocation; let texture1Location: WebGLUniformLocation; let texture2Location: WebGLUniformLocation; let ambientModeLocation: WebGLUniformLocation; let ambientFactorLocation: WebGLUniformLocation; const instanceData = new Float32Array(MAX_PARTICLES * INSTANCE_FLOATS);
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

export function initParticlePipeline(backend: WebGLBackend): void {
	vao = backend.createVertexArray() as WebGLVertexArrayObject;
	const quad = new Float32Array([-0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5]);
	quadBuffer = backend.createVertexBuffer(quad, 'static') as WebGLBuffer;
	instanceBuffers = [0, 1, 2].map(() => backend.createVertexBuffer(new Float32Array(MAX_PARTICLES * INSTANCE_FLOATS), 'dynamic') as WebGLBuffer);
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
	texture0Location = gl.getUniformLocation(particleProgram, 'u_texture0')!;
	texture1Location = gl.getUniformLocation(particleProgram, 'u_texture1')!;
	texture2Location = gl.getUniformLocation(particleProgram, 'u_texture2')!;
	ambientModeLocation = gl.getUniformLocation(particleProgram, 'u_particleAmbientMode')!;
	ambientFactorLocation = gl.getUniformLocation(particleProgram, 'u_particleAmbientFactor')!;
	gl.uniform1i(texture0Location, TEXTURE_UNIT_ATLAS_PRIMARY);
	gl.uniform1i(texture1Location, TEXTURE_UNIT_ATLAS_SECONDARY);
	gl.uniform1i(texture2Location, TEXTURE_UNIT_ATLAS_ENGINE);
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
	const batches = new Map<string, ParticleRenderSubmission[]>();
	let needsEngineAtlas = false;
	let needsSecondaryAtlas = false;
	forEachParticleQueue((p) => {
		if (!p) return;
		const atlasId = p.atlasBinding ?? 0;
		if (atlasId === ENGINE_ATLAS_INDEX) {
			needsEngineAtlas = true;
		} else if (atlasId !== 0) {
			needsSecondaryAtlas = true;
		}
		const mode = (p.ambient_mode ?? particleAmbientModeDefault) | 0;
			const factor = clamp(p.ambient_factor ?? particleAmbientFactorDefault, 0, 1);
		const key = mode + ':' + factor.toFixed(2);
		let arr = batches.get(key);
		if (!arr) { arr = []; batches.set(key, arr); }
		arr.push(p);
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
	gl.uniform1i(ambientModeLocation, 0);
	gl.uniform1f(ambientFactorLocation, 1.0);
	const atlasPrimaryTex = resolvedState.atlasPrimaryTex;
	if (!atlasPrimaryTex) {
		throw new Error("[ParticlesPipeline] Texture '_atlas_primary' missing from view textures.");
	}
	const atlasSecondaryTex = resolvedState.atlasSecondaryTex;
	const atlasEngineTex = resolvedState.atlasEngineTex;
	if (needsSecondaryAtlas && !atlasSecondaryTex) {
		throw new Error("[ParticlesPipeline] Texture '_atlas_secondary' missing from view textures.");
	}
	if (needsEngineAtlas && !atlasEngineTex) {
		throw new Error(`[ParticlesPipeline] Texture '${ENGINE_ATLAS_TEXTURE_KEY}' missing from view textures.`);
	}
	context.activeTexUnit = TEXTURE_UNIT_ATLAS_PRIMARY;
	context.bind2DTex(atlasPrimaryTex);
	if (atlasSecondaryTex) {
		context.activeTexUnit = TEXTURE_UNIT_ATLAS_SECONDARY;
		context.bind2DTex(atlasSecondaryTex);
	}
	if (atlasEngineTex) {
		context.activeTexUnit = TEXTURE_UNIT_ATLAS_ENGINE;
		context.bind2DTex(atlasEngineTex);
	}
	backend.bindVertexArray(vao);
	framePage = (framePage + 1) % 3;
	const instBuf = instanceBuffers[framePage];
	backend.bindArrayBuffer(instBuf);
	backend.enableVertexAttrib(1); backend.enableVertexAttrib(2); backend.enableVertexAttrib(3); backend.enableVertexAttrib(4);
	backend.vertexAttribPointer(1, 4, gl.FLOAT, false, INSTANCE_BYTES, 0);
	backend.vertexAttribDivisor(1, 1);
	backend.vertexAttribPointer(2, 4, gl.FLOAT, false, INSTANCE_BYTES, 4 * BYTES_PER_FLOAT);
	backend.vertexAttribDivisor(2, 1);
	backend.vertexAttribPointer(3, 4, gl.FLOAT, false, INSTANCE_BYTES, 8 * BYTES_PER_FLOAT);
	backend.vertexAttribDivisor(3, 1);
	backend.vertexAttribPointer(4, 1, gl.FLOAT, false, INSTANCE_BYTES, 12 * BYTES_PER_FLOAT);
	backend.vertexAttribDivisor(4, 1);
	for (const [ambKey, arr] of batches) {
		const batchCount = Math.min(arr.length, MAX_PARTICLES);
		const [modeStr, factorStr] = ambKey.split(':');
		gl.uniform1i(ambientModeLocation, parseInt(modeStr, 10) | 0);
		gl.uniform1f(ambientFactorLocation, parseFloat(factorStr));
		for (let i = 0; i < batchCount; i++) {
			const p = arr[i]; if (!p) continue;
			if (!p.uv0 || !p.uv1 || p.atlasBinding === undefined || p.atlasBinding === null) {
				throw new Error('[ParticlesPipeline] Particle missing atlas UV data.');
			}
			const base = i * INSTANCE_FLOATS;
			instanceData[base] = p.position[0];
			instanceData[base + 1] = p.position[1];
			instanceData[base + 2] = p.position[2];
			instanceData[base + 3] = p.size;
			instanceData[base + 4] = p.color.r;
			instanceData[base + 5] = p.color.g;
			instanceData[base + 6] = p.color.b;
			instanceData[base + 7] = p.color.a;
			instanceData[base + 8] = p.uv0[0];
			instanceData[base + 9] = p.uv0[1];
			instanceData[base + 10] = p.uv1[0];
			instanceData[base + 11] = p.uv1[1];
			instanceData[base + 12] = p.atlasBinding;
		}
		backend.bindArrayBuffer(instBuf);
		backend.updateVertexBuffer(instBuf, instanceData.subarray(0, batchCount * INSTANCE_FLOATS), 0);
		const passStub: PassEncoder = { fbo: framebuffer, desc: { label: 'particles' } };
		backend.drawInstanced(passStub, 6, batchCount, 0, 0);
	}
	backend.bindVertexArray(null);
	gl.depthMask(true);
}

export function registerParticlesPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'particles',
		name: 'Particles',
		vsCode: particleVS,
		fsCode: particleFS,
		bindingLayout: {
			uniforms: ['FrameUniforms'],
			textures: [{ name: 'u_texture0' }, { name: 'u_texture1' }, { name: 'u_texture2' }],
			samplers: [{ name: 's_texture0' }, { name: 's_texture1' }, { name: 's_texture2' }],
		},
		bootstrap: (backend) => {
			const webglBackend = backend as WebGLBackend;
			initParticlePipeline(webglBackend);
			setupParticleLocations(webglBackend);
			setupParticleUniforms(webglBackend);
		},
		writesDepth: true,
		shouldExecute: () => !!particleQueueBackSize(),
		exec: (backend, fbo, s: RenderPassStateRegistry['particles']) => {
			const webglBackend = backend as WebGLBackend;
			const runtime: ParticleRuntime = { backend: webglBackend, gl: webglBackend.gl as WebGL2RenderingContext, context: engineCore.view };
			renderParticleBatch(runtime, fbo as WebGLFramebuffer, s as ParticlePipelineState);
		},
		prepare: (_backend, _state) => {
			const gv = engineCore.view;
			const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
			const cam = resolveActiveCamera3D();
			const atlasPrimaryTex = gv.textures['_atlas_primary'];
			if (!atlasPrimaryTex) {
				throw new Error("[ParticlesPipeline] Texture '_atlas_primary' missing from view textures.");
			}
			const atlasSecondaryTex = gv.textures['_atlas_secondary'];
			const atlasEngineTex = gv.textures[ENGINE_ATLAS_TEXTURE_KEY];
				const state = cam
					? updateCameraParticleState(width, height, cam)
					: updateOrthographicParticleState(width, height);
				state.atlasPrimaryTex = atlasPrimaryTex;
				state.atlasSecondaryTex = atlasSecondaryTex;
				state.atlasEngineTex = atlasEngineTex;
				registry.setState('particles', state);
			},
		});
	}
