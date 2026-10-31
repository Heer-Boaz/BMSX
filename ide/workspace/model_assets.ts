import type { Affine3 } from '../../machine/ts/common/affine3';
import { HostMesh } from '../../machine/ts/render/host_overlay/mesh';
import type { GLTFModel } from '../../toolchain/ts/rompack/gltf';
import { prepareModelStaticScenes } from '../../toolchain/ts/rompack/model_static_scene';
import type { WorkspaceSourceCatalog, WorkspaceSourceContext } from './source_catalog';

export type WorkspaceModelPart = { readonly affine: Readonly<Affine3>; readonly meshes: readonly HostMesh[] };
export type WorkspaceModelScene = { readonly parts: readonly WorkspaceModelPart[] };
type Binding = {
	readonly provider: WorkspaceSourceContext;
	readonly model: GLTFModel;
	readonly rom: Uint8Array;
	readonly prepared: ReturnType<typeof prepareModelStaticScenes>;
	readonly meshes: Map<number, readonly HostMesh[]>;
	readonly scenes: Map<number, WorkspaceModelScene>;
	epoch: number;
};

/** A reader's immutable model generations and shared primitive resources. No guest decoding or World. */
export class WorkspaceModelAssets {
	private readonly bindings = new Map<string, Binding>();
	private epoch = 0;
	public constructor(private readonly catalog: WorkspaceSourceCatalog) {}
	public update(contextId: string, modelIds: ReadonlySet<string>): void {
		const epoch = ++this.epoch;
		for (const id of modelIds) {
			const resolved = this.catalog.resolveAsset(contextId, 'model', id);
			if (resolved === undefined) continue;
			const provider = this.catalog.getContext(resolved.contextId), mounted = provider.previewRom;
			if (mounted === null) continue;
			const previous = this.bindings.get(id), model = resolved.value;
			if (previous?.provider === provider && previous.model === model && previous.rom === mounted.bytes) {
				previous.epoch = epoch; continue;
			}
			if (previous !== undefined) this.retire(previous);
			this.bindings.set(id, { provider, model, rom: mounted.bytes, epoch,
				prepared: prepareModelStaticScenes(model), meshes: new Map(), scenes: new Map() });
		}
		for (const [id, binding] of this.bindings) if (binding.epoch !== epoch) {
			this.retire(binding); this.bindings.delete(id);
		}
	}
	/** Only the chosen scene's actual shader requirements govern availability. */
	public get(id: string, selected?: number): WorkspaceModelScene | undefined {
		const binding = this.bindings.get(id);
		if (binding === undefined) return;
		const index = selected ?? binding.model.scene;
		if (index === undefined) return;
		const source = binding.prepared.scenes[index];
		if (source === undefined || source.features !== 0) return;
		let scene = binding.scenes.get(index);
		if (scene !== undefined) return scene;
		const parts: WorkspaceModelPart[] = [], prepared = binding.prepared;
		for (let partIndex = source.firstPart; partIndex < source.firstPart + source.partCount; partIndex++) {
			const part = prepared.parts[partIndex];
			let meshes = binding.meshes.get(part.mesh);
			if (meshes === undefined) {
				meshes = binding.model.meshes[part.mesh].primitives.map(primitive => {
					const material = primitive.materialIndex === undefined ? undefined : prepared.materials[primitive.materialIndex];
					return new HostMesh({ positions: primitive.positions, indices: primitive.indices, indexComponentType: primitive.indexComponentType,
						color: material === undefined ? 0xffffffff : material.color, doubleSided: material === undefined ? false : material.doubleSided });
				});
				binding.meshes.set(part.mesh, meshes);
			}
			parts.push({ affine: part.affine, meshes });
		}
		scene = { parts }; binding.scenes.set(index, scene); return scene;
	}
	private retire(binding: Binding): void { for (const meshes of binding.meshes.values()) for (const mesh of meshes) mesh.dispose(); }
	public dispose(): void { for (const binding of this.bindings.values()) this.retire(binding); this.bindings.clear(); }
}
