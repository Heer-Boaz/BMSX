import {
	VDP_RPU_BLEND_ADD,
	VDP_RPU_BLEND_ALPHA,
	VDP_RPU_BLEND_NONE,
	VDP_RPU_CULL_FRONT,
	VDP_RPU_CULL_NONE,
	VDP_RPU_DEPTH_LESS,
	VDP_RPU_DEPTH_NONE,
	VDP_RPU_INDEX_NONE,
	VDP_RPU_INDEX_U16,
	VDP_RPU_PASS_COLOR_CLEAR,
	VDP_RPU_PASS_DEPTH_CLEAR,
	VDP_RPU_PIPE_BLEND_MASK,
	VDP_RPU_PIPE_COLOR_WRITE_MASK,
	VDP_RPU_PIPE_CULL_MASK,
	VDP_RPU_PIPE_DEPTH_MASK,
	VDP_RPU_PIPE_DEPTH_WRITE,
	VDP_RPU_PRIM_LINES,
	VDP_RPU_PRIM_POINTS,
	VDP_RPU_PRIM_TRIANGLES,
	VDP_RPU_PRIM_TRIANGLE_STRIP,
	VDP_RPU_ATTR_COLOR,
	VDP_RPU_ATTR_F32,
	VDP_RPU_ATTR_INSTANCE0,
	VDP_RPU_ATTR_INSTANCE1,
	VDP_RPU_ATTR_INSTANCE2,
	VDP_RPU_ATTR_INSTANCE3,
	VDP_RPU_ATTR_INSTANCE_COLOR,
	VDP_RPU_ATTR_INSTANCE_UVRECT,
	VDP_RPU_ATTR_JOINTS,
	VDP_RPU_ATTR_MORPH_NRM,
	VDP_RPU_ATTR_MORPH_POS,
	VDP_RPU_ATTR_NORMAL,
	VDP_RPU_ATTR_POS,
	VDP_RPU_ATTR_S16N,
	VDP_RPU_ATTR_U8,
	VDP_RPU_ATTR_U8N,
	VDP_RPU_ATTR_UV0,
	VDP_RPU_ATTR_WEIGHTS,
	VDP_RPU_INSTANCE_MODE_NONE,
	VDP_RPU_SHADER_FLAG_MORPH,
	VDP_RPU_SHADER_FLAG_T1,
	resolveVdpRpuStreamLayoutSpec,
	resolveVdpRpuShaderVariantSpec,
	vdpRpuVramRangeRevision,
	VDP_RPU_RESOURCE_NONE,
	VDP_RPU_SURFACE_FORMAT_DEPTH16,
	type VdpRpuFrameOutput,
	type VdpRpuShaderVariantSpec,
	type VdpRpuStreamAttributeSpec,
} from '../../../machine/devices/vdp/rpu';
import {
	RPU_SURFACE_DESC_BASE_ADDR_OFFSET,
	RPU_SURFACE_DESC_FORMAT_OFFSET,
	RPU_SURFACE_DESC_HEIGHT_OFFSET,
	RPU_SURFACE_DESC_PITCH_BYTES_OFFSET,
	RPU_SURFACE_DESC_WIDTH_OFFSET,
	readRpuDescU16,
	readRpuDescU32,
} from '../../../machine/devices/vdp/rpu_desc';
import type { RenderPassStateRegistry } from '../backend';
import type { RenderPassLibrary } from '../pass/library';
import type { WebGLBackend } from './backend';
import vdpRpuVertexShader from './shaders/vdp_rpu.vert.glsl';
import vdpRpuFragmentShader from './shaders/vdp_rpu.frag.glsl';

let vdpRpuProgram: WebGLProgram = null;
let vdpRpuBackend: WebGLBackend = null;
let vdpRpuGl: WebGL2RenderingContext = null;
let vdpRpuVertexArray: WebGLVertexArrayObject = null;
let vdpRpuNeutralTexture: WebGLTexture = null;
const vdpRpuNeutralTexturePixel = new Uint8Array(4);
let vdpRpuPositionLocation = -1;
let vdpRpuUv0Location = -1;
let vdpRpuColorLocation = -1;
let vdpRpuNormalLocation = -1;
let vdpRpuJointsLocation = -1;
let vdpRpuWeightsLocation = -1;
let vdpRpuMorphPosLocation = -1;
let vdpRpuMorphNrmLocation = -1;
let vdpRpuInstance0Location = -1;
let vdpRpuInstance1Location = -1;
let vdpRpuInstance2Location = -1;
let vdpRpuInstance3Location = -1;
let vdpRpuInstanceColorLocation = -1;
let vdpRpuInstanceUvRectLocation = -1;
let vdpRpuC0Location: WebGLUniformLocation = null;
let vdpRpuNmLocation: WebGLUniformLocation = null;
let vdpRpuC1Location: WebGLUniformLocation = null;
let vdpRpuJointLocation: WebGLUniformLocation = null;
let vdpRpuT0Location: WebGLUniformLocation = null;
let vdpRpuT1Location: WebGLUniformLocation = null;
let vdpRpuTextureEnabledLocation: WebGLUniformLocation = null;
let vdpRpuTextureFlipYLocation: WebGLUniformLocation = null;
let vdpRpuT1ModeLocation: WebGLUniformLocation = null;
let vdpRpuInstanceModeLocation: WebGLUniformLocation = null;
let vdpRpuSkinningModeLocation: WebGLUniformLocation = null;
let vdpRpuMorphModeLocation: WebGLUniformLocation = null;
let vdpRpuNormalModeLocation: WebGLUniformLocation = null;
let vdpRpuLightingModeLocation: WebGLUniformLocation = null;
type VdpRpuWebglBuffer = {
	buffer: WebGLBuffer;
	revision: number;
};
const vdpRpuArrayBuffers = new Map<number, VdpRpuWebglBuffer>();
const vdpRpuIndexBuffers = new Map<number, VdpRpuWebglBuffer>();
let vdpRpuFrameSerial = 0;
type VdpRpuWebglSurface = {
	baseAddr: number;
	pitchBytes: number;
	width: number;
	height: number;
	format: number;
	renderedFrame: number;
	uploadedFrame: number;
	sourceRevision: number;
	sourceUploaded: number;
	texture: WebGLTexture | null;
	depthBuffer: WebGLRenderbuffer | null;
	framebuffer: WebGLFramebuffer | null;
};
const vdpRpuSurfaces = new Map<number, VdpRpuWebglSurface>();
const vdpRpuColorDrawBuffers = [0];
const vdpRpuNoColorDrawBuffers = [0];

const vdpRpuIdentityC0 = new Float32Array(16);
vdpRpuIdentityC0[0] = 1;
vdpRpuIdentityC0[5] = 1;
vdpRpuIdentityC0[10] = 1;
vdpRpuIdentityC0[15] = 1;
const vdpRpuC0Words = new Uint32Array(16);
const vdpRpuC0Floats = new Float32Array(vdpRpuC0Words.buffer);
// Normal matrix: 9 floats packed at C0 words 16-24
const vdpRpuNmWords = new Uint32Array(9);
const vdpRpuNmFloats = new Float32Array(vdpRpuNmWords.buffer);
const vdpRpuIdentityNm = new Float32Array(9);
vdpRpuIdentityNm[0] = 1;
vdpRpuIdentityNm[4] = 1;
vdpRpuIdentityNm[8] = 1;
const vdpRpuC1Words = new Uint32Array(68);
const vdpRpuC1Floats = new Float32Array(vdpRpuC1Words.buffer);
const vdpRpuJointWords = new Uint32Array(384);
const vdpRpuJointFloats = new Float32Array(vdpRpuJointWords.buffer);
const vdpRpuConstantAddressScratch = new Uint32Array(1);
// Default C1: white ambient (intensity 1.0), all lights disabled
const vdpRpuDefaultC1Floats = new Float32Array(68);
vdpRpuDefaultC1Floats[0] = 1; // ambient.r
vdpRpuDefaultC1Floats[1] = 1; // ambient.g
vdpRpuDefaultC1Floats[2] = 1; // ambient.b
vdpRpuDefaultC1Floats[3] = 1; // ambient.intensity
const vdpRpuDefaultJointFloats = new Float32Array(384);
for (let jointIndex = 0; jointIndex < 24; jointIndex += 1) {
	const base = jointIndex * 16;
	vdpRpuDefaultJointFloats[base] = 1;
	vdpRpuDefaultJointFloats[base + 5] = 1;
	vdpRpuDefaultJointFloats[base + 10] = 1;
	vdpRpuDefaultJointFloats[base + 15] = 1;
}

const vdpRpuPipelineStateScratch: RenderPassStateRegistry['vdp_rpu'] = {
	width: 0,
	height: 0,
	frame: null,
};

export type VdpRpuRuntime = {
	backend: WebGLBackend;
};

const vdpRpuRuntimeScratch: VdpRpuRuntime = {
	backend: null,
};

function vdpRpuPrimitive(primitive: number): number {
	const gl = vdpRpuGl;
	switch (primitive) {
		case VDP_RPU_PRIM_TRIANGLE_STRIP:
			return gl.TRIANGLE_STRIP;
		case VDP_RPU_PRIM_LINES:
			return gl.LINES;
		case VDP_RPU_PRIM_POINTS:
			return gl.POINTS;
		case VDP_RPU_PRIM_TRIANGLES:
		default:
			return gl.TRIANGLES;
	}
}

function requireVdpRpuGl(gl: WebGL2RenderingContext | null): WebGL2RenderingContext {
	if (gl === null) {
		throw new Error('[VDPRPU] WebGL2 context missing during VDP-RPU bootstrap/execution.');
	}
	return gl;
}

function vdpRpuIndexType(indexType: number): number {
	const gl = vdpRpuGl;
	return indexType === VDP_RPU_INDEX_U16 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
}

function configureNearestClampTexture2D(gl: WebGL2RenderingContext): void {
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function deleteVdpRpuSurfaceStorage(surface: VdpRpuWebglSurface): void {
	const gl = vdpRpuGl;
	if (surface.texture !== null) {
		gl.deleteTexture(surface.texture);
		surface.texture = null;
	}
	if (surface.depthBuffer !== null) {
		gl.deleteRenderbuffer(surface.depthBuffer);
		surface.depthBuffer = null;
	}
	if (surface.framebuffer !== null) {
		gl.deleteFramebuffer(surface.framebuffer);
		surface.framebuffer = null;
	}
}

function uploadVdpRpuBuffer(frame: VdpRpuFrameOutput, target: number, vramAddr: number, byteLength: number): WebGLBuffer {
	const backend = vdpRpuBackend;
	const gl = vdpRpuGl;
	const arrayBufferTarget = target === gl.ARRAY_BUFFER;
	const bufferCache = arrayBufferTarget ? vdpRpuArrayBuffers : vdpRpuIndexBuffers;
	const key = vramAddr * (frame.vdpVram.byteLength + 1) + byteLength;
	let storage = bufferCache.get(key);
	const revision = vdpRpuVramRangeRevision(frame, vramAddr, byteLength);
	if (storage === undefined) {
		storage = {
			buffer: gl.createBuffer()!,
			revision,
		};
		bufferCache.set(key, storage);
		if (arrayBufferTarget) {
			backend.bindArrayBuffer(storage.buffer);
		} else {
			backend.bindElementArrayBuffer(storage.buffer);
		}
		gl.bufferData(target, byteLength, gl.DYNAMIC_DRAW);
		gl.bufferSubData(target, 0, frame.vdpVram, vramAddr, byteLength);
		return storage.buffer;
	}
	if (arrayBufferTarget) {
		backend.bindArrayBuffer(storage.buffer);
	} else {
		backend.bindElementArrayBuffer(storage.buffer);
	}
	if (storage.revision !== revision) {
		gl.bufferSubData(target, 0, frame.vdpVram, vramAddr, byteLength);
		storage.revision = revision;
	}
	return storage.buffer;
}

function loadVdpRpuSurfaceStorage(backend: WebGLBackend, frame: VdpRpuFrameOutput, surfaceDescAddr: number): VdpRpuWebglSurface {
	const gl = requireVdpRpuGl(backend.gl);
	const vram = frame.vdpVram;
	let surface = vdpRpuSurfaces.get(surfaceDescAddr);
	if (surface === undefined) {
		surface = {
			baseAddr: 0,
			pitchBytes: 0,
			width: 0,
			height: 0,
			format: 0,
			renderedFrame: 0,
			uploadedFrame: 0,
			sourceRevision: 0,
			sourceUploaded: 0,
			texture: null,
			depthBuffer: null,
			framebuffer: null,
		};
		vdpRpuSurfaces.set(surfaceDescAddr, surface);
	}
	const baseAddr = readRpuDescU32(vram, surfaceDescAddr + RPU_SURFACE_DESC_BASE_ADDR_OFFSET);
	const pitchBytes = readRpuDescU16(vram, surfaceDescAddr + RPU_SURFACE_DESC_PITCH_BYTES_OFFSET);
	const width = readRpuDescU16(vram, surfaceDescAddr + RPU_SURFACE_DESC_WIDTH_OFFSET);
	const height = readRpuDescU16(vram, surfaceDescAddr + RPU_SURFACE_DESC_HEIGHT_OFFSET);
	const format = vram[surfaceDescAddr + RPU_SURFACE_DESC_FORMAT_OFFSET]!;
	if (
		(surface.texture !== null || surface.depthBuffer !== null)
		&& surface.baseAddr === baseAddr
		&& surface.pitchBytes === pitchBytes
		&& surface.width === width
		&& surface.height === height
		&& surface.format === format
	) {
		return surface;
	}
	deleteVdpRpuSurfaceStorage(surface);
	backend.setActiveTexture(0);
	if (format === VDP_RPU_SURFACE_FORMAT_DEPTH16) {
		const depthBuffer = gl.createRenderbuffer()!;
		gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
		surface.depthBuffer = depthBuffer;
	} else {
		const texture = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		configureNearestClampTexture2D(gl);
		surface.texture = texture;
	}
	backend.invalidateTextureBindingCache();
	surface.baseAddr = baseAddr;
	surface.pitchBytes = pitchBytes;
	surface.width = width;
	surface.height = height;
	surface.format = format;
	surface.renderedFrame = 0;
	surface.uploadedFrame = 0;
	surface.sourceRevision = 0;
	surface.sourceUploaded = 0;
	surface.framebuffer = gl.createFramebuffer()!;
	return surface;
}

function uploadVdpRpuTextureSurface(backend: WebGLBackend, frame: VdpRpuFrameOutput, surface: VdpRpuWebglSurface): void {
	if (surface.renderedFrame === vdpRpuFrameSerial || surface.uploadedFrame === vdpRpuFrameSerial || surface.format === VDP_RPU_SURFACE_FORMAT_DEPTH16) {
		return;
	}
	const sourceByteLength = (surface.height - 1) * surface.pitchBytes + surface.width * 4;
	const sourceRevision = vdpRpuVramRangeRevision(frame, surface.baseAddr, sourceByteLength);
	if (surface.sourceUploaded !== 0 && surface.sourceRevision === sourceRevision) {
		return;
	}
	const gl = vdpRpuGl;
	backend.setActiveTexture(0);
	gl.bindTexture(gl.TEXTURE_2D, surface.texture);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	gl.pixelStorei(gl.UNPACK_ROW_LENGTH, surface.pitchBytes >> 2);
	gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, surface.width, surface.height, gl.RGBA, gl.UNSIGNED_BYTE, frame.vdpVram, surface.baseAddr);
	gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
	backend.invalidateTextureBindingCache();
	surface.uploadedFrame = vdpRpuFrameSerial;
	surface.sourceRevision = sourceRevision;
	surface.sourceUploaded = 1;
}

function bindVdpRpuPassFramebuffer(backend: WebGLBackend, frame: VdpRpuFrameOutput, passIndex: number, framebuffer: WebGLFramebuffer, width: number, height: number): number {
	void width;
	const gl = vdpRpuGl;
	const commands = frame.commands;
	const colorSurfaceDescAddr = commands.passColorSurfaceDescAddr[passIndex];
	const depthSurfaceDescAddr = commands.passDepthSurfaceDescAddr[passIndex];
	if (colorSurfaceDescAddr === 0 && depthSurfaceDescAddr === 0) {
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		vdpRpuColorDrawBuffers[0] = gl.COLOR_ATTACHMENT0;
		gl.drawBuffers(vdpRpuColorDrawBuffers);
		return height;
	}
	const targetSurface = colorSurfaceDescAddr !== 0
		? loadVdpRpuSurfaceStorage(backend, frame, colorSurfaceDescAddr)
		: loadVdpRpuSurfaceStorage(backend, frame, depthSurfaceDescAddr);
	gl.bindFramebuffer(gl.FRAMEBUFFER, targetSurface.framebuffer);
	if (colorSurfaceDescAddr !== 0) {
		const colorSurface = loadVdpRpuSurfaceStorage(backend, frame, colorSurfaceDescAddr);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorSurface.texture, 0);
		colorSurface.renderedFrame = vdpRpuFrameSerial;
		colorSurface.sourceUploaded = 0;
		vdpRpuColorDrawBuffers[0] = gl.COLOR_ATTACHMENT0;
		gl.drawBuffers(vdpRpuColorDrawBuffers);
	} else {
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
		vdpRpuNoColorDrawBuffers[0] = gl.NONE;
		gl.drawBuffers(vdpRpuNoColorDrawBuffers);
	}
	if (depthSurfaceDescAddr !== 0) {
		const depthSurface = loadVdpRpuSurfaceStorage(backend, frame, depthSurfaceDescAddr);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthSurface.depthBuffer);
		depthSurface.renderedFrame = vdpRpuFrameSerial;
		depthSurface.sourceUploaded = 0;
	} else {
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
	}
	return targetSurface.height;
}

function setVdpRpuPipelineState(pipelineWord: number): void {
	const backend = vdpRpuBackend;
	const gl = vdpRpuGl;
	const blend = pipelineWord & VDP_RPU_PIPE_BLEND_MASK;
	if (blend === VDP_RPU_BLEND_NONE) {
		backend.setBlendEnabled(false);
	} else {
		backend.setBlendEnabled(true);
		if (blend === VDP_RPU_BLEND_ADD) {
			backend.setBlendFunc(gl.SRC_ALPHA, gl.ONE);
		} else if (blend === VDP_RPU_BLEND_ALPHA) {
			backend.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		} else {
			backend.setBlendFunc(gl.ONE, gl.ZERO);
		}
	}

	const depth = (pipelineWord & VDP_RPU_PIPE_DEPTH_MASK) >>> 4;
	if (depth === VDP_RPU_DEPTH_NONE) {
		backend.setDepthTestEnabled(false);
	} else {
		backend.setDepthTestEnabled(true);
		backend.setDepthFunc(depth === VDP_RPU_DEPTH_LESS ? gl.LESS : gl.LEQUAL);
	}
	backend.setDepthMask((pipelineWord & VDP_RPU_PIPE_DEPTH_WRITE) !== 0);

	const cull = (pipelineWord & VDP_RPU_PIPE_CULL_MASK) >>> 8;
	if (cull === VDP_RPU_CULL_NONE) {
		backend.setCullEnabled(false);
	} else {
		backend.setCullEnabled(true);
		gl.cullFace(cull === VDP_RPU_CULL_FRONT ? gl.FRONT : gl.BACK);
	}

	const colorMask = (pipelineWord & VDP_RPU_PIPE_COLOR_WRITE_MASK) >>> 16;
	gl.colorMask((colorMask & 1) !== 0, (colorMask & 2) !== 0, (colorMask & 4) !== 0, (colorMask & 8) !== 0);
}

function vdpRpuAttributeLocation(attribute: number): number {
	switch (attribute) {
		case VDP_RPU_ATTR_UV0:
			return vdpRpuUv0Location;
		case VDP_RPU_ATTR_COLOR:
			return vdpRpuColorLocation;
		case VDP_RPU_ATTR_NORMAL:
			return vdpRpuNormalLocation;
		case VDP_RPU_ATTR_JOINTS:
			return vdpRpuJointsLocation;
		case VDP_RPU_ATTR_WEIGHTS:
			return vdpRpuWeightsLocation;
		case VDP_RPU_ATTR_MORPH_POS:
			return vdpRpuMorphPosLocation;
		case VDP_RPU_ATTR_MORPH_NRM:
			return vdpRpuMorphNrmLocation;
		case VDP_RPU_ATTR_INSTANCE0:
			return vdpRpuInstance0Location;
		case VDP_RPU_ATTR_INSTANCE1:
			return vdpRpuInstance1Location;
		case VDP_RPU_ATTR_INSTANCE2:
			return vdpRpuInstance2Location;
		case VDP_RPU_ATTR_INSTANCE3:
			return vdpRpuInstance3Location;
		case VDP_RPU_ATTR_INSTANCE_COLOR:
			return vdpRpuInstanceColorLocation;
		case VDP_RPU_ATTR_INSTANCE_UVRECT:
			return vdpRpuInstanceUvRectLocation;
		case VDP_RPU_ATTR_POS:
		default:
			return vdpRpuPositionLocation;
	}
}

function vdpRpuAttributeType(componentType: number): number {
	const gl = vdpRpuGl;
	switch (componentType) {
		case VDP_RPU_ATTR_U8:
		case VDP_RPU_ATTR_U8N:
			return gl.UNSIGNED_BYTE;
		case VDP_RPU_ATTR_S16N:
			return gl.SHORT;
		case VDP_RPU_ATTR_F32:
		default:
			return gl.FLOAT;
	}
}

function bindVdpRpuStreamAttribute(attribute: VdpRpuStreamAttributeSpec, byteStride: number, byteOffsetBase: number, divisor: number): void {
	const gl = vdpRpuGl;
	const location = vdpRpuAttributeLocation(attribute.attribute);
	gl.enableVertexAttribArray(location);
	gl.vertexAttribPointer(
		location,
		attribute.componentCount,
		vdpRpuAttributeType(attribute.componentType),
		attribute.normalized !== 0,
		byteStride,
		byteOffsetBase + attribute.byteOffset,
	);
	gl.vertexAttribDivisor(location, divisor);
}

function bindVdpRpuStreamBinding(frame: VdpRpuFrameOutput, streamBindingIndex: number, divisor: number): void {
	const gl = vdpRpuGl;
	const commands = frame.commands;
	const layout = resolveVdpRpuStreamLayoutSpec(commands.streamLayoutId[streamBindingIndex]);
	uploadVdpRpuBuffer(frame, gl.ARRAY_BUFFER, commands.streamVramAddr[streamBindingIndex], commands.streamByteLength[streamBindingIndex]);
	for (let index = 0; index < layout.attributeCount; index += 1) {
		bindVdpRpuStreamAttribute(layout.attributes[index], layout.byteStride, 0, divisor);
	}
}

function setVdpRpuDefaultVertexAttributes(): void {
	const gl = vdpRpuGl;
	gl.disableVertexAttribArray(vdpRpuPositionLocation);
	gl.vertexAttrib4f(vdpRpuPositionLocation, 0, 0, 0, 1);
	gl.vertexAttribDivisor(vdpRpuPositionLocation, 0);
	gl.disableVertexAttribArray(vdpRpuUv0Location);
	gl.vertexAttrib2f(vdpRpuUv0Location, 0, 0);
	gl.vertexAttribDivisor(vdpRpuUv0Location, 0);
	gl.disableVertexAttribArray(vdpRpuColorLocation);
	gl.vertexAttrib4f(vdpRpuColorLocation, 1, 1, 1, 1);
	gl.vertexAttribDivisor(vdpRpuColorLocation, 0);
	gl.disableVertexAttribArray(vdpRpuNormalLocation);
	gl.vertexAttrib3f(vdpRpuNormalLocation, 0, 0, 1);
	gl.vertexAttribDivisor(vdpRpuNormalLocation, 0);
	gl.disableVertexAttribArray(vdpRpuJointsLocation);
	gl.vertexAttrib4f(vdpRpuJointsLocation, 0, 0, 0, 0);
	gl.vertexAttribDivisor(vdpRpuJointsLocation, 0);
	gl.disableVertexAttribArray(vdpRpuWeightsLocation);
	gl.vertexAttrib4f(vdpRpuWeightsLocation, 1, 0, 0, 0);
	gl.vertexAttribDivisor(vdpRpuWeightsLocation, 0);
	gl.disableVertexAttribArray(vdpRpuMorphPosLocation);
	gl.vertexAttrib3f(vdpRpuMorphPosLocation, 0, 0, 0);
	gl.vertexAttribDivisor(vdpRpuMorphPosLocation, 0);
	gl.disableVertexAttribArray(vdpRpuMorphNrmLocation);
	gl.vertexAttrib3f(vdpRpuMorphNrmLocation, 0, 0, 0);
	gl.vertexAttribDivisor(vdpRpuMorphNrmLocation, 0);
}

function setVdpRpuDefaultInstanceAttributes(): void {
	const gl = vdpRpuGl;
	gl.disableVertexAttribArray(vdpRpuInstance0Location);
	gl.vertexAttrib4f(vdpRpuInstance0Location, 1, 0, 0, 0);
	gl.vertexAttribDivisor(vdpRpuInstance0Location, 0);
	gl.disableVertexAttribArray(vdpRpuInstance1Location);
	gl.vertexAttrib4f(vdpRpuInstance1Location, 0, 1, 0, 0);
	gl.vertexAttribDivisor(vdpRpuInstance1Location, 0);
	gl.disableVertexAttribArray(vdpRpuInstance2Location);
	gl.vertexAttrib4f(vdpRpuInstance2Location, 0, 0, 1, 0);
	gl.vertexAttribDivisor(vdpRpuInstance2Location, 0);
	gl.disableVertexAttribArray(vdpRpuInstance3Location);
	gl.vertexAttrib4f(vdpRpuInstance3Location, 0, 0, 0, 1);
	gl.vertexAttribDivisor(vdpRpuInstance3Location, 0);
	gl.disableVertexAttribArray(vdpRpuInstanceColorLocation);
	gl.vertexAttrib4f(vdpRpuInstanceColorLocation, 1, 1, 1, 1);
	gl.vertexAttribDivisor(vdpRpuInstanceColorLocation, 0);
	gl.disableVertexAttribArray(vdpRpuInstanceUvRectLocation);
	gl.vertexAttrib4f(vdpRpuInstanceUvRectLocation, 0, 0, 1, 1);
	gl.vertexAttribDivisor(vdpRpuInstanceUvRectLocation, 0);
}

function bindVdpRpuDrawStreams(frame: VdpRpuFrameOutput, drawIndex: number, instanceMode: number): void {
	const commands = frame.commands;
	const bindingEnd = commands.drawFirstStreamBinding[drawIndex] + commands.drawStreamBindingCount[drawIndex];
	let vertexBinding = -1;
	let instanceBinding = -1;
	let morphBinding = -1;
	for (let bindingIndex = commands.drawFirstStreamBinding[drawIndex]; bindingIndex < bindingEnd; bindingIndex += 1) {
		const streamSlot = commands.streamSlot[bindingIndex];
		if (streamSlot === 0) {
			vertexBinding = bindingIndex;
		} else if (streamSlot === 1) {
			instanceBinding = bindingIndex;
		} else if (streamSlot === 2) {
			morphBinding = bindingIndex;
		}
	}
	if (vertexBinding >= 0) {
		bindVdpRpuStreamBinding(frame, vertexBinding, 0);
	}
	if (instanceMode !== VDP_RPU_INSTANCE_MODE_NONE && instanceBinding >= 0) {
		bindVdpRpuStreamBinding(frame, instanceBinding, commands.streamStepRate[instanceBinding]);
	}
	if (morphBinding >= 0) {
		bindVdpRpuStreamBinding(frame, morphBinding, 0);
	}
}

function findVdpRpuConstantBindingAddress(commands: VdpRpuFrameOutput['commands'], drawIndex: number, constantSlot: number, constantByteAddr: Uint32Array): boolean {
	const bindingEnd = commands.drawFirstConstantBinding[drawIndex] + commands.drawConstantBindingCount[drawIndex];
	for (let bindingIndex = commands.drawFirstConstantBinding[drawIndex]; bindingIndex < bindingEnd; bindingIndex += 1) {
		if (commands.constantBindingSlot[bindingIndex] === constantSlot) {
			constantByteAddr[0] = commands.constantVramAddr[bindingIndex];
			return true;
		}
	}
	return false;
}

function readVdpRpuFloatWords(vram: Uint8Array, byteAddr: number, out: Uint32Array, wordOffset: number, count: number): void {
	for (let index = 0; index < count; index += 1) {
		out[index] = readRpuDescU32(vram, byteAddr + (wordOffset + index) * 4);
	}
}

function setVdpRpuC0Constants(frame: VdpRpuFrameOutput, drawIndex: number, normalMode: number): void {
	const gl = vdpRpuGl;
	if (findVdpRpuConstantBindingAddress(frame.commands, drawIndex, 0, vdpRpuConstantAddressScratch)) {
		const constantByteAddr = vdpRpuConstantAddressScratch[0];
		const vram = frame.vdpVram;
		readVdpRpuFloatWords(vram, constantByteAddr, vdpRpuC0Words, 0, 16);
		gl.uniformMatrix4fv(vdpRpuC0Location, false, vdpRpuC0Floats);
		if (normalMode !== 0) {
			readVdpRpuFloatWords(vram, constantByteAddr, vdpRpuNmWords, 16, 9);
			gl.uniformMatrix3fv(vdpRpuNmLocation, false, vdpRpuNmFloats);
		}
		return;
	}
	gl.uniformMatrix4fv(vdpRpuC0Location, false, vdpRpuIdentityC0);
	if (normalMode !== 0) {
		gl.uniformMatrix3fv(vdpRpuNmLocation, false, vdpRpuIdentityNm);
	}
}

function setVdpRpuC1Constants(frame: VdpRpuFrameOutput, drawIndex: number, shaderVariant: VdpRpuShaderVariantSpec): void {
	const gl = vdpRpuGl;
	const constantSlot = shaderVariant.lightingConstantSlot;
	if (constantSlot === VDP_RPU_RESOURCE_NONE) {
		gl.uniform1i(vdpRpuLightingModeLocation, 0);
		gl.uniform4fv(vdpRpuC1Location, vdpRpuDefaultC1Floats);
		return;
	}
	gl.uniform1i(vdpRpuLightingModeLocation, 1);
	if (findVdpRpuConstantBindingAddress(frame.commands, drawIndex, constantSlot, vdpRpuConstantAddressScratch)) {
		const constantByteAddr = vdpRpuConstantAddressScratch[0];
		readVdpRpuFloatWords(frame.vdpVram, constantByteAddr, vdpRpuC1Words, 0, 68);
		gl.uniform4fv(vdpRpuC1Location, vdpRpuC1Floats);
		return;
	}
	gl.uniform4fv(vdpRpuC1Location, vdpRpuDefaultC1Floats);
}

function setVdpRpuJointConstants(frame: VdpRpuFrameOutput, drawIndex: number, shaderVariant: VdpRpuShaderVariantSpec): void {
	const gl = vdpRpuGl;
	const constantSlot = shaderVariant.jointConstantSlot;
	if (constantSlot === VDP_RPU_RESOURCE_NONE) {
		gl.uniform1i(vdpRpuSkinningModeLocation, 0);
		gl.uniformMatrix4fv(vdpRpuJointLocation, false, vdpRpuDefaultJointFloats);
		return;
	}
	gl.uniform1i(vdpRpuSkinningModeLocation, 1);
	if (findVdpRpuConstantBindingAddress(frame.commands, drawIndex, constantSlot, vdpRpuConstantAddressScratch)) {
		const constantByteAddr = vdpRpuConstantAddressScratch[0];
		readVdpRpuFloatWords(frame.vdpVram, constantByteAddr, vdpRpuJointWords, 0, 384);
		gl.uniformMatrix4fv(vdpRpuJointLocation, false, vdpRpuJointFloats);
		return;
	}
	gl.uniformMatrix4fv(vdpRpuJointLocation, false, vdpRpuDefaultJointFloats);
}

function bindVdpRpuNeutralTexture(backend: WebGLBackend): void {
	const gl = vdpRpuGl;
	backend.setActiveTexture(0);
	gl.bindTexture(gl.TEXTURE_2D, vdpRpuNeutralTexture);
	gl.uniform1i(vdpRpuTextureFlipYLocation, 0);
	backend.invalidateTextureBindingCache();
}

function bindVdpRpuTextureBindings(runtime: VdpRpuRuntime, frame: VdpRpuFrameOutput, drawIndex: number, shaderVariant: VdpRpuShaderVariantSpec, rawVariantWord: number): void {
	const backend = runtime.backend;
	const gl = vdpRpuGl;
	const t1Flag = (rawVariantWord & VDP_RPU_SHADER_FLAG_T1) !== 0;
	if (shaderVariant.textureSlotCount === 0) {
		bindVdpRpuNeutralTexture(backend);
		gl.uniform1i(vdpRpuTextureEnabledLocation, 0);
		gl.uniform1i(vdpRpuT1ModeLocation, 0);
		return;
	}
	gl.uniform1i(vdpRpuTextureEnabledLocation, 1);
	const commands = frame.commands;
	const bindingEnd = commands.drawFirstTextureBinding[drawIndex] + commands.drawTextureBindingCount[drawIndex];
	let foundT0 = false;
	let foundT1 = false;
	for (let bindingIndex = commands.drawFirstTextureBinding[drawIndex]; bindingIndex < bindingEnd; bindingIndex += 1) {
		const slot = commands.textureSlot[bindingIndex];
		if (slot === 0 && !foundT0) {
			foundT0 = true;
			const surfaceDescAddr = commands.textureSurfaceDescAddr[bindingIndex];
			if (surfaceDescAddr === 0) {
				bindVdpRpuNeutralTexture(backend);
				gl.uniform1i(vdpRpuT0Location, 0);
			} else {
				const surface = loadVdpRpuSurfaceStorage(backend, frame, surfaceDescAddr);
				uploadVdpRpuTextureSurface(backend, frame, surface);
				backend.setActiveTexture(0);
				gl.bindTexture(gl.TEXTURE_2D, surface.texture);
				gl.uniform1i(vdpRpuTextureFlipYLocation, surface.renderedFrame === vdpRpuFrameSerial ? 1 : 0);
				gl.uniform1i(vdpRpuT0Location, 0);
			}
		} else if (slot === 1 && t1Flag && !foundT1) {
			foundT1 = true;
			const surfaceDescAddr = commands.textureSurfaceDescAddr[bindingIndex];
			if (surfaceDescAddr !== 0) {
				const surface = loadVdpRpuSurfaceStorage(backend, frame, surfaceDescAddr);
				uploadVdpRpuTextureSurface(backend, frame, surface);
				backend.setActiveTexture(1);
				gl.bindTexture(gl.TEXTURE_2D, surface.texture);
				gl.uniform1i(vdpRpuT1Location, 1);
				gl.uniform1i(vdpRpuT1ModeLocation, 1);
			}
		}
	}
	if (!foundT0) {
		bindVdpRpuNeutralTexture(backend);
		gl.uniform1i(vdpRpuTextureEnabledLocation, 0);
	}
	if (!foundT1 || !t1Flag) {
		gl.uniform1i(vdpRpuT1ModeLocation, 0);
	}
}

function drawVdpRpuCommand(runtime: VdpRpuRuntime, frame: VdpRpuFrameOutput, drawIndex: number, vertexCount: number, instanceCount: number, indexCount: number): void {
	const gl = vdpRpuGl;
	const commands = frame.commands;
	setVdpRpuPipelineState(commands.drawPipelineWord[drawIndex]);
	const rawVariantWord = commands.drawShaderVariant[drawIndex];
	const shaderVariant = resolveVdpRpuShaderVariantSpec(rawVariantWord);
	const instanceMode = shaderVariant.instanceMode;
	const morphMode = (rawVariantWord & VDP_RPU_SHADER_FLAG_MORPH) !== 0 ? 1 : 0;
	const normalMode = shaderVariant.lightingConstantSlot !== VDP_RPU_RESOURCE_NONE ? 1 : 0;
	gl.uniform1i(vdpRpuInstanceModeLocation, instanceMode);
	gl.uniform1i(vdpRpuMorphModeLocation, morphMode);
	gl.uniform1i(vdpRpuNormalModeLocation, normalMode);
	setVdpRpuDefaultVertexAttributes();
	setVdpRpuDefaultInstanceAttributes();
	bindVdpRpuTextureBindings(runtime, frame, drawIndex, shaderVariant, rawVariantWord);
	if (shaderVariant.usesC0 !== 0) {
		setVdpRpuC0Constants(frame, drawIndex, normalMode);
	} else {
		gl.uniformMatrix4fv(vdpRpuC0Location, false, vdpRpuIdentityC0);
		if (normalMode !== 0) {
			gl.uniformMatrix3fv(vdpRpuNmLocation, false, vdpRpuIdentityNm);
		}
	}
	setVdpRpuC1Constants(frame, drawIndex, shaderVariant);
	setVdpRpuJointConstants(frame, drawIndex, shaderVariant);
	bindVdpRpuDrawStreams(frame, drawIndex, instanceMode);
	const primitive = vdpRpuPrimitive(commands.drawPrimitive[drawIndex]);
	const indexType = commands.drawIndexType[drawIndex];
	const indexVramAddr = commands.drawIndexVramAddr[drawIndex];
	if (indexType === VDP_RPU_INDEX_NONE || indexVramAddr === 0) {
		if (instanceMode !== VDP_RPU_INSTANCE_MODE_NONE) {
			gl.drawArraysInstanced(primitive, 0, vertexCount, instanceCount);
			return;
		}
		gl.drawArrays(primitive, 0, vertexCount);
		return;
	}
	const indexByteLength = indexCount * (indexType === VDP_RPU_INDEX_U16 ? 2 : 4);
	uploadVdpRpuBuffer(frame, gl.ELEMENT_ARRAY_BUFFER, indexVramAddr, indexByteLength);
	if (instanceMode !== VDP_RPU_INSTANCE_MODE_NONE) {
		gl.drawElementsInstanced(primitive, indexCount, vdpRpuIndexType(indexType), 0, instanceCount);
		return;
	}
	gl.drawElements(primitive, indexCount, vdpRpuIndexType(indexType), 0);
}

export function initVdpRpuPipeline(backend: WebGLBackend): void {
	const gl = requireVdpRpuGl(backend.gl);
	vdpRpuBackend = backend;
	vdpRpuGl = gl;
	vdpRpuVertexArray = backend.createVertexArray() as WebGLVertexArrayObject;
	vdpRpuNeutralTexture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, vdpRpuNeutralTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, vdpRpuNeutralTexturePixel);
	configureNearestClampTexture2D(gl);
	gl.bindTexture(gl.TEXTURE_2D, null);
	backend.invalidateTextureBindingCache();
}

export function setupVdpRpuLocations(backend: WebGLBackend): void {
	const gl = backend.gl;
	const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	if (!current) {
		throw new Error('[VDPRPU] shader program not bound during bootstrap.');
	}
	vdpRpuProgram = current;
	vdpRpuPositionLocation = gl.getAttribLocation(vdpRpuProgram, 'a_position');
	vdpRpuUv0Location = gl.getAttribLocation(vdpRpuProgram, 'a_uv0');
	vdpRpuColorLocation = gl.getAttribLocation(vdpRpuProgram, 'a_color');
	vdpRpuNormalLocation = gl.getAttribLocation(vdpRpuProgram, 'a_normal');
	vdpRpuJointsLocation = gl.getAttribLocation(vdpRpuProgram, 'a_joints');
	vdpRpuWeightsLocation = gl.getAttribLocation(vdpRpuProgram, 'a_weights');
	vdpRpuMorphPosLocation = gl.getAttribLocation(vdpRpuProgram, 'a_morph_pos');
	vdpRpuMorphNrmLocation = gl.getAttribLocation(vdpRpuProgram, 'a_morph_nrm');
	vdpRpuInstance0Location = gl.getAttribLocation(vdpRpuProgram, 'a_instance0');
	vdpRpuInstance1Location = gl.getAttribLocation(vdpRpuProgram, 'a_instance1');
	vdpRpuInstance2Location = gl.getAttribLocation(vdpRpuProgram, 'a_instance2');
	vdpRpuInstance3Location = gl.getAttribLocation(vdpRpuProgram, 'a_instance3');
	vdpRpuInstanceColorLocation = gl.getAttribLocation(vdpRpuProgram, 'a_instance_color');
	vdpRpuInstanceUvRectLocation = gl.getAttribLocation(vdpRpuProgram, 'a_instance_uvrect');
	vdpRpuC0Location = gl.getUniformLocation(vdpRpuProgram, 'u_c0')!;
	vdpRpuNmLocation = gl.getUniformLocation(vdpRpuProgram, 'u_nm')!;
	vdpRpuC1Location = gl.getUniformLocation(vdpRpuProgram, 'u_c1[0]')!;
	vdpRpuJointLocation = gl.getUniformLocation(vdpRpuProgram, 'u_joint[0]')!;
	vdpRpuT0Location = gl.getUniformLocation(vdpRpuProgram, 'u_t0')!;
	vdpRpuT1Location = gl.getUniformLocation(vdpRpuProgram, 'u_t1')!;
	vdpRpuTextureEnabledLocation = gl.getUniformLocation(vdpRpuProgram, 'u_textureEnabled')!;
	vdpRpuTextureFlipYLocation = gl.getUniformLocation(vdpRpuProgram, 'u_textureFlipY')!;
	vdpRpuT1ModeLocation = gl.getUniformLocation(vdpRpuProgram, 'u_t1Mode')!;
	vdpRpuInstanceModeLocation = gl.getUniformLocation(vdpRpuProgram, 'u_instanceMode')!;
	vdpRpuSkinningModeLocation = gl.getUniformLocation(vdpRpuProgram, 'u_skinningMode')!;
	vdpRpuMorphModeLocation = gl.getUniformLocation(vdpRpuProgram, 'u_morphMode')!;
	vdpRpuNormalModeLocation = gl.getUniformLocation(vdpRpuProgram, 'u_normalMode')!;
	vdpRpuLightingModeLocation = gl.getUniformLocation(vdpRpuProgram, 'u_lightingMode')!;
	gl.uniformMatrix4fv(vdpRpuC0Location, false, vdpRpuIdentityC0);
	gl.uniformMatrix3fv(vdpRpuNmLocation, false, vdpRpuIdentityNm);
	gl.uniform4fv(vdpRpuC1Location, vdpRpuDefaultC1Floats);
	gl.uniformMatrix4fv(vdpRpuJointLocation, false, vdpRpuDefaultJointFloats);
	gl.uniform1i(vdpRpuT0Location, 0);
	gl.uniform1i(vdpRpuT1Location, 1);
	gl.uniform1i(vdpRpuTextureEnabledLocation, 0);
	gl.uniform1i(vdpRpuTextureFlipYLocation, 0);
	gl.uniform1i(vdpRpuT1ModeLocation, 0);
	gl.uniform1i(vdpRpuInstanceModeLocation, VDP_RPU_INSTANCE_MODE_NONE);
	gl.uniform1i(vdpRpuSkinningModeLocation, 0);
	gl.uniform1i(vdpRpuMorphModeLocation, 0);
	gl.uniform1i(vdpRpuNormalModeLocation, 0);
	gl.uniform1i(vdpRpuLightingModeLocation, 0);
}

export function renderVdpRpuFrame(runtime: VdpRpuRuntime, framebuffer: WebGLFramebuffer, state: RenderPassStateRegistry['vdp_rpu']): void {
	const backend = runtime.backend;
	const gl = backend.gl;
	vdpRpuBackend = backend;
	vdpRpuGl = gl;
	const frame = state.frame;
	backend.bindVertexArray(vdpRpuVertexArray);
	const commands = frame.commands;
	vdpRpuFrameSerial += 1;
	for (let passIndex = 0; passIndex < commands.passCount; passIndex += 1) {
		const targetHeight = bindVdpRpuPassFramebuffer(backend, frame, passIndex, framebuffer, state.width, state.height);
		const viewportXY = commands.passViewportXY[passIndex];
		const viewportWH = commands.passViewportWH[passIndex];
		const viewportY = viewportXY >>> 16;
		const viewportHeight = viewportWH >>> 16;
		backend.setViewportRect(
			viewportXY & 0xffff,
			targetHeight - viewportY - viewportHeight,
			viewportWH & 0xffff,
			viewportHeight,
		);
		let clearMask = 0;
		const passOps = commands.passOps[passIndex];
		if ((passOps & VDP_RPU_PASS_COLOR_CLEAR) !== 0) {
			const color = commands.passClearColor[passIndex];
			gl.clearColor(
				((color >>> 16) & 0xff) / 255,
				((color >>> 8) & 0xff) / 255,
				(color & 0xff) / 255,
				((color >>> 24) & 0xff) / 255,
			);
			clearMask |= gl.COLOR_BUFFER_BIT;
		}
		if ((passOps & VDP_RPU_PASS_DEPTH_CLEAR) !== 0) {
			gl.clearDepth(commands.passClearDepthWord[passIndex] * (1 / 0xffffffff));
			clearMask |= gl.DEPTH_BUFFER_BIT;
		}
		if (clearMask !== 0) {
			gl.clear(clearMask);
		}
		const firstDraw = commands.passFirstDraw[passIndex];
		const drawEnd = firstDraw + commands.passDrawCount[passIndex];
		for (let drawIndex = firstDraw; drawIndex < drawEnd; drawIndex += 1) {
			drawVdpRpuCommand(
				runtime,
				frame,
				drawIndex,
				commands.drawVertexCount[drawIndex],
				commands.drawInstanceCount[drawIndex],
				commands.drawIndexCount[drawIndex],
			);
		}
	}
	gl.colorMask(true, true, true, true);
	backend.setDepthMask(true);
	backend.bindVertexArray(null);
	backend.invalidateTextureBindingCache();
}

export function registerVdpRpuPass(registry: RenderPassLibrary): void {
	const view = registry.view;
	registry.register({
		id: 'vdp_rpu',
		name: 'VDPRPU',
		vsCode: vdpRpuVertexShader,
		fsCode: vdpRpuFragmentShader,
		graph: {
			writes: ['frame_color', 'frame_depth'],
		},
		writesDepth: true,
		bootstrap: (backend) => {
			const webglBackend = backend as WebGLBackend;
			initVdpRpuPipeline(webglBackend);
			setupVdpRpuLocations(webglBackend);
		},
		shouldExecute: (view) => view.vdpRpuFrame.commands.passCount !== 0,
		exec: (backend, fbo) => {
			vdpRpuRuntimeScratch.backend = backend as WebGLBackend;
			vdpRpuPipelineStateScratch.width = view.offscreenCanvasSize.x;
			vdpRpuPipelineStateScratch.height = view.offscreenCanvasSize.y;
			vdpRpuPipelineStateScratch.frame = view.vdpRpuFrame;
			renderVdpRpuFrame(vdpRpuRuntimeScratch, fbo as WebGLFramebuffer, vdpRpuPipelineStateScratch);
		},
	});
}
