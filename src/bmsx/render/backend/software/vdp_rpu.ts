import { VDP_RD_SURFACE_COUNT } from '../../../machine/devices/vdp/contracts';
import {
	VDP_RPU_ATTR_COLOR,
	VDP_RPU_ATTR_F32,
	VDP_RPU_ATTR_INSTANCE0,
	VDP_RPU_ATTR_INSTANCE1,
	VDP_RPU_ATTR_INSTANCE2,
	VDP_RPU_ATTR_INSTANCE3,
	VDP_RPU_ATTR_INSTANCE_COLOR,
	VDP_RPU_ATTR_INSTANCE_UVRECT,
	VDP_RPU_ATTR_JOINTS,
	VDP_RPU_ATTR_NORMAL,
	VDP_RPU_ATTR_POS,
	VDP_RPU_ATTR_U8,
	VDP_RPU_ATTR_U8N,
	VDP_RPU_ATTR_UV0,
	VDP_RPU_ATTR_WEIGHTS,
	VDP_RPU_BLEND_ADD,
	VDP_RPU_BLEND_ALPHA,
	VDP_RPU_BLEND_NONE,
	VDP_RPU_DEPTH_LESS,
	VDP_RPU_DEPTH_NONE,
	VDP_RPU_FILTER_LINEAR,
	VDP_RPU_INDEX_NONE,
	VDP_RPU_INDEX_U16,
	VDP_RPU_INSTANCE_MODE_AFFINE2,
	VDP_RPU_INSTANCE_MODE_MAT4,
	VDP_RPU_INSTANCE_MODE_NONE,
	VDP_RPU_PASS_COLOR_CLEAR,
	VDP_RPU_PASS_DEPTH_CLEAR,
	VDP_RPU_PIPE_BLEND_MASK,
	VDP_RPU_PIPE_COLOR_WRITE_MASK,
	VDP_RPU_PIPE_DEPTH_MASK,
	VDP_RPU_PIPE_DEPTH_WRITE,
	VDP_RPU_PRIM_LINES,
	VDP_RPU_PRIM_POINTS,
	VDP_RPU_PRIM_TRIANGLE_STRIP,
	VDP_RPU_REF_NONE,
	VDP_RPU_RESOURCE_NONE,
	VDP_RPU_SAMPLER_MAG_FILTER_MASK,
	VDP_RPU_SURFACE_CAPACITY,
	VDP_RPU_SURFACE_FORMAT_DEPTH16,
	resolveVdpRpuShaderVariantSpec,
	resolveVdpRpuStreamLayoutSpec,
	type VdpRpuFrameOutput,
	type VdpRpuShaderVariantSpec,
	type VdpRpuStreamLayoutSpec,
} from '../../../machine/devices/vdp/rpu';
import type { GameView } from '../../gameview';
import type { VdpSlotTexturePixels } from '../../vdp/slot_textures';

const SOFTWARE_RPU_DEFAULT_CLEAR_DEPTH = 1.0;
const SOFTWARE_RPU_POINT_SIZE = 3;
const softwareRpuSurfacePixels: (Uint8Array | null)[] = [];
const softwareRpuSurfaceDepth: (Float64Array | null)[] = [];
const softwareRpuSurfaceRevision = new Uint32Array(VDP_RPU_SURFACE_CAPACITY);
const softwareRpuSurfaceWidth = new Uint32Array(VDP_RPU_SURFACE_CAPACITY);
const softwareRpuSurfaceHeight = new Uint32Array(VDP_RPU_SURFACE_CAPACITY);
const softwareRpuSurfaceFormat = new Uint8Array(VDP_RPU_SURFACE_CAPACITY);
const softwareRpuFloatWord = new Uint32Array(1);
const softwareRpuFloatValue = new Float32Array(softwareRpuFloatWord.buffer);
let softwareRpuDefaultDepth = new Float64Array(256 * 212);
let softwareRpuDefaultDepthWidth = 256;
let softwareRpuDefaultDepthHeight = 212;

const vertexX = new Float64Array(4);
const vertexY = new Float64Array(4);
const vertexZ = new Float64Array(4);
const vertexU = new Float64Array(4);
const vertexV = new Float64Array(4);
const vertexR = new Float64Array(4);
const vertexG = new Float64Array(4);
const vertexB = new Float64Array(4);
const vertexA = new Float64Array(4);
const vertexNx = new Float64Array(4);
const vertexNy = new Float64Array(4);
const vertexNz = new Float64Array(4);
const attr = new Float64Array(24);
const attrJoint = new Uint8Array(4);

for (let index = 0; index < VDP_RPU_SURFACE_CAPACITY; index += 1) {
	softwareRpuSurfacePixels[index] = null;
	softwareRpuSurfaceDepth[index] = null;
}

function readU16(bytes: Uint8Array, offset: number): number {
	return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
	return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function readF32(bytes: Uint8Array, offset: number): number {
	softwareRpuFloatWord[0] = readU32(bytes, offset);
	return softwareRpuFloatValue[0];
}

function wordAsF32(word: number): number {
	softwareRpuFloatWord[0] = word >>> 0;
	return softwareRpuFloatValue[0];
}

function rasterFloor(value: number): number {
	const truncated = value | 0;
	return value < truncated ? truncated - 1 : truncated;
}

function rasterCeil(value: number): number {
	const truncated = value | 0;
	return value > truncated ? truncated + 1 : truncated;
}

function rasterRound(value: number): number {
	return value >= 0 ? ((value + 0.5) | 0) : ((value - 0.5) | 0);
}

function clampByte(value: number): number {
	if (value <= 0) return 0;
	if (value >= 255) return 255;
	return value | 0;
}

function floatByte(value: number): number {
	return clampByte(value * 255 + 0.5);
}

function colorByteR(color: number): number { return (color >>> 16) & 0xff; }
function colorByteG(color: number): number { return (color >>> 8) & 0xff; }
function colorByteB(color: number): number { return color & 0xff; }
function colorByteA(color: number): number { return (color >>> 24) & 0xff; }

function prepareDefaultDepth(width: number, height: number): Float64Array {
	if (softwareRpuDefaultDepthWidth !== width || softwareRpuDefaultDepthHeight !== height || softwareRpuDefaultDepth.length !== width * height) {
		softwareRpuDefaultDepthWidth = width;
		softwareRpuDefaultDepthHeight = height;
		softwareRpuDefaultDepth = new Float64Array(width * height);
		return softwareRpuDefaultDepth;
	}
	return softwareRpuDefaultDepth;
}

function syncSurfaceStorage(frame: VdpRpuFrameOutput, surfaceRef: number): void {
	const refs = frame.resources.surfaceRefs;
	const surfaceId = refs.surfaceId[surfaceRef];
	const revision = refs.revision[surfaceRef];
	const width = refs.width[surfaceRef];
	const height = refs.height[surfaceRef];
	const format = refs.format[surfaceRef];
	if (softwareRpuSurfaceRevision[surfaceId] === revision
		&& softwareRpuSurfaceWidth[surfaceId] === width
		&& softwareRpuSurfaceHeight[surfaceId] === height
		&& softwareRpuSurfaceFormat[surfaceId] === format) {
		return;
	}
	softwareRpuSurfaceRevision[surfaceId] = revision;
	softwareRpuSurfaceWidth[surfaceId] = width;
	softwareRpuSurfaceHeight[surfaceId] = height;
	softwareRpuSurfaceFormat[surfaceId] = format;
	if (format === VDP_RPU_SURFACE_FORMAT_DEPTH16) {
		softwareRpuSurfaceDepth[surfaceId] = new Float64Array(width * height);
		softwareRpuSurfacePixels[surfaceId] = null;
		return;
	}
	softwareRpuSurfacePixels[surfaceId] = new Uint8Array(width * height * 4);
	softwareRpuSurfaceDepth[surfaceId] = null;
}

function fillColorTarget(pixels: Uint8Array, color: number): void {
	const r = colorByteR(color);
	const g = colorByteG(color);
	const b = colorByteB(color);
	const a = colorByteA(color);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels[offset] = r;
		pixels[offset + 1] = g;
		pixels[offset + 2] = b;
		pixels[offset + 3] = a;
	}
}

function passColorTarget(view: GameView, frame: VdpRpuFrameOutput, passIndex: number, defaultPixels: Uint8Array, defaultWidth: number, defaultHeight: number): { pixels: Uint8Array; width: number; height: number } {
	const colorRef = frame.commands.passColorSurfaceRef[passIndex];
	if (colorRef === VDP_RPU_REF_NONE) {
		return { pixels: defaultPixels, width: defaultWidth, height: defaultHeight };
	}
	syncSurfaceStorage(frame, colorRef);
	const surfaceId = frame.resources.surfaceRefs.surfaceId[colorRef];
	const pixels = softwareRpuSurfacePixels[surfaceId] as Uint8Array;
	return { pixels, width: frame.resources.surfaceRefs.width[colorRef], height: frame.resources.surfaceRefs.height[colorRef] };
}

function passDepthTarget(frame: VdpRpuFrameOutput, passIndex: number, defaultDepth: Float64Array, defaultWidth: number, defaultHeight: number): { depth: Float64Array; width: number; height: number } {
	const depthRef = frame.commands.passDepthSurfaceRef[passIndex];
	if (depthRef === VDP_RPU_REF_NONE) {
		return { depth: defaultDepth, width: defaultWidth, height: defaultHeight };
	}
	syncSurfaceStorage(frame, depthRef);
	const surfaceId = frame.resources.surfaceRefs.surfaceId[depthRef];
	return { depth: softwareRpuSurfaceDepth[surfaceId] as Float64Array, width: frame.resources.surfaceRefs.width[depthRef], height: frame.resources.surfaceRefs.height[depthRef] };
}

function readAttribute(frame: VdpRpuFrameOutput, bindingIndex: number, elementIndex: number, attributeId: number): void {
	const commands = frame.commands;
	const layout = resolveVdpRpuStreamLayoutSpec(commands.streamLayoutId[bindingIndex]);
	const refIndex = commands.streamBufferRef[bindingIndex];
	const refs = frame.resources.bufferRefs;
	const bytes = refs.bytes[refIndex]!;
	const elementOffset = refs.byteOffset[refIndex] + elementIndex * layout.byteStride;
	attr[0] = 0; attr[1] = 0; attr[2] = 0; attr[3] = 1;
	attrJoint[0] = 0; attrJoint[1] = 0; attrJoint[2] = 0; attrJoint[3] = 0;
	for (let index = 0; index < layout.attributeCount; index += 1) {
		const spec = layout.attributes[index];
		if (spec.attribute !== attributeId) {
			continue;
		}
		const offset = elementOffset + spec.byteOffset;
		if (spec.componentType === VDP_RPU_ATTR_F32) {
			for (let component = 0; component < spec.componentCount; component += 1) {
				attr[component] = readF32(bytes, offset + component * 4);
			}
			return;
		}
		if (spec.componentType === VDP_RPU_ATTR_U8N) {
			for (let component = 0; component < spec.componentCount; component += 1) {
				attr[component] = bytes[offset + component]! * (1 / 255);
			}
			return;
		}
		if (spec.componentType === VDP_RPU_ATTR_U8) {
			for (let component = 0; component < spec.componentCount; component += 1) {
				attr[component] = bytes[offset + component]!;
			}
			attrJoint[0] = bytes[offset]!;
			attrJoint[1] = bytes[offset + 1]!;
			attrJoint[2] = bytes[offset + 2]!;
			attrJoint[3] = bytes[offset + 3]!;
			return;
		}
	}
}

function streamBinding(frame: VdpRpuFrameOutput, drawIndex: number, streamSlot: number): number {
	const commands = frame.commands;
	const bindingEnd = commands.drawFirstStreamBinding[drawIndex] + commands.drawStreamBindingCount[drawIndex];
	for (let bindingIndex = commands.drawFirstStreamBinding[drawIndex]; bindingIndex < bindingEnd; bindingIndex += 1) {
		if (commands.streamSlot[bindingIndex] === streamSlot) {
			return bindingIndex;
		}
	}
	return -1;
}

function findConstantBinding(frame: VdpRpuFrameOutput, drawIndex: number, slot: number): number {
	const commands = frame.commands;
	const bindingEnd = commands.drawFirstConstantBinding[drawIndex] + commands.drawConstantBindingCount[drawIndex];
	for (let bindingIndex = commands.drawFirstConstantBinding[drawIndex]; bindingIndex < bindingEnd; bindingIndex += 1) {
		if (commands.constantBindingSlot[bindingIndex] === slot) {
			return bindingIndex;
		}
	}
	return -1;
}

function constantWord(frame: VdpRpuFrameOutput, bindingIndex: number, wordIndex: number): number {
	const commands = frame.commands;
	const bank = commands.constantBank[bindingIndex];
	if (bank === VDP_RPU_REF_NONE) {
		return 0;
	}
	return frame.resources.constantWords[frame.resources.constantBanks.firstWord[bank] + commands.constantFirstWord[bindingIndex] + wordIndex];
}

function constantF32(frame: VdpRpuFrameOutput, bindingIndex: number, wordIndex: number): number {
	return wordAsF32(constantWord(frame, bindingIndex, wordIndex));
}

function matrixValue(frame: VdpRpuFrameOutput, bindingIndex: number, row: number, column: number): number {
	return constantF32(frame, bindingIndex, column * 4 + row);
}

function transformMatrix(frame: VdpRpuFrameOutput, bindingIndex: number, x: number, y: number, z: number): void {
	const tx = matrixValue(frame, bindingIndex, 0, 0) * x + matrixValue(frame, bindingIndex, 0, 1) * y + matrixValue(frame, bindingIndex, 0, 2) * z + matrixValue(frame, bindingIndex, 0, 3);
	const ty = matrixValue(frame, bindingIndex, 1, 0) * x + matrixValue(frame, bindingIndex, 1, 1) * y + matrixValue(frame, bindingIndex, 1, 2) * z + matrixValue(frame, bindingIndex, 1, 3);
	const tz = matrixValue(frame, bindingIndex, 2, 0) * x + matrixValue(frame, bindingIndex, 2, 1) * y + matrixValue(frame, bindingIndex, 2, 2) * z + matrixValue(frame, bindingIndex, 2, 3);
	const tw = matrixValue(frame, bindingIndex, 3, 0) * x + matrixValue(frame, bindingIndex, 3, 1) * y + matrixValue(frame, bindingIndex, 3, 2) * z + matrixValue(frame, bindingIndex, 3, 3);
	attr[0] = tx;
	attr[1] = ty;
	attr[2] = tz;
	attr[3] = tw;
}

function applySkin(frame: VdpRpuFrameOutput, bindingIndex: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
	let px = 0;
	let py = 0;
	let pz = 0;
	let pw = 0;
	let snx = 0;
	let sny = 0;
	let snz = 0;
	for (let joint = 0; joint < 4; joint += 1) {
		const weight = attr[16 + joint];
		const base = attrJoint[joint] * 16;
		px += (constantF32(frame, bindingIndex, base + 0) * x + constantF32(frame, bindingIndex, base + 4) * y + constantF32(frame, bindingIndex, base + 8) * z + constantF32(frame, bindingIndex, base + 12)) * weight;
		py += (constantF32(frame, bindingIndex, base + 1) * x + constantF32(frame, bindingIndex, base + 5) * y + constantF32(frame, bindingIndex, base + 9) * z + constantF32(frame, bindingIndex, base + 13)) * weight;
		pz += (constantF32(frame, bindingIndex, base + 2) * x + constantF32(frame, bindingIndex, base + 6) * y + constantF32(frame, bindingIndex, base + 10) * z + constantF32(frame, bindingIndex, base + 14)) * weight;
		pw += (constantF32(frame, bindingIndex, base + 3) * x + constantF32(frame, bindingIndex, base + 7) * y + constantF32(frame, bindingIndex, base + 11) * z + constantF32(frame, bindingIndex, base + 15)) * weight;
		snx += (constantF32(frame, bindingIndex, base + 0) * nx + constantF32(frame, bindingIndex, base + 4) * ny + constantF32(frame, bindingIndex, base + 8) * nz) * weight;
		sny += (constantF32(frame, bindingIndex, base + 1) * nx + constantF32(frame, bindingIndex, base + 5) * ny + constantF32(frame, bindingIndex, base + 9) * nz) * weight;
		snz += (constantF32(frame, bindingIndex, base + 2) * nx + constantF32(frame, bindingIndex, base + 6) * ny + constantF32(frame, bindingIndex, base + 10) * nz) * weight;
	}
	attr[0] = px;
	attr[1] = py;
	attr[2] = pz;
	attr[3] = pw;
	attr[4] = snx;
	attr[5] = sny;
	attr[6] = snz;
}

function writeVertex(frame: VdpRpuFrameOutput, drawIndex: number, shaderVariant: VdpRpuShaderVariantSpec, vertexIndex: number, instanceIndex: number, outIndex: number, width: number, height: number): void {
	const vertexBinding = streamBinding(frame, drawIndex, 0);
	const instanceBinding = streamBinding(frame, drawIndex, 1);
	let px = 0;
	let py = 0;
	let pz = 0;
	let pw = 1;
	let u = 0;
	let v = 0;
	let r = 1;
	let g = 1;
	let b = 1;
	let a = 1;
	let nx = 0;
	let ny = 0;
	let nz = 1;
	if (vertexBinding >= 0) {
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_POS);
		px = attr[0];
		py = attr[1];
		pz = attr[2];
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_UV0);
		u = attr[0];
		v = attr[1];
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_COLOR);
		r = attr[0];
		g = attr[1];
		b = attr[2];
		a = attr[3];
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_NORMAL);
		nx = attr[0];
		ny = attr[1];
		nz = attr[2];
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_JOINTS);
		const j0 = attrJoint[0];
		const j1 = attrJoint[1];
		const j2 = attrJoint[2];
		const j3 = attrJoint[3];
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_WEIGHTS);
		attr[16] = attr[0];
		attr[17] = attr[1];
		attr[18] = attr[2];
		attr[19] = attr[3];
		attrJoint[0] = j0;
		attrJoint[1] = j1;
		attrJoint[2] = j2;
		attrJoint[3] = j3;
	}
	if (shaderVariant.jointConstantSlot !== VDP_RPU_RESOURCE_NONE) {
		const jointBinding = findConstantBinding(frame, drawIndex, shaderVariant.jointConstantSlot);
		if (jointBinding >= 0) {
			applySkin(frame, jointBinding, px, py, pz, nx, ny, nz);
			px = attr[0];
			py = attr[1];
			pz = attr[2];
			pw = attr[3];
			nx = attr[4];
			ny = attr[5];
			nz = attr[6];
		}
	}
	if (shaderVariant.instanceMode === VDP_RPU_INSTANCE_MODE_AFFINE2 && instanceBinding >= 0) {
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE0);
		const i0x = attr[0];
		const i0y = attr[1];
		const i0z = attr[2];
		const i0w = attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE1);
		const i1x = attr[0];
		const i1y = attr[1];
		const i1z = attr[2];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE_UVRECT);
		const uvx = attr[0];
		const uvy = attr[1];
		const uvz = attr[2];
		const uvw = attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE_COLOR);
		const cr = attr[0];
		const cg = attr[1];
		const cb = attr[2];
		const ca = attr[3];
		const oldX = px;
		const oldY = py;
		px = i0x * oldX + i0y * oldY + i0z;
		py = i1x * oldX + i1y * oldY + i1z;
		pz = i0w;
		pw = 1;
		u = uvx + u * uvz;
		v = uvy + v * uvw;
		r *= cr;
		g *= cg;
		b *= cb;
		a *= ca;
	} else if (shaderVariant.instanceMode === VDP_RPU_INSTANCE_MODE_MAT4 && instanceBinding >= 0) {
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE0);
		const m00 = attr[0]; const m10 = attr[1]; const m20 = attr[2]; const m30 = attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE1);
		const m01 = attr[0]; const m11 = attr[1]; const m21 = attr[2]; const m31 = attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE2);
		const m02 = attr[0]; const m12 = attr[1]; const m22 = attr[2]; const m32 = attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE3);
		const m03 = attr[0]; const m13 = attr[1]; const m23 = attr[2]; const m33 = attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE_COLOR);
		const cr = attr[0]; const cg = attr[1]; const cb = attr[2]; const ca = attr[3];
		const oldX = px; const oldY = py; const oldZ = pz; const oldW = pw;
		px = m00 * oldX + m01 * oldY + m02 * oldZ + m03 * oldW;
		py = m10 * oldX + m11 * oldY + m12 * oldZ + m13 * oldW;
		pz = m20 * oldX + m21 * oldY + m22 * oldZ + m23 * oldW;
		pw = m30 * oldX + m31 * oldY + m32 * oldZ + m33 * oldW;
		r *= cr;
		g *= cg;
		b *= cb;
		a *= ca;
	}
	if (shaderVariant.usesC0 !== 0) {
		const c0Binding = findConstantBinding(frame, drawIndex, 0);
		if (c0Binding >= 0) {
			transformMatrix(frame, c0Binding, px, py, pz);
			px = attr[0];
			py = attr[1];
			pz = attr[2];
			pw = attr[3];
		}
	}
	if (shaderVariant.lightingConstantSlot !== VDP_RPU_RESOURCE_NONE) {
		const c1Binding = findConstantBinding(frame, drawIndex, shaderVariant.lightingConstantSlot);
		if (c1Binding >= 0) {
			const lx = constantF32(frame, c1Binding, 0);
			const ly = constantF32(frame, c1Binding, 1);
			const lz = constantF32(frame, c1Binding, 2);
			const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
			const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
			let ndl = (nx / nl) * (lx / ll) + (ny / nl) * (ly / ll) + (nz / nl) * (lz / ll);
			if (ndl < 0) ndl = 0;
			r *= constantF32(frame, c1Binding, 4) + constantF32(frame, c1Binding, 8) * ndl;
			g *= constantF32(frame, c1Binding, 5) + constantF32(frame, c1Binding, 9) * ndl;
			b *= constantF32(frame, c1Binding, 6) + constantF32(frame, c1Binding, 10) * ndl;
			a *= constantF32(frame, c1Binding, 7) + constantF32(frame, c1Binding, 11) * ndl;
		}
	}
	const invW = 1 / pw;
	const ndcX = px * invW;
	const ndcY = py * invW;
	const ndcZ = pz * invW;
	vertexX[outIndex] = (ndcX * 0.5 + 0.5) * width;
	vertexY[outIndex] = (0.5 - ndcY * 0.5) * height;
	vertexZ[outIndex] = ndcZ * 0.5 + 0.5;
	vertexU[outIndex] = u;
	vertexV[outIndex] = v;
	vertexR[outIndex] = r;
	vertexG[outIndex] = g;
	vertexB[outIndex] = b;
	vertexA[outIndex] = a;
	vertexNx[outIndex] = nx;
	vertexNy[outIndex] = ny;
	vertexNz[outIndex] = nz;
}

function readIndex(frame: VdpRpuFrameOutput, drawIndex: number, index: number): number {
	const commands = frame.commands;
	const refIndex = commands.drawIndexBufferRef[drawIndex];
	const refs = frame.resources.bufferRefs;
	const bytes = refs.bytes[refIndex]!;
	const offset = refs.byteOffset[refIndex] + index * (commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_U16 ? 2 : 4);
	return commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_U16 ? readU16(bytes, offset) : readU32(bytes, offset);
}

function textureBinding(frame: VdpRpuFrameOutput, drawIndex: number): number {
	const commands = frame.commands;
	const bindingEnd = commands.drawFirstTextureBinding[drawIndex] + commands.drawTextureBindingCount[drawIndex];
	for (let bindingIndex = commands.drawFirstTextureBinding[drawIndex]; bindingIndex < bindingEnd; bindingIndex += 1) {
		if (commands.textureSlot[bindingIndex] === 0) {
			return bindingIndex;
		}
	}
	return -1;
}

function sampleTexture(view: GameView, frame: VdpRpuFrameOutput, bindingIndex: number, u: number, v: number): void {
	if (bindingIndex < 0) {
		attr[0] = 0;
		attr[1] = 0;
		attr[2] = 0;
		attr[3] = 0;
		return;
	}
	const commands = frame.commands;
	const surfaceRef = commands.textureSurfaceRef[bindingIndex];
	if (surfaceRef === VDP_RPU_REF_NONE) {
		attr[0] = 0;
		attr[1] = 0;
		attr[2] = 0;
		attr[3] = 0;
		return;
	}
	const surfaceId = frame.resources.surfaceRefs.surfaceId[surfaceRef];
	let pixels: Uint8Array;
	let width: number;
	let height: number;
	if (surfaceId < VDP_RD_SURFACE_COUNT) {
		const slot: VdpSlotTexturePixels = view.vdpSlotTextures.readSurfaceTexturePixels(surfaceId);
		pixels = slot.pixels;
		width = slot.width;
		height = slot.height;
	} else {
		syncSurfaceStorage(frame, surfaceRef);
		pixels = softwareRpuSurfacePixels[surfaceId] as Uint8Array;
		width = softwareRpuSurfaceWidth[surfaceId];
		height = softwareRpuSurfaceHeight[surfaceId];
	}
	let sx = (u * width) | 0;
	let sy = (v * height) | 0;
	if (sx < 0) sx = 0;
	if (sy < 0) sy = 0;
	if (sx >= width) sx = width - 1;
	if (sy >= height) sy = height - 1;
	const offset = (sy * width + sx) * 4;
	attr[0] = pixels[offset] * (1 / 255);
	attr[1] = pixels[offset + 1] * (1 / 255);
	attr[2] = pixels[offset + 2] * (1 / 255);
	attr[3] = pixels[offset + 3] * (1 / 255);
}

function writePixel(pixels: Uint8Array, depth: Float64Array, width: number, height: number, x: number, y: number, z: number, pipelineWord: number, r: number, g: number, b: number, a: number): void {
	if (x < 0 || y < 0 || x >= width || y >= height) return;
	const pixelIndex = y * width + x;
	const depthMode = (pipelineWord & VDP_RPU_PIPE_DEPTH_MASK) >>> 4;
	if (depthMode !== VDP_RPU_DEPTH_NONE) {
		const currentDepth = depth[pixelIndex];
		if (depthMode === VDP_RPU_DEPTH_LESS) {
			if (z >= currentDepth) return;
		} else if (z > currentDepth) {
			return;
		}
		if ((pipelineWord & VDP_RPU_PIPE_DEPTH_WRITE) !== 0) {
			depth[pixelIndex] = z;
		}
	}
	const colorMask = (pipelineWord & VDP_RPU_PIPE_COLOR_WRITE_MASK) >>> 16;
	if (colorMask === 0) return;
	const offset = pixelIndex * 4;
	const srcR = floatByte(r);
	const srcG = floatByte(g);
	const srcB = floatByte(b);
	const srcA = floatByte(a);
	const blend = pipelineWord & VDP_RPU_PIPE_BLEND_MASK;
	if (blend === VDP_RPU_BLEND_ALPHA) {
		const invA = 255 - srcA;
		if ((colorMask & 1) !== 0) pixels[offset] = clampByte((srcR * srcA + pixels[offset] * invA + 127) / 255);
		if ((colorMask & 2) !== 0) pixels[offset + 1] = clampByte((srcG * srcA + pixels[offset + 1] * invA + 127) / 255);
		if ((colorMask & 4) !== 0) pixels[offset + 2] = clampByte((srcB * srcA + pixels[offset + 2] * invA + 127) / 255);
		if ((colorMask & 8) !== 0) pixels[offset + 3] = clampByte(srcA + (pixels[offset + 3] * invA + 127) / 255);
		return;
	}
	if (blend === VDP_RPU_BLEND_ADD) {
		if ((colorMask & 1) !== 0) pixels[offset] = clampByte(pixels[offset] + (srcR * srcA + 127) / 255);
		if ((colorMask & 2) !== 0) pixels[offset + 1] = clampByte(pixels[offset + 1] + (srcG * srcA + 127) / 255);
		if ((colorMask & 4) !== 0) pixels[offset + 2] = clampByte(pixels[offset + 2] + (srcB * srcA + 127) / 255);
		if ((colorMask & 8) !== 0) pixels[offset + 3] = clampByte(pixels[offset + 3] + srcA);
		return;
	}
	if ((colorMask & 1) !== 0) pixels[offset] = srcR;
	if ((colorMask & 2) !== 0) pixels[offset + 1] = srcG;
	if ((colorMask & 4) !== 0) pixels[offset + 2] = srcB;
	if ((colorMask & 8) !== 0) pixels[offset + 3] = srcA;
}

function drawTriangle(view: GameView, frame: VdpRpuFrameOutput, drawIndex: number, pixels: Uint8Array, depth: Float64Array, width: number, height: number, texture: number): void {
	const x0 = vertexX[0]; const y0 = vertexY[0];
	const x1 = vertexX[1]; const y1 = vertexY[1];
	const x2 = vertexX[2]; const y2 = vertexY[2];
	const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
	if (area === 0) return;
	let minX = rasterFloor(x0 < x1 ? (x0 < x2 ? x0 : x2) : (x1 < x2 ? x1 : x2));
	let maxX = rasterCeil(x0 > x1 ? (x0 > x2 ? x0 : x2) : (x1 > x2 ? x1 : x2));
	let minY = rasterFloor(y0 < y1 ? (y0 < y2 ? y0 : y2) : (y1 < y2 ? y1 : y2));
	let maxY = rasterCeil(y0 > y1 ? (y0 > y2 ? y0 : y2) : (y1 > y2 ? y1 : y2));
	if (minX < 0) minX = 0;
	if (minY < 0) minY = 0;
	if (maxX > width) maxX = width;
	if (maxY > height) maxY = height;
	const invArea = 1 / area;
	const pipelineWord = frame.commands.drawPipelineWord[drawIndex];
	for (let y = minY; y < maxY; y += 1) {
		const py = y + 0.5;
		for (let x = minX; x < maxX; x += 1) {
			const px = x + 0.5;
			const w0 = ((x1 - px) * (y2 - py) - (y1 - py) * (x2 - px)) * invArea;
			const w1 = ((x2 - px) * (y0 - py) - (y2 - py) * (x0 - px)) * invArea;
			const w2 = 1 - w0 - w1;
			if (w0 < 0 || w1 < 0 || w2 < 0) continue;
			let r = vertexR[0] * w0 + vertexR[1] * w1 + vertexR[2] * w2;
			let g = vertexG[0] * w0 + vertexG[1] * w1 + vertexG[2] * w2;
			let b = vertexB[0] * w0 + vertexB[1] * w1 + vertexB[2] * w2;
			let a = vertexA[0] * w0 + vertexA[1] * w1 + vertexA[2] * w2;
			if (texture >= 0) {
				const u = vertexU[0] * w0 + vertexU[1] * w1 + vertexU[2] * w2;
				const v = vertexV[0] * w0 + vertexV[1] * w1 + vertexV[2] * w2;
				sampleTexture(view, frame, texture, u, v);
				r *= attr[0];
				g *= attr[1];
				b *= attr[2];
				a *= attr[3];
			}
			const z = vertexZ[0] * w0 + vertexZ[1] * w1 + vertexZ[2] * w2;
			writePixel(pixels, depth, width, height, x, y, z, pipelineWord, r, g, b, a);
		}
	}
}

function drawLine(frame: VdpRpuFrameOutput, drawIndex: number, pixels: Uint8Array, depth: Float64Array, width: number, height: number): void {
	let x0 = rasterRound(vertexX[0]);
	let y0 = rasterRound(vertexY[0]);
	const x1 = rasterRound(vertexX[1]);
	const y1 = rasterRound(vertexY[1]);
	const dx = x1 >= x0 ? x1 - x0 : x0 - x1;
	const dy = y1 >= y0 ? y1 - y0 : y0 - y1;
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx - dy;
	const pipelineWord = frame.commands.drawPipelineWord[drawIndex];
	while (true) {
		writePixel(pixels, depth, width, height, x0, y0, vertexZ[0], pipelineWord, vertexR[0], vertexG[0], vertexB[0], vertexA[0]);
		if (x0 === x1 && y0 === y1) return;
		const e2 = err << 1;
		if (e2 > -dy) {
			err -= dy;
			x0 += sx;
		}
		if (e2 < dx) {
			err += dx;
			y0 += sy;
		}
	}
}

function drawPoint(frame: VdpRpuFrameOutput, drawIndex: number, pixels: Uint8Array, depth: Float64Array, width: number, height: number): void {
	const cx = rasterRound(vertexX[0]);
	const cy = rasterRound(vertexY[0]);
	const half = SOFTWARE_RPU_POINT_SIZE >> 1;
	const pipelineWord = frame.commands.drawPipelineWord[drawIndex];
	for (let y = cy - half; y <= cy + half; y += 1) {
		for (let x = cx - half; x <= cx + half; x += 1) {
			writePixel(pixels, depth, width, height, x, y, vertexZ[0], pipelineWord, vertexR[0], vertexG[0], vertexB[0], vertexA[0]);
		}
	}
}

function drawCommand(view: GameView, frame: VdpRpuFrameOutput, drawIndex: number, pixels: Uint8Array, depth: Float64Array, width: number, height: number): void {
	const commands = frame.commands;
	const shaderVariant = resolveVdpRpuShaderVariantSpec(commands.drawShaderVariant[drawIndex]);
	const texture = shaderVariant.textureSlotCount === 0 ? -1 : textureBinding(frame, drawIndex);
	const primitive = commands.drawPrimitive[drawIndex];
	const instanceCount = shaderVariant.instanceMode === VDP_RPU_INSTANCE_MODE_NONE ? 1 : commands.drawInstanceCount[drawIndex];
	for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
		if (primitive === VDP_RPU_PRIM_LINES) {
			const count = commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_NONE ? commands.drawVertexCount[drawIndex] : commands.drawIndexCount[drawIndex];
			for (let vertex = 0; vertex + 1 < count; vertex += 2) {
				const v0 = commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_NONE ? vertex : readIndex(frame, drawIndex, vertex);
				const v1 = commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_NONE ? vertex + 1 : readIndex(frame, drawIndex, vertex + 1);
				writeVertex(frame, drawIndex, shaderVariant, v0, instanceIndex, 0, width, height);
				writeVertex(frame, drawIndex, shaderVariant, v1, instanceIndex, 1, width, height);
				drawLine(frame, drawIndex, pixels, depth, width, height);
			}
			continue;
		}
		if (primitive === VDP_RPU_PRIM_POINTS) {
			const count = commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_NONE ? commands.drawVertexCount[drawIndex] : commands.drawIndexCount[drawIndex];
			for (let vertex = 0; vertex < count; vertex += 1) {
				const v0 = commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_NONE ? vertex : readIndex(frame, drawIndex, vertex);
				writeVertex(frame, drawIndex, shaderVariant, v0, instanceIndex, 0, width, height);
				drawPoint(frame, drawIndex, pixels, depth, width, height);
			}
			continue;
		}
		const count = commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_NONE ? commands.drawVertexCount[drawIndex] : commands.drawIndexCount[drawIndex];
		const triangleStep = primitive === VDP_RPU_PRIM_TRIANGLE_STRIP ? 1 : 3;
		const triangleLimit = primitive === VDP_RPU_PRIM_TRIANGLE_STRIP ? count - 2 : count;
		for (let vertex = 0; vertex < triangleLimit; vertex += triangleStep) {
			const i0 = vertex;
			const i1 = primitive === VDP_RPU_PRIM_TRIANGLE_STRIP && (vertex & 1) !== 0 ? vertex + 2 : vertex + 1;
			const i2 = primitive === VDP_RPU_PRIM_TRIANGLE_STRIP && (vertex & 1) !== 0 ? vertex + 1 : vertex + 2;
			const v0 = commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_NONE ? i0 : readIndex(frame, drawIndex, i0);
			const v1 = commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_NONE ? i1 : readIndex(frame, drawIndex, i1);
			const v2 = commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_NONE ? i2 : readIndex(frame, drawIndex, i2);
			writeVertex(frame, drawIndex, shaderVariant, v0, instanceIndex, 0, width, height);
			writeVertex(frame, drawIndex, shaderVariant, v1, instanceIndex, 1, width, height);
			writeVertex(frame, drawIndex, shaderVariant, v2, instanceIndex, 2, width, height);
			drawTriangle(view, frame, drawIndex, pixels, depth, width, height, texture);
		}
	}
}

export function renderVdpRpuSoftwareFrame(view: GameView, frame: VdpRpuFrameOutput, defaultPixels: Uint8Array, defaultWidth: number, defaultHeight: number): void {
	let defaultDepth = prepareDefaultDepth(defaultWidth, defaultHeight);
	if (defaultDepth.length !== defaultWidth * defaultHeight) {
		defaultDepth = new Float64Array(defaultWidth * defaultHeight);
	}
	const commands = frame.commands;
	for (let passIndex = 0; passIndex < commands.passCount; passIndex += 1) {
		const colorTarget = passColorTarget(view, frame, passIndex, defaultPixels, defaultWidth, defaultHeight);
		const depthTarget = passDepthTarget(frame, passIndex, defaultDepth, colorTarget.width, colorTarget.height);
		const passOps = commands.passOps[passIndex];
		if ((passOps & VDP_RPU_PASS_COLOR_CLEAR) !== 0) {
			fillColorTarget(colorTarget.pixels, commands.passClearColor[passIndex]);
		}
		if ((passOps & VDP_RPU_PASS_DEPTH_CLEAR) !== 0) {
			depthTarget.depth.fill(commands.passClearDepthWord[passIndex] * (1 / 0xffffffff));
		} else if (passIndex === 0) {
			depthTarget.depth.fill(SOFTWARE_RPU_DEFAULT_CLEAR_DEPTH);
		}
		const firstDraw = commands.passFirstDraw[passIndex];
		const drawEnd = firstDraw + commands.passDrawCount[passIndex];
		for (let drawIndex = firstDraw; drawIndex < drawEnd; drawIndex += 1) {
			drawCommand(view, frame, drawIndex, colorTarget.pixels, depthTarget.depth, colorTarget.width, colorTarget.height);
		}
	}
}
