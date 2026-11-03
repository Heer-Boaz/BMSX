import { ModelRenderResources } from '../common/model_resources';
import type { ModelAsset } from '../../toolchain/ts/rompack/model';
import type { WorkspaceSourceCatalog, WorkspaceSourceContext } from './source_catalog';

type Binding = {
	readonly provider: WorkspaceSourceContext;
	readonly model: ModelAsset;
	readonly rom: Uint8Array;
	readonly resources: ModelRenderResources;
	epoch: number;
};

/** A reader's immutable model generations and shared primitive resources. No guest decoding or World. */
export class WorkspaceModelAssets {
	private readonly bindings = new Map<string, Binding>();
	private epoch = 0;
	public constructor(private readonly catalog: WorkspaceSourceCatalog) {}
	public get revision(): number { return this.epoch; }
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
			if (previous !== undefined) previous.resources.dispose();
			this.bindings.set(id, { provider, model, rom: mounted.bytes, epoch,
				resources: new ModelRenderResources(model) });
		}
		for (const [id, binding] of this.bindings) if (binding.epoch !== epoch) {
			binding.resources.dispose(); this.bindings.delete(id);
		}
	}
	/** The admitted model resource owns scene selection and immutable mesh decoding. */
	public get(id: string): ModelRenderResources | undefined { return this.bindings.get(id)?.resources; }

	public dispose(): void { for (const binding of this.bindings.values()) binding.resources.dispose(); this.bindings.clear(); }
}
