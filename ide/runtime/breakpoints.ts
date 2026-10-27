import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import { resourceIdentityKey, type ResourceIdentity } from '../common/resource';
import type { Blua32SourceImage, Blua32SourceMedia, RuntimeSourceState } from './sources';
import { bindSourceBreakpoints, type SourceBreakpoint } from './source_breakpoints';

export type SerializedBreakpoints = (ResourceIdentity & { lines: number[] })[];
export type RuntimeSourceBreakpoint = Omit<SourceBreakpoint, 'locations'> & {
	locations: { domain: ExecutionDomainId; image: Blua32SourceImage; pc: number; column: number; inlineDepth: number }[];
};
export type RuntimeBreakpointBindings = {
	media: Blua32SourceMedia;
	pcs: [Map<number, number>, Map<number, number>, Map<number, number>];
	sources: Map<string, RuntimeSourceBreakpoint[]>;
	installations: [Map<string, SourceBreakpoint[]>, Map<string, SourceBreakpoint[]>, Map<string, SourceBreakpoint[]>];
};
const EMPTY_LINES: ReadonlySet<number> = new Set();
const EMPTY_BINDINGS: readonly RuntimeSourceBreakpoint[] = [];
const EMPTY_INSTALLATION_BINDINGS: readonly SourceBreakpoint[] = [];

/** Authored requests are context-bound; compiled PCs belong to each exact installation. */
export class RuntimeBreakpoints {
	private readonly requested = new Map<string, { resource: ResourceIdentity; lines: Set<number> }>();
	private readonly installedRequests: [Map<string, { resource: ResourceIdentity; image: Blua32SourceImage; lines: Set<number> }>, Map<string, { resource: ResourceIdentity; image: Blua32SourceImage; lines: Set<number> }>, Map<string, { resource: ResourceIdentity; image: Blua32SourceImage; lines: Set<number> }>] = [new Map(), new Map(), new Map()];
	private readonly listeners = new Set<() => void>();
	public bindings: RuntimeBreakpointBindings;
	public constructor(private readonly sources: RuntimeSourceState, private readonly bindingsChanged: () => void) {
		this.bindings = { media: sources.currentBlua32Media, pcs: [new Map(), new Map(), new Map()], sources: new Map(), installations: [new Map(), new Map(), new Map()] };
	}

	public get(resource: ResourceIdentity): ReadonlySet<number> { return this.requested.get(resourceIdentityKey(resource))?.lines ?? EMPTY_LINES; }
	public read(resource: ResourceIdentity): readonly RuntimeSourceBreakpoint[] { return this.bindings.sources.get(resourceIdentityKey(resource)) ?? EMPTY_BINDINGS; }
	public readInstallation(resource: ResourceIdentity, domain: ExecutionDomainId): readonly SourceBreakpoint[] {
		return this.bindings.installations[domain + 1].get(resourceIdentityKey(resource)) ?? EMPTY_INSTALLATION_BINDINGS;
	}
	/** Installed-source handles affect this image only, not another context installation. */
	public setInstallation(resource: ResourceIdentity, domain: ExecutionDomainId, image: Blua32SourceImage, lines: readonly number[]): void {
		const requests = this.installedRequests[domain + 1], key = resourceIdentityKey(resource);
		if (lines.length === 0) requests.delete(key); else requests.set(key, { resource: { ...resource }, image, lines: new Set(lines) });
		this.rebind();
		for (const listener of this.listeners) listener();
	}
	public set(resource: ResourceIdentity, lines: readonly number[]): void {
		const previous = this.get(resource);
		if (previous.size === lines.length && lines.every(line => previous.has(line))) return;
		const key = resourceIdentityKey(resource);
		if (lines.length === 0) this.requested.delete(key); else this.requested.set(key, { resource: { ...resource }, lines: new Set(lines) });
		this.rebind();
		for (const listener of this.listeners) listener();
	}
	public toggle(resource: ResourceIdentity, line: number): boolean {
		const lines = new Set(this.get(resource)), added = !lines.has(line);
		if (added) lines.add(line); else lines.delete(line);
		this.set(resource, [...lines]);
		return added;
	}
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	public serialize(): SerializedBreakpoints {
		return [...this.requested.values()].map(({ resource, lines }) => ({ ...resource, lines: [...lines].sort((a, b) => a - b) }))
			.sort((a, b) => a.contextId.localeCompare(b.contextId) || a.path.localeCompare(b.path));
	}
	public restore(payload: SerializedBreakpoints): void {
		this.requested.clear();
		for (const item of payload) this.requested.set(resourceIdentityKey(item), { resource: { contextId: item.contextId, path: item.path }, lines: new Set(item.lines) });
		this.rebind();
	}

	/** Rebuild at request/image publication, never in the execution hook. */
	public compile(media: Blua32SourceMedia): RuntimeBreakpointBindings {
		const bindings: RuntimeBreakpointBindings = { media, pcs: [new Map(), new Map(), new Map()], sources: new Map(), installations: [new Map(), new Map(), new Map()] };
		for (const [key, { lines }] of this.requested) bindings.sources.set(key, [...lines].sort((a, b) => a - b)
			.map(line => ({ line, status: 'image-unavailable', locations: [] })));
		for (const domain of [-1, 0, 1] as const) {
			const image = domain === -1 ? media.system : media.cartridgeSlots[domain];
			if (image === null) continue;
			const requests = new Map<string, { resource: ResourceIdentity; lines: ReadonlySet<number> }>();
			for (const [key, request] of this.requested) if (request.resource.contextId === image.sourceContextId) requests.set(key, request);
			for (const [key, request] of this.installedRequests[domain + 1]) if (request.image === image) {
				const authored = requests.get(key);
				requests.set(key, authored === undefined ? request : { resource: request.resource, lines: new Set([...authored.lines, ...request.lines]) });
			}
			if (requests.size === 0) continue;
			const modulesByPath = new Map<string, string>();
			for (const [module, record] of image.sources) modulesByPath.set(record.displayPath, module);
			const modules = new Map<string, Map<number, SourceBreakpoint>>();
			for (const [key, request] of requests) {
				const module = modulesByPath.get(request.resource.path);
				const points: SourceBreakpoint[] = [...request.lines].sort((a, b) => a - b).map(line => ({ line,
					status: image.symbols === null ? 'symbols-unavailable' : module === undefined ? 'source-unavailable' : 'no-statement', locations: [] }));
				bindings.installations[domain + 1].set(key, points);
				if (module !== undefined && image.symbols !== null) modules.set(module, new Map(points.map(point => [point.line, point])));
			}
			if (modules.size !== 0) bindSourceBreakpoints(image, modules, bindings.pcs[domain + 1]);
			for (const [key, points] of bindings.installations[domain + 1]) {
				const aggregate = bindings.sources.get(key);
				if (aggregate === undefined) continue;
				for (const point of points) {
					const result = aggregate.find(result => result.line === point.line);
					if (result === undefined) continue;
					if (result.status === 'image-unavailable' || point.status === 'bound') result.status = point.status;
					for (const location of point.locations) result.locations.push({ ...location, domain, image });
				}
			}
		}
		return bindings;
	}
	public install(bindings: RuntimeBreakpointBindings): void {
		this.bindings = bindings;
		for (const domain of [-1, 0, 1] as const) {
			const image = domain === -1 ? bindings.media.system : bindings.media.cartridgeSlots[domain];
			for (const [key, request] of this.installedRequests[domain + 1]) if (request.image !== image) this.installedRequests[domain + 1].delete(key);
		}
		this.bindingsChanged();
	}
	public rebind(): void { this.install(this.compile(this.sources.currentBlua32Media)); }
}
