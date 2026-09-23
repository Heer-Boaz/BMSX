import { DisposableStore } from '../../../common/lifecycle';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN } from '../../../common/resource';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { onDidChangeLuaSourceRegistry } from '../../../runtime/source_registry';
import { runtimeLuaSourceRegistry, type RuntimeSourceState } from '../../../runtime/sources';

export type CapturedWorkspaceSource = {
	readonly model: EditorTextModel;
	readonly version: number;
	readonly source: string;
};

/** Expected operation retirement, not a language/runtime failure. */
export class WorkspaceSourceContextConflict extends Error {}

/** One explicit source-reading operation. Capture starts before awaiting tools, not when their edits arrive. */
export class WorkspaceSourceContext {
	private readonly lifetime = new DisposableStore();
	private readonly captured = new Map<EditorTextModel, CapturedWorkspaceSource>();
	private readonly invalidationListeners = new Set<() => void>();
	private readonly registries;
	private reasonValue: string | undefined;

	public constructor(public readonly models: EditorTextModelService, private readonly sources: RuntimeSourceState) {
		this.lifetime.add({ dispose: models.onWillClear(() => this.invalidate('Workspace closed')) });
		this.lifetime.add({ dispose: models.onDidChangeContent(model => this.invalidate(`Source changed: ${model.resource.path}`)) });
		this.registries = ([SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const).map(domain => ({ domain, registry: runtimeLuaSourceRegistry(sources, domain) }));
		for (const { domain, registry } of this.registries) {
			if (registry === undefined) continue; // Empty cartridge socket.
			this.lifetime.add({ dispose: onDidChangeLuaSourceRegistry(registry, path => {
				if (path !== undefined && models.get({ domain, path }) !== undefined) return; // A model owns the effective source, not its saved base.
				this.invalidate('Workspace source catalog changed');
			}) });
		}
	}

	public get reason(): string | undefined { return this.reasonValue; }

	public onDidInvalidate(listener: () => void): () => void {
		this.invalidationListeners.add(listener);
		return () => this.invalidationListeners.delete(listener);
	}

	/** Admission checks identities of replaced sockets without scanning/re-reading source. */
	public assertCurrent(): void {
		if (this.reasonValue === undefined && this.registries.some(({ domain, registry }) => runtimeLuaSourceRegistry(this.sources, domain) !== registry)) {
			this.invalidate('Workspace source catalog was replaced');
		}
		if (this.reasonValue !== undefined) throw new WorkspaceSourceContextConflict(this.reasonValue);
	}

	/** Immutable evidence uses cached source bytes; reading is not a Save/Undo boundary. */
	public read(model: EditorTextModel): CapturedWorkspaceSource {
		this.assertCurrent();
		if (this.models.get(model.identity) !== model) throw new WorkspaceSourceContextConflict(`Source '${model.resource.path}' no longer belongs to this workspace.`);
		let value = this.captured.get(model);
		if (value === undefined) {
			value = { model, version: model.version, source: getTextSnapshot(model.buffer) };
			this.captured.set(model, value);
			this.lifetime.add({ dispose: model.onWillDispose(() => this.invalidate(`Source closed: ${model.resource.path}`)) });
		}
		return value;
	}

	private invalidate(reason: string): void {
		if (this.reasonValue !== undefined) return;
		this.reasonValue = reason;
		this.lifetime.dispose();
		this.captured.clear();
		for (const listener of this.invalidationListeners) listener();
		this.invalidationListeners.clear();
	}

	public dispose(): void { this.invalidate('Source context released'); }
}
