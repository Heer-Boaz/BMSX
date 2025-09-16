import { Component, type ComponentAttachOptions } from 'bmsx/component/basecomponent';
import { $ } from 'bmsx/core/game';
import { M4 } from 'bmsx/render/3d/math3d';
import type { asset_id, GLTFModel, GLTFMesh, GLTFAnimation, GLTFAnimationSampler, GLTFNode, color_arr, vec3arr, vec4arr } from 'bmsx/rompack/rompack';
import { Mesh as RenderMesh } from 'bmsx/render/3d/mesh';
import { Material } from 'bmsx/render/3d/material';
import { insavegame, excludepropfromsavegame, onsave, onload } from 'bmsx/serializer/serializationhooks';
import type { MeshRenderSubmission } from 'bmsx/render/gameview';

type MeshInstance = { mesh: RenderMesh; nodeIndex?: number; meshIndex?: number; skinIndex?: number; morphWeights?: number[]; worldMatrix?: Float32Array };

// Runtime snapshot types for save/load
type NodeKey = string; // "s<scene>/<i0>/<i1>/.../<ik>" (or detached)
type RuntimeNodeTRS = { t?: vec3arr; r?: vec4arr; s?: vec3arr };
type RuntimeNodeState = { trs?: RuntimeNodeTRS; weights?: number[]; visible?: boolean };
type RuntimeAnim = { time?: number; speed?: number; activeClip?: string | number; loop?: boolean };
type PersistedMatTex = Partial<{ albedo: number; normal: number; metallicRoughness: number; color: color_arr; metallicFactor: number; roughnessFactor: number }>;
type MeshRuntime = { version: 1; model_id?: asset_id; nodes?: Record<NodeKey, RuntimeNodeState>; anim?: RuntimeAnim };

@insavegame
export class MeshComponent extends Component {
	public modelId!: asset_id;

	@excludepropfromsavegame
	private model?: GLTFModel;

	@excludepropfromsavegame
	private instances: MeshInstance[] = [];

	// Animation + per-node caches
	public animationTime: number = 0;
	public activeClipIndex: number | null = null;
	public animationLoop: boolean = true;
	@excludepropfromsavegame private worldMatrices: Float32Array[] = [];
	@excludepropfromsavegame private nodeDirty: boolean[] = [];
	@excludepropfromsavegame private renderMeshes: RenderMesh[] = [];
	@excludepropfromsavegame private _tmpLocal: Float32Array = new Float32Array(16);
	@excludepropfromsavegame private skinMatrices: (Float32Array[] | undefined)[] = [];
	@excludepropfromsavegame private skinDirty: boolean[] = [];
	@excludepropfromsavegame private _skinTmpMatrix: Float32Array = new Float32Array(16);
	@excludepropfromsavegame private _skinMeshInverse: Float32Array = new Float32Array(16);
	private static readonly _ID: Float32Array = (() => { const m = new Float32Array(16); M4.setIdentity(m); return m; })();
	private static readonly _quatScratchA: Float32Array = new Float32Array(4);
	private static readonly _quatScratchB: Float32Array = new Float32Array(4);

	// Runtime snapshot used solely during (de)serialization
	private _runtime?: MeshRuntime;

	// Persisted material overrides by GLTF mesh index
	public materialOverrides?: Record<number, PersistedMatTex>;

	// Rendering config
	/** Enable per-instance frustum culling (default true). */
	public enableCulling: boolean = true;
	/** Distance in world units beyond which morph weights are dropped (default 50). Set <= 0 to disable. */
	public lodMorphDropDistance: number = 50;
	/** Distance in world units beyond which morphs are fully disabled (default 120). Set <= 0 to disable. */
	public lodMorphDisableDistance: number = 120;

	constructor(opts: ComponentAttachOptions & { modelId: asset_id }) {
		super(opts);
		this.modelId = opts.modelId;
		this.tryLoadModelAndBuild();
	}

	public setModel(id: asset_id): void {
		if (this.modelId === id) return;
		this.modelId = id;
		this.tryLoadModelAndBuild();
	}

	private tryLoadModelAndBuild(): void {
		const m = $.rompack.model?.[this.modelId];
		if (!m) return;
		this.model = m;
		this.buildInstances();
		this.applyMaterialOverrides();
		this.fetchAndBindModelTextures();
	}

	private resetSkinCaches(): void {
		const count = this.model?.skins?.length ?? 0;
		this.skinMatrices = new Array(count);
		this.skinDirty = new Array(count).fill(true);
	}

	private markAllSkinsDirty(): void {
		for (let i = 0; i < this.skinDirty.length; i++) this.skinDirty[i] = true;
	}

	private buildInstances(): void {
		this.instances.length = 0;
		this.renderMeshes.length = 0;
		const model = this.model!;
		const nodes = model.nodes ?? [];
		if (!nodes || nodes.length === 0) return;

		// Convert GLTFMesh to engine RenderMesh (build once per GLTF mesh)
		const createRenderMesh = (g: GLTFMesh, mdl: GLTFModel, index: number): RenderMesh => {
			const renderMesh = new RenderMesh({
				positions: g.positions,
				texcoords: g.texcoords ?? new Float32Array(),
				normals: g.normals ?? null,
				tangents: g.tangents ?? null,
				indices: g.indices,
				atlasId: g.materialIndex !== undefined ? 255 : 0,
				morphPositions: g.morphPositions,
				morphNormals: g.morphNormals,
				morphTangents: g.morphTangents,
				morphWeights: g.weights ? [...g.weights] : (g.morphPositions ? new Array(g.morphPositions.length).fill(0) : []),
				jointIndices: g.jointIndices,
				jointWeights: g.jointWeights,
				meshname: `${mdl.name}_${index}`,
			});
			const mat = mdl.materials?.[g.materialIndex ?? 0];
			let albedo = mat?.baseColorTexture;
			let normal = mat?.normalTexture;
			let metallicRoughness = mat?.metallicRoughnessTexture;
			if (mdl.textures) {
				if (albedo !== undefined) albedo = mdl.textures[albedo] ?? albedo;
				if (normal !== undefined) normal = mdl.textures[normal] ?? normal;
				if (metallicRoughness !== undefined) metallicRoughness = mdl.textures[metallicRoughness] ?? metallicRoughness;
			}
			const alphaMode = mat?.alphaMode ?? 'OPAQUE';
			const surface: Material['surface'] = alphaMode === 'MASK' ? 'masked' : alphaMode === 'BLEND' ? 'transparent' : 'opaque';
			const material = new Material({
				color: mat?.baseColorFactor ? [...mat.baseColorFactor] : [1, 1, 1, 1],
				textures: {
					albedo: albedo !== undefined ? albedo : undefined,
					normal: normal !== undefined ? normal : undefined,
					metallicRoughness: metallicRoughness !== undefined ? metallicRoughness : undefined,
				},
				metallicFactor: mat?.metallicFactor ?? 1.0,
				roughnessFactor: mat?.roughnessFactor ?? 1.0,
				doubleSided: mat?.doubleSided ?? false,
			});
			material.surface = surface;
			material.alphaCutoff = alphaMode === 'MASK' ? (mat?.alphaCutoff ?? 0.5) : 0.5;
			renderMesh.material = material;
			return renderMesh;
		};

		// Build renderMeshes for all GLTF meshes once
		for (let mi = 0; mi < model.meshes.length; mi++) {
			this.renderMeshes[mi] = createRenderMesh(model.meshes[mi], model, mi);
		}

		// Initialize per-node caches
		this.worldMatrices = nodes.map(() => { const m = new Float32Array(16); M4.setIdentity(m); return m; });
		this.nodeDirty = nodes.map(() => true);
		this.resetSkinCaches();

		// Traverse active scene roots to build instances similar to MeshObject
		if (model.scenes && model.scenes.length > 0) {
			const scene = model.scenes[model.scene ?? 0];
			if (scene) for (const root of scene.nodes) this.traverse(root, MeshComponent._ID);
		} else {
			// Fallback: no nodes/scenes, one instance per mesh at identity
			for (let i = 0; i < this.renderMeshes.length; i++) {
				const mesh = this.renderMeshes[i];
				this.instances.push({ mesh, meshIndex: i, morphWeights: mesh.morphWeights.slice() });
			}
		}
	}

	private traverse(nodeIndex: number, parent: Float32Array): void {
		if (!this.model?.nodes) return;
		const world = this.getWorldMatrixFrom(nodeIndex, parent);
		const node: GLTFNode = this.model.nodes[nodeIndex];
		if (node.mesh !== undefined) {
			const mesh = this.renderMeshes[node.mesh];
			if (mesh) {
				const weights = node.weights ? [...node.weights] : mesh.morphWeights.slice();
				this.instances.push({ mesh, nodeIndex, meshIndex: node.mesh, skinIndex: node.skin, morphWeights: weights });
			}
		}
		const ch = node.children as number[] | undefined;
		if (ch) for (const c of ch) this.traverse(c, world);
	}

	private getWorldMatrixFrom(nodeIndex: number, parent: Float32Array): Float32Array {
		if (this.nodeDirty[nodeIndex]) {
			const node: GLTFNode = this.model!.nodes![nodeIndex];
			const local = node.matrix ? new Float32Array(node.matrix) : this.composeNodeMatrixInto(this._tmpLocal, node);
			const world = this.worldMatrices[nodeIndex] ?? (this.worldMatrices[nodeIndex] = new Float32Array(16));
			M4.mulAffineInto(world, parent, local);
			this.nodeDirty[nodeIndex] = false;
		}
		return this.worldMatrices[nodeIndex];
	}

	private composeNodeMatrixInto(out: Float32Array, node: GLTFNode): Float32Array {
		const t = node.translation ?? [0, 0, 0];
		const q = node.rotation ?? undefined;
		const s = node.scale ?? [1, 1, 1];
		return M4.fromTRSInto(out, [t[0], t[1], t[2]], q, [s[0], s[1], s[2]]);
	}

	private computeSkinMatrices(skinIndex: number, meshNodeIndex: number, meshNodeWorld: Float32Array): Float32Array[] | undefined {
		const skin = this.model?.skins?.[skinIndex];
		if (!skin || skin.joints.length === 0) return undefined;
		let cache = this.skinMatrices[skinIndex];
		if (!cache || cache.length !== skin.joints.length) {
			cache = new Array(skin.joints.length);
			for (let i = 0; i < skin.joints.length; i++) cache[i] = new Float32Array(16);
			this.skinMatrices[skinIndex] = cache;
		}
		if (this.skinDirty[skinIndex]) {
			this.skinDirty[skinIndex] = false;
			const meshWorld = this.worldMatrices[meshNodeIndex] ?? meshNodeWorld;
			const meshInv = this._skinMeshInverse;
			M4.invertAffineInto(meshInv, meshWorld);
			for (let i = 0; i < skin.joints.length; i++) {
				const jointIdx = skin.joints[i];
				const jointWorld = this.worldMatrices[jointIdx] ?? MeshComponent._ID;
				const inv = skin.inverseBindMatrices?.[i] ?? MeshComponent._ID;
				const tmp = this._skinTmpMatrix;
				M4.mulAffineInto(tmp, jointWorld, inv);
				M4.mulAffineInto(cache[i], meshInv, tmp);
			}
		}
		return cache;
	}

	public stepAnimation(dtSec: number): void {
		const anims = this.model?.animations;
		if (!anims || anims.length === 0) return;
		this.animationTime += dtSec;
		let nodesChanged = false;
		const plays = (this.activeClipIndex != null) ? [anims[this.activeClipIndex]] : anims;
		for (const anim of plays) {
			for (const channel of (anim as GLTFAnimation).channels) {
				const sampler = (anim as GLTFAnimation).samplers[channel.sampler];
				if (!sampler || !sampler.input || !sampler.output) continue;
				const stride = sampler.output.length / sampler.input.length;
				const comp = sampler.interpolation === 'CUBICSPLINE' ? stride / 3 : stride;
				const path = channel.target.path ?? '';
				const value = this.sampleAnimation(sampler, this.animationTime, comp, path);
				if (channel.target.node !== undefined && this.model?.nodes) {
					const node: GLTFNode = this.model.nodes[channel.target.node];
					switch (channel.target.path) {
						case 'rotation': {
							const q = { x: value[0], y: value[1], z: value[2], w: value[3] };
							node.rotation = [q.x, q.y, q.z, q.w];
							node.matrix = undefined;
							this.nodeDirty[channel.target.node] = true;
							nodesChanged = true;
							break;
						}
						case 'translation':
							node.translation = [value[0], value[1], value[2]];
							node.matrix = undefined;
							this.nodeDirty[channel.target.node] = true;
							nodesChanged = true;
							break;
						case 'scale':
							node.scale = [value[0], value[1], value[2]];
							node.matrix = undefined;
							this.nodeDirty[channel.target.node] = true;
							nodesChanged = true;
							break;
						case 'weights':
							if (node.mesh !== undefined) {
								const weights = Array.from(value);
								node.weights = weights;
								for (const inst of this.instances) if (inst.nodeIndex === channel.target.node) inst.morphWeights = weights;
								nodesChanged = true;
							}
							break;
					}
				}
			}
		}
		if (nodesChanged && this.model?.nodes) {
			for (let i = 0; i < this.nodeDirty.length; i++) this.nodeDirty[i] = true;
			this.markAllSkinsDirty();
			if (this.model.scenes && this.model.scenes.length > 0) {
				const scene = this.model.scenes[this.model.scene ?? 0];
				if (scene) for (const root of scene.nodes) this.getWorldMatrixFrom(root, MeshComponent._ID);
			}
		}
	}

	private sampleAnimation(s: GLTFAnimationSampler, time: number, stride: number, path: string): Float32Array {
		const input = s.input;
		const output = s.output;
		const last = input.length - 1;
		const duration = last >= 0 ? input[last] : 0;
		const loop = this._runtime?.anim?.loop ?? this.animationLoop;
		let t = 0;
		if (last >= 0) {
			if (loop) {
				t = duration > 0 ? (time % duration) : 0;
			} else {
				t = duration > 0 ? Math.min(time, duration) : 0;
			}
		}
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
				if (path === 'rotation') {
					const q0 = this.readQuatAt(s, i, stride, MeshComponent._quatScratchA);
					const q1 = this.readQuatAt(s, j, stride, MeshComponent._quatScratchB);
					MeshComponent.slerpQuat(q0, q1, alpha, res);
				} else {
					const start = i * stride;
					const end = j * stride;
					for (let k = 0; k < stride; k++) {
						const v0 = output[start + k];
						const v1 = output[end + k];
						res[k] = v0 + (v1 - v0) * alpha;
					}
				}
				break;
			}
		}
		if (path === 'rotation') MeshComponent.normalizeQuat(res);
		return res;
	}

	private readQuatAt(s: GLTFAnimationSampler, index: number, stride: number, target: Float32Array): Float32Array {
		const start = index * stride;
		for (let k = 0; k < stride; k++) target[k] = s.output[start + k];
		return target;
	}

	private static slerpQuat(a: Float32Array, b: Float32Array, t: number, out: Float32Array): Float32Array {
		let ax = a[0], ay = a[1], az = a[2], aw = a[3];
		let bx = b[0], by = b[1], bz = b[2], bw = b[3];
		let cos = ax * bx + ay * by + az * bz + aw * bw;
		if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
		if (cos > 0.9995) {
			out[0] = ax + t * (bx - ax);
			out[1] = ay + t * (by - ay);
			out[2] = az + t * (bz - az);
			out[3] = aw + t * (bw - aw);
		} else {
			const theta = Math.acos(cos);
			const sinTheta = Math.sin(theta);
			const s0 = Math.sin((1 - t) * theta) / sinTheta;
			const s1 = Math.sin(t * theta) / sinTheta;
			out[0] = ax * s0 + bx * s1;
			out[1] = ay * s0 + by * s1;
			out[2] = az * s0 + bz * s1;
			out[3] = aw * s0 + bw * s1;
		}
		MeshComponent.normalizeQuat(out);
		return out;
	}

	private static normalizeQuat(q: Float32Array): void {
		const len = Math.hypot(q[0], q[1], q[2], q[3]);
		if (len > 0) {
			const inv = 1 / len;
			q[0] *= inv; q[1] *= inv; q[2] *= inv; q[3] *= inv;
		} else {
			q[0] = 0; q[1] = 0; q[2] = 0; q[3] = 1;
		}
	}

	/** Apply lightweight material overrides for all instances of a GLTF mesh index and persist the override. */
	public setMaterialOverride(meshIndex: number, overrides: PersistedMatTex): void {
		this.materialOverrides ??= {};
		this.materialOverrides[meshIndex] = { ...(this.materialOverrides[meshIndex] ?? {}), ...overrides };
		if (!this.model) return;
		for (const inst of this.instances) {
			if (inst.meshIndex !== meshIndex) continue;
			const mat = inst.mesh.material;
			if (!mat) continue;
			if (overrides.albedo !== undefined) mat.textures.albedo = overrides.albedo;
			if (overrides.normal !== undefined) mat.textures.normal = overrides.normal;
			if (overrides.metallicRoughness !== undefined) mat.textures.metallicRoughness = overrides.metallicRoughness;
			if (overrides.color) mat.color = [...overrides.color];
			if (overrides.metallicFactor !== undefined) mat.metallicFactor = overrides.metallicFactor;
			if (overrides.roughnessFactor !== undefined) mat.roughnessFactor = overrides.roughnessFactor;
		}
		this.rebindMaterialTexturesFromModelKeys();
	}

	private applyMaterialOverrides(): void {
		if (!this.materialOverrides) return;
		for (const k in this.materialOverrides) {
			const idx = parseInt(k, 10);
			this.setMaterialOverride(idx, this.materialOverrides[idx]);
		}
	}

	private async fetchAndBindModelTextures(): Promise<void> {
		const model = this.model; if (!model) return;
		if (!model.gpuTextures) {
			try {
				const genGuard = model; // capture to guard against model switch during await
				const keys = await $.texmanager.fetchModelTextures(model);
				if (this.model !== genGuard) return; // model changed
				this.model.gpuTextures = keys;
			} catch (e) {
				console.error('[MeshComponent] fetchModelTextures failed:', e);
			}
		}
		this.rebindMaterialTexturesFromModelKeys();
	}

	private rebindMaterialTexturesFromModelKeys(): void {
		const keys = this.model?.gpuTextures; if (!keys) return;
		for (const inst of this.instances) {
			const mat = inst.mesh.material; if (!mat) continue;
			const t = mat.textures ?? {};
			mat.gpuTextures.albedo = t.albedo !== undefined ? keys[t.albedo] : undefined;
			mat.gpuTextures.normal = t.normal !== undefined ? keys[t.normal] : undefined;
			mat.gpuTextures.metallicRoughness = t.metallicRoughness !== undefined ? keys[t.metallicRoughness] : undefined;
		}
	}

	// Utility used by system to emit submissions for this component
	public collectSubmissions(base: Float32Array, receiveShadow: boolean = true): MeshRenderSubmission[] {
		const out: MeshRenderSubmission[] = [];
		for (const inst of this.instances) {
			const nodeWorld = (this.model && inst.nodeIndex !== undefined) ? (this.worldMatrices[inst.nodeIndex] ?? MeshComponent._ID) : MeshComponent._ID;
			const world = inst.worldMatrix ?? (inst.worldMatrix = new Float32Array(16));
			M4.mulAffineInto(world, base, nodeWorld);
			const joints = (inst.skinIndex !== undefined && inst.nodeIndex !== undefined)
				? this.computeSkinMatrices(inst.skinIndex, inst.nodeIndex, nodeWorld)
				: undefined;
			if (!receiveShadow && inst.mesh.shadow) { inst.mesh.shadow = undefined; }
			out.push({ mesh: inst.mesh, matrix: world, jointMatrices: joints, morphWeights: inst.morphWeights });
		}
		return out;
	}

	// --- Runtime save/load -------------------------------------------------

	// Stable node key map for savegames
	private static buildNodeKeyMap(model: GLTFModel): { toKey: (i: number) => NodeKey; toIndex: (k: NodeKey) => number | undefined } {
		const nodes = model.nodes ?? [];
		const sceneIndex = model.scene ?? 0;
		const scene = model.scenes?.[sceneIndex];
		if (!scene) {
			const map = new Map<string, number>();
			for (let i = 0; i < nodes.length; i++) map.set(`s-1/${i}`, i);
			return { toKey: (i) => `s-1/${i}`, toIndex: (k) => map.get(k) };
		}
		const parentOf: number[] = new Array(nodes.length).fill(-1);
		for (let p = 0; p < nodes.length; p++) {
			const ch = nodes[p]?.children ?? [];
			for (const c of ch) parentOf[c] = p;
		}
		const cacheKey: (string | undefined)[] = new Array(nodes.length);
		const keyOf = (i: number): string => {
			if (cacheKey[i] !== undefined) return cacheKey[i]!;
			let p = parentOf[i];
			let path = `${i}`;
			while (p !== -1) { path = `${p}/${path}`; p = parentOf[p]; }
			const isRooted = scene.nodes.includes(parseInt(path.split('/')[0], 10));
			const key = isRooted ? `s${sceneIndex}/${path}` : `s${sceneIndex}#detached/${path}`;
			cacheKey[i] = key; return key;
		};
		const map = new Map<string, number>();
		for (let i = 0; i < nodes.length; i++) map.set(keyOf(i), i);
		return { toKey: keyOf, toIndex: (k) => map.get(k) };
	}

	@onsave
	public saveRuntime(): { _runtime: MeshRuntime } {
		const runtime: MeshRuntime = { version: 1 };
		if (this.modelId !== undefined) runtime.model_id = this.modelId;

		if (this.model?.nodes && this.model.scenes?.length) {
			const { toKey } = MeshComponent.buildNodeKeyMap(this.model);
			const map: Record<NodeKey, RuntimeNodeState> = {};
			for (let i = 0; i < this.model.nodes.length; i++) {
				const n = this.model.nodes[i];
				const k = toKey(i);
				const st: RuntimeNodeState = {};
				if (n.translation || n.rotation || n.scale) {
					st.trs = {};
					if (n.translation) st.trs.t = [...n.translation] as vec3arr;
					if (n.rotation) st.trs.r = [...n.rotation] as vec4arr;
					if (n.scale) st.trs.s = [...n.scale] as vec3arr;
				}
				if (n.weights) st.weights = [...n.weights];
				if (n.visible !== undefined) st.visible = !!n.visible;
				if (st.trs || st.weights || st.visible !== undefined) map[k] = st;
			}
			if (Object.keys(map).length) runtime.nodes = map;
		}

		if (this.animationTime !== undefined) {
			runtime.anim = { time: this.animationTime ?? 0, loop: this.animationLoop };
		}
		return { _runtime: runtime };
	}

	@onsave
	// @ts-ignore
	private captureMaterialOverrides() {
		const out: Record<number, PersistedMatTex> = {};
		for (let i = 0; i < this.renderMeshes.length; i++) {
			const m = this.renderMeshes[i];
			const t = m?.material?.textures; if (!t) continue;
			const o: PersistedMatTex = {};
			if (t.albedo !== undefined) o.albedo = t.albedo;
			if (t.normal !== undefined) o.normal = t.normal;
			if (t.metallicRoughness !== undefined) o.metallicRoughness = t.metallicRoughness;
			if (Object.keys(o).length) out[i] = o;
		}
		if (Object.keys(out).length) return { materialOverrides: out };
		return {};
	}

	@onload
	public onLoad(): void {
		const rt = this._runtime;
		if (this._runtime) delete this._runtime;

		if (rt?.model_id !== undefined) this.modelId = rt.model_id;
		const model = $.rompack.model?.[this.modelId] ?? this.model;
		if (!model) return;

		this.model = model;
		this.buildInstances();
		if (rt?.anim) {
			if (rt.anim.time !== undefined) this.animationTime = rt.anim.time;
			if (rt.anim.loop !== undefined) this.animationLoop = !!rt.anim.loop;
		}

		if (rt?.nodes && this.model?.nodes) {
			const { toIndex } = MeshComponent.buildNodeKeyMap(this.model);
			let anyDirty = false;
			for (const [k, ns] of Object.entries(rt.nodes)) {
				const idx = toIndex(k);
				if (idx === undefined) continue;
				const node = this.model.nodes[idx];
				if (ns.trs) {
					if (ns.trs.t) node.translation = [...ns.trs.t] as vec3arr;
					if (ns.trs.r) node.rotation = [...ns.trs.r] as vec4arr;
					if (ns.trs.s) node.scale = [...ns.trs.s] as vec3arr;
					node.matrix = undefined;
					anyDirty = true;
				}
				if (ns.weights) {
					node.weights = [...(ns.weights)];
					for (const inst of this.instances) if (inst.nodeIndex === idx) inst.morphWeights = node.weights;
				}
				if (ns.visible !== undefined) node.visible = !!ns.visible;
			}
			if (anyDirty) {
				for (let i = 0; i < this.nodeDirty.length; i++) this.nodeDirty[i] = true;
				this.markAllSkinsDirty();
				if (this.model.scenes && this.model.scenes.length > 0) {
				const scene = this.model.scenes[this.model.scene ?? 0];
				if (scene) for (const root of scene.nodes) this.getWorldMatrixFrom(root, MeshComponent._ID);
				}
			}
		}

		this.applyMaterialOverrides();

		if (!this.model.gpuTextures) {
			$.texmanager.fetchModelTextures(this.model).then(keys => {
				if (this.model) { this.model.gpuTextures = keys; this.rebindMaterialTexturesFromModelKeys(); }
			});
		} else {
			this.rebindMaterialTexturesFromModelKeys();
		}
	}
}
