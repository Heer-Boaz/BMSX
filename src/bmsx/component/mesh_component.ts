import { Component } from 'bmsx/component/basecomponent';
import { $ } from 'bmsx/core/game';
import { M4 } from 'bmsx/render/3d/math3d';
import type { asset_id, GLTFModel, GLTFMesh, GLTFAnimation, GLTFAnimationSampler } from 'bmsx/rompack/rompack';
import { Mesh as RenderMesh } from 'bmsx/core/object/mesh';
import { Material } from 'bmsx/render/3d/material';
import { insavegame, excludepropfromsavegame, type RevivableObjectArgs } from 'bmsx/serializer/serializationhooks';
import type { MeshRenderSubmission } from 'bmsx/render/gameview';

type MeshInstance = { mesh: RenderMesh; nodeIndex?: number; meshIndex?: number; skinIndex?: number; morphWeights?: number[] };

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
	@excludepropfromsavegame private worldMatrices: Float32Array[] = [];
	@excludepropfromsavegame private nodeDirty: boolean[] = [];
	@excludepropfromsavegame private renderMeshes: RenderMesh[] = [];

	// Persisted material overrides by GLTF mesh index
	public materialOverrides?: Record<number, Partial<{ albedo: number; normal: number; metallicRoughness: number; color: [number, number, number, number]; metallicFactor: number; roughnessFactor: number }>>;

	// Rendering config
	/** Enable per-instance frustum culling (default true). */
	public enableCulling: boolean = true;
	/** Distance in world units beyond which morph weights are dropped (default 50). Set <= 0 to disable. */
	public lodMorphDropDistance: number = 50;
	/** Distance in world units beyond which morphs are fully disabled (default 120). Set <= 0 to disable. */
	public lodMorphDisableDistance: number = 120;

	constructor(opts: RevivableObjectArgs & { parentid: string; modelId: asset_id }) {
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

	private buildInstances(): void {
		this.instances.length = 0;
		this.renderMeshes.length = 0;
		const model = this.model!;
		const nodes = model.nodes ?? [];
		if (!nodes || nodes.length === 0) return;

		// Convert GLTFMesh to engine RenderMesh (build once per GLTF mesh)
		const createRenderMesh = (g: GLTFMesh, mdl: GLTFModel, index: number): RenderMesh => {
			const m = new RenderMesh({
				positions: g.positions.slice(),
				texcoords: g.texcoords?.slice() ?? new Float32Array(),
				normals: g.normals?.slice() ?? null,
				tangents: g.tangents?.slice() ?? null,
				indices: g.indices?.slice() ?? undefined,
				atlasId: g.materialIndex !== undefined ? 255 : 0,
				morphPositions: g.morphPositions?.map(t => t.slice()),
				morphNormals: g.morphNormals?.map(t => t.slice()),
				morphTangents: g.morphTangents?.map(t => t.slice()),
				morphWeights: g.weights ? [...g.weights] : [],
				jointIndices: g.jointIndices?.slice(),
				jointWeights: g.jointWeights?.slice(),
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
		};

		// Build renderMeshes for all GLTF meshes once
		for (let mi = 0; mi < model.meshes.length; mi++) {
			this.renderMeshes[mi] = createRenderMesh(model.meshes[mi], model, mi);
		}

		// Initialize per-node caches
		this.worldMatrices = nodes.map(() => M4.identity());
		this.nodeDirty = nodes.map(() => true);

		// Traverse active scene roots to build instances similar to MeshObject
		if (model.scenes && model.scenes.length > 0) {
			const scene = model.scenes[model.scene ?? 0];
			if (scene) for (const root of scene.nodes) this.traverse(root, M4.identity());
		} else {
			// Fallback: no nodes/scenes, one instance per mesh at identity
			for (let i = 0; i < this.renderMeshes.length; i++) {
				const mesh = this.renderMeshes[i];
				this.instances.push({ mesh, nodeIndex: i, meshIndex: i, morphWeights: mesh.morphWeights.slice() });
			}
		}
	}

	private traverse(nodeIndex: number, parent: Float32Array): void {
		if (!this.model?.nodes) return;
		const world = this.getWorldMatrixFrom(nodeIndex, parent);
		const node: any = this.model.nodes[nodeIndex];
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
			const node: any = this.model!.nodes![nodeIndex];
			const local = node.matrix ? new Float32Array(node.matrix) : this.composeNodeMatrix(node);
			const world = this.worldMatrices[nodeIndex] ?? (this.worldMatrices[nodeIndex] = new Float32Array(16));
			M4.mulInto(world, parent, local);
			this.nodeDirty[nodeIndex] = false;
		}
		return this.worldMatrices[nodeIndex];
	}

	private composeNodeMatrix(node: any): Float32Array {
		const t = node.translation ?? [0, 0, 0];
		const q = node.rotation ?? undefined;
		const s = node.scale ?? [1, 1, 1];
		return M4.fromTRS([t[0], t[1], t[2]], q, [s[0], s[1], s[2]]);
	}

	private computeSkinMatrices(skinIndex: number): Float32Array[] | undefined {
		const skin = this.model?.skins?.[skinIndex];
		if (!skin || skin.joints.length === 0) return undefined;
		const out: Float32Array[] = [];
		for (let i = 0; i < skin.joints.length; i++) {
			const jointIdx = skin.joints[i];
			const jointWorld = this.worldMatrices[jointIdx];
			const inv = skin.inverseBindMatrices?.[i] ?? M4.identity();
			const buf = new Float32Array(16);
			M4.mulInto(buf, jointWorld, inv);
			out.push(buf);
		}
		return out;
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
				const value = this.sampleAnimation(sampler, this.animationTime, comp);
				if (channel.target.node !== undefined && this.model?.nodes) {
					const node: any = this.model.nodes[channel.target.node];
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
			if (this.model.scenes && this.model.scenes.length > 0) {
				const scene = this.model.scenes[this.model.scene ?? 0];
				if (scene) for (const root of scene.nodes) this.getWorldMatrixFrom(root, M4.identity());
			}
		}
	}

	private sampleAnimation(s: GLTFAnimationSampler, time: number, stride: number): Float32Array {
		const input = s.input;
		const output = s.output;
		const last = input.length - 1;
		const t = last >= 0 ? (true ? (time % input[last]) : Math.min(time, input[last])) : 0;
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

	/** Apply lightweight material overrides for all instances of a GLTF mesh index and persist the override. */
	public setMaterialOverride(meshIndex: number, overrides: Partial<{ albedo: number; normal: number; metallicRoughness: number; color: [number, number, number, number]; metallicFactor: number; roughnessFactor: number }>): void {
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
			const t = mat.textures ?? {} as any;
			mat.gpuTextures.albedo = t.albedo !== undefined ? keys[t.albedo] : undefined;
			mat.gpuTextures.normal = t.normal !== undefined ? keys[t.normal] : undefined;
			mat.gpuTextures.metallicRoughness = t.metallicRoughness !== undefined ? keys[t.metallicRoughness] : undefined;
		}
	}

	// Utility used by system to emit submissions for this component
	public collectSubmissions(base: Float32Array, receiveShadow: boolean = true): MeshRenderSubmission[] {
		const out: MeshRenderSubmission[] = [];
		for (const inst of this.instances) {
			const localNow = this.model && inst.nodeIndex !== undefined ? this.worldMatrices[inst.nodeIndex] : M4.identity();
			const world = M4.mul(base, localNow);
			const joints = (inst.skinIndex !== undefined) ? this.computeSkinMatrices(inst.skinIndex) : undefined;
			if (!receiveShadow && (inst.mesh as any).shadow) { (inst.mesh as any).shadow = undefined; }
			out.push({ mesh: inst.mesh, matrix: world, jointMatrices: joints, morphWeights: inst.morphWeights });
		}
		return out;
	}
}
