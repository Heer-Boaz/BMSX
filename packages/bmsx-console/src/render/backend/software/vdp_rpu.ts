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
	VDP_RPU_ATTR_MORPH_NRM,
	VDP_RPU_ATTR_MORPH_POS,
	VDP_RPU_ATTR_NORMAL,
	VDP_RPU_ATTR_POS,
	VDP_RPU_ATTR_U8,
	VDP_RPU_ATTR_U8N,
	VDP_RPU_ATTR_UV0,
	VDP_RPU_ATTR_WEIGHTS,
	VDP_RPU_BLEND_ADD,
	VDP_RPU_BLEND_ALPHA,
	VDP_RPU_DEPTH_LESS,
	VDP_RPU_DEPTH_NONE,
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
	VDP_RPU_RESOURCE_NONE,
	VDP_RPU_SHADER_FLAG_MORPH,
	VDP_RPU_SHADER_FLAG_T1,
	resolveVdpRpuShaderVariantSpec,
	resolveVdpRpuStreamLayoutSpec,
	type VdpRpuFrameOutput,
	type VdpRpuShaderVariantSpec,
} from '../../../machine/devices/vdp/rpu';
import {
	RPU_SURFACE_DESC_BASE_ADDR_OFFSET,
	RPU_SURFACE_DESC_HEIGHT_OFFSET,
	RPU_SURFACE_DESC_PITCH_BYTES_OFFSET,
	RPU_SURFACE_DESC_WIDTH_OFFSET,
	readRpuDescU16,
	readRpuDescU32,
} from '../../../machine/devices/vdp/rpu_desc';

const SOFTWARE_RPU_DEFAULT_CLEAR_DEPTH = 1.0;
const SOFTWARE_RPU_POINT_SIZE = 3;
type SoftwareRpuColorTarget = {
	pixels: Uint8Array;
	baseOffset: number;
	pitchBytes: number;
	width: number;
	height: number;
};
type SoftwareRpuTextureSource = {
	enabled: boolean;
	pixels: Uint8Array;
	baseOffset: number;
	pitchBytes: number;
	width: number;
	height: number;
};
type SoftwareRpuDepthSurface = {
	width: number;
	height: number;
	depth: Float64Array;
};
const softwareRpuDepthSurfaces = new Map<number, SoftwareRpuDepthSurface>();
const softwareRpuTexture0: SoftwareRpuTextureSource = { enabled: false, pixels: new Uint8Array(0), baseOffset: 0, pitchBytes: 0, width: 0, height: 0 };
const softwareRpuTexture1: SoftwareRpuTextureSource = { enabled: false, pixels: new Uint8Array(0), baseOffset: 0, pitchBytes: 0, width: 0, height: 0 };
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

function readF32(bytes: Uint8Array, offset: number): number {
	softwareRpuFloatWord[0] = readRpuDescU32(bytes, offset);
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

function fillColorTarget(target: SoftwareRpuColorTarget, color: number): void {
	const r = colorByteR(color);
	const g = colorByteG(color);
	const b = colorByteB(color);
	const a = colorByteA(color);
	for (let y = 0; y < target.height; y += 1) {
		let offset = target.baseOffset + y * target.pitchBytes;
		const end = offset + target.width * 4;
		for (; offset < end; offset += 4) {
			target.pixels[offset] = r;
			target.pixels[offset + 1] = g;
			target.pixels[offset + 2] = b;
			target.pixels[offset + 3] = a;
		}
	}
}

function passColorTarget(frame: VdpRpuFrameOutput, passIndex: number, defaultPixels: Uint8Array, defaultWidth: number, defaultHeight: number): SoftwareRpuColorTarget {
	const colorSurfaceDescAddr = frame.commands.passColorSurfaceDescAddr[passIndex];
	if (colorSurfaceDescAddr === 0) {
		return { pixels: defaultPixels, baseOffset: 0, pitchBytes: defaultWidth * 4, width: defaultWidth, height: defaultHeight };
	}
	const vram = frame.vdpVram;
	return {
		pixels: vram,
		baseOffset: readRpuDescU32(vram, colorSurfaceDescAddr + RPU_SURFACE_DESC_BASE_ADDR_OFFSET),
		pitchBytes: readRpuDescU16(vram, colorSurfaceDescAddr + RPU_SURFACE_DESC_PITCH_BYTES_OFFSET),
		width: readRpuDescU16(vram, colorSurfaceDescAddr + RPU_SURFACE_DESC_WIDTH_OFFSET),
		height: readRpuDescU16(vram, colorSurfaceDescAddr + RPU_SURFACE_DESC_HEIGHT_OFFSET),
	};
}

function passDepthTarget(frame: VdpRpuFrameOutput, passIndex: number, defaultDepth: Float64Array, defaultWidth: number, defaultHeight: number): { depth: Float64Array; width: number; height: number } {
	const depthSurfaceDescAddr = frame.commands.passDepthSurfaceDescAddr[passIndex];
	if (depthSurfaceDescAddr === 0) {
		return { depth: defaultDepth, width: defaultWidth, height: defaultHeight };
	}
	const vram = frame.vdpVram;
	const width = readRpuDescU16(vram, depthSurfaceDescAddr + RPU_SURFACE_DESC_WIDTH_OFFSET);
	const height = readRpuDescU16(vram, depthSurfaceDescAddr + RPU_SURFACE_DESC_HEIGHT_OFFSET);
	let surface = softwareRpuDepthSurfaces.get(depthSurfaceDescAddr);
	if (surface === undefined || surface.width !== width || surface.height !== height) {
		surface = { width, height, depth: new Float64Array(width * height) };
		softwareRpuDepthSurfaces.set(depthSurfaceDescAddr, surface);
	}
	return { depth: surface.depth, width, height };
}

function setDefaultAttribute(attributeId: number): void {
	attr[0] = 0; attr[1] = 0; attr[2] = 0; attr[3] = 1;
	switch (attributeId) {
		case VDP_RPU_ATTR_COLOR:
		case VDP_RPU_ATTR_INSTANCE_COLOR:
			attr[0] = 1; attr[1] = 1; attr[2] = 1;
			break;
		case VDP_RPU_ATTR_JOINTS:
			attr[3] = 0;
			attrJoint[0] = 0; attrJoint[1] = 0; attrJoint[2] = 0; attrJoint[3] = 0;
			break;
		case VDP_RPU_ATTR_NORMAL:
			attr[2] = 1;
			break;
		case VDP_RPU_ATTR_WEIGHTS:
			attr[0] = 1; attr[3] = 0;
			break;
		case VDP_RPU_ATTR_INSTANCE0:
			attr[0] = 1; attr[3] = 0;
			break;
		case VDP_RPU_ATTR_INSTANCE1:
			attr[1] = 1; attr[3] = 0;
			break;
		case VDP_RPU_ATTR_INSTANCE2:
			attr[2] = 1; attr[3] = 0;
			break;
		case VDP_RPU_ATTR_INSTANCE_UVRECT:
			attr[2] = 1;
			break;
	}
}

function readAttribute(frame: VdpRpuFrameOutput, bindingIndex: number, elementIndex: number, attributeId: number): void {
	const commands = frame.commands;
	const layout = resolveVdpRpuStreamLayoutSpec(commands.streamLayoutId[bindingIndex]);
	setDefaultAttribute(attributeId);
	const bytes = frame.vdpVram;
	const elementOffset = commands.streamVramAddr[bindingIndex] + elementIndex * layout.byteStride;
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

function findBindingSlot(slots: Uint8Array, firstBinding: number, bindingCount: number, slot: number): number {
	const bindingEnd = firstBinding + bindingCount;
	for (let bindingIndex = firstBinding; bindingIndex < bindingEnd; bindingIndex += 1) {
		if (slots[bindingIndex] === slot) {
			return bindingIndex;
		}
	}
	return -1;
}

function constantWord(frame: VdpRpuFrameOutput, bindingIndex: number, wordIndex: number): number {
	return readRpuDescU32(frame.vdpVram, frame.commands.constantVramAddr[bindingIndex] + wordIndex * 4);
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

function applyDefaultSkin(x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
	const weightSum = attr[16] + attr[17] + attr[18] + attr[19];
	attr[0] = x * weightSum;
	attr[1] = y * weightSum;
	attr[2] = z * weightSum;
	attr[3] = weightSum;
	attr[4] = nx * weightSum;
	attr[5] = ny * weightSum;
	attr[6] = nz * weightSum;
}

function writeVertex(frame: VdpRpuFrameOutput, drawIndex: number, shaderVariant: VdpRpuShaderVariantSpec, rawVariantWord: number, vertexIndex: number, instanceIndex: number, outIndex: number, width: number, height: number): void {
	const commands = frame.commands;
	const streamFirstBinding = commands.drawFirstStreamBinding[drawIndex];
	const streamBindingCount = commands.drawStreamBindingCount[drawIndex];
	const constantFirstBinding = commands.drawFirstConstantBinding[drawIndex];
	const constantBindingCount = commands.drawConstantBindingCount[drawIndex];
	const constantBindingSlot = commands.constantBindingSlot;
	const vertexBinding = findBindingSlot(commands.streamSlot, streamFirstBinding, streamBindingCount, 0);
	const instanceBinding = findBindingSlot(commands.streamSlot, streamFirstBinding, streamBindingCount, 1);
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
	attr[16] = 1;
	attr[17] = 0;
	attr[18] = 0;
	attr[19] = 0;
	attrJoint[0] = 0;
	attrJoint[1] = 0;
	attrJoint[2] = 0;
	attrJoint[3] = 0;
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
		readAttribute(frame, vertexBinding, vertexIndex, VDP_RPU_ATTR_WEIGHTS);
		attr[16] = attr[0];
		attr[17] = attr[1];
		attr[18] = attr[2];
		attr[19] = attr[3];
	}
	if ((rawVariantWord & VDP_RPU_SHADER_FLAG_MORPH) !== 0) {
		const morphBinding = findBindingSlot(commands.streamSlot, streamFirstBinding, streamBindingCount, 2);
		if (morphBinding >= 0) {
			readAttribute(frame, morphBinding, vertexIndex, VDP_RPU_ATTR_MORPH_POS);
			px += attr[0]; py += attr[1]; pz += attr[2];
			readAttribute(frame, morphBinding, vertexIndex, VDP_RPU_ATTR_MORPH_NRM);
			nx += attr[0]; ny += attr[1]; nz += attr[2];
		}
	}
	if (shaderVariant.jointConstantSlot !== VDP_RPU_RESOURCE_NONE) {
		const jointBinding = findBindingSlot(constantBindingSlot, constantFirstBinding, constantBindingCount, shaderVariant.jointConstantSlot);
		if (jointBinding < 0) {
			applyDefaultSkin(px, py, pz, nx, ny, nz);
		} else {
			applySkin(frame, jointBinding, px, py, pz, nx, ny, nz);
		}
		px = attr[0];
		py = attr[1];
		pz = attr[2];
		pw = attr[3];
		nx = attr[4];
		ny = attr[5];
		nz = attr[6];
	}
	let applyInstanceColor = false;
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
		const oldX = px;
		const oldY = py;
		px = i0x * oldX + i0y * oldY + i0z;
		py = i1x * oldX + i1y * oldY + i1z;
		pz = i0w;
		pw = 1;
		u = uvx + u * uvz;
		v = uvy + v * uvw;
		applyInstanceColor = true;
	} else if (shaderVariant.instanceMode === VDP_RPU_INSTANCE_MODE_MAT4 && instanceBinding >= 0) {
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE0);
		const m00 = attr[0]; const m10 = attr[1]; const m20 = attr[2]; const m30 = attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE1);
		const m01 = attr[0]; const m11 = attr[1]; const m21 = attr[2]; const m31 = attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE2);
		const m02 = attr[0]; const m12 = attr[1]; const m22 = attr[2]; const m32 = attr[3];
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE3);
		const m03 = attr[0]; const m13 = attr[1]; const m23 = attr[2]; const m33 = attr[3];
		const oldX = px; const oldY = py; const oldZ = pz; const oldW = pw;
		px = m00 * oldX + m01 * oldY + m02 * oldZ + m03 * oldW;
		py = m10 * oldX + m11 * oldY + m12 * oldZ + m13 * oldW;
		pz = m20 * oldX + m21 * oldY + m22 * oldZ + m23 * oldW;
		pw = m30 * oldX + m31 * oldY + m32 * oldZ + m33 * oldW;
		applyInstanceColor = true;
	}
	if (applyInstanceColor) {
		readAttribute(frame, instanceBinding, instanceIndex, VDP_RPU_ATTR_INSTANCE_COLOR);
		r *= attr[0];
		g *= attr[1];
		b *= attr[2];
		a *= attr[3];
	}
	// Save model-space position (pre-MVP) for point light attenuation
	const modelX = px; const modelY = py; const modelZ = pz;
	if (shaderVariant.usesC0 !== 0) {
		const c0Binding = findBindingSlot(constantBindingSlot, constantFirstBinding, constantBindingCount, 0);
		if (c0Binding >= 0) {
			transformMatrix(frame, c0Binding, px, py, pz);
			px = attr[0];
			py = attr[1];
			pz = attr[2];
			pw = attr[3];
		}
	}
	if (shaderVariant.lightingConstantSlot !== VDP_RPU_RESOURCE_NONE) {
		const c1Binding = findBindingSlot(constantBindingSlot, constantFirstBinding, constantBindingCount, shaderVariant.lightingConstantSlot);
		if (c1Binding >= 0) {
			// Apply normal matrix from C0 if available
			let lnx = nx; let lny = ny; let lnz = nz;
			const c0BindingNm = findBindingSlot(constantBindingSlot, constantFirstBinding, constantBindingCount, 0);
			if (c0BindingNm >= 0) {
				lnx = constantF32(frame, c0BindingNm, 16) * nx + constantF32(frame, c0BindingNm, 19) * ny + constantF32(frame, c0BindingNm, 22) * nz;
				lny = constantF32(frame, c0BindingNm, 17) * nx + constantF32(frame, c0BindingNm, 20) * ny + constantF32(frame, c0BindingNm, 23) * nz;
				lnz = constantF32(frame, c0BindingNm, 18) * nx + constantF32(frame, c0BindingNm, 21) * ny + constantF32(frame, c0BindingNm, 24) * nz;
			}
			const nl = Math.sqrt(lnx * lnx + lny * lny + lnz * lnz);
			const invNl = nl > 0.0 ? 1.0 / nl : 0.0;
			const fnx = lnx * invNl; const fny = lny * invNl; const fnz = lnz * invNl;
			// Ambient: words 0-3 (r,g,b,intensity)
			const ambR = constantF32(frame, c1Binding, 0);
			const ambG = constantF32(frame, c1Binding, 1);
			const ambB = constantF32(frame, c1Binding, 2);
			const ambI = constantF32(frame, c1Binding, 3);
			let totalR = ambR * ambI;
			let totalG = ambG * ambI;
			let totalB = ambB * ambI;
			// 4 directional lights: words 4-35 (each 8 words: dir.xyz+pad, color.rgb+intensity)
			for (let li = 0; li < 4; li += 1) {
				const base = 4 + li * 8;
				const dlx = constantF32(frame, c1Binding, base);
				const dly = constantF32(frame, c1Binding, base + 1);
				const dlz = constantF32(frame, c1Binding, base + 2);
				const dlr = constantF32(frame, c1Binding, base + 4);
				const dlg = constantF32(frame, c1Binding, base + 5);
				const dlb = constantF32(frame, c1Binding, base + 6);
				const dli = constantF32(frame, c1Binding, base + 7);
				if (dli <= 0) continue;
				const ll = Math.sqrt(dlx * dlx + dly * dly + dlz * dlz);
				if (ll <= 0) continue;
				const ndl = Math.max(0, fnx * (dlx / ll) + fny * (dly / ll) + fnz * (dlz / ll));
				totalR += dlr * dli * ndl;
				totalG += dlg * dli * ndl;
				totalB += dlb * dli * ndl;
			}
			// 4 point lights: words 36-67 (each 8 words: pos.xyz+range, color.rgb+intensity)
			for (let li = 0; li < 4; li += 1) {
				const base = 36 + li * 8;
				const plx = constantF32(frame, c1Binding, base);
				const ply = constantF32(frame, c1Binding, base + 1);
				const plz = constantF32(frame, c1Binding, base + 2);
				const plRange = constantF32(frame, c1Binding, base + 3);
				const plr = constantF32(frame, c1Binding, base + 4);
				const plg = constantF32(frame, c1Binding, base + 5);
				const plb = constantF32(frame, c1Binding, base + 6);
				const pli = constantF32(frame, c1Binding, base + 7);
				if (pli <= 0 || plRange <= 0) continue;
				const ddx = modelX - plx; const ddy = modelY - ply; const ddz = modelZ - plz;
				const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
				const atten = Math.max(0, 1.0 - dist / plRange);
				totalR += plr * pli * atten;
				totalG += plg * pli * atten;
				totalB += plb * pli * atten;
			}
			// Emissive: words 68-70; alpha cutoff: word 71
			const emR = constantF32(frame, c1Binding, 68);
			const emG = constantF32(frame, c1Binding, 69);
			const emB = constantF32(frame, c1Binding, 70);
			const alphaCutoff = constantF32(frame, c1Binding, 71);
			r = r * totalR + emR;
			g = g * totalG + emG;
			b = b * totalB + emB;
			if (a <= 0 || (alphaCutoff > 0 && a <= alphaCutoff)) a = 0;
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
	const indexType = commands.drawIndexType[drawIndex];
	const offset = commands.drawIndexVramAddr[drawIndex] + index * (indexType === VDP_RPU_INDEX_U16 ? 2 : 4);
	return indexType === VDP_RPU_INDEX_U16 ? readRpuDescU16(frame.vdpVram, offset) : readRpuDescU32(frame.vdpVram, offset);
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

function textureBinding1(frame: VdpRpuFrameOutput, drawIndex: number): number {
	const commands = frame.commands;
	const bindingEnd = commands.drawFirstTextureBinding[drawIndex] + commands.drawTextureBindingCount[drawIndex];
	for (let bindingIndex = commands.drawFirstTextureBinding[drawIndex]; bindingIndex < bindingEnd; bindingIndex += 1) {
		if (commands.textureSlot[bindingIndex] === 1) {
			return bindingIndex;
		}
	}
	return -1;
}

function resolveTextureSource(frame: VdpRpuFrameOutput, bindingIndex: number, source: SoftwareRpuTextureSource): void {
	if (bindingIndex < 0) {
		source.enabled = false;
		return;
	}
	const surfaceDescAddr = frame.commands.textureSurfaceDescAddr[bindingIndex];
	if (surfaceDescAddr === 0) {
		source.enabled = false;
		return;
	}
	const vram = frame.vdpVram;
	source.enabled = true;
	source.pixels = vram;
	source.baseOffset = readRpuDescU32(vram, surfaceDescAddr + RPU_SURFACE_DESC_BASE_ADDR_OFFSET);
	source.pitchBytes = readRpuDescU16(vram, surfaceDescAddr + RPU_SURFACE_DESC_PITCH_BYTES_OFFSET);
	source.width = readRpuDescU16(vram, surfaceDescAddr + RPU_SURFACE_DESC_WIDTH_OFFSET);
	source.height = readRpuDescU16(vram, surfaceDescAddr + RPU_SURFACE_DESC_HEIGHT_OFFSET);
}

function sampleTexture(source: SoftwareRpuTextureSource, u: number, v: number): void {
	if (!source.enabled) {
		attr[0] = 0;
		attr[1] = 0;
		attr[2] = 0;
		attr[3] = 0;
		return;
	}
	let sx = (u * source.width) | 0;
	let sy = (v * source.height) | 0;
	if (sx < 0) sx = 0;
	if (sy < 0) sy = 0;
	if (sx >= source.width) sx = source.width - 1;
	if (sy >= source.height) sy = source.height - 1;
	const offset = source.baseOffset + sy * source.pitchBytes + sx * 4;
	const pixels = source.pixels;
	attr[0] = pixels[offset] * (1 / 255);
	attr[1] = pixels[offset + 1] * (1 / 255);
	attr[2] = pixels[offset + 2] * (1 / 255);
	attr[3] = pixels[offset + 3] * (1 / 255);
}

function writePixel(target: SoftwareRpuColorTarget, depth: Float64Array, x: number, y: number, z: number, pipelineWord: number, r: number, g: number, b: number, a: number): void {
	if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
	const srcR = floatByte(r);
	const srcG = floatByte(g);
	const srcB = floatByte(b);
	const srcA = floatByte(a);
	if (srcA === 0) return;
	const pixelIndex = y * target.width + x;
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
	const pixels = target.pixels;
	const offset = target.baseOffset + y * target.pitchBytes + x * 4;
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

function drawTriangle(frame: VdpRpuFrameOutput, drawIndex: number, target: SoftwareRpuColorTarget, depth: Float64Array, texture: SoftwareRpuTextureSource, t1Texture: SoftwareRpuTextureSource): void {
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
	if (maxX > target.width) maxX = target.width;
	if (maxY > target.height) maxY = target.height;
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
			if (texture.enabled) {
				const u = vertexU[0] * w0 + vertexU[1] * w1 + vertexU[2] * w2;
				const v = vertexV[0] * w0 + vertexV[1] * w1 + vertexV[2] * w2;
				sampleTexture(texture, u, v);
				r *= attr[0];
				g *= attr[1];
				b *= attr[2];
				a *= attr[3];
			}
			if (t1Texture.enabled) {
				const u = vertexU[0] * w0 + vertexU[1] * w1 + vertexU[2] * w2;
				const v = vertexV[0] * w0 + vertexV[1] * w1 + vertexV[2] * w2;
				sampleTexture(t1Texture, u, v);
				r *= attr[0];
				g *= attr[1];
				b *= attr[2];
				a *= attr[3];
			}
			const z = vertexZ[0] * w0 + vertexZ[1] * w1 + vertexZ[2] * w2;
			writePixel(target, depth, x, y, z, pipelineWord, r, g, b, a);
		}
	}
}

function drawLine(frame: VdpRpuFrameOutput, drawIndex: number, target: SoftwareRpuColorTarget, depth: Float64Array): void {
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
		writePixel(target, depth, x0, y0, vertexZ[0], pipelineWord, vertexR[0], vertexG[0], vertexB[0], vertexA[0]);
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

function drawPoint(frame: VdpRpuFrameOutput, drawIndex: number, target: SoftwareRpuColorTarget, depth: Float64Array): void {
	const cx = rasterRound(vertexX[0]);
	const cy = rasterRound(vertexY[0]);
	const half = SOFTWARE_RPU_POINT_SIZE >> 1;
	const pipelineWord = frame.commands.drawPipelineWord[drawIndex];
	for (let y = cy - half; y <= cy + half; y += 1) {
		for (let x = cx - half; x <= cx + half; x += 1) {
			writePixel(target, depth, x, y, vertexZ[0], pipelineWord, vertexR[0], vertexG[0], vertexB[0], vertexA[0]);
		}
	}
}

function drawCommand(frame: VdpRpuFrameOutput, drawIndex: number, vertexCount: number, instanceCount: number, indexCount: number, target: SoftwareRpuColorTarget, depth: Float64Array): void {
	const commands = frame.commands;
	const rawVariantWord = commands.drawShaderVariant[drawIndex];
	const shaderVariant = resolveVdpRpuShaderVariantSpec(rawVariantWord);
	resolveTextureSource(frame, shaderVariant.textureSlotCount === 0 ? -1 : textureBinding(frame, drawIndex), softwareRpuTexture0);
	resolveTextureSource(frame, (rawVariantWord & VDP_RPU_SHADER_FLAG_T1) !== 0 ? textureBinding1(frame, drawIndex) : -1, softwareRpuTexture1);
	const primitive = commands.drawPrimitive[drawIndex];
	const drawnInstanceCount = shaderVariant.instanceMode === VDP_RPU_INSTANCE_MODE_NONE ? 1 : instanceCount;
	const drawIndexed = commands.drawIndexType[drawIndex] !== VDP_RPU_INDEX_NONE && commands.drawIndexVramAddr[drawIndex] !== 0;
	const elementCount = drawIndexed ? indexCount : vertexCount;
	for (let instanceIndex = 0; instanceIndex < drawnInstanceCount; instanceIndex += 1) {
		if (primitive === VDP_RPU_PRIM_LINES) {
			for (let vertex = 0; vertex + 1 < elementCount; vertex += 2) {
				let v0 = vertex;
				let v1 = vertex + 1;
				if (drawIndexed) {
					v0 = readIndex(frame, drawIndex, vertex);
					v1 = readIndex(frame, drawIndex, vertex + 1);
				}
				writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v0, instanceIndex, 0, target.width, target.height);
				writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v1, instanceIndex, 1, target.width, target.height);
				drawLine(frame, drawIndex, target, depth);
			}
			continue;
		}
		if (primitive === VDP_RPU_PRIM_POINTS) {
			for (let vertex = 0; vertex < elementCount; vertex += 1) {
				let v0 = vertex;
				if (drawIndexed) {
					v0 = readIndex(frame, drawIndex, vertex);
				}
				writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v0, instanceIndex, 0, target.width, target.height);
				drawPoint(frame, drawIndex, target, depth);
			}
			continue;
		}
		const triangleStep = primitive === VDP_RPU_PRIM_TRIANGLE_STRIP ? 1 : 3;
		const triangleLimit = primitive === VDP_RPU_PRIM_TRIANGLE_STRIP ? elementCount - 2 : elementCount;
		for (let vertex = 0; vertex < triangleLimit; vertex += triangleStep) {
			const i0 = vertex;
			const stripFlipped = primitive === VDP_RPU_PRIM_TRIANGLE_STRIP && (vertex & 1) !== 0;
			const i1 = stripFlipped ? vertex + 2 : vertex + 1;
			const i2 = stripFlipped ? vertex + 1 : vertex + 2;
			let v0 = i0;
			let v1 = i1;
			let v2 = i2;
			if (drawIndexed) {
				v0 = readIndex(frame, drawIndex, i0);
				v1 = readIndex(frame, drawIndex, i1);
				v2 = readIndex(frame, drawIndex, i2);
			}
			writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v0, instanceIndex, 0, target.width, target.height);
			writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v1, instanceIndex, 1, target.width, target.height);
			writeVertex(frame, drawIndex, shaderVariant, rawVariantWord, v2, instanceIndex, 2, target.width, target.height);
			drawTriangle(frame, drawIndex, target, depth, softwareRpuTexture0, softwareRpuTexture1);
		}
	}
}

export function renderVdpRpuSoftwareFrame(frame: VdpRpuFrameOutput, defaultPixels: Uint8Array, defaultWidth: number, defaultHeight: number): void {
	let defaultDepth = prepareDefaultDepth(defaultWidth, defaultHeight);
	if (defaultDepth.length !== defaultWidth * defaultHeight) {
		defaultDepth = new Float64Array(defaultWidth * defaultHeight);
	}
	const commands = frame.commands;
	for (let passIndex = 0; passIndex < commands.passCount; passIndex += 1) {
		const colorTarget = passColorTarget(frame, passIndex, defaultPixels, defaultWidth, defaultHeight);
		const depthTarget = passDepthTarget(frame, passIndex, defaultDepth, colorTarget.width, colorTarget.height);
		const passOps = commands.passOps[passIndex];
		if ((passOps & VDP_RPU_PASS_COLOR_CLEAR) !== 0) {
			fillColorTarget(colorTarget, commands.passClearColor[passIndex]);
		}
		if ((passOps & VDP_RPU_PASS_DEPTH_CLEAR) !== 0) {
			depthTarget.depth.fill(commands.passClearDepthWord[passIndex] * (1 / 0xffffffff));
		} else if (passIndex === 0) {
			depthTarget.depth.fill(SOFTWARE_RPU_DEFAULT_CLEAR_DEPTH);
		}
		const firstDraw = commands.passFirstDraw[passIndex];
		const drawEnd = firstDraw + commands.passDrawCount[passIndex];
		for (let drawIndex = firstDraw; drawIndex < drawEnd; drawIndex += 1) {
			drawCommand(
				frame,
				drawIndex,
				commands.drawVertexCount[drawIndex],
				commands.drawInstanceCount[drawIndex],
				commands.drawIndexCount[drawIndex],
				colorTarget,
				depthTarget.depth,
			);
		}
	}
}
