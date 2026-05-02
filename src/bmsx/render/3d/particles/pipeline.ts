import { consoleCore } from '../../../core/console';

import particleFS from '../shaders/particle.frag.glsl';
import particleVS from '../shaders/particle.vert.glsl';
import type { PassEncoder, RenderContext, RenderPassStateRegistry } from '../../backend/interfaces';
import { RenderPassLibrary } from '../../backend/pass/library';
import { ParticlePipelineState } from '../../backend/interfaces';
import { TEXTURE_UNIT_TEXTPAGE_ENGINE, TEXTURE_UNIT_TEXTPAGE_PRIMARY, TEXTURE_UNIT_TEXTPAGE_SECONDARY } from '../../backend/webgl/constants';
import { WebGLBackend } from '../../backend/webgl/backend';
import type { Camera } from '../camera';
import { M4 } from '../math';
import {
	beginParticleQueue,
	forEachParticleQueue,
	particleAmbientFactorDefault,
	particleAmbientModeDefault,
} from '../../shared/queues';
import type { ParticleRenderSubmission } from '../../shared/submissions';
import { SYSTEM_SLOT_TEXTURE_KEY, VDP_PRIMARY_SLOT_TEXTURE_KEY, VDP_SECONDARY_SLOT_TEXTURE_KEY } from '../../../rompack/format';
import { VDP_SLOT_PRIMARY, VDP_SLOT_SECONDARY, VDP_SLOT_SYSTEM } from '../../../machine/bus/io';
import { hardwareCameraBank0 } from '../../shared/hardware/camera';
import { clamp } from '../../../common/clamp';
import { VDP_BBU_BILLBOARD_LIMIT } from '../../../machine/devices/vdp/contracts';

const camRight = new Float32Array(3);
const camUp = new Float32Array(3);
const HOST_PARTICLE_LIMIT = 1000;
const PARTICLE_INSTANCE_LIMIT = VDP_BBU_BILLBOARD_LIMIT;
const INSTANCE_FLOATS = 13; // vec4(position+size) + vec4(color) + vec4(uvrect) + textpageId
const BYTES_PER_FLOAT = 4;
const INSTANCE_BYTES = INSTANCE_FLOATS * BYTES_PER_FLOAT;
let particleProgram: WebGLProgram; let vao: WebGLVertexArrayObject; let quadBuffer: WebGLBuffer; let instanceBuffers: WebGLBuffer[] = []; let viewProjLocation: WebGLUniformLocation; let cameraRightLocation: WebGLUniformLocation; let cameraUpLocation: WebGLUniformLocation; let texture0Location: WebGLUniformLocation; let texture1Location: WebGLUniformLocation; let texture2Location: WebGLUniformLocation; let ambientModeLocation: WebGLUniformLocation; let ambientFactorLocation: WebGLUniformLocation; const instanceData = new Float32Array(PARTICLE_INSTANCE_LIMIT * INSTANCE_FLOATS);
let framePage = 0;

const cameraParticleState: ParticlePipelineState = {
	width: 1,
	height: 1,
	viewProj: new Float32Array(16),
	camRight: new Float32Array(3),
	camUp: new Float32Array(3),
};

function updateCameraParticleState(width: number, height: number, cam: Camera): ParticlePipelineState {
	cameraParticleState.width = width;
	cameraParticleState.height = height;
	cameraParticleState.viewProj = cam.viewProjection;
	M4.viewRightUpInto(cam.view, cameraParticleState.camRight, cameraParticleState.camUp);
	return cameraParticleState;
}

function drawPreparedParticleInstances(backend: WebGLBackend, instBuf: WebGLBuffer, framebuffer: WebGLFramebuffer, batchCount: number): void {
	backend.bindArrayBuffer(instBuf);
	backend.updateVertexBuffer(instBuf, instanceData.subarray(0, batchCount * INSTANCE_FLOATS), 0);
	const passStub: PassEncoder = { fbo: framebuffer, desc: { label: 'particles' } };
	backend.drawInstanced(passStub, 6, batchCount, 0, 0);
}

export function initParticlePipeline(backend: WebGLBackend): void {
	vao = backend.createVertexArray() as WebGLVertexArrayObject;
	const quad = new Float32Array([-0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5]);
	quadBuffer = backend.createVertexBuffer(quad, 'static') as WebGLBuffer;
	instanceBuffers = [0, 1, 2].map(() => backend.createVertexBuffer(new Float32Array(PARTICLE_INSTANCE_LIMIT * INSTANCE_FLOATS), 'dynamic') as WebGLBuffer);
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
	gl.uniform1i(texture0Location, TEXTURE_UNIT_TEXTPAGE_PRIMARY);
	gl.uniform1i(texture1Location, TEXTURE_UNIT_TEXTPAGE_SECONDARY);
	gl.uniform1i(texture2Location, TEXTURE_UNIT_TEXTPAGE_ENGINE);
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
	const vdpPending = context.vdpBillboardCount;
	if (pending === 0 && vdpPending === 0) return;
	camRight.set(state.camRight);
	camUp.set(state.camUp);
	let needsSystemSlot = false;
	let needsSecondaryTextpage = false;
	let batches: Map<string, ParticleRenderSubmission[]> | null = null;
	if (pending !== 0) {
		batches = new Map<string, ParticleRenderSubmission[]>();
		forEachParticleQueue((p) => {
			if (!p) return;
			const slot = p.slot ?? VDP_SLOT_PRIMARY;
			if (slot === VDP_SLOT_SYSTEM) {
				needsSystemSlot = true;
			} else if (slot === VDP_SLOT_SECONDARY) {
				needsSecondaryTextpage = true;
			}
			const mode = (p.ambient_mode ?? particleAmbientModeDefault) | 0;
			const factor = clamp(p.ambient_factor ?? particleAmbientFactorDefault, 0, 1);
			const key = mode + ':' + factor.toFixed(2);
			let arr = batches.get(key);
			if (!arr) { arr = []; batches.set(key, arr); }
			arr.push(p);
		});
	}
	if (vdpPending !== 0) {
		const vdpSlots = context.vdpBillboardSlot;
		for (let index = 0; index < vdpPending; index += 1) {
			const slot = vdpSlots[index];
			if (slot === VDP_SLOT_SYSTEM) {
				needsSystemSlot = true;
			} else if (slot === VDP_SLOT_SECONDARY) {
				needsSecondaryTextpage = true;
			}
		}
	}
	backend.setViewport({ x: 0, y: 0, w: state.width, h: state.height });
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.depthMask(false);
	gl.uniformMatrix4fv(viewProjLocation, false, state.viewProj);
	gl.uniform3fv(cameraRightLocation, camRight);
	gl.uniform3fv(cameraUpLocation, camUp);
	gl.uniform1i(ambientModeLocation, 0);
	gl.uniform1f(ambientFactorLocation, 1.0);
	const textpagePrimaryTex = state.textpagePrimaryTex;
	if (!textpagePrimaryTex) {
		throw new Error(`[ParticlesPipeline] Texture '${VDP_PRIMARY_SLOT_TEXTURE_KEY}' missing from view textures.`);
	}
	const textpageSecondaryTex = state.textpageSecondaryTex;
	const systemSlotTex = state.systemSlotTex;
	if (needsSecondaryTextpage && !textpageSecondaryTex) {
		throw new Error(`[ParticlesPipeline] Texture '${VDP_SECONDARY_SLOT_TEXTURE_KEY}' missing from view textures.`);
	}
	if (needsSystemSlot && !systemSlotTex) {
		throw new Error(`[ParticlesPipeline] Texture '${SYSTEM_SLOT_TEXTURE_KEY}' missing from view textures.`);
	}
	context.activeTexUnit = TEXTURE_UNIT_TEXTPAGE_PRIMARY;
	context.bind2DTex(textpagePrimaryTex);
	if (textpageSecondaryTex) {
		context.activeTexUnit = TEXTURE_UNIT_TEXTPAGE_SECONDARY;
		context.bind2DTex(textpageSecondaryTex);
	}
	if (systemSlotTex) {
		context.activeTexUnit = TEXTURE_UNIT_TEXTPAGE_ENGINE;
		context.bind2DTex(systemSlotTex);
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
	if (batches !== null) {
		for (const [ambKey, arr] of batches) {
			const batchCount = arr.length < HOST_PARTICLE_LIMIT ? arr.length : HOST_PARTICLE_LIMIT;
			const [modeStr, factorStr] = ambKey.split(':');
			gl.uniform1i(ambientModeLocation, parseInt(modeStr, 10) | 0);
			gl.uniform1f(ambientFactorLocation, parseFloat(factorStr));
			for (let i = 0; i < batchCount; i++) {
				const p = arr[i]; if (!p) continue;
				if (!p.uv0 || !p.uv1 || p.slot === undefined || p.slot === null) {
					throw new Error('[ParticlesPipeline] Particle missing textpage UV data.');
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
				instanceData[base + 12] = p.slot;
			}
			drawPreparedParticleInstances(backend, instBuf, framebuffer, batchCount);
		}
	}
	if (vdpPending !== 0) {
		const batchCount = vdpPending;
		const positionSize = context.vdpBillboardPositionSize;
		const color = context.vdpBillboardColor;
		const uvRect = context.vdpBillboardUvRect;
		const slots = context.vdpBillboardSlot;
		gl.uniform1i(ambientModeLocation, 0);
		gl.uniform1f(ambientFactorLocation, 1.0);
		for (let index = 0; index < batchCount; index += 1) {
			const base = index * INSTANCE_FLOATS;
			const sourceBase = index * 4;
			instanceData[base + 0] = positionSize[sourceBase + 0];
			instanceData[base + 1] = positionSize[sourceBase + 1];
			instanceData[base + 2] = positionSize[sourceBase + 2];
			instanceData[base + 3] = positionSize[sourceBase + 3];
			instanceData[base + 4] = color[sourceBase + 0];
			instanceData[base + 5] = color[sourceBase + 1];
			instanceData[base + 6] = color[sourceBase + 2];
			instanceData[base + 7] = color[sourceBase + 3];
			instanceData[base + 8] = uvRect[sourceBase + 0];
			instanceData[base + 9] = uvRect[sourceBase + 1];
			instanceData[base + 10] = uvRect[sourceBase + 2];
			instanceData[base + 11] = uvRect[sourceBase + 3];
			instanceData[base + 12] = slots[index];
		}
		drawPreparedParticleInstances(backend, instBuf, framebuffer, batchCount);
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
		shouldExecute: () => beginParticleQueue() !== 0 || consoleCore.view.vdpBillboardCount !== 0,
		exec: (backend, fbo, s: RenderPassStateRegistry['particles']) => {
			const webglBackend = backend as WebGLBackend;
			const runtime: ParticleRuntime = { backend: webglBackend, gl: webglBackend.gl as WebGL2RenderingContext, context: consoleCore.view };
			renderParticleBatch(runtime, fbo as WebGLFramebuffer, s as ParticlePipelineState);
		},
		prepare: (_backend, _state) => {
			const gv = consoleCore.view;
			const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
			const textpagePrimaryTex = gv.textures[VDP_PRIMARY_SLOT_TEXTURE_KEY];
			if (!textpagePrimaryTex) {
				throw new Error(`[ParticlesPipeline] Texture '${VDP_PRIMARY_SLOT_TEXTURE_KEY}' missing from view textures.`);
			}
			const textpageSecondaryTex = gv.textures[VDP_SECONDARY_SLOT_TEXTURE_KEY];
			const systemSlotTex = gv.textures[SYSTEM_SLOT_TEXTURE_KEY];
			const state = updateCameraParticleState(width, height, hardwareCameraBank0);
			state.textpagePrimaryTex = textpagePrimaryTex;
			state.textpageSecondaryTex = textpageSecondaryTex;
			state.systemSlotTex = systemSlotTex;
			registry.setState('particles', state);
		},
	});
}
