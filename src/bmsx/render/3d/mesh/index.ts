import { Material } from '../material';
import { ShadowMap } from '../shadowmap';
import { DEFAULT_VERTEX_COLOR } from '../../backend/webgl/constants';
import type { TextureKey } from '../../texture_manager';
import type { color } from '../../shared/submissions';
import type { vec3arr } from '../../../rompack/format';

interface MeshOptions {
	positions?: Float32Array;
	texcoords?: Float32Array;
	texcoords1?: Float32Array;
	colors?: Float32Array;
	normals?: Float32Array;
	tangents?: Float32Array;
	indices?: Uint8Array | Uint16Array | Uint32Array;
	color?: color;
	textpageId?: number;
	material?: Material;
	morphPositions?: Float32Array[];
	morphNormals?: Float32Array[];
	morphTangents?: Float32Array[];
	morphWeights?: number[];
	jointIndices?: Uint16Array;
	jointWeights?: Float32Array;
	meshname?: string;
}

const EMPTY_FLOAT32 = new Float32Array();
const EMPTY_MORPH_BUFFERS: Float32Array[] = [];
const EMPTY_MORPH_WEIGHTS: number[] = [];
const UNNAMED_MESH = 'mesh';
const NO_TEXTURE_KEY = '-';

export class Mesh {
	public positions: Float32Array;
	public texcoords: Float32Array;
	public texcoords1: Float32Array;
	public colors: Float32Array;
	/** Optional normal vectors per vertex */
	public normals?: Float32Array;
	/** Optional tangent vectors per vertex (xyz + w sign) */
	public tangents?: Float32Array;
	/** Optional index buffer */
	public indices?: Uint8Array | Uint16Array | Uint32Array;
	public color: color;
	public textpageId: number;
	public material?: Material;
	public shadow?: { map: ShadowMap; matrix: Float32Array; strength: number };
	public morphPositions?: Float32Array[];
	public morphNormals?: Float32Array[];
	public morphTangents?: Float32Array[];
	public morphWeights: number[];
	public jointIndices?: Uint16Array;
	public jointWeights?: Float32Array;
	public name: string;
	public boundingCenter: vec3arr = [0, 0, 0];
	public boundingRadius: number = 0;
	private readonly morphExtremesScratch = new Float32Array(6);

	constructor(opts: MeshOptions = {}) {
		this.name = opts.meshname ?? UNNAMED_MESH;
		this.positions = opts.positions ?? EMPTY_FLOAT32;
		this.texcoords = opts.texcoords ?? EMPTY_FLOAT32;
		this.texcoords1 = opts.texcoords1 ?? EMPTY_FLOAT32;
		this.colors = opts.colors ?? EMPTY_FLOAT32;
		this.normals = opts.normals;
		this.tangents = opts.tangents;
		this.indices = opts.indices;
		this.color = opts.color ?? DEFAULT_VERTEX_COLOR;
		this.textpageId = opts.textpageId ?? 255;
		this.material = opts.material;
		this.morphPositions = opts.morphPositions;
		this.morphNormals = opts.morphNormals;
		this.morphTangents = opts.morphTangents;
		this.morphWeights = opts.morphWeights ?? EMPTY_MORPH_WEIGHTS;
		this.jointIndices = opts.jointIndices;
		this.jointWeights = opts.jointWeights;
		this.updateBounds();
	}

	public get vertexCount(): number { return this.positions.length / 3; }
	public get hasTexcoords(): boolean { return this.texcoords.length >= this.vertexCount * 2; }
	public get hasNormals(): boolean { return !!(this.normals && this.normals.length >= this.vertexCount * 3); }
	public get hasTangents(): boolean { return !!this.tangents; }
	public get hasSkinning(): boolean { return !!(this.jointIndices && this.jointWeights); }
	public get hasMorphTargets(): boolean { return !!(this.morphPositions && this.morphPositions.length > 0); }

	public get gpuTextureAlbedo(): TextureKey | undefined {
		return this.material?.gpuTextures.albedo;
	}
	public get gpuTextureNormal(): TextureKey | undefined {
		return this.material?.gpuTextures.normal;
	}
	public get gpuTextureMetallicRoughness(): TextureKey | undefined {
		return this.material?.gpuTextures.metallicRoughness;
	}

	/** Signature for batching by GPU state (exclude per-instance color). */
	public get materialSignature(): string {
		const material = this.material;
		const surf = material?.surface ?? 'opaque';
		const doubleSided = material?.doubleSided ? 1 : 0;
		return `${this.gpuTextureAlbedo ?? NO_TEXTURE_KEY}|${this.gpuTextureNormal ?? NO_TEXTURE_KEY}|${this.gpuTextureMetallicRoughness ?? NO_TEXTURE_KEY}|${surf}|ds${doubleSided}`;
	}

	private writeMorphedVertexExtremes(i: number, morphs: Float32Array[], out: Float32Array): void {
		const baseX = this.positions[i];
		const baseY = this.positions[i + 1];
		const baseZ = this.positions[i + 2];
		let posX = baseX, posY = baseY, posZ = baseZ;
		let negX = baseX, negY = baseY, negZ = baseZ;
		for (let index = 0; index < morphs.length; index += 1) {
			const morph = morphs[index];
			const dx = morph[i];
			const dy = morph[i + 1];
			const dz = morph[i + 2];
			if (dx > 0) posX += dx; else negX += dx;
			if (dy > 0) posY += dy; else negY += dy;
			if (dz > 0) posZ += dz; else negZ += dz;
		}
		out[0] = posX;
		out[1] = posY;
		out[2] = posZ;
		out[3] = negX;
		out[4] = negY;
		out[5] = negZ;
	}

	/**
	 * Recalculate local-space bounding sphere, including morph extremes.
	 */
	public updateBounds(): void {
		if (this.positions.length < 3) {
			this.boundingCenter = [0, 0, 0];
			this.boundingRadius = 0;
			return;
		}
		const morphs = this.morphPositions ?? EMPTY_MORPH_BUFFERS;
		const extremes = this.morphExtremesScratch;
		let minX = Infinity, minY = Infinity, minZ = Infinity;
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
		for (let i = 0; i < this.positions.length; i += 3) {
			this.writeMorphedVertexExtremes(i, morphs, extremes);
			if (extremes[0] > maxX) maxX = extremes[0];
			if (extremes[1] > maxY) maxY = extremes[1];
			if (extremes[2] > maxZ) maxZ = extremes[2];
			if (extremes[3] < minX) minX = extremes[3];
			if (extremes[4] < minY) minY = extremes[4];
			if (extremes[5] < minZ) minZ = extremes[5];
		}
		this.boundingCenter = [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5];
		let maxDistSq = 0;
		for (let i = 0; i < this.positions.length; i += 3) {
			this.writeMorphedVertexExtremes(i, morphs, extremes);
			let dx = extremes[0] - this.boundingCenter[0];
			let dy = extremes[1] - this.boundingCenter[1];
			let dz = extremes[2] - this.boundingCenter[2];
			let distSq = dx * dx + dy * dy + dz * dz;
			if (distSq > maxDistSq) maxDistSq = distSq;
			dx = extremes[3] - this.boundingCenter[0];
			dy = extremes[4] - this.boundingCenter[1];
			dz = extremes[5] - this.boundingCenter[2];
			distSq = dx * dx + dy * dy + dz * dz;
			if (distSq > maxDistSq) maxDistSq = distSq;
		}
		this.boundingRadius = Math.sqrt(maxDistSq);
	}
}
