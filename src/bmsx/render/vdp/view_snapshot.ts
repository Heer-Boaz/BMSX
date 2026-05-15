import type { GameView } from '../gameview';
import type { VdpDeviceOutput } from '../../machine/devices/vdp/device_output';
import { decodeSignedQ16_16 } from '../../machine/devices/vdp/fixed_point';
import {
	VDP_LPU_AMBIENT_REGISTER_BASE,
	VDP_LPU_CONTROL_ENABLE,
	VDP_LPU_DIRECTIONAL_LIGHT_LIMIT,
	VDP_LPU_DIRECTIONAL_REGISTER_BASE,
	VDP_LPU_DIRECTIONAL_REGISTER_WORDS,
	VDP_LPU_POINT_LIGHT_LIMIT,
	VDP_LPU_POINT_REGISTER_BASE,
	VDP_LPU_POINT_REGISTER_WORDS,
} from '../../machine/devices/vdp/lpu';
import { resolveVdpTransformSnapshot } from './transform';

function commitVdpLightingSnapshot(view: GameView, words: ArrayLike<number>): void {
	view.vdpLightRegisterWords.set(words);
	const ambientBase = VDP_LPU_AMBIENT_REGISTER_BASE;
	const ambient = view.vdpAmbientLightColorIntensity;
	if ((words[ambientBase] & VDP_LPU_CONTROL_ENABLE) !== 0) {
		ambient[0] = decodeSignedQ16_16(words[ambientBase + 1] >>> 0);
		ambient[1] = decodeSignedQ16_16(words[ambientBase + 2] >>> 0);
		ambient[2] = decodeSignedQ16_16(words[ambientBase + 3] >>> 0);
		ambient[3] = decodeSignedQ16_16(words[ambientBase + 4] >>> 0);
	} else {
		ambient[0] = 0;
		ambient[1] = 0;
		ambient[2] = 0;
		ambient[3] = 0;
	}

	let dirCount = 0;
	const dirDirections = view.vdpDirectionalLightDirections;
	const dirColors = view.vdpDirectionalLightColors;
	const dirIntensities = view.vdpDirectionalLightIntensities;
	for (let light = 0; light < VDP_LPU_DIRECTIONAL_LIGHT_LIMIT; light += 1) {
		const base = VDP_LPU_DIRECTIONAL_REGISTER_BASE + light * VDP_LPU_DIRECTIONAL_REGISTER_WORDS;
		if ((words[base] & VDP_LPU_CONTROL_ENABLE) === 0) {
			continue;
		}
		const out = dirCount * 3;
		dirDirections[out] = decodeSignedQ16_16(words[base + 1] >>> 0);
		dirDirections[out + 1] = decodeSignedQ16_16(words[base + 2] >>> 0);
		dirDirections[out + 2] = decodeSignedQ16_16(words[base + 3] >>> 0);
		dirColors[out] = decodeSignedQ16_16(words[base + 4] >>> 0);
		dirColors[out + 1] = decodeSignedQ16_16(words[base + 5] >>> 0);
		dirColors[out + 2] = decodeSignedQ16_16(words[base + 6] >>> 0);
		dirIntensities[dirCount] = decodeSignedQ16_16(words[base + 7] >>> 0);
		dirCount += 1;
	}
	view.vdpDirectionalLightCount = dirCount;

	let pointCount = 0;
	const pointPositions = view.vdpPointLightPositions;
	const pointColors = view.vdpPointLightColors;
	const pointParams = view.vdpPointLightParams;
	for (let light = 0; light < VDP_LPU_POINT_LIGHT_LIMIT; light += 1) {
		const base = VDP_LPU_POINT_REGISTER_BASE + light * VDP_LPU_POINT_REGISTER_WORDS;
		if ((words[base] & VDP_LPU_CONTROL_ENABLE) === 0) {
			continue;
		}
		const out = pointCount * 3;
		const paramOut = pointCount * 2;
		pointPositions[out] = decodeSignedQ16_16(words[base + 1] >>> 0);
		pointPositions[out + 1] = decodeSignedQ16_16(words[base + 2] >>> 0);
		pointPositions[out + 2] = decodeSignedQ16_16(words[base + 3] >>> 0);
		pointParams[paramOut] = decodeSignedQ16_16(words[base + 4] >>> 0);
		pointColors[out] = decodeSignedQ16_16(words[base + 5] >>> 0);
		pointColors[out + 1] = decodeSignedQ16_16(words[base + 6] >>> 0);
		pointColors[out + 2] = decodeSignedQ16_16(words[base + 7] >>> 0);
		pointParams[paramOut + 1] = decodeSignedQ16_16(words[base + 8] >>> 0);
		pointCount += 1;
	}
	view.vdpPointLightCount = pointCount;
}

export function commitVdpViewSnapshot(view: GameView, output: VdpDeviceOutput): void {
	view.dither_type = output.ditherType;
	resolveVdpTransformSnapshot(view.vdpTransform, output.xfMatrixWords, output.xfViewMatrixIndex, output.xfProjectionMatrixIndex);
	view.vdpXfMatrixWords.set(output.xfMatrixWords);
	if (!output.skyboxEnabled) {
		view.skyboxRenderReady = false;
	} else {
		const faceUvRects = view.skyboxFaceUvRects;
		const faceTextpageBindings = view.skyboxFaceTextpageBindings;
		const faceSurfaceIds = view.skyboxFaceSurfaceIds;
		const faceSizes = view.skyboxFaceSizes;
		for (let index = 0; index < output.skyboxSamples.length; index += 1) {
			const sample = output.skyboxSamples[index]!;
			const uvBase = index * 4;
			faceUvRects[uvBase + 0] = sample.source.srcX / sample.surfaceWidth;
			faceUvRects[uvBase + 1] = sample.source.srcY / sample.surfaceHeight;
			faceUvRects[uvBase + 2] = sample.source.width / sample.surfaceWidth;
			faceUvRects[uvBase + 3] = sample.source.height / sample.surfaceHeight;
			faceTextpageBindings[index] = sample.slot;
			faceSurfaceIds[index] = sample.source.surfaceId;
			const sizeBase = index * 2;
			faceSizes[sizeBase + 0] = sample.source.width;
			faceSizes[sizeBase + 1] = sample.source.height;
		}
		view.skyboxRenderReady = true;
	}
	const billboards = output.billboards;
	view.vdpBillboardCount = billboards.length;
	const positionSize = view.vdpBillboardPositionSize;
	const colors = view.vdpBillboardColor;
	const uvRect = view.vdpBillboardUvRect;
	const slot = view.vdpBillboardSlot;
	const surfaceId = view.vdpBillboardSurfaceId;
	for (let index = 0; index < billboards.length; index += 1) {
		const base = index * 4;
		const color = billboards.color[index];
		positionSize[base + 0] = billboards.positionX[index];
		positionSize[base + 1] = billboards.positionY[index];
		positionSize[base + 2] = billboards.positionZ[index];
		positionSize[base + 3] = billboards.size[index];
		colors[index] = color;
		uvRect[base + 0] = billboards.sourceSrcX[index] / billboards.surfaceWidth[index];
		uvRect[base + 1] = billboards.sourceSrcY[index] / billboards.surfaceHeight[index];
		uvRect[base + 2] = (billboards.sourceSrcX[index] + billboards.sourceWidth[index]) / billboards.surfaceWidth[index];
		uvRect[base + 3] = (billboards.sourceSrcY[index] + billboards.sourceHeight[index]) / billboards.surfaceHeight[index];
		slot[index] = billboards.slot[index];
		surfaceId[index] = billboards.sourceSurfaceId[index];
	}
	const meshes = output.meshes;
	view.vdpMeshCount = meshes.length;
	const meshModelTokenLo = view.vdpMeshModelTokenLo;
	const meshModelTokenHi = view.vdpMeshModelTokenHi;
	const meshIndex = view.vdpMeshIndex;
	const meshMaterialIndex = view.vdpMeshMaterialIndex;
	const meshModelMatrixIndex = view.vdpMeshModelMatrixIndex;
	const meshControl = view.vdpMeshControl;
	const meshColor = view.vdpMeshColor;
	const meshMorphBase = view.vdpMeshMorphBase;
	const meshMorphCount = view.vdpMeshMorphCount;
	const meshJointBase = view.vdpMeshJointBase;
	const meshJointCount = view.vdpMeshJointCount;
	for (let index = 0; index < meshes.length; index += 1) {
		meshModelTokenLo[index] = meshes.modelTokenLo[index];
		meshModelTokenHi[index] = meshes.modelTokenHi[index];
		meshIndex[index] = meshes.meshIndex[index];
		meshMaterialIndex[index] = meshes.materialIndex[index];
		meshModelMatrixIndex[index] = meshes.modelMatrixIndex[index];
		meshControl[index] = meshes.control[index];
		meshColor[index] = meshes.color[index];
		meshMorphBase[index] = meshes.morphBase[index];
		meshMorphCount[index] = meshes.morphCount[index];
		meshJointBase[index] = meshes.jointBase[index];
		meshJointCount[index] = meshes.jointCount[index];
	}
	view.vdpMorphWeightWords.set(output.morphWeightWords);
	view.vdpJointMatrixWords.set(output.jointMatrixWords);
	commitVdpLightingSnapshot(view, output.lightRegisterWords);
}
