import { Component, type ComponentAttachOptions } from '../component/basecomponent';
import { $ } from '../core/game';
import { createGameEvent } from '../core/game_event';
import { M4, V4 } from '../render/3d/math3d';
import type { asset_id, GLTFModel, GLTFMesh, GLTFAnimation, GLTFAnimationSampler, GLTFNode, color_arr, vec3arr, vec4arr } from '../rompack/rompack';
import { Mesh as RenderMesh } from '../render/3d/mesh';
import { Material } from '../render/3d/material';
import { insavegame, excludepropfromsavegame, onsave, onload } from '../serializer/serializationhooks';
import type { MeshRenderSubmission } from '../render/gameview';

type MeshInstance = { mesh: RenderMesh; nodeIndex?: number; meshIndex?: number; skinIndex?: number; morphWeights?: number[]; worldMatrix?: Float32Array };

// Runtime snapshot types for save/load
type NodeKey = string; // "s<scene>/<i0>/<i1>/.../<ik>" (or detached)
type RuntimeNodeTRS = { t?: vec3arr; r?: vec4arr; s?: vec3arr };
type RuntimeNodeState = { trs?: RuntimeNodeTRS; weights?: number[]; visible?: boolean };
type MeshAnimationNotify = { time: number; event: string; payload?: Record<string, unknown>; scope?: 'self' | 'global'; once?: boolean; };
type RuntimeClipState = {
	clipId: string;
	time?: number;
	speed?: number;
	loop?: boolean;
	weight?: number;
	targetWeight?: number;
	blendDuration?: number;
	blendElapsed?: number;
	applyRootMotion?: boolean;
	lastRootTranslation?: [number, number, number];
	notifyCursor?: number;
	notifies?: MeshAnimationNotify[];
};
type RuntimeAnim = {
	current?: RuntimeClipState;
	previous?: RuntimeClipState;
	rootMotionNode?: number;
	autoResetPose?: boolean;
};
type LegacyRuntimeAnim = { time?: number; speed?: number; activeClip?: asset_id; loop?: boolean };
type PersistedMatTex = Partial<{ albedo: number; normal: number; metallicRoughness: number; color: color_arr; metallicFactor: number; roughnessFactor: number }>;
type MeshRuntime = { version: 1; model_id?: asset_id; nodes?: Record<NodeKey, RuntimeNodeState>; anim?: RuntimeAnim | LegacyRuntimeAnim };
type MeshClipState = {
	name: string;
	clip: GLTFAnimation;
	time: number;
	speed: number;
	loop: boolean;
	weight: number;
	targetWeight: number;
	blendDuration: number;
	blendElapsed: number;
	applyRootMotion: boolean;
	lastRootTranslation: Float32Array;
	notifies?: MeshAnimationNotify[];
	notifyCursor: number;
};

export type MeshClipPlayOptions = {
	loop?: boolean;
	speed?: number;
	fadeSeconds?: number;
	resetTime?: boolean;
	applyRootMotion?: boolean;
	startTime?: number;
};

@insavegame
export class MeshComponent extends Component {
	public modelId!: asset_id;

	@excludepropfromsavegame
	private model?: GLTFModel;

	@excludepropfromsavegame
	private instances: MeshInstance[] = [];

	// Animation + per-node caches
	@excludepropfromsavegame private worldMatrices: Float32Array[] = [];
	@excludepropfromsavegame private nodeDirty: boolean[] = [];
	@excludepropfromsavegame private renderMeshes: RenderMesh[] = [];
	@excludepropfromsavegame private _tmpLocal: Float32Array = new Float32Array(16);
	@excludepropfromsavegame private _tmpRotation: Float32Array = new Float32Array(16);
	@excludepropfromsavegame private skinMatrices: (Float32Array[] | undefined)[] = [];
	@excludepropfromsavegame private skinDirty: boolean[] = [];
	@excludepropfromsavegame private _skinTmpMatrix: Float32Array = new Float32Array(16);
	@excludepropfromsavegame private _skinMeshInverse: Float32Array = new Float32Array(16);
	private static readonly _ID: Float32Array = (() => { const m = new Float32Array(16); M4.setIdentity(m); return m; })();
	private static readonly _quatScratchA: Float32Array = new Float32Array(4);
	private static readonly _quatScratchB: Float32Array = new Float32Array(4);
	@excludepropfromsavegame private baseTranslation: Float32Array[] = [];
	@excludepropfromsavegame private baseRotation: Float32Array[] = [];
	@excludepropfromsavegame private baseScale: Float32Array[] = [];
	@excludepropfromsavegame private baseWeights: (Float32Array | undefined)[] = [];
	@excludepropfromsavegame private poseTranslation: Float32Array[] = [];
	@excludepropfromsavegame private poseRotation: Float32Array[] = [];
	@excludepropfromsavegame private poseScale: Float32Array[] = [];
	@excludepropfromsavegame private poseWeights: (Float32Array | undefined)[] = [];
	@excludepropfromsavegame private poseVisibility: (boolean | undefined)[] = [];
	@excludepropfromsavegame private _sampleVec3: Float32Array = new Float32Array(3);
	@excludepropfromsavegame private _sampleQuat: Float32Array = new Float32Array(4);
	@excludepropfromsavegame private _sampleWeights?: Float32Array;
	@excludepropfromsavegame private _currentClip?: MeshClipState;
	@excludepropfromsavegame private _previousClip?: MeshClipState;
	@excludepropfromsavegame private _clipNotifies: Map<string, MeshAnimationNotify[]> = new Map();
	@excludepropfromsavegame private _clipDurationCache: Map<string, number> = new Map();
	@excludepropfromsavegame private _rootMotionDelta: Float32Array = new Float32Array(3);
	@excludepropfromsavegame private _rootMotionNode: number = 0;
	@excludepropfromsavegame private _autoResetPose: boolean = true;

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
		const rom = $.rompack.model;
		if (!rom) {
			throw new Error(`[MeshComponent] ROM pack not loaded when constructing '${this.id}'.`);
		}
		const model = rom[this.modelId];
		if (!model) {
			throw new Error(`[MeshComponent] Model '${this.modelId}' not found for '${this.id}'.`);
		}
		this.model = model;
		this.buildInstances();
		this.applyMaterialOverrides();
		void this.fetchAndBindModelTextures();
	}

	private modelOrThrow(): GLTFModel {
		const model = this.model;
		if (!model) {
			throw new Error(`[MeshComponent] Model '${this.modelId}' requested before load on '${this.id}'.`);
		}
		return model;
	}

	private resetSkinCaches(): void {
		const model = this.modelOrThrow();
		const count = model.skins?.length ?? 0;
		this.skinMatrices = new Array(count);
		this.skinDirty = new Array(count).fill(true);
	}

	private initializePoseFromModel(): void {
		const nodes = this.modelOrThrow().nodes ?? [];
		this.baseTranslation = new Array(nodes.length);
		this.baseRotation = new Array(nodes.length);
		this.baseScale = new Array(nodes.length);
		this.baseWeights = new Array(nodes.length);
		this.poseTranslation = new Array(nodes.length);
		this.poseRotation = new Array(nodes.length);
		this.poseScale = new Array(nodes.length);
		this.poseWeights = new Array(nodes.length);
		this.poseVisibility = new Array(nodes.length);
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			const { t, r, s } = MeshComponent.decomposeNode(node);
			this.baseTranslation[i] = t;
			this.baseRotation[i] = r;
			this.baseScale[i] = s;
			this.poseTranslation[i] = new Float32Array(t);
			this.poseRotation[i] = new Float32Array(r);
			this.poseScale[i] = new Float32Array(s);
			if (node.weights) {
				const base = Float32Array.from(node.weights);
				this.baseWeights[i] = base;
				this.poseWeights[i] = new Float32Array(base);
			} else {
				this.baseWeights[i] = undefined;
				this.poseWeights[i] = undefined;
			}
			this.poseVisibility[i] = node.visible;
		}
	}

	private markAllSkinsDirty(): void {
		for (let i = 0; i < this.skinDirty.length; i++) this.skinDirty[i] = true;
	}

	private buildInstances(): void {
		this.instances.length = 0;
		this.renderMeshes.length = 0;
		const model = this.modelOrThrow();
		const nodes = model.nodes ?? [];
		if (!nodes || nodes.length === 0) return;

		// Convert GLTFMesh to engine RenderMesh (build once per GLTF mesh)
		const createRenderMesh = (g: GLTFMesh, mdl: GLTFModel, index: number): RenderMesh => {
			const renderMesh = new RenderMesh({
				positions: g.positions,
				texcoords: g.texcoords ?? new Float32Array(),
				texcoords1: g.texcoords1 ?? new Float32Array(),
				colors: g.colors ?? new Float32Array(),
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
			const resolveTexture = (idx?: number): number | undefined => {
				if (idx === undefined) return undefined;
				return mdl.textures ? mdl.textures[idx] ?? idx : idx;
			};
			const textureUVs = {
				albedo: mat?.baseColorTexCoord,
				normal: mat?.normalTexCoord,
				metallicRoughness: mat?.metallicRoughnessTexCoord,
				occlusion: mat?.occlusionTexCoord,
				emissive: mat?.emissiveTexCoord,
			};
			const textures = {
				albedo: resolveTexture(mat?.baseColorTexture),
				normal: resolveTexture(mat?.normalTexture),
				metallicRoughness: resolveTexture(mat?.metallicRoughnessTexture),
				occlusion: resolveTexture(mat?.occlusionTexture),
				emissive: resolveTexture(mat?.emissiveTexture),
			};
			const alphaMode = mat?.alphaMode ?? 'OPAQUE';
			const surface: Material['surface'] = alphaMode === 'MASK' ? 'masked' : alphaMode === 'BLEND' ? 'transparent' : 'opaque';
			const emissiveFactor: color_arr = mat?.emissiveFactor
				? ([...mat.emissiveFactor] as color_arr)
				: [0, 0, 0, 1];
			const material = new Material({
				textures,
				textureUVs,
				color: mat?.baseColorFactor ? [...mat.baseColorFactor] as color_arr : [1, 1, 1, 1],
				metallicFactor: mat?.metallicFactor ?? 1.0,
				roughnessFactor: mat?.roughnessFactor ?? 1.0,
				doubleSided: mat?.doubleSided ?? false,
				occlusionStrength: mat?.occlusionStrength ?? 1.0,
				normalScale: mat?.normalScale ?? 1.0,
				emissiveFactor,
				unlit: !!mat?.unlit,
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
		this.initializePoseFromModel();

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
		const model = this.modelOrThrow();
		const nodes = model.nodes;
		if (!nodes) {
			throw new Error(`[MeshComponent] Model '${this.modelId}' is missing nodes while traversing '${this.id}'.`);
		}
		const world = this.getWorldMatrixFrom(nodeIndex, parent);
		const node: GLTFNode = nodes[nodeIndex];
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
			const local = this.composePoseMatrixInto(this._tmpLocal, nodeIndex);
			const world = this.worldMatrices[nodeIndex] ?? (this.worldMatrices[nodeIndex] = new Float32Array(16));
			M4.mulAffineInto(world, parent, local);
			this.nodeDirty[nodeIndex] = false;
		}
		return this.worldMatrices[nodeIndex];
	}

	private composePoseMatrixInto(out: Float32Array, nodeIndex: number): Float32Array {
		const t = this.poseTranslation[nodeIndex] ?? this.baseTranslation[nodeIndex];
		const r = this.poseRotation[nodeIndex] ?? this.baseRotation[nodeIndex];
		const s = this.poseScale[nodeIndex] ?? this.baseScale[nodeIndex];
		M4.setIdentity(out);
		if (t) M4.translateSelf(out, t[0], t[1], t[2]);
		if (r) {
			MeshComponent.normalizeQuat(r);
			M4.quatToMat4Into(this._tmpRotation, V4.fromF32ArrToArr(r));
			M4.mulAffineInto(out, out, this._tmpRotation);
		}
		if (s) M4.scaleSelf(out, s[0], s[1], s[2]);
		return out;
	}

	private resetPoseToBase(): void {
		for (let i = 0; i < this.poseTranslation.length; i++) {
			const baseT = this.baseTranslation[i];
			if (baseT) this.poseTranslation[i].set(baseT);
			const baseR = this.baseRotation[i];
			if (baseR) this.poseRotation[i].set(baseR);
			const baseS = this.baseScale[i];
			if (baseS) this.poseScale[i].set(baseS);
			const baseW = this.baseWeights[i];
			if (baseW) {
				let poseW = this.poseWeights[i];
				if (!poseW || poseW.length !== baseW.length) {
					poseW = new Float32Array(baseW.length);
					this.poseWeights[i] = poseW;
				}
				poseW.set(baseW);
			} else {
				this.poseWeights[i] = undefined;
			}
		}
	}

	private lerpVec3(target: Float32Array, sample: Float32Array, weight: number): void {
		const w = Math.max(0, Math.min(1, weight));
		target[0] += (sample[0] - target[0]) * w;
		target[1] += (sample[1] - target[1]) * w;
		target[2] += (sample[2] - target[2]) * w;
	}

	private lerpWeights(nodeIndex: number, sample: Float32Array, weight: number): void {
		let target = this.poseWeights[nodeIndex];
		if (!target || target.length !== sample.length) {
			target = new Float32Array(sample.length);
			this.poseWeights[nodeIndex] = target;
		}
		const w = Math.max(0, Math.min(1, weight));
		for (let i = 0; i < sample.length; i++) {
			target[i] += (sample[i] - target[i]) * w;
		}
	}

	private advanceClips(dtSec: number): void {
		if (this._currentClip) {
			this.updateClipState(this._currentClip, dtSec);
			if (this._currentClip.weight <= 0 && this._currentClip.targetWeight === 0) {
				this.dispatchMeshAnimationEvent('meshAnimationEnd', { clipId: this._currentClip.name }, undefined);
				this._currentClip = undefined;
			}
		}
		if (this._previousClip) {
			this.updateClipState(this._previousClip, dtSec, true);
			if (this._previousClip.weight <= 0) this._previousClip = undefined;
		}
	}

	private updateClipState(state: MeshClipState, dtSec: number, fadingOut: boolean = false): void {
		const duration = this.getClipDuration(state);
		const prevTime = state.time;
		state.time += dtSec * state.speed;
		if (state.loop && duration > 0) {
			state.time = state.time % duration;
		} else {
			state.time = Math.min(state.time, duration);
		}
		this.processClipNotifies(state, prevTime, state.time, duration);
		if (state.blendDuration > 0) {
			state.blendElapsed = Math.min(state.blendElapsed + dtSec, state.blendDuration);
			const alpha = state.blendDuration > 0 ? state.blendElapsed / state.blendDuration : 1;
			const startWeight = fadingOut ? state.weight : state.weight;
			state.weight = fadingOut
				? startWeight + (state.targetWeight - startWeight) * alpha
				: startWeight + (state.targetWeight - startWeight) * alpha;
			if (state.blendElapsed >= state.blendDuration) {
				state.weight = state.targetWeight;
			}
		} else {
			state.weight = state.targetWeight;
		}
		state.weight = Math.max(0, Math.min(1, state.weight));
		if (!state.loop && !fadingOut && state.time >= duration - 1e-4) {
			state.targetWeight = 0;
			state.blendDuration = Math.max(state.blendDuration, 0.1);
			state.blendElapsed = Math.min(state.blendElapsed, state.blendDuration);
		}
	}

	private processClipNotifies(state: MeshClipState, prevTime: number, currentTime: number, duration: number): void {
		const notifies = state.notifies;
		if (!notifies || notifies.length === 0) return;
		const wrapped = state.loop && duration > 0 && currentTime < prevTime;
		if (wrapped) {
			this.dispatchMeshAnimationEvent('meshAnimationLoop', { clipId: state.name }, undefined);
			this.dispatchClipNotifiesInRange(state, prevTime, duration);
			state.notifyCursor = 0;
			this.dispatchClipNotifiesInRange(state, 0, currentTime);
		} else {
			this.dispatchClipNotifiesInRange(state, prevTime, currentTime);
		}
	}

	private dispatchClipNotifiesInRange(state: MeshClipState, start: number, end: number): void {
		const notifies = state.notifies;
		if (!notifies) return;
		let cursor = state.notifyCursor;
		while (cursor < notifies.length) {
			const notify = notifies[cursor];
			if (notify.time > end) break;
			if (notify.time >= start) {
				this.dispatchMeshAnimationEvent('meshAnimationEvent', { clipId: state.name, event: notify.event, payload: notify.payload }, notify.scope);
				if (notify.event) this.dispatchMeshAnimationEvent(`meshAnimationEvent:${notify.event}`, { clipId: state.name, event: notify.event, payload: notify.payload }, notify.scope);
				if (notify.once) {
					notifies.splice(cursor, 1);
					continue;
				}
			}
			cursor++;
		}
		state.notifyCursor = cursor;
	}

	private applyClipState(state: MeshClipState): void {
		const weight = Math.max(0, Math.min(1, state.weight));
		if (weight <= 0) return;
		const clip = state.clip;
		const animations = clip.channels;
		for (let c = 0; c < animations.length; c++) {
			const channel = animations[c];
			const sampler = clip.samplers[channel.sampler];
			if (!sampler) continue;
			const nodeIndex = channel.target.node;
			if (nodeIndex === undefined) continue;
			switch (channel.target.path) {
				case 'translation': {
					const sample = this.sampleVec3(sampler, state.time, state.loop);
					if (state.applyRootMotion && nodeIndex === this._rootMotionNode) {
						const deltaX = sample[0] - state.lastRootTranslation[0];
						const deltaY = sample[1] - state.lastRootTranslation[1];
						const deltaZ = sample[2] - state.lastRootTranslation[2];
						state.lastRootTranslation[0] = sample[0];
						state.lastRootTranslation[1] = sample[1];
						state.lastRootTranslation[2] = sample[2];
						this._rootMotionDelta[0] += deltaX * weight;
						this._rootMotionDelta[1] += deltaY * weight;
						this._rootMotionDelta[2] += deltaZ * weight;
					}
					this.lerpVec3(this.poseTranslation[nodeIndex], sample, weight);
					this.nodeDirty[nodeIndex] = true;
					break;
				}
				case 'rotation': {
					const sample = this.sampleQuat(sampler, state.time, state.loop);
					MeshComponent.slerpQuat(this.poseRotation[nodeIndex], sample, weight, this.poseRotation[nodeIndex]);
					this.nodeDirty[nodeIndex] = true;
					break;
				}
				case 'scale': {
					const sample = this.sampleVec3(sampler, state.time, state.loop);
					this.lerpVec3(this.poseScale[nodeIndex], sample, weight);
					this.nodeDirty[nodeIndex] = true;
					break;
				}
				case 'weights': {
					const sample = this.sampleWeights(sampler, state.time, state.loop);
					this.lerpWeights(nodeIndex, sample, weight);
					break;
				}
			}
		}
	}

	private sampleVec3(sampler: GLTFAnimationSampler, time: number, loop: boolean): Float32Array {
		return this.sampleAnimationInto(sampler, time, 3, 'translation', this._sampleVec3, loop);
	}

	private sampleQuat(sampler: GLTFAnimationSampler, time: number, loop: boolean): Float32Array {
		return this.sampleAnimationInto(sampler, time, 4, 'rotation', this._sampleQuat, loop);
	}

	private sampleWeights(sampler: GLTFAnimationSampler, time: number, loop: boolean): Float32Array {
		const componentCount = sampler.output.length / sampler.input.length;
		if (!this._sampleWeights || this._sampleWeights.length !== componentCount) {
			this._sampleWeights = new Float32Array(componentCount);
		}
		return this.sampleAnimationInto(sampler, time, componentCount, 'weights', this._sampleWeights, loop);
	}

	private getClipDuration(state: MeshClipState): number {
		const name = state.name;
		if (this._clipDurationCache.has(name)) return this._clipDurationCache.get(name)!;
		const clip = state.clip;
		let duration = 0;
		for (const sampler of clip.samplers) {
			const input = sampler?.input;
			if (input && input.length > 0) {
				const last = input[input.length - 1];
				if (last > duration) duration = last;
			}
		}
		this._clipDurationCache.set(name, duration);
		return duration;
	}

	private dispatchMeshAnimationEvent(event: string, payload: Record<string, unknown>, scope?: 'self' | 'global'): void {
		const parent = this.parent;
		const busEvent = createGameEvent({ type: event, lane: 'any', emitter: parent, ...(payload ?? {}) });
		$.emit(busEvent);
		const sc = parent.sc;
		if (!sc) {
			throw new Error(`[MeshComponent] Parent '${parent.id}' is missing a state controller.`);
		}
		const name = scope === 'self' ? `$${event}` : event;
		const fsmEvent = createGameEvent({ type: name, emitter: parent, ...(payload ?? {}) });
		sc.dispatch_event(fsmEvent);
	}

	private applyRootMotionDelta(): void {
		const delta = this._rootMotionDelta;
		if (Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) <= 1e-4) return;
		const parent = this.parent;
		parent.x += delta[0];
		parent.y += delta[1];
		parent.z += delta[2];
		delta[0] = 0; delta[1] = 0; delta[2] = 0;
	}

	public playClip(name: string, options: MeshClipPlayOptions = {}): void {
		const clip = this.getClipByName(name);
		if (!clip) {
			throw new Error(`[MeshComponent] Clip '${name}' not found on model '${this.modelId}'.`);
		}
		const key = this.resolveClipKey(clip);
		const fade = Math.max(0, options.fadeSeconds ?? 0);
		const loop = options.loop ?? true;
		const speed = options.speed ?? 1;
		const startTime = options.startTime ?? 0;
		const applyRootMotion = options.applyRootMotion ?? false;
		const state: MeshClipState = {
			name: key,
			clip,
			time: startTime,
			speed,
			loop,
			weight: fade > 0 ? 0 : 1,
			targetWeight: 1,
			blendDuration: fade,
			blendElapsed: fade > 0 ? 0 : fade,
			applyRootMotion,
			lastRootTranslation: new Float32Array(3),
			notifies: this.cloneNotifies(key),
			notifyCursor: 0,
		};
		if (state.notifies && state.notifies.length) state.notifies.sort((a, b) => a.time - b.time);
		const rootSample = this.sampleRootTranslation(state, startTime);
		state.lastRootTranslation.set(rootSample);
		if (this._currentClip) {
			if (this._currentClip.name === state.name && options.resetTime === false) {
				this._currentClip.loop = loop;
				this._currentClip.speed = speed;
				this._currentClip.targetWeight = 1;
				this._currentClip.applyRootMotion = applyRootMotion;
				if (options.startTime !== undefined) {
					this._currentClip.time = startTime;
					this._currentClip.lastRootTranslation.set(rootSample);
				}
				return;
			}
			this._previousClip = {
				...this._currentClip,
				lastRootTranslation: new Float32Array(this._currentClip.lastRootTranslation),
				notifies: this._currentClip.notifies ? this._currentClip.notifies.map(n => ({ ...n })) : undefined,
				blendDuration: fade,
				blendElapsed: 0,
				targetWeight: 0,
			};
		}
		this._currentClip = state;
		if (fade <= 0) {
			state.weight = 1;
			state.blendElapsed = fade;
			this._previousClip = undefined;
		}
		this.dispatchMeshAnimationEvent('meshAnimationStart', { clipId: state.name }, undefined);
	}

	public stopClip(name?: string): void {
		if (!this._currentClip) return;
		if (!name || this._currentClip.name === name) {
			this._currentClip.targetWeight = 0;
			this._currentClip.blendDuration = Math.max(this._currentClip.blendDuration, 0.1);
			this._currentClip.blendElapsed = 0;
			return;
		}
		if (this._previousClip && this._previousClip.name === name) {
			this._previousClip.targetWeight = 0;
			this._previousClip.blendDuration = Math.max(this._previousClip.blendDuration, 0.1);
			this._previousClip.blendElapsed = 0;
		}
	}

	public setClipNotifies(name: string, notifies: MeshAnimationNotify[]): void {
		this._clipNotifies.set(name, [...notifies]);
	}

	public setRootMotionNode(index: number): void {
		const model = this.modelOrThrow();
		const nodeCount = model.nodes?.length ?? 1;
		this._rootMotionNode = Math.max(0, Math.min(index, nodeCount - 1));
	}

	private getClipByName(name: string): GLTFAnimation | undefined {
		const anims = this.modelOrThrow().animations;
		if (!anims || anims.length === 0) return undefined;
		let clip = anims.find(anim => anim?.name === name);
		if (clip) return clip;
		const numeric = Number(name);
		if (!Number.isNaN(numeric) && anims[numeric]) return anims[numeric];
		for (let i = 0; i < anims.length; i++) {
			const candidate = anims[i];
			const key = this.resolveClipKey(candidate);
			if (key === name) return candidate;
		}
		return undefined;
	}

	private resolveClipKey(clip: GLTFAnimation): string {
		if (clip.name && clip.name.length > 0) return clip.name;
		const anims = this.modelOrThrow().animations ?? [];
		const idx = anims.indexOf(clip);
		return idx >= 0 ? `clip_${idx}` : 'clip';
	}

	private cloneNotifies(name: string): MeshAnimationNotify[] | undefined {
		const list = this._clipNotifies.get(name);
		return list ? list.map(n => ({ ...n })) : undefined;
	}

	private clipStateToRuntime(state: MeshClipState): RuntimeClipState {
		return {
			clipId: state.name,
			time: state.time,
			speed: state.speed,
			loop: state.loop,
			weight: state.weight,
			targetWeight: state.targetWeight,
			blendDuration: state.blendDuration,
			blendElapsed: state.blendElapsed,
			applyRootMotion: state.applyRootMotion,
			lastRootTranslation: [state.lastRootTranslation[0], state.lastRootTranslation[1], state.lastRootTranslation[2]],
			notifyCursor: state.notifyCursor,
			notifies: state.notifies ? state.notifies.map(n => ({ ...n })) : undefined,
		};
	}

	private createClipStateFromSnapshot(snapshot: RuntimeClipState | undefined): MeshClipState | undefined {
		if (!snapshot?.clipId) return undefined;
		const clip = this.getClipByName(snapshot.clipId);
		if (!clip) return undefined;
		const name = this.resolveClipKey(clip);
		const blendDuration = snapshot.blendDuration ?? 0;
		const state: MeshClipState = {
			name,
			clip,
			time: snapshot.time ?? 0,
			speed: snapshot.speed ?? 1,
			loop: snapshot.loop ?? true,
			weight: snapshot.weight ?? 0,
			targetWeight: snapshot.targetWeight ?? (snapshot.weight ?? 0),
			blendDuration,
			blendElapsed: Math.min(snapshot.blendElapsed ?? blendDuration, blendDuration),
			applyRootMotion: snapshot.applyRootMotion ?? false,
			lastRootTranslation: new Float32Array(3),
			notifies: undefined,
			notifyCursor: snapshot.notifyCursor ?? 0,
		};
		if (snapshot.notifies) {
			state.notifies = snapshot.notifies.map(n => ({ ...n }));
		} else {
			state.notifies = this.cloneNotifies(name) ?? undefined;
		}
		if (state.notifies && state.notifies.length) state.notifies.sort((a, b) => a.time - b.time);
		const storedTranslation = snapshot.lastRootTranslation;
		if (storedTranslation && storedTranslation.length === 3) {
			state.lastRootTranslation[0] = storedTranslation[0];
			state.lastRootTranslation[1] = storedTranslation[1];
			state.lastRootTranslation[2] = storedTranslation[2];
		} else {
			state.lastRootTranslation.set(this.sampleRootTranslation(state, state.time));
		}
		if (state.notifies) {
			state.notifyCursor = Math.min(state.notifyCursor, state.notifies.length);
		} else {
			state.notifyCursor = 0;
		}
		state.weight = Math.max(0, Math.min(1, state.weight));
		state.targetWeight = Math.max(0, Math.min(1, state.targetWeight));
		return state;
	}

	private restoreAnimationRuntime(anim: RuntimeAnim | LegacyRuntimeAnim | undefined): void {
		if (!anim) return;
		if ('current' in anim || 'previous' in anim || 'rootMotionNode' in anim || 'autoResetPose' in anim) {
			const runtime = anim as RuntimeAnim;
			if (runtime.autoResetPose !== undefined) this._autoResetPose = runtime.autoResetPose;
			if (runtime.rootMotionNode !== undefined) this._rootMotionNode = runtime.rootMotionNode;
			this._currentClip = this.createClipStateFromSnapshot(runtime.current);
			this._previousClip = this.createClipStateFromSnapshot(runtime.previous);
			this._rootMotionDelta[0] = 0; this._rootMotionDelta[1] = 0; this._rootMotionDelta[2] = 0;
			this.resetPoseToBase();
			if (this._previousClip) this.applyClipState(this._previousClip);
			if (this._currentClip) this.applyClipState(this._currentClip);
			for (let i = 0; i < this.nodeDirty.length; i++) this.nodeDirty[i] = true;
			this.markAllSkinsDirty();
			return;
		}
		const legacy = anim as LegacyRuntimeAnim;
		if (!legacy.activeClip) return;
		const snapshot: RuntimeClipState = {
			clipId: legacy.activeClip,
			time: legacy.time,
			speed: legacy.speed,
			loop: legacy.loop,
			weight: 1,
			targetWeight: 1,
			blendDuration: 0,
			blendElapsed: 0,
		};
		this._currentClip = this.createClipStateFromSnapshot(snapshot);
		this._previousClip = undefined;
		if (!this._currentClip) return;
		const duration = this.getClipDuration(this._currentClip);
		this._currentClip.time = Math.min(Math.max(0, this._currentClip.time), duration);
		this._currentClip.weight = 1;
		this._currentClip.targetWeight = 1;
		this._currentClip.blendDuration = 0;
		this._currentClip.blendElapsed = 0;
		this._currentClip.notifyCursor = 0;
		this._currentClip.lastRootTranslation.set(this.sampleRootTranslation(this._currentClip, this._currentClip.time));
		this._rootMotionDelta[0] = 0; this._rootMotionDelta[1] = 0; this._rootMotionDelta[2] = 0;
		this.resetPoseToBase();
		this.applyClipState(this._currentClip);
		for (let i = 0; i < this.nodeDirty.length; i++) this.nodeDirty[i] = true;
		this.markAllSkinsDirty();
	}

	private sampleRootTranslation(state: MeshClipState, time: number): Float32Array {
		const clip = state.clip;
		for (const channel of clip.channels) {
			if (channel.target.node === this._rootMotionNode && channel.target.path === 'translation') {
				const sample = this.sampleVec3(clip.samplers[channel.sampler], time, state.loop);
				const out = new Float32Array(3);
				out.set(sample);
				return out;
			}
		}
		return new Float32Array(3);
	}

	private computeSkinMatrices(skinIndex: number, meshNodeIndex: number, meshNodeWorld: Float32Array): Float32Array[] | undefined {
		const model = this.modelOrThrow();
		const skin = model.skins?.[skinIndex];
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
		const model = this.modelOrThrow();
		if (!model.animations || model.animations.length === 0) return;
		this.advanceClips(dtSec);
		if (!this._currentClip && !this._previousClip) {
			if (this._autoResetPose) {
				this.resetPoseToBase();
				for (let i = 0; i < this.nodeDirty.length; i++) this.nodeDirty[i] = true;
			}
			return;
		}
		this.resetPoseToBase();
		if (this._previousClip) this.applyClipState(this._previousClip);
		if (this._currentClip) this.applyClipState(this._currentClip);
		for (let i = 0; i < this.nodeDirty.length; i++) this.nodeDirty[i] = true;
		this.markAllSkinsDirty();
		this.applyRootMotionDelta();
		if (model.scenes && model.scenes.length > 0) {
			const scene = model.scenes[model.scene ?? 0];
			if (scene) for (const root of scene.nodes) this.getWorldMatrixFrom(root, MeshComponent._ID);
		}
	}

	private sampleAnimationInto(s: GLTFAnimationSampler, time: number, componentCount: number, path: string, out: Float32Array, loop: boolean): Float32Array {
		const input = s.input;
		const output = s.output;
		const last = input.length - 1;
		const duration = last >= 0 ? input[last] : 0;
		let t = 0;
		if (last >= 0) {
			if (loop && duration > 0) t = time % duration;
			else t = duration > 0 ? Math.min(time, duration) : 0;
		}
		let i = 0;
		while (i < last && t >= input[i + 1]) i++;
		const j = Math.min(i + 1, last);
		const t0 = input[i];
		const t1 = input[j];
		const dt = t1 - t0;
		switch (s.interpolation) {
			case 'STEP': {
				const start = i * componentCount;
				for (let k = 0; k < componentCount; k++) out[k] = output[start + k];
				break;
			}
			case 'CUBICSPLINE': {
				const start = i * componentCount * 3;
				const end = j * componentCount * 3;
				const u = dt === 0 ? 0 : (t - t0) / dt;
				const u2 = u * u; const u3 = u2 * u;
				const s0 = 2.0 * u3 - 3.0 * u2 + 1.0;
				const s1 = u3 - 2.0 * u2 + u;
				const s2 = -2.0 * u3 + 3.0 * u2;
				const s3 = u3 - u2;
				for (let k = 0; k < componentCount; k++) {
					const p0 = output[start + componentCount + k];
					const m0 = output[start + componentCount * 2 + k];
					const p1 = output[end + componentCount + k];
					const m1 = output[end + k];
					out[k] = s0 * p0 + s1 * m0 * dt + s2 * p1 + s3 * m1 * dt;
				}
				break;
			}
			case 'LINEAR':
			default: {
				const alpha = dt > 0 ? (t - t0) / dt : 0;
				if (path === 'rotation') {
					const q0 = this.readQuatAt(s, i, componentCount, MeshComponent._quatScratchA);
					const q1 = this.readQuatAt(s, j, componentCount, MeshComponent._quatScratchB);
					MeshComponent.slerpQuat(q0, q1, alpha, out);
				} else {
					const start = i * componentCount;
					const end = j * componentCount;
					for (let k = 0; k < componentCount; k++) {
						const v0 = output[start + k];
						const v1 = output[end + k];
						out[k] = v0 + (v1 - v0) * alpha;
					}
				}
				break;
			}
		}
		if (path === 'rotation') MeshComponent.normalizeQuat(out);
		return out;
	}

	private readQuatAt(s: GLTFAnimationSampler, index: number, componentCount: number, target: Float32Array): Float32Array {
		const start = index * componentCount;
		for (let k = 0; k < componentCount; k++) target[k] = s.output[start + k];
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

	private static rotationMatrixToQuaternion(m: Float32Array): Float32Array {
		const out = new Float32Array(4);
		const trace = m[0] + m[4] + m[8];
		if (trace > 0) {
			const s = Math.sqrt(trace + 1.0) * 2;
			out[3] = 0.25 * s;
			out[0] = (m[7] - m[5]) / s;
			out[1] = (m[2] - m[6]) / s;
			out[2] = (m[3] - m[1]) / s;
		} else if (m[0] > m[4] && m[0] > m[8]) {
			const s = Math.sqrt(1.0 + m[0] - m[4] - m[8]) * 2;
			out[3] = (m[7] - m[5]) / s;
			out[0] = 0.25 * s;
			out[1] = (m[1] + m[3]) / s;
			out[2] = (m[2] + m[6]) / s;
		} else if (m[4] > m[8]) {
			const s = Math.sqrt(1.0 + m[4] - m[0] - m[8]) * 2;
			out[3] = (m[2] - m[6]) / s;
			out[0] = (m[1] + m[3]) / s;
			out[1] = 0.25 * s;
			out[2] = (m[5] + m[7]) / s;
		} else {
			const s = Math.sqrt(1.0 + m[8] - m[0] - m[4]) * 2;
			out[3] = (m[3] - m[1]) / s;
			out[0] = (m[2] + m[6]) / s;
			out[1] = (m[5] + m[7]) / s;
			out[2] = 0.25 * s;
		}
		MeshComponent.normalizeQuat(out);
		return out;
	}

	private static decomposeMatrix(matrix: Float32Array | number[]): { t: Float32Array; r: Float32Array; s: Float32Array } {
		const m = matrix instanceof Float32Array ? matrix : Float32Array.from(matrix);
		const t = new Float32Array([m[12], m[13], m[14]]);
		let sx = Math.hypot(m[0], m[1], m[2]);
		let sy = Math.hypot(m[4], m[5], m[6]);
		let sz = Math.hypot(m[8], m[9], m[10]);
		if (sx === 0) sx = 1;
		if (sy === 0) sy = 1;
		if (sz === 0) sz = 1;
		// Detect negative scale using determinant
		const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
		if (det < 0) sz = -sz;
		const invSx = 1 / sx;
		const invSy = 1 / sy;
		const invSz = 1 / sz;
		const rot = new Float32Array(9);
		rot[0] = m[0] * invSx; rot[1] = m[1] * invSx; rot[2] = m[2] * invSx;
		rot[3] = m[4] * invSy; rot[4] = m[5] * invSy; rot[5] = m[6] * invSy;
		rot[6] = m[8] * invSz; rot[7] = m[9] * invSz; rot[8] = m[10] * invSz;
		const r = MeshComponent.rotationMatrixToQuaternion(rot);
		const s = new Float32Array([sx, sy, sz]);
		return { t, r, s };
	}

	private static decomposeNode(node: GLTFNode): { t: Float32Array; r: Float32Array; s: Float32Array } {
		if (node.matrix) return MeshComponent.decomposeMatrix(node.matrix);
		const t = new Float32Array(node.translation ?? [0, 0, 0]);
		const r = new Float32Array(node.rotation ?? [0, 0, 0, 1]);
		MeshComponent.normalizeQuat(r);
		const s = new Float32Array(node.scale ?? [1, 1, 1]);
		return { t, r, s };
	}

	/** Apply lightweight material overrides for all instances of a GLTF mesh index and persist the override. */
	public setMaterialOverride(meshIndex: number, overrides: PersistedMatTex): void {
		this.materialOverrides ??= {};
		this.materialOverrides[meshIndex] = { ...(this.materialOverrides[meshIndex] ?? {}), ...overrides };
		const model = this.modelOrThrow();
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
		if (!model.gpuTextures) {
			void this.fetchAndBindModelTextures();
			return;
		}
		this.rebindMaterialTexturesFromModelKeys(model);
	}

	private applyMaterialOverrides(): void {
		if (!this.materialOverrides) return;
		for (const k in this.materialOverrides) {
			const idx = parseInt(k, 10);
			this.setMaterialOverride(idx, this.materialOverrides[idx]);
		}
	}

	private async fetchAndBindModelTextures(): Promise<void> {
		const model = this.modelOrThrow();
		if (!model.gpuTextures) {
			const genGuard = model;
			const keys = await $.texmanager.fetchModelTextures(model);
			if (this.model !== genGuard) {
				throw new Error(`[MeshComponent] Model switched while fetching textures for '${this.id}'.`);
			}
			model.gpuTextures = keys;
		}
		this.rebindMaterialTexturesFromModelKeys(model);
	}

	private rebindMaterialTexturesFromModelKeys(model: GLTFModel): void {
		const keys = model.gpuTextures;
		if (!keys) {
			throw new Error(`[MeshComponent] GPU textures not bound for '${this.id}'.`);
		}
		for (const inst of this.instances) {
			const mat = inst.mesh.material; if (!mat) continue;
			const t = mat.textures ?? {};
			mat.gpuTextures.albedo = t.albedo !== undefined ? keys[t.albedo] : undefined;
			mat.gpuTextures.normal = t.normal !== undefined ? keys[t.normal] : undefined;
			mat.gpuTextures.metallicRoughness = t.metallicRoughness !== undefined ? keys[t.metallicRoughness] : undefined;
			mat.gpuTextures.occlusion = t.occlusion !== undefined ? keys[t.occlusion] : undefined;
			mat.gpuTextures.emissive = t.emissive !== undefined ? keys[t.emissive] : undefined;
		}
	}

	// Utility used by system to emit submissions for this component
	public collectSubmissions(base: Float32Array, receiveShadow: boolean = true): MeshRenderSubmission[] {
		this.modelOrThrow();
		const out: MeshRenderSubmission[] = [];
		for (const inst of this.instances) {
			const nodeWorld = inst.nodeIndex !== undefined ? (this.worldMatrices[inst.nodeIndex] ?? MeshComponent._ID) : MeshComponent._ID;
			const world = inst.worldMatrix ?? (inst.worldMatrix = new Float32Array(16));
			M4.mulAffineInto(world, base, nodeWorld);
			const joints = (inst.skinIndex !== undefined && inst.nodeIndex !== undefined)
				? this.computeSkinMatrices(inst.skinIndex, inst.nodeIndex, nodeWorld)
				: undefined;
			if (inst.nodeIndex !== undefined) {
				const weights = this.poseWeights[inst.nodeIndex];
				if (weights) {
					let target = inst.morphWeights;
					if (!target || target.length !== weights.length) {
						target = new Array(weights.length).fill(0);
					}
					for (let i = 0; i < weights.length; i++) target[i] = weights[i];
					inst.morphWeights = target;
				}
			}
			out.push({ mesh: inst.mesh, matrix: world, joint_matrices: joints, morph_weights: inst.morphWeights, receive_shadow: receiveShadow });
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

		const model = this.modelOrThrow();
		if (model.nodes && model.scenes?.length) {
			const { toKey } = MeshComponent.buildNodeKeyMap(model);
			const map: Record<NodeKey, RuntimeNodeState> = {};
			for (let i = 0; i < model.nodes.length; i++) {
				const n = model.nodes[i];
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

		const animState: RuntimeAnim = {
			rootMotionNode: this._rootMotionNode,
			autoResetPose: this._autoResetPose,
		};
		if (this._currentClip) animState.current = this.clipStateToRuntime(this._currentClip);
		if (this._previousClip) animState.previous = this.clipStateToRuntime(this._previousClip);
		const hasActiveAnim = !!(animState.current || animState.previous);
		const nonDefaultConfig = animState.rootMotionNode !== 0 || animState.autoResetPose !== true;
		if (hasActiveAnim || nonDefaultConfig) {
			runtime.anim = animState;
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
		const rom = $.rompack.model;
		if (!rom) {
			throw new Error(`[MeshComponent] ROM pack unavailable during onLoad for '${this.id}'.`);
		}
		const loaded = rom[this.modelId] ?? this.model;
		if (!loaded) {
			throw new Error(`[MeshComponent] Model '${this.modelId}' missing during onLoad for '${this.id}'.`);
		}

		this.model = loaded;
		if (rt?.nodes) {
			const nodes = loaded.nodes;
			if (!nodes) {
				throw new Error(`[MeshComponent] Runtime node data provided but model '${this.modelId}' has no nodes.`);
			}
			const { toIndex } = MeshComponent.buildNodeKeyMap(loaded);
			for (const [k, ns] of Object.entries(rt.nodes)) {
				const idx = toIndex(k);
				if (idx === undefined) continue;
				const node = nodes[idx];
				if (ns.trs) {
					if (ns.trs.t) node.translation = [...ns.trs.t] as vec3arr;
					if (ns.trs.r) node.rotation = [...ns.trs.r] as vec4arr;
					if (ns.trs.s) node.scale = [...ns.trs.s] as vec3arr;
					node.matrix = undefined;
				}
				if (ns.weights) node.weights = [...ns.weights];
				if (ns.visible !== undefined) node.visible = !!ns.visible;
			}
		}

		this.buildInstances();
		this.restoreAnimationRuntime(rt?.anim);
		if (!rt?.anim) {
			this._currentClip = undefined;
			this._previousClip = undefined;
			this._rootMotionDelta[0] = 0; this._rootMotionDelta[1] = 0; this._rootMotionDelta[2] = 0;
		}

		this.applyMaterialOverrides();
		const modelInstance = this.modelOrThrow();
		if (modelInstance.gpuTextures) {
			this.rebindMaterialTexturesFromModelKeys(modelInstance);
		} else {
			void this.fetchAndBindModelTextures();
		}
	}
}
