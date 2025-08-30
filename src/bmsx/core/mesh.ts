import { update_tagged_components } from '../component/basecomponent';
import { TransformComponent } from '../component/transformcomponent';
import { Material } from '../render/3d/material';
import { M4, Mat4, Q, quat } from '../render/3d/math3d';
import { ShadowMap } from '../render/3d/shadowmap';
import { DEFAULT_VERTEX_COLOR } from '../render/backend/webgl.constants';
import type { TextureKey } from '../render/texturemanager';
import type { color, DrawMeshOptions } from '../render/view';
import type { asset_id, color_arr, GLTFAnimationSampler, GLTFMesh, GLTFModel, GLTFNode, Oriented, Scaled, vec3arr, vec4arr } from '../rompack/rompack';
import { excludeclassfromsavegame, excludepropfromsavegame, insavegame, onload, onsave } from '../serializer/gameserializer';
import { $ } from './game';
import { GameObject } from './gameobject';
import { Float32ArrayPool } from './utils';

type NodeKey = string; // "s<scene>/<i0>/<i1>/.../<ik>"
type RuntimeNodeTRS = { t?: vec3arr; r?: vec4arr; s?: vec3arr };
type RuntimeNodeState = { trs?: RuntimeNodeTRS; weights?: number[]; visible?: boolean };
type RuntimeAnim = { time?: number; speed?: number; activeClip?: string | number; loop?: boolean };
type PersistedMatTex = Partial<{
	albedo: number;
	normal: number;
	metallicRoughness: number;
	color: color_arr;
	metallicFactor: number;
	roughnessFactor: number;
}>;

type MeshObjectRuntime = {
	version: 1;
	model_id?: asset_id;
	nodes?: Record<NodeKey, RuntimeNodeState>;
	anim?: RuntimeAnim;
};

function buildNodeKeyMap(model: GLTFModel): { toKey: (i: number) => NodeKey, toIndex: (k: NodeKey) => number | undefined } {
	const nodes = model.nodes ?? []; const sceneIndex = model.scene ?? 0; const scene = model.scenes?.[sceneIndex]; if (!scene) {
		// fallback: enkelvoudige graf zonder scenes → key = "s-1/<i>"
		const map = new Map<string, number>(); for (let i = 0; i < nodes.length; i++) map.set(`s-1/${i}`, i); return { toKey: (i) => `s-1/${i}`, toIndex: (k) => map.get(k) };
	} // parent[] opbouwen
	const parentOf: number[] = new Array(nodes.length).fill(-1); for (let p = 0; p < nodes.length; p++) { const ch = nodes[p]?.children ?? []; for (const c of ch) parentOf[c] = p; } // alle nodes die bereikbaar zijn vanuit de scene-roots: path keten van indices
	const cacheKey: (string | undefined)[] = new Array(nodes.length); const keyOf = (i: number): string => {
		if (cacheKey[i] !== undefined) return cacheKey[i]!; let p = parentOf[i]; let path = `${i}`; while (p !== -1) { path = `${p}/${path}`; p = parentOf[p]; } // controle: i moet bereikbaar zijn via een scene-root; zo niet, markeer als “detached”
		const isRooted = scene.nodes.includes(parseInt(path.split('/')[0], 10)); const key = isRooted ? `s${sceneIndex}/${path}` : `s${sceneIndex}#detached/${path}`; cacheKey[i] = key; return key;
	}; const map = new Map<string, number>(); for (let i = 0; i < nodes.length; i++) { map.set(keyOf(i), i); } return { toKey: keyOf, toIndex: (k) => map.get(k), };
}

@excludeclassfromsavegame
export class Mesh {
	public positions: Float32Array;
	public texcoords: Float32Array;
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

	constructor(opts?: { positions?: Float32Array; texcoords?: Float32Array; normals?: Float32Array; tangents?: Float32Array; indices?: Uint8Array | Uint16Array | Uint32Array; color?: color; atlasId?: number; material?: Material; morphPositions?: Float32Array[]; morphNormals?: Float32Array[]; morphTangents?: Float32Array[]; morphWeights?: number[]; jointIndices?: Uint16Array; jointWeights?: Float32Array, meshname: string }) {
		this.name = opts?.meshname;
		this.positions = opts?.positions ?? new Float32Array();
		this.texcoords = opts?.texcoords ?? new Float32Array();
		this.normals = opts?.normals ?? null;
		this.tangents = opts?.tangents ?? null;
		this.indices = opts?.indices;
		this.color = opts?.color ?? DEFAULT_VERTEX_COLOR;
		this.atlasId = opts?.atlasId ?? 255;
		this.material = opts?.material;
		this.morphPositions = opts?.morphPositions;
		this.morphNormals = opts?.morphNormals;
		this.morphTangents = opts?.morphTangents;
		this.morphWeights = opts?.morphWeights ?? [];
		this.jointIndices = opts?.jointIndices;
		this.jointWeights = opts?.jointWeights;
		this.updateBounds();
	}

	public get vertexCount(): number {
		return this.positions.length / 3;
	}

	public get hasTexcoords(): boolean {
		return this.texcoords.length >= this.vertexCount * 2;
	}

	public get hasNormals(): boolean {
		return !!(this.normals && this.normals.length >= this.vertexCount * 3);
	}

	public get hasTangents(): boolean {
		return !!this.tangents;
	}

	public get hasSkinning(): boolean {
		return !!(this.jointIndices && this.jointWeights);
	}

	public get hasMorphTargets(): boolean {
		return !!(this.morphPositions && this.morphPositions.length > 0);
	}

	public get gpuTextureAlbedo(): TextureKey | undefined {
		return this.material?.gpuTextures.albedo;
	}

	public get gpuTextureNormal(): TextureKey | undefined {
		return this.material?.gpuTextures.normal;
	}

	public get gpuTextureMetallicRoughness(): TextureKey | undefined {
		return this.material?.gpuTextures.metallicRoughness;
	}

	/**
	 * Signature identifying the GPU state needed to render this mesh's material.
	 * Used for batching to minimize texture and shader state changes.
	 */
	public get materialSignature(): string {
		// Include base color so per-instance color overrides do not collapse into one instanced batch losing variation.
		const c = this.material?.color;
		const cSig = c ? `${c[0].toFixed(3)},${c[1].toFixed(3)},${c[2].toFixed(3)},${c[3].toFixed(3)}` : '';
		return `${this.gpuTextureAlbedo ?? ''}|${this.gpuTextureNormal ?? ''}|${this.gpuTextureMetallicRoughness ?? ''}|${cSig}`;
	}

	/**
	 * Recalculate the mesh's bounding sphere in local space. Morph targets are
	 * taken into account so the bounds remain valid as animations deform the
	 * mesh. Call this again if vertex data changes at runtime.
	 */
	public updateBounds(): void {
		if (this.positions.length >= 3) {
			const morphs = this.morphPositions ?? [];
			let minX = Infinity, minY = Infinity, minZ = Infinity;
			let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
			// Determine extreme positions considering all morph targets
			for (let i = 0; i < this.positions.length; i += 3) {
				let baseX = this.positions[i];
				let baseY = this.positions[i + 1];
				let baseZ = this.positions[i + 2];
				let posX = baseX, posY = baseY, posZ = baseZ;
				let negX = baseX, negY = baseY, negZ = baseZ;
				for (const m of morphs) {
					const dx = m[i];
					const dy = m[i + 1];
					const dz = m[i + 2];
					if (dx > 0) posX += dx; else negX += dx;
					if (dy > 0) posY += dy; else negY += dy;
					if (dz > 0) posZ += dz; else negZ += dz;
				}
				if (posX > maxX) maxX = posX;
				if (posY > maxY) maxY = posY;
				if (posZ > maxZ) maxZ = posZ;
				if (negX < minX) minX = negX;
				if (negY < minY) minY = negY;
				if (negZ < minZ) minZ = negZ;
			}
			this.boundingCenter = [
				(minX + maxX) * 0.5,
				(minY + maxY) * 0.5,
				(minZ + maxZ) * 0.5,
			];
			let maxDistSq = 0;
			for (let i = 0; i < this.positions.length; i += 3) {
				let baseX = this.positions[i];
				let baseY = this.positions[i + 1];
				let baseZ = this.positions[i + 2];
				let posX = baseX, posY = baseY, posZ = baseZ;
				let negX = baseX, negY = baseY, negZ = baseZ;
				for (const m of morphs) {
					const dx = m[i];
					const dy = m[i + 1];
					const dz = m[i + 2];
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

interface MeshInstance {
	mesh: Mesh;
	matrix: Float32Array;
	skinIndex?: number;
	nodeIndex: number;
	morphWeights: number[];
}

@insavegame
export abstract class MeshObject extends GameObject implements Oriented, Scaled {
	@excludepropfromsavegame
	public meshes: Mesh[] = [];
	@excludepropfromsavegame
	public meshModel: GLTFModel;
	// Orientation stored purely as quaternion (Euler legacy removed)
	private _rotationQ: quat = Q.ident();
	public scale: vec3arr;
	private _model_id?: asset_id;
	@excludepropfromsavegame
	private meshInstances: MeshInstance[] = [];
	@excludepropfromsavegame
	private nodeDirty: boolean[] = [];
	@excludepropfromsavegame
	private worldMatrices: Float32Array[] = [];
	private animationTime = 0;
	@excludepropfromsavegame
	private _base = new Float32Array(16);
	@excludepropfromsavegame
	private worldPool: Float32ArrayPool;
	private _modelGen = 0;
	private _runtime: MeshObjectRuntime; // Runtime data for the mesh object, which is only used for serializing and deserializing the state
	// Variants are expressed through explicit per-mesh overrides captured in materialOverrides
	// so they serialize/deserialze cleanly without reflection or subclass boilerplate.
	public materialOverrides?: Record<number, PersistedMatTex>; // meshIndex -> overrides
	// Orientation driving
	orientationDriveNodeIndex: number = 0; // which node's sampled rotation drives object-level rotationQ
	activeClipIndex: number | null = null; // currently playing animation clip (null = play all as before)

	public get rotationQ(): quat { return this._rotationQ; }
	public set rotationQValue(q: quat) { this._rotationQ = Q.norm(q); }

	// Animation blending support
	private _animBlendActive = false;
	private _animBlendT = 0; // 0..1
	private _animBlendDur = 0.001;
	private _animTargetQ: quat = Q.ident();
	private _animStartQ: quat = Q.ident();

	public startRotationBlend(target: quat, duration: number) {
		this._animBlendActive = true; this._animBlendT = 0;
		this._animBlendDur = Math.max(duration, 0.0001);
		this._animStartQ = { ...this._rotationQ };
		this._animTargetQ = Q.norm(target);
	}

	public setOrientationDriveNode(index: number) { this.orientationDriveNodeIndex = index | 0; }

	public playAnimation(clip: string | number, blendDuration = 0, resetTime = true): boolean {
		if (!this.meshModel?.animations) return false;
		let idx: number | undefined;
		if (typeof clip === 'number') idx = clip | 0; else {
			idx = this.meshModel.animations.findIndex(a => a.name === clip);
		}
		if (idx === undefined || idx < 0 || idx >= this.meshModel.animations.length) return false;
		// Prepare blend if requested
		if (blendDuration > 0) {
			// Sample target clip root node rotation at t=0 to get blend target
			const anim = this.meshModel.animations[idx];
			let targetQ: quat | null = null;
			for (const channel of anim.channels) {
				if (channel.target.node === this.orientationDriveNodeIndex && channel.target.path === 'rotation') {
					const sampler = anim.samplers[channel.sampler];
					if (sampler?.input && sampler?.output) {
						const stride = sampler.output.length / sampler.input.length;
						const comp = sampler.interpolation === 'CUBICSPLINE' ? stride / 3 : stride;
						const val = this.sampleAnimation(sampler, 0, comp); // t=0
						targetQ = { x: val[0], y: val[1], z: val[2], w: val[3] };
					}
					break;
				}
			}
			if (targetQ) this.startRotationBlend(targetQ, blendDuration);
		}
		this.activeClipIndex = idx;
		if (resetTime) this.animationTime = 0;
		return true;
	}

	private _advanceRotationBlend(dtSec: number) {
		if (!this._animBlendActive) return;
		this._animBlendT += dtSec / this._animBlendDur;
		if (this._animBlendT >= 1) { this._rotationQ = this._animTargetQ; this._animBlendActive = false; return; }
		// Slerp
		const t = this._animBlendT;
		let cos = this._animStartQ.x * this._animTargetQ.x + this._animStartQ.y * this._animTargetQ.y + this._animStartQ.z * this._animTargetQ.z + this._animStartQ.w * this._animTargetQ.w;
		let tq = this._animTargetQ;
		if (cos < 0) { cos = -cos; tq = { x: -tq.x, y: -tq.y, z: -tq.z, w: -tq.w }; }
		let k0: number, k1: number;
		if (cos > 0.9995) { k0 = 1 - t; k1 = t; }
		else {
			const sin = Math.sqrt(1 - cos * cos);
			const ang = Math.atan2(sin, cos);
			k0 = Math.sin((1 - t) * ang) / sin;
			k1 = Math.sin(t * ang) / sin;
		}
		this._rotationQ = Q.norm({
			x: this._animStartQ.x * k0 + tq.x * k1,
			y: this._animStartQ.y * k0 + tq.y * k1,
			z: this._animStartQ.z * k0 + tq.z * k1,
			w: this._animStartQ.w * k0 + tq.w * k1,
		});
	}

	constructor(id?: string, fsm_id?: string) {
		super(id, fsm_id);
		// Euler rotation removed
		this.scale ??= [1, 1, 1];
		this.worldPool = new Float32ArrayPool(16);
	}

	/** Convenience getter returning the first mesh */
	public get mesh(): Mesh | undefined {
		return this.meshes[0];
	}

	public get model_id(): asset_id | undefined {
		return this._model_id;
	}

	public set model_id(id: asset_id) {
		if (this._model_id === id) return;
		if (this._model_id) this.releaseModel(this.meshModel);
		this._model_id = id;
		this._modelGen++;
		this.setMeshModel($.rompack.model[id]);
	}

	private createMesh(mesh: GLTFMesh, meshModel: GLTFModel, index: number): Mesh {
		const m = new Mesh({
			positions: mesh.positions.slice(),
			texcoords: mesh.texcoords?.slice() ?? new Float32Array(),
			normals: mesh.normals?.slice() ?? null,
			tangents: mesh.tangents?.slice() ?? null,
			indices: mesh.indices?.slice() ?? undefined,
			atlasId: mesh.materialIndex !== undefined ? 255 : 0,
			morphPositions: mesh.morphPositions?.map(t => t.slice()),
			morphNormals: mesh.morphNormals?.map(t => t.slice()),
			morphTangents: mesh.morphTangents?.map(t => t.slice()),
			morphWeights: mesh.weights ? [...mesh.weights] : [],
			jointIndices: mesh.jointIndices?.slice(),
			jointWeights: mesh.jointWeights?.slice(),
			meshname: `${meshModel.name}_${index}`,
		});

		const mat = meshModel.materials?.[mesh.materialIndex ?? 0];
		let albedo = mat?.baseColorTexture;
		let normal = mat?.normalTexture;
		let metallicRoughness = mat?.metallicRoughnessTexture;
		if (meshModel.textures) {
			if (albedo !== undefined) albedo = meshModel.textures[albedo] ?? albedo;
			if (normal !== undefined) normal = meshModel.textures[normal] ?? normal;
			if (metallicRoughness !== undefined) metallicRoughness = meshModel.textures[metallicRoughness] ?? metallicRoughness;
		}

		m.material = new Material({
			color: mat?.baseColorFactor ? [...mat.baseColorFactor] : [1, 1, 1, 1],
			textures: {
				albedo: albedo !== undefined ? albedo : undefined,
				normal: normal !== undefined ? normal : undefined,
				metallicRoughness: metallicRoughness !== undefined ? metallicRoughness : undefined,
			},
			metallicFactor: mat?.metallicFactor ?? 1.0,
			roughnessFactor: mat?.roughnessFactor ?? 1.0,
		});

		return m;
	}

	/**
	 * Returns (and caches) a lightweight material instance differing only by a small set of overrides.
	 * The base material's GPU bindings are reused; only texture indices / scalar params differ.
	 * keyParts must uniquely describe the variant (e.g. model id, mesh index, param tuple).
	 */
	/**
	 * Set (and persist) a material override for a given mesh index.
	 * Only fields provided in overrides are mutated & recorded.
	 */
	public setMaterialOverride(meshIndex: number, overrides: PersistedMatTex): void {
		const mesh = this.meshes[meshIndex];
		if (!mesh || !mesh.material) return;
		const mat = mesh.material;
		if (overrides.albedo !== undefined) mat.textures.albedo = overrides.albedo;
		if (overrides.normal !== undefined) mat.textures.normal = overrides.normal;
		if (overrides.metallicRoughness !== undefined) mat.textures.metallicRoughness = overrides.metallicRoughness;
		if (overrides.color) mat.color = [...overrides.color];
		if (overrides.metallicFactor !== undefined) mat.metallicFactor = overrides.metallicFactor;
		if (overrides.roughnessFactor !== undefined) mat.roughnessFactor = overrides.roughnessFactor;
		this.materialOverrides ??= {};
		this.materialOverrides[meshIndex] = { ...(this.materialOverrides[meshIndex] ?? {}), ...overrides };
		// (Re)bind GPU texture keys if already fetched
		const keys = this.meshModel?.gpuTextures;
		if (keys) {
			if (mat.textures.albedo !== undefined) mat.gpuTextures.albedo = keys[mat.textures.albedo];
			if (mat.textures.normal !== undefined) mat.gpuTextures.normal = keys[mat.textures.normal];
			if (mat.textures.metallicRoughness !== undefined) mat.gpuTextures.metallicRoughness = keys[mat.textures.metallicRoughness];
		}
	}

	public setMeshModel(meshModel: GLTFModel): void {
		this.meshModel = meshModel;

		// Valideer brondata, faal vroeg bij corruptie
		if (!Array.isArray(meshModel.meshes) || meshModel.meshes.some(m => !m || !m.positions)) {
			throw new Error(`GLTFModel '${meshModel.name}': invalid meshes array`);
		}

		this.meshes = meshModel.meshes.map((m, i) => this.createMesh(m, meshModel, i));

		// Invariant: dicht/non-null
		// (optioneel) Object.freeze(this.meshes);

		if (meshModel.nodes) {
			this.worldMatrices = meshModel.nodes.map(() => M4.identity());
			this.nodeDirty = meshModel.nodes.map(() => true);
		} else {
			this.worldMatrices = [];
			this.nodeDirty = [];
		}

		this.recalcMeshInstances();
		this.loadMeshModel(this.meshModel); // textures binden NA volledige opbouw
	}

	@update_tagged_components('physics_pre')
	@update_tagged_components('physics_post')
	public override run(): void {
		const dtSec = $.deltaTime / 1000;
		if (this.meshModel?.animations) {
			this.animationTime += dtSec;
			this._advanceRotationBlend(dtSec);
			let nodesChanged = false;
			const anims = this.activeClipIndex != null ? [this.meshModel.animations[this.activeClipIndex]] : this.meshModel.animations;
			for (const anim of anims) {
				for (const channel of anim.channels) {
					const sampler = anim.samplers[channel.sampler];
					if (!sampler || !sampler.input || !sampler.output) continue; // TODO: SHOULD NOT BE REQUIRED, BUT LOADING FROM SERIALIZED STATE CAUSES ISSUES
					const stride = sampler.output.length / sampler.input.length;
					const comp = sampler.interpolation === 'CUBICSPLINE' ? stride / 3 : stride;
					const value = this.sampleAnimation(sampler, this.animationTime, comp);
					if (channel.target.node !== undefined && this.meshModel.nodes) {
						const node = this.meshModel.nodes[channel.target.node];
						switch (channel.target.path) {
							case 'rotation': {
								const q = { x: value[0], y: value[1], z: value[2], w: value[3] };
								node.rotation = [q.x, q.y, q.z, q.w]; // keep per-node for skinning hierarchy
								// If this node is the configured orientation driver, copy into object quaternion (unless blending in progress)
								if (channel.target.node === this.orientationDriveNodeIndex) {
									if (!this._animBlendActive) {
										this._rotationQ = Q.norm(q);
									}
								}
								node.matrix = undefined;
								this.markNodeDirty(channel.target.node);
								nodesChanged = true;
								break;
							}
							case 'translation':
								node.translation = [value[0], value[1], value[2]];
								node.matrix = undefined;
								this.markNodeDirty(channel.target.node);
								nodesChanged = true;
								break;
							case 'scale':
								node.scale = [value[0], value[1], value[2]];
								node.matrix = undefined;
								this.markNodeDirty(channel.target.node);
								nodesChanged = true;
								break;
							case 'weights':
								if (node.mesh !== undefined) {
									const weights = Array.from(value);
									node.weights = weights;
									for (const inst of this.meshInstances) {
										if (inst.nodeIndex === channel.target.node) {
											inst.morphWeights = weights;
										}
									}
								}
								break;
						}
					}
				}
			}
			if (nodesChanged) this.recalcMeshInstances();
		}
		super.run();
	}

	private sampleAnimation(s: GLTFAnimationSampler, time: number, stride: number): Float32Array {
		const input = s.input;
		const output = s.output;
		const last = input.length - 1;
		const t = time % input[last];
		let i = 0;
		while (i < last && t >= input[i + 1]) i++;
		const j = Math.min(i + 1, last);
		const t0 = input[i];
		const t1 = input[j];
		const dt = t1 - t0;
		const res = new Float32Array(stride);
		switch (s.interpolation) {
			case 'STEP': {
				const start = i * stride;
				for (let k = 0; k < stride; k++) res[k] = output[start + k];
				break;
			}
			case 'CUBICSPLINE': {
				const start = i * stride * 3;
				const end = j * stride * 3;
				const u = dt === 0 ? 0 : (t - t0) / dt;
				const u2 = u * u; const u3 = u2 * u;
				const s0 = 2.0 * u3 - 3.0 * u2 + 1.0;
				const s1 = u3 - 2.0 * u2 + u;
				const s2 = -2.0 * u3 + 3.0 * u2;
				const s3 = u3 - u2;
				for (let k = 0; k < stride; k++) {
					const p0 = output[start + stride + k];
					const m0 = output[start + stride * 2 + k];
					const p1 = output[end + stride + k];
					const m1 = output[end + k];
					res[k] = s0 * p0 + s1 * m0 * dt + s2 * p1 + s3 * m1 * dt;
				}
				break;
			}
			case 'LINEAR':
			default: {
				const alpha = dt > 0 ? (t - t0) / dt : 0;
				const start = i * stride;
				const end = j * stride;
				for (let k = 0; k < stride; k++) {
					const v0 = output[start + k];
					const v1 = output[end + k];
					res[k] = v0 + (v1 - v0) * alpha;
				}
				break;
			}
		}
		return res;
	}

	@onsave
	public saveRuntime(): { _runtime: MeshObjectRuntime } {
		// NB: static @onsave krijgt de instance als parameter (o)
		const runtime: MeshObjectRuntime = { version: 1 };

		// Model-id: voorkeursbron
		if (this._model_id !== undefined) runtime.model_id = this._model_id;

		// Node-state minimal opslaan via node-keys
		if (this.meshModel?.nodes && this.meshModel.scenes?.length) {
			const { toKey } = buildNodeKeyMap(this.meshModel);
			const map: Record<NodeKey, RuntimeNodeState> = {};
			for (let i = 0; i < this.meshModel.nodes.length; i++) {
				const n = this.meshModel.nodes[i];
				const k = toKey(i);
				const st: RuntimeNodeState = {};
				// Alleen meenemen als expliciet aanwezig
				if (n.translation || n.rotation || n.scale) {
					st.trs = {};
					if (n.translation) st.trs.t = [...n.translation] as vec3arr;
					if (n.rotation) st.trs.r = [...n.rotation] as vec4arr;
					if (n.scale) st.trs.s = [...n.scale] as vec3arr;
				}
				if (n.weights) st.weights = [...n.weights];
				// (optioneel) visible-flag als je dat per node gebruikt
				if (n.visible !== undefined) st.visible = !!n.visible;

				if (st.trs || st.weights || st.visible !== undefined) {
					map[k] = st;
				}
			}
			if (Object.keys(map).length) runtime.nodes = map;
		}

		// Animation snapshot (super compact, uitbreidbaar)
		if (this.animationTime !== undefined) {
			runtime.anim = { time: this.animationTime ?? 0 };
		}

		// console.log(`Saving MeshObject runtime: model_id=${runtime.model_id}, nodes=${Object.keys(runtime.nodes ?? {}).length}, anim=${runtime.anim?.time ?? 'none'}`);

		return { _runtime: runtime };
	}

	@onsave
	private captureMaterialOverrides() {
		// Store only what’s explicitly set on each mesh.material.textures (image indices).
		const out: Record<number, PersistedMatTex> = {};
		this.meshes.forEach((m, i) => {
			if (!m?.material) return;
			const t = m.material.textures;
			if (!t) return;

			const o: PersistedMatTex = {};
			if (t.albedo !== undefined) o.albedo = t.albedo;
			if (t.normal !== undefined) o.normal = t.normal;
			if (t.metallicRoughness !== undefined) o.metallicRoughness = t.metallicRoughness;

			if (Object.keys(o).length) out[i] = o;
		});

		// Only persist if there is anything to save
		if (Object.keys(out).length) {
			return { materialOverrides: out };
		}
		return {};
	}

	@onload
	public onLoad(): void {
		// console.log(`Hydrating MeshObject from runtime`);
		// 1) Runtime info uit snapshot
		const rt: MeshObjectRuntime | undefined = this._runtime;
		// Safety: gooi het veld weer weg uit de instance
		if (this._runtime) { delete this._runtime; }

		// 2) Kies model
		let model: GLTFModel | undefined = undefined;
		if (rt?.model_id !== undefined) {
			model = $.rompack.model[rt.model_id];
			this._model_id = rt.model_id; // in sync houden
		} else {
			model = this.meshModel; // fallback: builder heeft meshModel al gerevived
		}

		if (!model) {
			// Geen model beschikbaar → niets te doen
			return;
		}

		// 3) Bouw deterministisch op (maakt meshes, worldMatrices, meshInstances, en start texture binding)
		this.setMeshModel(model);

		// 4) Node-overrides terugzetten (TRS/weights), via node-keys
		if (rt?.nodes && this.meshModel?.nodes) {
			const { toIndex } = buildNodeKeyMap(this.meshModel);
			let anyDirty = false;

			for (const [k, ns] of Object.entries(rt.nodes)) {
				const idx = toIndex(k);
				if (idx === undefined) continue; // key bestaat niet meer in dit model (asset gewijzigd)
				const node = this.meshModel.nodes[idx];
				// TRS
				if (ns.trs) {
					if (ns.trs.t) node.translation = [...ns.trs.t] as vec3arr;
					if (ns.trs.r) node.rotation = [...ns.trs.r] as vec4arr;
					if (ns.trs.s) node.scale = [...ns.trs.s] as vec3arr;
					node.matrix = undefined; // force recompute
					anyDirty = true;
				}
				// Morph weights
				if (ns.weights) {
					node.weights = [...ns.weights];
					// sync runtime inst weights (wordt ook gedaan in recalc, maar dit is cheap)
				}
				// Visible (optioneel)
				if (ns.visible !== undefined) node.visible = !!ns.visible;
			}

			if (anyDirty) this.recalcMeshInstances();
		}

		// 5) Animatie-tijd herstellen (optioneel)
		if (rt?.anim?.time !== undefined) {
			this['animationTime'] = rt.anim.time;
		}

		// 6) Reapply persisted indices (image-space) to materials
		if (this.materialOverrides) {
			for (const [k, o] of Object.entries(this.materialOverrides)) {
				const i = +k | 0;
				const mesh = this.meshes[i];
				if (!mesh?.material) continue;
				const t = mesh.material.textures;
				if (!t) continue;
				if (o.albedo !== undefined) t.albedo = o.albedo;
				if (o.normal !== undefined) t.normal = o.normal;
				if (o.metallicRoughness !== undefined) t.metallicRoughness = o.metallicRoughness;
			}
		}


		// 7) If the TextureManager was cleared, fetch keys again and then rebind
		if (!this.meshModel.gpuTextures) {
			$.texmanager.fetchModelTextures(this.meshModel).then(keys => {
				// hydration guard (optional):
				if (this.meshModel) {
					this.meshModel.gpuTextures = keys;
					this.rebindMaterialTexturesFromModelKeys();
				}
			});
		} else {
			// We already have keys — bind immediately
			this.rebindMaterialTexturesFromModelKeys();
		}
	}

	private rebindMaterialTexturesFromModelKeys(): void {
		const keys = this.meshModel.gpuTextures;
		if (!keys) return; // will bind once fetch completes
		for (const m of this.meshes) {
			const mat = m.material;
			if (!mat) continue;
			const t = mat.textures ?? {};
			mat.gpuTextures.albedo = t.albedo !== undefined ? keys[t.albedo] : undefined;
			mat.gpuTextures.normal = t.normal !== undefined ? keys[t.normal] : undefined;
			mat.gpuTextures.metallicRoughness = t.metallicRoughness !== undefined ? keys[t.metallicRoughness] : undefined;
		}
	}

	private loadMeshModel(meshModel: GLTFModel): void {
		const gen = this._modelGen;
		$.texmanager.fetchModelTextures(meshModel).then((gpuTextureKeys) => {
			if (gen !== this._modelGen || meshModel !== this.meshModel) return; // hydration barrier
			meshModel.gpuTextures = gpuTextureKeys;
			for (let i = 0; i < this.meshes.length; i++) {
				const mesh = this.meshes[i]; // hier mag je ervan uitgaan: non-null
				const tex = mesh.material?.textures ?? {};
				if (tex.albedo !== undefined) mesh.material!.gpuTextures.albedo = gpuTextureKeys[tex.albedo];
				if (tex.normal !== undefined) mesh.material!.gpuTextures.normal = gpuTextureKeys[tex.normal];
				if (tex.metallicRoughness !== undefined)
					mesh.material!.gpuTextures.metallicRoughness = gpuTextureKeys[tex.metallicRoughness];
			}
		});
	}
	private recalcMeshInstances(): void {
		this.meshInstances = [];
		if (this.meshModel.nodes && this.meshModel.scenes && this.meshModel.scenes.length > 0) {
			const scene = this.meshModel.scenes[this.meshModel.scene ?? 0];
			if (scene) {
				for (const nodeIndex of scene.nodes) this.traverse(nodeIndex, M4.identity());
			}
		} else {
			for (const [idx, mesh] of this.meshes.entries()) {
				this.meshInstances.push({
					mesh,
					matrix: M4.identity(),
					nodeIndex: idx,
					morphWeights: mesh.morphWeights.slice(),
				});
			}
		}
	}

	private traverse(nodeIndex: number, parent: Mat4): void {
		if (!this.meshModel.nodes) return;
		const world = this.getWorldMatrix(nodeIndex, parent);
		const node: GLTFNode = this.meshModel.nodes[nodeIndex];
		if (node.mesh !== undefined) {
			const mesh = this.meshes[node.mesh];
			if (mesh) {
				const weights = node.weights ? [...node.weights] : mesh.morphWeights.slice();
				this.meshInstances.push({ mesh, matrix: world, skinIndex: node.skin, nodeIndex, morphWeights: weights });
			}
		}
		if (node.children) for (const child of node.children) this.traverse(child, world);
	}

	private getWorldMatrix(nodeIndex: number, parent: Mat4): Mat4 {
		if (this.nodeDirty[nodeIndex]) {
			const node: GLTFNode = this.meshModel.nodes![nodeIndex];
			const local = node.matrix ? new Float32Array(node.matrix) : this.composeNodeMatrix(node);
			// world = parent * local
			const world = new Float32Array(16);
			M4.mulInto(world, parent, local);
			this.worldMatrices[nodeIndex] = world;
			this.nodeDirty[nodeIndex] = false;
		}
		return this.worldMatrices[nodeIndex];
	}

	private composeNodeMatrix(node: GLTFNode): Mat4 {
		const t = node.translation ?? [0, 0, 0];
		const q = node.rotation ?? undefined; // [x,y,z,w]
		const s = node.scale ?? [1, 1, 1];
		return M4.fromTRS([t[0], t[1], t[2]], q, [s[0], s[1], s[2]]);
	}

	private computeSkinMatrices(skinIndex: number): Float32Array[] | undefined {
		const skin = this.meshModel.skins?.[skinIndex];
		if (!skin || skin.joints.length === 0) return undefined;
		const mats: Float32Array[] = [];
		for (let i = 0; i < skin.joints.length; i++) {
			const jointIdx = skin.joints[i];
			const jointWorld = this.worldMatrices[jointIdx];
			const inv = skin.inverseBindMatrices?.[i] ?? M4.identity();
			mats.push(M4.mul(jointWorld, inv));
		}
		return mats;
	}

	private markNodeDirty(index: number): void {
		if (!this.meshModel.nodes) return;
		const mark = (i: number) => {
			this.nodeDirty[i] = true;
			const n = this.meshModel.nodes![i];
			if (n.children) for (const c of n.children) mark(c);
		};
		mark(index);
	}

	public releaseModel(model: GLTFModel): void {
		$.texmanager.releaseModelTextures(model);
	}

	override dispose(): void {
		if (this._model_id) {
			this.releaseModel($.rompack.model[this._model_id]);
			this._model_id = undefined;
		}
		super.dispose();
	}

	override paint(): void {
		if (this.meshInstances.length === 0) return;
		// Euler path removed; always use quaternion orientation

		const transform = this.getComponent(TransformComponent);
		const base = this._base; // Float32Array(16) hergebruikt

		if (transform) {
			base.set(transform.getWorldMatrix()); // aanname: column-major 4x4
		} else {
			const q = this._rotationQ;
			M4.setIdentity(base);
			M4.translateSelf(base, this.x, this.y, this.z);
			const rot = this.worldPool.ensure();
			M4.quatToMat4Into(rot, [q.x, q.y, q.z, q.w]);
			M4.mulInto(base, base, rot);
			M4.scaleSelf(base, this.scale[0], this.scale[1], this.scale[2]);
		}

		for (const inst of this.meshInstances) {
			// Skip instances whose source node is explicitly invisible
			if (inst.nodeIndex !== undefined && this.meshModel?.nodes?.[inst.nodeIndex]?.visible === false) continue;

			const mesh = inst.mesh;
			if (!mesh || !mesh.positions || mesh.positions.length === 0) continue;

			// world = base * inst.matrix
			const world = this.worldPool.ensure();
			M4.mulInto(world, base, inst.matrix);

			const options: DrawMeshOptions = {
				mesh,
				matrix: world,
				jointMatrices: inst.skinIndex !== undefined ? this.computeSkinMatrices(inst.skinIndex) : undefined,
				morphWeights: inst.morphWeights,
			};
			$.view.drawMesh(options);
		}
		this.worldPool.reset();
	}
}
