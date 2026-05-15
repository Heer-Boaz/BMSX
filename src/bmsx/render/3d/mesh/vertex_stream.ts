import {
	VDP_JTU_MATRIX_COUNT,
	VDP_JTU_MATRIX_WORDS,
	VDP_MDU_MATERIAL_MESH_DEFAULT,
	VDP_MDU_MORPH_WEIGHT_LIMIT,
	VDP_MDU_VERTEX_LIMIT,
} from '../../../machine/devices/vdp/contracts';
import { decodeSignedQ16_16 } from '../../../machine/devices/vdp/fixed_point';
import type { GLTFMaterial, GLTFMesh, GLTFModel } from '../../../rompack/format';
import type { GameView } from '../../gameview';
import { M4 } from '../math';

export const MESH_GLES2_SURFACE_OPAQUE = 0;
export const MESH_GLES2_SURFACE_MASK = 1;
export const MESH_GLES2_SURFACE_BLEND = 2;
export const MESH_VERTEX_FLOATS = 12;
export const MESH_VERTEX_BYTES = MESH_VERTEX_FLOATS * 4;
export const MESH_POSITION_OFFSET = 0;
export const MESH_NORMAL_OFFSET = 3 * 4;
export const MESH_UV_OFFSET = 6 * 4;
export const MESH_COLOR_OFFSET = 8 * 4;

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
		surface: MESH_GLES2_SURFACE_OPAQUE,
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

	build(view: GameView, model: GLTFModel, mesh: GLTFMesh, entryIndex: number): void {
		const modelMatrixIndex = view.vdpMeshModelMatrixIndex[entryIndex];
		this.decodeMatrixWordsInto(this.modelMatrix, view.vdpXfMatrixWords, modelMatrixIndex * 16);
		M4.normal3Into(this.normalMatrix, this.modelMatrix);
		this.resolveMeshMaterial(model, mesh, view.vdpMeshMaterialIndex[entryIndex], view.vdpMeshColor[entryIndex]);
		const vertexCount = mesh.indices ? mesh.indices.length : mesh.positions.length / 3;
		if (vertexCount > VDP_MDU_VERTEX_LIMIT) {
			throw new Error('[MeshPipeline] VDP mesh packet expands beyond the MDU vertex stream limit.');
		}
		const morphCount = this.meshMorphTargetCount(mesh, view.vdpMeshMorphCount[entryIndex]);
		this.decodeMorphWeights(view, view.vdpMeshMorphBase[entryIndex], morphCount);
		const jointCount = view.vdpMeshJointCount[entryIndex];
		const skinningEnabled = this.meshHasSkinningSource(mesh, jointCount);
		if (skinningEnabled) {
			this.decodeJointMatrices(view, view.vdpMeshJointBase[entryIndex], jointCount);
		}
		this.vertexCount = vertexCount;
		const indices = mesh.indices;
		if (indices) {
			for (let index = 0; index < vertexCount; index += 1) {
				this.writeMeshVertex(mesh, indices[index], index * MESH_VERTEX_FLOATS, morphCount, skinningEnabled, jointCount);
			}
		} else {
			for (let index = 0; index < vertexCount; index += 1) {
				this.writeMeshVertex(mesh, index, index * MESH_VERTEX_FLOATS, morphCount, skinningEnabled, jointCount);
			}
		}
	}

	private meshSurfaceMode(alphaMode: GLTFMaterial['alphaMode']): number {
		switch (alphaMode) {
			case undefined:
			case 'OPAQUE': return MESH_GLES2_SURFACE_OPAQUE;
			case 'MASK': return MESH_GLES2_SURFACE_MASK;
			case 'BLEND': return MESH_GLES2_SURFACE_BLEND;
		}
		throw new Error('[MeshPipeline] material alpha mode is outside the WebGL mesh surface modes.');
	}

	private writePacketColor(color: number): void {
		const target = this.material;
		target.color0 = ((color >>> 16) & 0xff) / 255;
		target.color1 = ((color >>> 8) & 0xff) / 255;
		target.color2 = (color & 0xff) / 255;
		target.color3 = ((color >>> 24) & 0xff) / 255;
	}

	private resolveMeshMaterial(model: GLTFModel, mesh: GLTFMesh, materialWord: number, colorWord: number): void {
		const target = this.material;
		this.writePacketColor(colorWord);
		target.surface = MESH_GLES2_SURFACE_OPAQUE;
		target.alphaCutoff = 0.5;
		target.metallicFactor = 1;
		target.roughnessFactor = 1;
		target.emissive0 = 0;
		target.emissive1 = 0;
		target.emissive2 = 0;
		target.doubleSided = false;
		target.unlit = false;
		const materialIndex = materialWord === VDP_MDU_MATERIAL_MESH_DEFAULT && mesh.materialIndex !== undefined
			? mesh.materialIndex >>> 0
			: materialWord >>> 0;
		if (materialIndex === VDP_MDU_MATERIAL_MESH_DEFAULT) {
			return;
		}
		const materials = model.materials;
		if (!materials || materialIndex >= materials.length) {
			throw new Error('[MeshPipeline] VDP mesh packet references a material index outside the model.');
		}
		const material = materials[materialIndex];
		const baseColor = material.baseColorFactor;
		if (baseColor) {
			target.color0 *= baseColor[0];
			target.color1 *= baseColor[1];
			target.color2 *= baseColor[2];
			target.color3 *= baseColor[3];
		}
		target.surface = this.meshSurfaceMode(material.alphaMode);
		if (material.alphaCutoff !== undefined) {
			target.alphaCutoff = material.alphaCutoff;
		}
		if (material.metallicFactor !== undefined) {
			target.metallicFactor = material.metallicFactor;
		}
		if (material.roughnessFactor !== undefined) {
			target.roughnessFactor = material.roughnessFactor;
		}
		const emissive = material.emissiveFactor;
		if (emissive) {
			target.emissive0 = emissive[0];
			target.emissive1 = emissive[1];
			target.emissive2 = emissive[2];
		}
		target.doubleSided = !!material.doubleSided;
		target.unlit = !!material.unlit;
	}

	private decodeMatrixWordsInto(target: Float32Array, words: ArrayLike<number>, base: number): void {
		for (let index = 0; index < 16; index += 1) {
			target[index] = decodeSignedQ16_16(words[base + index] >>> 0);
		}
	}

	private decodeMorphWeights(view: GameView, morphBase: number, morphCount: number): void {
		const words = view.vdpMorphWeightWords;
		for (let index = 0; index < morphCount; index += 1) {
			this.morphWeights[index] = decodeSignedQ16_16(words[morphBase + index] >>> 0);
		}
	}

	private decodeJointMatrices(view: GameView, jointBase: number, jointCount: number): void {
		const words = view.vdpJointMatrixWords;
		for (let index = 0; index < jointCount; index += 1) {
			this.decodeMatrixWordsInto(this.jointMatrices, words, (jointBase + index) * VDP_JTU_MATRIX_WORDS);
		}
	}

	private transformPointAffineInto(outBase: number, x: number, y: number, z: number, matrixBase: number): void {
		const vertices = this.vertices;
		const matrices = this.jointMatrices;
		vertices[outBase] = matrices[matrixBase] * x + matrices[matrixBase + 4] * y + matrices[matrixBase + 8] * z + matrices[matrixBase + 12];
		vertices[outBase + 1] = matrices[matrixBase + 1] * x + matrices[matrixBase + 5] * y + matrices[matrixBase + 9] * z + matrices[matrixBase + 13];
		vertices[outBase + 2] = matrices[matrixBase + 2] * x + matrices[matrixBase + 6] * y + matrices[matrixBase + 10] * z + matrices[matrixBase + 14];
	}

	private transformVectorInto(outBase: number, x: number, y: number, z: number, matrixBase: number): void {
		const vertices = this.vertices;
		const matrices = this.jointMatrices;
		vertices[outBase] = matrices[matrixBase] * x + matrices[matrixBase + 4] * y + matrices[matrixBase + 8] * z;
		vertices[outBase + 1] = matrices[matrixBase + 1] * x + matrices[matrixBase + 5] * y + matrices[matrixBase + 9] * z;
		vertices[outBase + 2] = matrices[matrixBase + 2] * x + matrices[matrixBase + 6] * y + matrices[matrixBase + 10] * z;
	}

	private writeMeshVertex(mesh: GLTFMesh,
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
		if (normals && positionBase + 2 < normals.length) {
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
			if (morphNormals && morphIndex < morphNormals.length) {
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
					this.transformPointAffineInto(scratchBase, x, y, z, matrixBase);
					this.transformVectorInto(scratchBase + 3, nx, ny, nz, matrixBase);
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
		const hasTexcoord = texcoords && uvBase + 1 < texcoords.length;
		const colorBase = vertexIndex * 4;
		const colors = mesh.colors;
		const hasColor = colors && colorBase + 3 < colors.length;
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

	private meshMorphTargetCount(mesh: GLTFMesh, packetMorphCount: number): number {
		const morphPositions = mesh.morphPositions;
		if (!morphPositions) {
			return 0;
		}
		return packetMorphCount < morphPositions.length ? packetMorphCount : morphPositions.length;
	}

	private meshHasSkinningSource(mesh: GLTFMesh, jointCount: number): boolean {
		const influenceCount = (mesh.positions.length / 3) * 4;
		return jointCount !== 0 && !!mesh.jointIndices && !!mesh.jointWeights && mesh.jointIndices.length >= influenceCount && mesh.jointWeights.length >= influenceCount;
	}
}
