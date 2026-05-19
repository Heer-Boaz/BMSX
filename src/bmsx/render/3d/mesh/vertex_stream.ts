import {
	VDP_JTU_MATRIX_COUNT,
	VDP_JTU_MATRIX_WORDS,
	VDP_MDU_MORPH_WEIGHT_LIMIT,
	VDP_MDU_VERTEX_LIMIT,
} from '../../../machine/devices/vdp/contracts';
import { decodeSignedQ16_16WordsInto } from '../../../machine/devices/vdp/fixed_point';
import {
	VDP_MESH_ALPHA_BLEND,
	VDP_MESH_ALPHA_MASK,
	type VdpMeshSourceMaterial,
	type VdpMeshSourceMesh,
} from '../../../machine/devices/vdp/mesh_source';
import { VDP_XF_MATRIX_WORDS } from '../../../machine/devices/vdp/xf';
import type { GameView } from '../../gameview';
import { M4 } from '../math';

export const MESH_SURFACE_OPAQUE = 0;
export const MESH_SURFACE_MASK = 1;
export const MESH_SURFACE_BLEND = 2;
export const MESH_VERTEX_FLOATS = 12;
export const MESH_POSITION_FLOAT_OFFSET = 0;
export const MESH_NORMAL_FLOAT_OFFSET = 3;
export const MESH_UV_FLOAT_OFFSET = 6;
export const MESH_COLOR_FLOAT_OFFSET = 8;

export interface ResolvedMeshMaterial {
	color0: number;
	color1: number;
	color2: number;
	color3: number;
	surface: number;
	alphaCutoff: number;
	metallicFactor: number;
	roughnessFactor: number;
	emissive0: number;
	emissive1: number;
	emissive2: number;
	doubleSided: boolean;
	unlit: boolean;
}

export class MeshVertexStreamBuilder {
	readonly vertices = new Float32Array(VDP_MDU_VERTEX_LIMIT * MESH_VERTEX_FLOATS);
	readonly modelMatrix = new Float32Array(16);
	readonly normalMatrix = new Float32Array(9);
	readonly material: ResolvedMeshMaterial = {
		color0: 1,
		color1: 1,
		color2: 1,
		color3: 1,
		surface: MESH_SURFACE_OPAQUE,
		alphaCutoff: 0.5,
		metallicFactor: 1,
		roughnessFactor: 1,
		emissive0: 0,
		emissive1: 0,
		emissive2: 0,
		doubleSided: false,
		unlit: false,
	};
	vertexCount = 0;

	private readonly jointMatrices = new Float32Array(VDP_JTU_MATRIX_COUNT * VDP_JTU_MATRIX_WORDS);
	private readonly morphWeights = new Float32Array(VDP_MDU_MORPH_WEIGHT_LIMIT);

	build(view: GameView, mesh: VdpMeshSourceMesh, sourceMaterial: VdpMeshSourceMaterial, entryIndex: number): void {
		const modelMatrixIndex = view.vdpMeshModelMatrixIndex[entryIndex];
		decodeSignedQ16_16WordsInto(this.modelMatrix, 0, view.vdpXfMatrixWords, modelMatrixIndex * VDP_XF_MATRIX_WORDS, VDP_XF_MATRIX_WORDS);
		M4.normal3Into(this.normalMatrix, this.modelMatrix);
		this.resolveMeshMaterial(sourceMaterial, view.vdpMeshColor[entryIndex]);
		const sourceVertexCount = mesh.hasIndices ? mesh.indices.length : mesh.positions.length / 3;
		const vertexCount = sourceVertexCount > VDP_MDU_VERTEX_LIMIT ? VDP_MDU_VERTEX_LIMIT : sourceVertexCount;
		const morphCount = this.meshMorphTargetCount(mesh, view.vdpMeshMorphCount[entryIndex]);
		decodeSignedQ16_16WordsInto(this.morphWeights, 0, view.vdpMorphWeightWords, view.vdpMeshMorphBase[entryIndex], morphCount);
		const jointCount = view.vdpMeshJointCount[entryIndex];
		const skinningEnabled = this.meshHasSkinningSource(mesh, jointCount);
		if (skinningEnabled) {
			const jointBase = view.vdpMeshJointBase[entryIndex];
			const words = view.vdpJointMatrixWords;
			for (let jointIndex = 0; jointIndex < jointCount; jointIndex += 1) {
				decodeSignedQ16_16WordsInto(this.jointMatrices, jointIndex * VDP_JTU_MATRIX_WORDS, words, (jointBase + jointIndex) * VDP_JTU_MATRIX_WORDS, VDP_JTU_MATRIX_WORDS);
			}
		}
		this.vertexCount = vertexCount;
		if (mesh.hasIndices) {
			const indices = mesh.indices;
			for (let index = 0; index < vertexCount; index += 1) {
				this.writeMeshVertex(mesh, indices[index], index * MESH_VERTEX_FLOATS, morphCount, skinningEnabled, jointCount);
			}
		} else {
			for (let index = 0; index < vertexCount; index += 1) {
				this.writeMeshVertex(mesh, index, index * MESH_VERTEX_FLOATS, morphCount, skinningEnabled, jointCount);
			}
		}
	}

	private meshSurfaceMode(alphaMode: number): number {
		switch (alphaMode) {
			case VDP_MESH_ALPHA_MASK: return MESH_SURFACE_MASK;
			case VDP_MESH_ALPHA_BLEND: return MESH_SURFACE_BLEND;
		}
		return MESH_SURFACE_OPAQUE;
	}

	private writePacketColor(color: number): void {
		const target = this.material;
		target.color0 = ((color >>> 16) & 0xff) / 255;
		target.color1 = ((color >>> 8) & 0xff) / 255;
		target.color2 = (color & 0xff) / 255;
		target.color3 = ((color >>> 24) & 0xff) / 255;
	}

	private resolveMeshMaterial(source: VdpMeshSourceMaterial, colorWord: number): void {
		const target = this.material;
		this.writePacketColor(colorWord);
		target.color0 *= source.baseColor0;
		target.color1 *= source.baseColor1;
		target.color2 *= source.baseColor2;
		target.color3 *= source.baseColor3;
		target.surface = this.meshSurfaceMode(source.alphaMode);
		target.alphaCutoff = source.alphaCutoff;
		target.metallicFactor = source.metallicFactor;
		target.roughnessFactor = source.roughnessFactor;
		target.emissive0 = source.emissive0;
		target.emissive1 = source.emissive1;
		target.emissive2 = source.emissive2;
		target.doubleSided = source.doubleSided;
		target.unlit = source.unlit;
	}

	private writeMeshVertex(mesh: VdpMeshSourceMesh,
		vertexIndex: number,
		outputBase: number,
		morphCount: number,
		skinningEnabled: boolean,
		jointCount: number): void {
		const positionBase = vertexIndex * 3;
		let x = mesh.positions[positionBase];
		let y = mesh.positions[positionBase + 1];
		let z = mesh.positions[positionBase + 2];
		let nx = 0;
		let ny = 0;
		let nz = 1;
		const normals = mesh.normals;
		if (positionBase + 2 < normals.length) {
			nx = normals[positionBase];
			ny = normals[positionBase + 1];
			nz = normals[positionBase + 2];
		}
		const morphPositions = mesh.morphPositions;
		const morphNormals = mesh.morphNormals;
		for (let morphIndex = 0; morphIndex < morphCount; morphIndex += 1) {
			const morph = morphPositions[morphIndex];
			const weight = this.morphWeights[morphIndex];
			x += morph[positionBase] * weight;
			y += morph[positionBase + 1] * weight;
			z += morph[positionBase + 2] * weight;
			if (morphIndex < morphNormals.length) {
				const morphNormal = morphNormals[morphIndex];
				nx += morphNormal[positionBase] * weight;
				ny += morphNormal[positionBase + 1] * weight;
				nz += morphNormal[positionBase + 2] * weight;
			}
		}
		if (skinningEnabled) {
			let weightedX = 0;
			let weightedY = 0;
			let weightedZ = 0;
			let weightedNx = 0;
			let weightedNy = 0;
			let weightedNz = 0;
			const influenceBase = vertexIndex * 4;
			const jointIndices = mesh.jointIndices;
			const jointWeights = mesh.jointWeights;
			for (let influence = 0; influence < 4; influence += 1) {
				const joint = jointIndices[influenceBase + influence];
				const weight = jointWeights[influenceBase + influence];
				const scratchBase = outputBase;
				if (joint < jointCount) {
					const matrixBase = joint * VDP_JTU_MATRIX_WORDS;
					M4.transformAffinePoint3At(this.vertices, scratchBase, this.jointMatrices, matrixBase, x, y, z);
					M4.transformDir3At(this.vertices, scratchBase + 3, this.jointMatrices, matrixBase, nx, ny, nz);
				} else {
					this.vertices[scratchBase] = x;
					this.vertices[scratchBase + 1] = y;
					this.vertices[scratchBase + 2] = z;
					this.vertices[scratchBase + 3] = nx;
					this.vertices[scratchBase + 4] = ny;
					this.vertices[scratchBase + 5] = nz;
				}
				weightedX += this.vertices[scratchBase] * weight;
				weightedY += this.vertices[scratchBase + 1] * weight;
				weightedZ += this.vertices[scratchBase + 2] * weight;
				weightedNx += this.vertices[scratchBase + 3] * weight;
				weightedNy += this.vertices[scratchBase + 4] * weight;
				weightedNz += this.vertices[scratchBase + 5] * weight;
			}
			x = weightedX;
			y = weightedY;
			z = weightedZ;
			nx = weightedNx;
			ny = weightedNy;
			nz = weightedNz;
		}
		const uvBase = vertexIndex * 2;
		const texcoords = mesh.texcoords;
		const hasTexcoord = uvBase + 1 < texcoords.length;
		const colorBase = vertexIndex * 4;
		const colors = mesh.colors;
		const hasColor = colorBase + 3 < colors.length;
		const vertices = this.vertices;
		const material = this.material;
		vertices[outputBase] = x;
		vertices[outputBase + 1] = y;
		vertices[outputBase + 2] = z;
		vertices[outputBase + 3] = nx;
		vertices[outputBase + 4] = ny;
		vertices[outputBase + 5] = nz;
		vertices[outputBase + 6] = hasTexcoord ? texcoords[uvBase] : 0;
		vertices[outputBase + 7] = hasTexcoord ? texcoords[uvBase + 1] : 0;
		vertices[outputBase + 8] = hasColor ? colors[colorBase] * material.color0 : material.color0;
		vertices[outputBase + 9] = hasColor ? colors[colorBase + 1] * material.color1 : material.color1;
		vertices[outputBase + 10] = hasColor ? colors[colorBase + 2] * material.color2 : material.color2;
		vertices[outputBase + 11] = hasColor ? colors[colorBase + 3] * material.color3 : material.color3;
	}

	private meshMorphTargetCount(mesh: VdpMeshSourceMesh, packetMorphCount: number): number {
		const morphPositions = mesh.morphPositions;
		return packetMorphCount < morphPositions.length ? packetMorphCount : morphPositions.length;
	}

	private meshHasSkinningSource(mesh: VdpMeshSourceMesh, jointCount: number): boolean {
		const influenceCount = (mesh.positions.length / 3) * 4;
		return jointCount !== 0 && mesh.jointIndices.length >= influenceCount && mesh.jointWeights.length >= influenceCount;
	}
}
