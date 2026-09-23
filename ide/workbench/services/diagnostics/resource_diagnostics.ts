import type { HostClock, TimerHandle } from '../../../../hosts/common/clock';
import { enqueueBackgroundTask, type BackgroundTask } from '../../../common/background_tasks';
import type { EditorDiagnostic } from '../../../common/models';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, type ResourceIdentity, type ResourceDomain } from '../../../common/resource';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import { runtimeLuaSourceRegistry } from '../../../runtime/sources';
import { onDidChangeLuaSourceRegistry } from '../../../runtime/source_registry';
import { computeResourceDiagnostics } from './lua';

export type ResourceDiagnostics = { readonly model: EditorTextModel; readonly version: number } & (
	| { readonly status: 'pending' | 'unsupported' }
	| { readonly status: 'ready'; readonly diagnostics: readonly EditorDiagnostic[] }
	| { readonly status: 'failed'; readonly error: unknown }
);

export type DiagnosticsCoverage = {
	readonly ready: number;
	readonly pending: number;
	readonly unsupported: number;
	readonly failed: number;
};

const EMPTY_DIAGNOSTICS: readonly EditorDiagnostic[] = [];
const DEBOUNCE_MS = 200;
const MIN_INTERVAL_MS = 600;

/** Session-owned resource results. A missing entry means unrequested coverage, never a clean file. */
export class ResourceDiagnosticsService {
	private readonly entries = new Map<EditorTextModel, ResourceDiagnostics>();
	private readonly dirty = new Set<EditorTextModel>();
	private readonly listeners = new Set<() => void>();
	private readonly subscriptions: (() => void)[];
	private timer: TimerHandle | null = null;
	private queued: BackgroundTask | null = null;
	private enabled = false;
	private disposed = false;
	private lastRun = -MIN_INTERVAL_MS;
	private diagnosticsValue: readonly EditorDiagnostic[] = EMPTY_DIAGNOSTICS;
	private coverageValue: DiagnosticsCoverage = { ready: 0, pending: 0, unsupported: 0, failed: 0 };

	public constructor(
		private readonly models: EditorTextModelService,
		private readonly tooling: RuntimeLuaTooling,
		private readonly clock: HostClock,
	) {
		this.subscriptions = [
			models.onDidAddModel(model => { this.add(model); this.publish(); this.schedule(); }),
			models.onDidApplyChanges(model => {
				if (model.mode === 'lua') this.invalidateDomain(model.identity.domain);
				else this.entries.set(model, { model, version: model.version, status: 'unsupported' });
			}),
			models.onDidChangeContent(() => { this.publish(); this.schedule(); }),
			models.onDidRemoveModel(model => {
				this.entries.delete(model); this.dirty.delete(model);
				if (model.mode === 'lua') this.invalidateDomain(model.identity.domain);
				this.publish(); this.schedule();
			}),
		];
		for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
			const registry = runtimeLuaSourceRegistry(tooling.sources, domain);
			if (registry === undefined) continue; // Empty cartridge socket.
			this.subscriptions.push(onDidChangeLuaSourceRegistry(registry, path => {
				// A retained working copy, not its saved/installed base, owns the newer source.
				if (path !== undefined && models.get({ domain, path }) !== undefined) return;
				this.invalidateDomain(domain);
				this.publish(); this.schedule();
			}));
		}
		for (const model of models.models) {
			this.entries.set(model, { model, version: model.version, status: model.mode === 'lua' ? 'pending' : 'unsupported' });
			if (model.mode === 'lua') this.dirty.add(model);
		}
		this.publish();
	}

	public get diagnostics(): readonly EditorDiagnostic[] { return this.diagnosticsValue; }
	public get coverage(): DiagnosticsCoverage { return this.coverageValue; }

	public get(resource: ResourceIdentity): ResourceDiagnostics | undefined {
		const model = this.models.get(resource);
		return model === undefined ? undefined : this.entries.get(model);
	}

	public onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private add(model: EditorTextModel): void {
		this.entries.set(model, { model, version: model.version, status: model.mode === 'lua' ? 'pending' : 'unsupported' });
		if (model.mode === 'lua') this.invalidateDomain(model.identity.domain);
	}

	private invalidateDomain(domain: ResourceDomain): void {
		// Lua files may publish globals, not just imports. Revalidate retained
		// consumers in the affected project; the semantic owner reuses syntax.
		for (const [model, entry] of this.entries) {
			if (model.mode !== 'lua' || domain !== SYSTEM_RESOURCE_DOMAIN && model.identity.domain !== domain) continue;
			if (entry.status !== 'pending' || entry.version !== model.version) {
				this.entries.set(model, { model, version: model.version, status: 'pending' });
			}
			this.dirty.add(model);
		}
	}

	/** Workbench visibility controls automatic background work, not result lifetime. */
	public setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		this.timer?.cancel(); this.timer = null;
		this.queued = null;
		if (enabled) this.schedule();
	}

	private schedule(): void {
		if (!this.enabled || this.disposed || this.dirty.size === 0 || this.queued !== null) return;
		this.timer?.cancel();
		const delay = Math.max(DEBOUNCE_MS, this.lastRun + MIN_INTERVAL_MS - this.clock.now());
		this.timer = this.clock.scheduleOnce(delay, () => {
			this.timer = null;
			const task = () => {
				if (this.queued !== task) return false;
				this.queued = null;
				this.computePending();
				return false;
			};
			this.queued = task;
			enqueueBackgroundTask(task);
		});
	}

	/** Explicit context/diagnostic requests use the same retained resource results, without a code tab. */
	public computePending(): void {
		if (this.disposed) throw new Error('Cannot compute diagnostics after workbench disposal.');
		this.timer?.cancel(); this.timer = null;
		this.queued = null;
		if (this.dirty.size === 0) return;
		const batch = [...this.dirty];
		this.dirty.clear();
		try {
			const diagnostics = computeResourceDiagnostics(this.models, this.tooling, batch);
			const byModel = new Map<EditorTextModel, EditorDiagnostic[]>();
			for (const diagnostic of diagnostics) {
				let bucket = byModel.get(diagnostic.model);
				if (bucket === undefined) byModel.set(diagnostic.model, bucket = []);
				bucket.push(diagnostic);
			}
			for (const model of batch) this.entries.set(model, { model, version: model.version,
				status: 'ready', diagnostics: byModel.get(model) ?? EMPTY_DIAGNOSTICS });
		} catch (error) {
			for (const model of batch) this.entries.set(model, { model, version: model.version, status: 'failed', error });
		}
		this.lastRun = this.clock.now();
		this.publish();
	}

	private publish(): void {
		const diagnostics: EditorDiagnostic[] = [];
		let ready = 0, pending = 0, unsupported = 0, failed = 0;
		for (const entry of this.entries.values()) {
			switch (entry.status) {
				case 'ready': ready++; for (const diagnostic of entry.diagnostics) diagnostics.push(diagnostic); break;
				case 'pending': pending++; break;
				case 'unsupported': unsupported++; break;
				case 'failed': failed++; break;
			}
		}
		this.diagnosticsValue = diagnostics;
		this.coverageValue = { ready, pending, unsupported, failed };
		for (const listener of this.listeners) listener();
	}

	public dispose(): void {
		this.disposed = true;
		this.setEnabled(false);
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.dirty.clear(); this.entries.clear();
		this.publish();
		this.listeners.clear();
	}
}
