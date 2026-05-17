import { consoleCore } from '../../../core/console';

import particleFS from '../shaders/particle.frag.glsl';
import particleVS from '../shaders/particle.vert.glsl';
import type { PassEncoder, RenderContext, RenderPassStateRegistry } from '../../backend/backend';
import { RenderPassLibrary } from '../../backend/pass/library';
import { ParticlePipelineState } from '../../backend/backend';
import { TEXTURE_UNIT_TEXTPAGE_ENGINE, TEXTURE_UNIT_TEXTPAGE_PRIMARY, TEXTURE_UNIT_TEXTPAGE_SECONDARY } from '../../backend/webgl/constants';
import type { WebGLBackend } from '../../backend/webgl/backend';
import type { VdpTransformSnapshot } from '../../vdp/transform';
import { M4 } from '../math';
import { SYSTEM_SLOT_TEXTURE_KEY, VDP_PRIMARY_SLOT_TEXTURE_KEY, VDP_SECONDARY_SLOT_TEXTURE_KEY } from '../../../rompack/format';

import {
	VDP_BBU_BILLBOARD_LIMIT,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
} from '../../../machine/devices/vdp/contracts';

const camRight = new Float32Array(3);
const camUp = new Float32Array(3);
const PARTICLE_INSTANCE_LIMIT = VDP_BBU_BILLBOARD_LIMIT;
const INSTANCE_FLOATS = 13; // vec4(position+size) + vec4(color) + vec4(uvrect) + textpageId
const BYTES_PER_FLOAT = 4;
const INSTANCE_BYTES = INSTANCE_FLOATS * BYTES_PER_FLOAT;
let particleProgram: WebGLProgram; let vao: WebGLVertexArrayObject; let quadBuffer: WebGLBuffer; let instanceBuffers: WebGLBuffer[] = []; let viewProjLocation: WebGLUniformLocation; let cameraRightLocation: WebGLUniformLocation; let cameraUpLocation: WebGLUniformLocation; let texture0Location: WebGLUniformLocation; let texture1Location: WebGLUniformLocation; let texture2Location: WebGLUniformLocation; let ambientModeLocation: WebGLUniformLocation; let ambientFactorLocation: WebGLUniformLocation; const instanceData = new Float32Array(PARTICLE_INSTANCE_LIMIT * INSTANCE_FLOATS);
let framePage = 0;

const particlePipelineStateScratch: ParticlePipelineState = {
	width: 1,
	height: 1,
	viewProj: new Float32Array(16),
	camRight: new Float32Array(3),
	camUp: new Float32Array(3),
};
const particlePassEncoder: PassEncoder = { fbo: null, desc: { label: 'particles' } };

function updateParticleTransformState(width: number, height: number, transform: VdpTransformSnapshot): ParticlePipelineState {
	particlePipelineStateScratch.width = width;
	particlePipelineStateScratch.height = height;
	particlePipelineStateScratch.viewProj = transform.viewProj;
	M4.viewRightUpInto(transform.view, particlePipelineStateScratch.camRight, particlePipelineStateScratch.camUp);
	return particlePipelineStateScratch;
}

function drawPreparedParticleInstances(backend: WebGLBackend, instBuf: WebGLBuffer, framebuffer: WebGLFramebuffer, batchCount: number): void {
	backend.bindArrayBuffer(instBuf);
	backend.updateVertexBuffer(instBuf, instanceData, 0, 0, batchCount * INSTANCE_FLOATS);
	particlePassEncoder.fbo = framebuffer;
	backend.drawInstanced(particlePassEncoder, 6, batchCount, 0, 0);
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
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	// Instance attributes 1 & 2 are (re)bound once per frame for the selected buffer
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(null);
}
export function renderParticleBatch(backend: WebGLBackend, gl: WebGL2RenderingContext, context: RenderContext, framebuffer: WebGLFramebuffer, state: ParticlePipelineState): void {
	const vdpPending = context.vdpBillboardCount;
	if (vdpPending === 0) return;
	camRight.set(state.camRight);
	camUp.set(state.camUp);
	let needsSystemSlot = false;
	let needsSecondaryTextpage = false;
	const vdpSlots = context.vdpBillboardSlot;
	for (let index = 0; index < vdpPending; index += 1) {
		const slot = vdpSlots[index];
		if (slot === VDP_SLOT_SYSTEM) {
			needsSystemSlot = true;
		} else if (slot === VDP_SLOT_SECONDARY) {
			needsSecondaryTextpage = true;
		}
	}
	backend.setViewportRect(0, 0, state.width, state.height);
	backend.setCullEnabled(false);
	backend.setDepthTestEnabled(false);
	backend.setBlendEnabled(true);
	backend.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	backend.setDepthMask(false);
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
	gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2); gl.enableVertexAttribArray(3); gl.enableVertexAttribArray(4);
	gl.vertexAttribPointer(1, 4, gl.FLOAT, false, INSTANCE_BYTES, 0);
	gl.vertexAttribDivisor(1, 1);
	gl.vertexAttribPointer(2, 4, gl.FLOAT, false, INSTANCE_BYTES, 4 * BYTES_PER_FLOAT);
	gl.vertexAttribDivisor(2, 1);
	gl.vertexAttribPointer(3, 4, gl.FLOAT, false, INSTANCE_BYTES, 8 * BYTES_PER_FLOAT);
	gl.vertexAttribDivisor(3, 1);
	gl.vertexAttribPointer(4, 1, gl.FLOAT, false, INSTANCE_BYTES, 12 * BYTES_PER_FLOAT);
	gl.vertexAttribDivisor(4, 1);
	const positionSize = context.vdpBillboardPositionSize;
	const color = context.vdpBillboardColor;
	const uvRect = context.vdpBillboardUvRect;
	gl.uniform1i(ambientModeLocation, 0);
	gl.uniform1f(ambientFactorLocation, 1.0);
	for (let index = 0; index < vdpPending; index += 1) {
		const base = index * INSTANCE_FLOATS;
		const sourceBase = index * 4;
		const colorValue = color[index];
		instanceData[base + 0] = positionSize[sourceBase + 0];
		instanceData[base + 1] = positionSize[sourceBase + 1];
		instanceData[base + 2] = positionSize[sourceBase + 2];
		instanceData[base + 3] = positionSize[sourceBase + 3];
		instanceData[base + 4] = ((colorValue >>> 16) & 0xff) / 255;
		instanceData[base + 5] = ((colorValue >>> 8) & 0xff) / 255;
		instanceData[base + 6] = (colorValue & 0xff) / 255;
		instanceData[base + 7] = ((colorValue >>> 24) & 0xff) / 255;
		instanceData[base + 8] = uvRect[sourceBase + 0];
		instanceData[base + 9] = uvRect[sourceBase + 1];
		instanceData[base + 10] = uvRect[sourceBase + 2];
		instanceData[base + 11] = uvRect[sourceBase + 3];
		instanceData[base + 12] = vdpSlots[index];
	}
	drawPreparedParticleInstances(backend, instBuf, framebuffer, vdpPending);
	backend.bindVertexArray(null);
	backend.setDepthMask(true);
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
		shouldExecute: () => consoleCore.view.vdpBillboardCount !== 0,
		exec: (backend, fbo, s: RenderPassStateRegistry['particles']) => {
			const webglBackend = backend as WebGLBackend;
			renderParticleBatch(webglBackend, webglBackend.gl as WebGL2RenderingContext, consoleCore.view, fbo as WebGLFramebuffer, s as ParticlePipelineState);
			},
			prepare: (_backend, _state) => {
				const gv = consoleCore.view;
				const size = gv.offscreenCanvasSize;
				const state = updateParticleTransformState(size.x, size.y, gv.vdpTransform);
				state.textpagePrimaryTex = gv.textures[VDP_PRIMARY_SLOT_TEXTURE_KEY];
				state.textpageSecondaryTex = gv.textures[VDP_SECONDARY_SLOT_TEXTURE_KEY];
				state.systemSlotTex = gv.textures[SYSTEM_SLOT_TEXTURE_KEY];
				registry.setState('particles', state);
			},
	});
}
