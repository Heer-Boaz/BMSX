import { VDP_RD_SURFACE_COUNT } from '../../../machine/devices/vdp/contracts';
import {
	VDP_RPU_BLEND_ADD,
	VDP_RPU_BLEND_ALPHA,
	VDP_RPU_BLEND_NONE,
	VDP_RPU_BUFFER_CAPACITY,
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
	VDP_RPU_REF_NONE,
	VDP_RPU_RESOURCE_NONE,
	VDP_RPU_SURFACE_CAPACITY,
	VDP_RPU_SURFACE_FORMAT_DEPTH16,
	type VdpRpuFrameOutput,
	type VdpRpuShaderVariantSpec,
	type VdpRpuStreamAttributeSpec,
} from '../../../machine/devices/vdp/rpu';
import type { RenderPassStateRegistry } from '../backend';
import type { RenderPassLibrary } from '../pass/library';
import type { WebGLBackend } from './backend';
import type { GameView } from '../../gameview';
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
const vdpRpuVertexBufferObject: (WebGLBuffer | null)[] = [];
const vdpRpuVertexBufferRevision = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuVertexBufferByteOffset = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuVertexBufferByteLength = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuInstanceBufferObject: (WebGLBuffer | null)[] = [];
const vdpRpuInstanceBufferRevision = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuInstanceBufferByteOffset = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuInstanceBufferByteLength = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuMorphBufferObject: (WebGLBuffer | null)[] = [];
const vdpRpuMorphBufferRevision = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuMorphBufferByteOffset = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuMorphBufferByteLength = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuIndexBufferObject: (WebGLBuffer | null)[] = [];
const vdpRpuIndexBufferRevision = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuIndexBufferByteOffset = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuIndexBufferByteLength = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
const vdpRpuSurfaceTexture: (WebGLTexture | null)[] = [];
const vdpRpuSurfaceDepthBuffer: (WebGLRenderbuffer | null)[] = [];
const vdpRpuSurfaceFramebuffer: (WebGLFramebuffer | null)[] = [];
const vdpRpuSurfaceRevision = new Uint32Array(VDP_RPU_SURFACE_CAPACITY);
const vdpRpuSurfaceWidth = new Uint32Array(VDP_RPU_SURFACE_CAPACITY);
const vdpRpuSurfaceHeight = new Uint32Array(VDP_RPU_SURFACE_CAPACITY);
const vdpRpuSurfaceFormat = new Uint8Array(VDP_RPU_SURFACE_CAPACITY);
const vdpRpuColorDrawBuffers = [0];
const vdpRpuNoColorDrawBuffers = [0];
for (let index = 0; index < VDP_RPU_BUFFER_CAPACITY; index += 1) {
	vdpRpuVertexBufferObject[index] = null;
	vdpRpuInstanceBufferObject[index] = null;
	vdpRpuMorphBufferObject[index] = null;
	vdpRpuIndexBufferObject[index] = null;
}
for (let index = 0; index < VDP_RPU_SURFACE_CAPACITY; index += 1) {
	vdpRpuSurfaceTexture[index] = null;
	vdpRpuSurfaceDepthBuffer[index] = null;
	vdpRpuSurfaceFramebuffer[index] = null;
}

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
	context: GameView;
};

const vdpRpuRuntimeScratch: VdpRpuRuntime = {
	backend: null,
	context: null,
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

function vdpRpuIndexType(indexType: number): number {
	const gl = vdpRpuGl;
	return indexType === VDP_RPU_INDEX_U16 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
}

function deleteVdpRpuSurfaceStorage(surfaceId: number): void {
	const gl = vdpRpuGl;
	const color = vdpRpuSurfaceTexture[surfaceId];
	if (color !== null) {
		gl.deleteTexture(color);
		vdpRpuSurfaceTexture[surfaceId] = null;
	}
	const depth = vdpRpuSurfaceDepthBuffer[surfaceId];
	if (depth !== null) {
		gl.deleteRenderbuffer(depth);
		vdpRpuSurfaceDepthBuffer[surfaceId] = null;
	}
	const framebuffer = vdpRpuSurfaceFramebuffer[surfaceId];
	if (framebuffer !== null) {
		gl.deleteFramebuffer(framebuffer);
		vdpRpuSurfaceFramebuffer[surfaceId] = null;
	}
}

function ensureVdpRpuBufferStorage(
	frame: VdpRpuFrameOutput,
	refIndex: number,
	target: number,
	bufferObject: (WebGLBuffer | null)[],
	bufferRevision: Uint32Array,
	bufferByteOffset: Uint32Array,
	bufferByteLength: Uint32Array,
): WebGLBuffer {
	const backend = vdpRpuBackend;
	const gl = vdpRpuGl;
	const refs = frame.resources.bufferRefs;
	const bufferId = refs.bufferId[refIndex];
	let buffer = bufferObject[bufferId];
	if (buffer === null) {
		buffer = gl.createBuffer()!;
		bufferObject[bufferId] = buffer;
	}
	if (target === gl.ARRAY_BUFFER) {
		backend.bindArrayBuffer(buffer);
	} else {
		backend.bindElementArrayBuffer(buffer);
	}
	if (
		bufferRevision[bufferId] !== refs.revision[refIndex]
		|| bufferByteOffset[bufferId] !== refs.byteOffset[refIndex]
		|| bufferByteLength[bufferId] !== refs.byteLength[refIndex]
	) {
		const byteLength = refs.byteLength[refIndex];
		gl.bufferData(target, byteLength, gl.STREAM_DRAW);
		gl.bufferSubData(target, 0, refs.bytes[refIndex], refs.byteOffset[refIndex], byteLength);
		bufferRevision[bufferId] = refs.revision[refIndex];
		bufferByteOffset[bufferId] = refs.byteOffset[refIndex];
		bufferByteLength[bufferId] = byteLength;
	}
	return buffer;
}

function ensureVdpRpuSurfaceStorage(backend: WebGLBackend, frame: VdpRpuFrameOutput, surfaceRef: number): void {
	const gl = vdpRpuGl;
	const refs = frame.resources.surfaceRefs;
	const surfaceId = refs.surfaceId[surfaceRef];
	const revision = refs.revision[surfaceRef];
	const width = refs.width[surfaceRef];
	const height = refs.height[surfaceRef];
	const format = refs.format[surfaceRef];
	if (
		vdpRpuSurfaceRevision[surfaceId] === revision
		&& vdpRpuSurfaceWidth[surfaceId] === width
		&& vdpRpuSurfaceHeight[surfaceId] === height
		&& vdpRpuSurfaceFormat[surfaceId] === format
	) {
		return;
	}
	deleteVdpRpuSurfaceStorage(surfaceId);
	backend.setActiveTexture(0);
	if (format === VDP_RPU_SURFACE_FORMAT_DEPTH16) {
		const depth = gl.createRenderbuffer()!;
		gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
		vdpRpuSurfaceDepthBuffer[surfaceId] = depth;
	} else {
		const color = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, color);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		vdpRpuSurfaceTexture[surfaceId] = color;
	}
	backend.invalidateTextureBindingCache();
	vdpRpuSurfaceFramebuffer[surfaceId] = gl.createFramebuffer()!;
	vdpRpuSurfaceRevision[surfaceId] = revision;
	vdpRpuSurfaceWidth[surfaceId] = width;
	vdpRpuSurfaceHeight[surfaceId] = height;
	vdpRpuSurfaceFormat[surfaceId] = format;
}

function bindVdpRpuPassFramebuffer(backend: WebGLBackend, frame: VdpRpuFrameOutput, passIndex: number, framebuffer: WebGLFramebuffer, width: number, height: number): void {
	const gl = vdpRpuGl;
	const commands = frame.commands;
	const colorRef = commands.passColorSurfaceRef[passIndex];
	const depthRef = commands.passDepthSurfaceRef[passIndex];
	if (colorRef === VDP_RPU_REF_NONE && depthRef === VDP_RPU_REF_NONE) {
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		backend.setViewportRect(0, 0, width, height);
		vdpRpuColorDrawBuffers[0] = gl.COLOR_ATTACHMENT0;
		gl.drawBuffers(vdpRpuColorDrawBuffers);
		return;
	}
	const targetRef = colorRef !== VDP_RPU_REF_NONE ? colorRef : depthRef;
	ensureVdpRpuSurfaceStorage(backend, frame, targetRef);
	const targetSurfaceId = frame.resources.surfaceRefs.surfaceId[targetRef];
	const targetFramebuffer = vdpRpuSurfaceFramebuffer[targetSurfaceId]!;
	gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
	if (colorRef !== VDP_RPU_REF_NONE) {
		ensureVdpRpuSurfaceStorage(backend, frame, colorRef);
		const colorSurfaceId = frame.resources.surfaceRefs.surfaceId[colorRef];
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vdpRpuSurfaceTexture[colorSurfaceId], 0);
		vdpRpuColorDrawBuffers[0] = gl.COLOR_ATTACHMENT0;
		gl.drawBuffers(vdpRpuColorDrawBuffers);
	} else {
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
		vdpRpuNoColorDrawBuffers[0] = gl.NONE;
		gl.drawBuffers(vdpRpuNoColorDrawBuffers);
	}
	if (depthRef !== VDP_RPU_REF_NONE) {
		ensureVdpRpuSurfaceStorage(backend, frame, depthRef);
		const depthSurfaceId = frame.resources.surfaceRefs.surfaceId[depthRef];
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, vdpRpuSurfaceDepthBuffer[depthSurfaceId]);
	} else {
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
	}
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

function bindVdpRpuVertexStream(frame: VdpRpuFrameOutput, streamBindingIndex: number): void {
	const gl = vdpRpuGl;
	const commands = frame.commands;
	const refIndex = commands.streamBufferRef[streamBindingIndex];
	if (refIndex === VDP_RPU_REF_NONE) {
		return;
	}
	const layout = resolveVdpRpuStreamLayoutSpec(commands.streamLayoutId[streamBindingIndex]);
	ensureVdpRpuBufferStorage(
		frame,
		refIndex,
		gl.ARRAY_BUFFER,
		vdpRpuVertexBufferObject,
		vdpRpuVertexBufferRevision,
		vdpRpuVertexBufferByteOffset,
		vdpRpuVertexBufferByteLength,
	);
	const byteOffsetBase = commands.streamByteOffset[streamBindingIndex] - frame.resources.bufferRefs.sourceByteOffset[refIndex];
	for (let index = 0; index < layout.attributeCount; index += 1) {
		bindVdpRpuStreamAttribute(layout.attributes[index], layout.byteStride, byteOffsetBase, 0);
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

function bindVdpRpuInstanceStream(frame: VdpRpuFrameOutput, streamBindingIndex: number): void {
	const gl = vdpRpuGl;
	const commands = frame.commands;
	const refIndex = commands.streamBufferRef[streamBindingIndex];
	const stepRate = commands.streamStepRate[streamBindingIndex];
	if (refIndex === VDP_RPU_REF_NONE) {
		return;
	}
	const layout = resolveVdpRpuStreamLayoutSpec(commands.streamLayoutId[streamBindingIndex]);
	ensureVdpRpuBufferStorage(
		frame,
		refIndex,
		gl.ARRAY_BUFFER,
		vdpRpuInstanceBufferObject,
		vdpRpuInstanceBufferRevision,
		vdpRpuInstanceBufferByteOffset,
		vdpRpuInstanceBufferByteLength,
	);
	const byteOffsetBase = commands.streamByteOffset[streamBindingIndex] - frame.resources.bufferRefs.sourceByteOffset[refIndex];
	for (let index = 0; index < layout.attributeCount; index += 1) {
		bindVdpRpuStreamAttribute(layout.attributes[index], layout.byteStride, byteOffsetBase, stepRate);
	}
}

function bindVdpRpuMorphStream(frame: VdpRpuFrameOutput, streamBindingIndex: number): void {
	const gl = vdpRpuGl;
	const commands = frame.commands;
	const refIndex = commands.streamBufferRef[streamBindingIndex];
	if (refIndex === VDP_RPU_REF_NONE) {
		return;
	}
	const layout = resolveVdpRpuStreamLayoutSpec(commands.streamLayoutId[streamBindingIndex]);
	ensureVdpRpuBufferStorage(
		frame,
		refIndex,
		gl.ARRAY_BUFFER,
		vdpRpuMorphBufferObject,
		vdpRpuMorphBufferRevision,
		vdpRpuMorphBufferByteOffset,
		vdpRpuMorphBufferByteLength,
	);
	const byteOffsetBase = commands.streamByteOffset[streamBindingIndex] - frame.resources.bufferRefs.sourceByteOffset[refIndex];
	for (let index = 0; index < layout.attributeCount; index += 1) {
		bindVdpRpuStreamAttribute(layout.attributes[index], layout.byteStride, byteOffsetBase, 0);
	}
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
		bindVdpRpuVertexStream(frame, vertexBinding);
	}
	if (instanceMode !== VDP_RPU_INSTANCE_MODE_NONE && instanceBinding >= 0) {
		bindVdpRpuInstanceStream(frame, instanceBinding);
	}
	if (morphBinding >= 0) {
		bindVdpRpuMorphStream(frame, morphBinding);
	}
}

function setVdpRpuC0Constants(frame: VdpRpuFrameOutput, drawIndex: number, normalMode: number): void {
	const gl = vdpRpuGl;
	const commands = frame.commands;
	const bindingEnd = commands.drawFirstConstantBinding[drawIndex] + commands.drawConstantBindingCount[drawIndex];
	for (let bindingIndex = commands.drawFirstConstantBinding[drawIndex]; bindingIndex < bindingEnd; bindingIndex += 1) {
		if (commands.constantBindingSlot[bindingIndex] === 0) {
			const constantBank = commands.constantBank[bindingIndex];
			if (constantBank === VDP_RPU_REF_NONE) {
				gl.uniformMatrix4fv(vdpRpuC0Location, false, vdpRpuIdentityC0);
				if (normalMode !== 0) {
					gl.uniformMatrix3fv(vdpRpuNmLocation, false, vdpRpuIdentityNm);
				}
				return;
			}
			const firstWord = frame.resources.constantBanks.firstWord[constantBank] + commands.constantFirstWord[bindingIndex];
			const constantWords = frame.resources.constantWords;
			for (let index = 0; index < 16; index += 1) {
				vdpRpuC0Words[index] = constantWords[firstWord + index];
			}
			gl.uniformMatrix4fv(vdpRpuC0Location, false, vdpRpuC0Floats);
			if (normalMode !== 0) {
				for (let index = 0; index < 9; index += 1) {
					vdpRpuNmWords[index] = constantWords[firstWord + 16 + index];
				}
				gl.uniformMatrix3fv(vdpRpuNmLocation, false, vdpRpuNmFloats);
			}
			return;
		}
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
	const commands = frame.commands;
	const bindingEnd = commands.drawFirstConstantBinding[drawIndex] + commands.drawConstantBindingCount[drawIndex];
	for (let bindingIndex = commands.drawFirstConstantBinding[drawIndex]; bindingIndex < bindingEnd; bindingIndex += 1) {
		if (commands.constantBindingSlot[bindingIndex] === constantSlot) {
			const constantBank = commands.constantBank[bindingIndex];
			if (constantBank === VDP_RPU_REF_NONE) {
				gl.uniform4fv(vdpRpuC1Location, vdpRpuDefaultC1Floats);
				return;
			}
			const firstWord = frame.resources.constantBanks.firstWord[constantBank] + commands.constantFirstWord[bindingIndex];
			const constantWords = frame.resources.constantWords;
			for (let index = 0; index < 68; index += 1) {
				vdpRpuC1Words[index] = constantWords[firstWord + index];
			}
			gl.uniform4fv(vdpRpuC1Location, vdpRpuC1Floats);
			return;
		}
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
	const commands = frame.commands;
	const bindingEnd = commands.drawFirstConstantBinding[drawIndex] + commands.drawConstantBindingCount[drawIndex];
	for (let bindingIndex = commands.drawFirstConstantBinding[drawIndex]; bindingIndex < bindingEnd; bindingIndex += 1) {
		if (commands.constantBindingSlot[bindingIndex] === constantSlot) {
			const constantBank = commands.constantBank[bindingIndex];
			if (constantBank === VDP_RPU_REF_NONE) {
				gl.uniformMatrix4fv(vdpRpuJointLocation, false, vdpRpuDefaultJointFloats);
				return;
			}
			const firstWord = frame.resources.constantBanks.firstWord[constantBank] + commands.constantFirstWord[bindingIndex];
			const constantWords = frame.resources.constantWords;
			for (let index = 0; index < 384; index += 1) {
				vdpRpuJointWords[index] = constantWords[firstWord + index];
			}
			gl.uniformMatrix4fv(vdpRpuJointLocation, false, vdpRpuJointFloats);
			return;
		}
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
			const surfaceRef = commands.textureSurfaceRef[bindingIndex];
			if (surfaceRef === VDP_RPU_REF_NONE) {
				bindVdpRpuNeutralTexture(backend);
				gl.uniform1i(vdpRpuT0Location, 0);
			} else {
				const surfaceId = frame.resources.surfaceRefs.surfaceId[surfaceRef];
				backend.setActiveTexture(0);
				if (surfaceId < VDP_RD_SURFACE_COUNT) {
					backend.bindTexture2D(runtime.context.vdpSlotTextures.readSurfaceTextureHandle(surfaceId) as WebGLTexture);
					gl.uniform1i(vdpRpuTextureFlipYLocation, 0);
				} else {
					ensureVdpRpuSurfaceStorage(backend, frame, surfaceRef);
					backend.invalidateTextureBindingCache();
					gl.bindTexture(gl.TEXTURE_2D, vdpRpuSurfaceTexture[surfaceId]);
					gl.uniform1i(vdpRpuTextureFlipYLocation, 1);
				}
				gl.uniform1i(vdpRpuT0Location, 0);
			}
		} else if (slot === 1 && t1Flag && !foundT1) {
			foundT1 = true;
			const surfaceRef = commands.textureSurfaceRef[bindingIndex];
			if (surfaceRef !== VDP_RPU_REF_NONE) {
				const surfaceId = frame.resources.surfaceRefs.surfaceId[surfaceRef];
				backend.setActiveTexture(1);
				if (surfaceId < VDP_RD_SURFACE_COUNT) {
					backend.bindTexture2D(runtime.context.vdpSlotTextures.readSurfaceTextureHandle(surfaceId) as WebGLTexture);
				} else {
					ensureVdpRpuSurfaceStorage(backend, frame, surfaceRef);
					backend.invalidateTextureBindingCache();
					gl.bindTexture(gl.TEXTURE_2D, vdpRpuSurfaceTexture[surfaceId]);
				}
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
	const indexRef = commands.drawIndexBufferRef[drawIndex];
	if (indexType === VDP_RPU_INDEX_NONE || indexRef === VDP_RPU_REF_NONE) {
		if (instanceMode !== VDP_RPU_INSTANCE_MODE_NONE) {
			gl.drawArraysInstanced(primitive, 0, vertexCount, instanceCount);
			return;
		}
		gl.drawArrays(primitive, 0, vertexCount);
		return;
	}
	ensureVdpRpuBufferStorage(
		frame,
		indexRef,
		gl.ELEMENT_ARRAY_BUFFER,
		vdpRpuIndexBufferObject,
		vdpRpuIndexBufferRevision,
		vdpRpuIndexBufferByteOffset,
		vdpRpuIndexBufferByteLength,
	);
	const indexByteOffset = commands.drawIndexByteOffset[drawIndex] - frame.resources.bufferRefs.sourceByteOffset[indexRef];
	if (instanceMode !== VDP_RPU_INSTANCE_MODE_NONE) {
		gl.drawElementsInstanced(primitive, indexCount, vdpRpuIndexType(indexType), indexByteOffset, instanceCount);
		return;
	}
	gl.drawElements(primitive, indexCount, vdpRpuIndexType(indexType), indexByteOffset);
}

export function initVdpRpuPipeline(backend: WebGLBackend): void {
	const gl = backend.gl;
	vdpRpuVertexArray = backend.createVertexArray() as WebGLVertexArrayObject;
	vdpRpuNeutralTexture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, vdpRpuNeutralTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, vdpRpuNeutralTexturePixel);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
	for (let passIndex = 0; passIndex < commands.passCount; passIndex += 1) {
		bindVdpRpuPassFramebuffer(backend, frame, passIndex, framebuffer, state.width, state.height);
		const viewportXY = commands.passViewportXY[passIndex];
		const viewportWH = commands.passViewportWH[passIndex];
		backend.setViewportRect(
			viewportXY & 0xffff,
			viewportXY >>> 16,
			viewportWH & 0xffff,
			viewportWH >>> 16,
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
		const firstBatch = commands.passFirstBatch[passIndex];
		const batchEnd = firstBatch + commands.passBatchCount[passIndex];
		for (let batchIndex = firstBatch; batchIndex < batchEnd; batchIndex += 1) {
			drawVdpRpuCommand(
				runtime,
				frame,
				commands.batchFirstDraw[batchIndex],
				commands.batchVertexCount[batchIndex],
				commands.batchInstanceCount[batchIndex],
				commands.batchIndexCount[batchIndex],
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
		shouldExecute: () => view.vdpRpuFrame.commands.passCount !== 0,
		exec: (backend, fbo) => {
			vdpRpuRuntimeScratch.backend = backend as WebGLBackend;
			vdpRpuRuntimeScratch.context = view;
			vdpRpuPipelineStateScratch.width = view.offscreenCanvasSize.x;
			vdpRpuPipelineStateScratch.height = view.offscreenCanvasSize.y;
			vdpRpuPipelineStateScratch.frame = view.vdpRpuFrame;
			renderVdpRpuFrame(vdpRpuRuntimeScratch, fbo as WebGLFramebuffer, vdpRpuPipelineStateScratch);
		},
	});
}
