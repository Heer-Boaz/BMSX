import { Material } from './material';
import { ShadowMap } from './shadowmap';
import { DEFAULT_VERTEX_COLOR } from '../backend/webgl/webgl.constants';
import type { TextureKey } from '../../render/texturemanager';
import type { color } from '../../render/gameview';
import type { vec3arr } from '../../rompack/rompack';
import { excludeclassfromsavegame } from '../../serializer/serializationhooks';

interface MeshOptions {
	positions?: Float32Array;
	texcoords?: Float32Array;
	texcoords1?: Float32Array;
	colors?: Float32Array;
	normals?: Float32Array;
	tangents?: Float32Array;
	indices?: Uint8Array | Uint16Array | Uint32Array;
	color?: color;
	atlasId?: number;
	material?: Material;
	morphPositions?: Float32Array[];
	morphNormals?: Float32Array[];
	morphTangents?: Float32Array[];
	morphWeights?: number[];
	jointIndices?: Uint16Array;
	jointWeights?: Float32Array;
	meshname?: string;
}

@excludeclassfromsavegame
export class Mesh {
  public positions: Float32Array;
  public texcoords: Float32Array;
  public texcoords1: Float32Array;
  public colors: Float32Array;
  /** Optional normal vectors per vertex */
  public normals: Float32Array | null;
  /** Optional tangent vectors per vertex (xyz + w sign) */
  public tangents: Float32Array | null;
  /** Optional index buffer */
  public indices?: Uint8Array | Uint16Array | Uint32Array;
  public color: color;
  public atlasId: number;
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

  constructor(opts: MeshOptions = {}) {
	this.name = opts.meshname ?? '';
	this.positions = opts.positions ?? new Float32Array();
	this.texcoords = opts.texcoords ?? new Float32Array();
	this.texcoords1 = opts.texcoords1 ?? new Float32Array();
	this.colors = opts.colors ?? new Float32Array();
	this.normals = opts.normals ?? null;
	this.tangents = opts.tangents ?? null;
	this.indices = opts.indices;
	this.color = opts.color ?? DEFAULT_VERTEX_COLOR;
	this.atlasId = opts.atlasId ?? 255;
	this.material = opts.material;
	this.morphPositions = opts.morphPositions;
	this.morphNormals = opts.morphNormals;
	this.morphTangents = opts.morphTangents;
	this.morphWeights = opts.morphWeights ?? [];
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
	const material = this.material;
	return material ? material.gpuTextures.albedo : undefined;
  }
  public get gpuTextureNormal(): TextureKey | undefined {
	const material = this.material;
	return material ? material.gpuTextures.normal : undefined;
  }
  public get gpuTextureMetallicRoughness(): TextureKey | undefined {
	const material = this.material;
	return material ? material.gpuTextures.metallicRoughness : undefined;
  }

  /** Signature for batching by GPU state (exclude per-instance color). */
  public get materialSignature(): string {
	const material = this.material;
	const surf = material ? material.surface : 'opaque';
	const doubleSided = material && material.doubleSided ? 1 : 0;
	return `${this.gpuTextureAlbedo ?? ''}|${this.gpuTextureNormal ?? ''}|${this.gpuTextureMetallicRoughness ?? ''}|${surf}|ds${doubleSided}`;
  }

  /**
   * Recalculate local-space bounding sphere, including morph extremes.
   */
  public updateBounds(): void {
	if (this.positions.length >= 3) {
	  const morphs = this.morphPositions ?? [];
	  let minX = Infinity, minY = Infinity, minZ = Infinity;
	  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
	  for (let i = 0; i < this.positions.length; i += 3) {
		let baseX = this.positions[i];
		let baseY = this.positions[i + 1];
		let baseZ = this.positions[i + 2];
		let posX = baseX, posY = baseY, posZ = baseZ;
		let negX = baseX, negY = baseY, negZ = baseZ;
		for (const m of morphs) {
		  const dx = m[i]; const dy = m[i + 1]; const dz = m[i + 2];
		  if (dx > 0) posX += dx; else negX += dx;
		  if (dy > 0) posY += dy; else negY += dy;
		  if (dz > 0) posZ += dz; else negZ += dz;
		}
		if (posX > maxX) maxX = posX; if (posY > maxY) maxY = posY; if (posZ > maxZ) maxZ = posZ;
		if (negX < minX) minX = negX; if (negY < minY) minY = negY; if (negZ < minZ) minZ = negZ;
	  }
	  this.boundingCenter = [ (minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5 ];
	  let maxDistSq = 0;
	  for (let i = 0; i < this.positions.length; i += 3) {
		let baseX = this.positions[i];
		let baseY = this.positions[i + 1];
		let baseZ = this.positions[i + 2];
		let posX = baseX, posY = baseY, posZ = baseZ;
		let negX = baseX, negY = baseY, negZ = baseZ;
		for (const m of morphs) {
		  const dx = m[i]; const dy = m[i + 1]; const dz = m[i + 2];
		  if (dx > 0) posX += dx; else negX += dx;
		  if (dy > 0) posY += dy; else negY += dy;
		  if (dz > 0) posZ += dz; else negZ += dz;
		}
		let dx = posX - this.boundingCenter[0];
		let dy = posY - this.boundingCenter[1];
		let dz = posZ - this.boundingCenter[2];
		let distSq = dx * dx + dy * dy + dz * dz;
		if (distSq > maxDistSq) maxDistSq = distSq;
		dx = negX - this.boundingCenter[0];
		dy = negY - this.boundingCenter[1];
		dz = negZ - this.boundingCenter[2];
		distSq = dx * dx + dy * dy + dz * dz;
		if (distSq > maxDistSq) maxDistSq = distSq;
	  }
	  this.boundingRadius = Math.sqrt(maxDistSq);
	} else {
	  this.boundingCenter = [0, 0, 0];
	  this.boundingRadius = 0;
	}
  }
}
