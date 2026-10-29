import type { WorkspaceDirectoryEntry } from './record_provider';
import { computeSourceLabel } from '../common/paths';
import { joinWorkspacePaths, normalizeRelativeWorkspacePath, stripProjectRootPrefix, workspacePathIsWithin } from './path';
import { WORKSPACE_METADATA_DIR, type WorkspaceFileChange, type WorkspaceRecords } from './records';
import type { WorkspaceSourceCatalog, WorkspaceSourceContext } from './source_catalog';

export type WorkspaceDirectoryRoot = {
	readonly contextId: string;
	readonly label: string;
	readonly projectRootPath: string;
};
export type WorkspaceDirectoryReference = {
	readonly root: WorkspaceDirectoryRoot;
	readonly path: string;
	readonly workspacePath: string;
};
export type WorkspaceDirectoryChild = WorkspaceDirectoryReference & WorkspaceDirectoryEntry;
export type WorkspaceDirectorySnapshot =
	| { readonly status: 'loading' }
	| { readonly status: 'missing' }
	| { readonly status: 'error'; readonly error: unknown }
	| { readonly status: 'ready'; readonly entries: readonly WorkspaceDirectoryEntry[] };

type DirectoryObservation = {
	readonly path: string;
	snapshot: WorkspaceDirectorySnapshot;
	/** Last acknowledged membership remains readable while its next observation is pending or failed. */
	membership: readonly WorkspaceDirectoryEntry[] | undefined;
	request: Promise<void> | undefined;
	reload: boolean;
};
type RootAdmission = {
	readonly root: WorkspaceDirectoryRoot;
	readonly context: WorkspaceSourceContext;
	readonly projections: Map<string, { membership: readonly WorkspaceDirectoryEntry[]; entries: readonly WorkspaceDirectoryChild[] }>;
};

/** Physical namespace observations, independent of semantic resources and the presenting Files tree. */
export class WorkspaceDirectoryModel {
	public roots: readonly WorkspaceDirectoryRoot[] = [];
	public revision = 0;
	private readonly admissions = new Map<string, RootAdmission>();
	private readonly addresses = new WeakMap<WorkspaceDirectoryRoot, Map<string, WorkspaceDirectoryReference>>();
	private readonly observations = new Map<string, DirectoryObservation>();
	private readonly listeners = new Set<() => void>();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly unbindCatalog: () => void;
	private readonly unbindRecords: () => void;
	private disposed = false;

	public constructor(private readonly records: WorkspaceRecords, private readonly catalog: WorkspaceSourceCatalog) {
		this.syncRoots();
		this.unbindCatalog = catalog.onDidChange(() => this.syncRoots());
		this.unbindRecords = records.onDidChange(change => this.didChangeFile(change));
	}
	public get acceptingRequests(): boolean { return !this.disposed && this.records.acceptingOperations; }
	public rootForContext(contextId: string): WorkspaceDirectoryRoot | undefined { return this.admissions.get(contextId)?.root; }
	public isCurrent(root: WorkspaceDirectoryRoot): boolean {
		return !this.disposed && this.admissions.get(root.contextId)?.root === root;
	}
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private publish(): void { this.revision++; for (const listener of this.listeners) listener(); }

	/** An admitted address; constructing it does not claim filesystem presence or perform IO. */
	public directory(root: WorkspaceDirectoryRoot, path: string): WorkspaceDirectoryReference {
		const addresses = this.addresses.get(root)!;
		let address = addresses.get(path);
		if (address === undefined) {
			address = { root, path, workspacePath: joinWorkspacePaths(root.projectRootPath, path) };
			addresses.set(path, address);
		}
		return address;
	}
	public get(root: WorkspaceDirectoryRoot, path: string): WorkspaceDirectorySnapshot | undefined {
		if (this.admissions.get(root.contextId)?.root !== root) return;
		return this.observations.get(joinWorkspacePaths(root.projectRootPath, path))?.snapshot;
	}
	public children(root: WorkspaceDirectoryRoot, path: string): readonly WorkspaceDirectoryChild[] | undefined {
		const admission = this.admissions.get(root.contextId);
		if (admission?.root !== root) return;
		const membership = this.observations.get(joinWorkspacePaths(root.projectRootPath, path))?.membership;
		if (membership === undefined) return;
		const cached = admission.projections.get(path);
		if (cached?.membership === membership) return cached.entries;
		const entries = membership.map(entry => ({ ...this.directory(root, joinWorkspacePaths(path, entry.name)), ...entry }));
		admission.projections.set(path, { membership, entries });
		return entries;
	}
	public resolve(root: WorkspaceDirectoryRoot, path: string): Promise<void> { return this.read(root, path, false); }
	public refresh(root: WorkspaceDirectoryRoot, path: string): Promise<void> { return this.read(root, path, true); }

	private read(root: WorkspaceDirectoryRoot, path: string, refresh: boolean): Promise<void> {
		if (!this.acceptingRequests || !this.isCurrent(root)) throw new Error('The project directory owner is closed.');
		const workspacePath = joinWorkspacePaths(root.projectRootPath, path);
		let observation = this.observations.get(workspacePath);
		if (observation === undefined) {
			observation = { path: workspacePath, snapshot: { status: 'loading' }, membership: undefined, request: undefined, reload: false };
			this.observations.set(workspacePath, observation);
		} else if (observation.request !== undefined) {
			if (refresh) observation.reload = true;
			return observation.request;
		} else if (!refresh && observation.snapshot.status !== 'loading') return Promise.resolve();
		const current = observation;
		current.snapshot = { status: 'loading' };
		// Publish the receipt before IO or outward observers can reenter resolution.
		const request = Promise.resolve().then(async () => {
			do {
				current.reload = false;
				let snapshot: WorkspaceDirectorySnapshot;
				try {
					const entries = await this.records.readDirectory(workspacePath);
					snapshot = entries === null ? { status: 'missing' }
						: { status: 'ready', entries: entries.filter(entry => entry.name !== WORKSPACE_METADATA_DIR) };
				} catch (error) { snapshot = { status: 'error', error }; }
				if (this.disposed || this.observations.get(workspacePath) !== current) return;
				if (!current.reload) {
					if (snapshot.status === 'ready') current.membership = snapshot.entries;
					else if (snapshot.status === 'missing') current.membership = undefined;
					current.snapshot = snapshot; this.publish();
				}
			} while (current.reload && this.acceptingRequests);
		}).finally(() => { current.request = undefined; this.pending.delete(request); });
		current.request = request;
		this.pending.add(request);
		this.publish();
		return request;
	}

	public createDirectory(parent: WorkspaceDirectoryReference, userPath: string): Promise<WorkspaceDirectoryReference> {
		if (!this.acceptingRequests || !this.isCurrent(parent.root)) throw new Error('The project directory owner is closed.');
		const child = normalizeRelativeWorkspacePath(userPath, 'directory');
		if (child.length === 0) throw new Error('Enter a folder name.');
		const segments = child.split('/');
		if (segments.includes(WORKSPACE_METADATA_DIR)) throw new Error(`'${WORKSPACE_METADATA_DIR}' is reserved for Studio metadata.`);
		const target = this.directory(parent.root, joinWorkspacePaths(parent.path, child));
		const request = this.records.createDirectory(target.workspacePath).then(async () => {
			// Creation intent includes publishing its containing namespace, not an optimistic UI row.
			let path = parent.path;
			for (let index = 0; index < segments.length && this.acceptingRequests && this.isCurrent(parent.root); index++) {
				await this.resolve(parent.root, path);
				path = joinWorkspacePaths(path, segments[index]);
			}
			return target;
		});
		this.pending.add(request);
		void request.then(() => this.pending.delete(request), () => this.pending.delete(request));
		return request;
	}

	private didChangeFile(change: WorkspaceFileChange): void {
		for (const observation of this.observations.values()) {
			if (change.path !== observation.path) {
				const prefix = observation.path.length === 0 ? '' : `${observation.path}/`;
				if (!change.path.startsWith(prefix)) continue;
				const relative = change.path.slice(prefix.length), slash = relative.indexOf('/');
				const name = slash === -1 ? relative : relative.slice(0, slash);
				if (name === WORKSPACE_METADATA_DIR) continue;
				const entry = observation.membership?.find(entry => entry.name === name);
				// Writing existing contents or a descendant does not change this directory's membership.
				if (entry !== undefined && (slash !== -1 && entry.type === 'directory' || slash === -1 && change.kind === 'fileWritten' && entry.type === 'file')) continue;
			}
			const root = this.roots.find(root => workspacePathIsWithin(observation.path, root.projectRootPath));
			if (root !== undefined && this.acceptingRequests)
				void this.refresh(root, stripProjectRootPrefix(observation.path, root.projectRootPath));
		}
	}

	private syncRoots(): void {
		let changed = false;
		for (const [id, admission] of this.admissions) if (this.catalog.contexts.get(id) !== admission.context) {
			this.admissions.delete(id); changed = true;
		}
		// Only surviving admissions may carry an old physical observation into new root bindings.
		if (changed) for (const path of this.observations.keys()) {
			let retained = false;
			for (const { root } of this.admissions.values()) if (workspacePathIsWithin(path, root.projectRootPath)) { retained = true; break; }
			if (!retained) this.observations.delete(path);
		}
		for (const context of this.catalog.contexts.values()) if (!this.admissions.has(context.id)) {
			const root = { contextId: context.id, label: context.projectRootPath === '' ? 'Project' : computeSourceLabel(context.projectRootPath),
				projectRootPath: context.projectRootPath };
			this.addresses.set(root, new Map());
			this.admissions.set(context.id, { root, context, projections: new Map() }); changed = true;
		}
		if (!changed) return;
		this.roots = Array.from(this.admissions.values(), admission => admission.root);
		this.publish();
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true; this.unbindCatalog(); this.unbindRecords();
		// Final source/session checkpoints still consume the last inert reading projection.
		this.publish(); this.listeners.clear();
	}
	public async shutdown(): Promise<void> { this.dispose(); await Promise.allSettled(this.pending); }
}
