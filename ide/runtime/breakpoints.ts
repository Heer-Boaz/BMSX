import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import type { ResourceDomain, ResourceIdentity } from '../common/resource';
import { resolveRuntimeLuaSource, type Blua32SourceMedia, type RuntimeSourceState } from './sources';

export type SerializedBreakpoints = { domain: ResourceDomain; path: string; lines: number[] }[];
export type RuntimeBreakpoint = {
	line: number;
	status: 'bound' | 'no-statement' | 'image-unavailable' | 'symbols-unavailable' | 'source-unavailable';
	locations: { pc: number; column: number; inlineDepth: number }[];
};
export type RuntimeBreakpointBindings = {
	pcs: [Map<number, number>, Map<number, number>, Map<number, number>];
	sources: [Map<string, RuntimeBreakpoint[]>, Map<string, RuntimeBreakpoint[]>, Map<string, RuntimeBreakpoint[]>];
};
const EMPTY_LINES: ReadonlySet<number> = new Set();
const EMPTY_BINDINGS: readonly RuntimeBreakpoint[] = [];

/** Source requests and installed bindings share an owner, independently of any editor pane. */
export class RuntimeBreakpoints {
	private readonly requested: [Map<string, Set<number>>, Map<string, Set<number>>, Map<string, Set<number>>] = [new Map(), new Map(), new Map()];
	private readonly listeners = new Set<() => void>();
	public bindings: RuntimeBreakpointBindings = { pcs: [new Map(), new Map(), new Map()], sources: [new Map(), new Map(), new Map()] };
	public constructor(private readonly sources: RuntimeSourceState, private readonly bindingsChanged: () => void) {}

	public get(resource: ResourceIdentity): ReadonlySet<number> {
		return this.requested[resource.domain + 1].get(resource.path) ?? EMPTY_LINES;
	}
	public read(resource: ResourceIdentity): readonly RuntimeBreakpoint[] {
		return this.bindings.sources[resource.domain + 1].get(resource.path) ?? EMPTY_BINDINGS;
	}
	public set(resource: ResourceIdentity, lines: readonly number[]): void {
		const previous = this.get(resource);
		if (previous.size === lines.length && lines.every(line => previous.has(line))) return;
		const domain = this.requested[resource.domain + 1];
		if (lines.length === 0) domain.delete(resource.path); else domain.set(resource.path, new Set(lines));
		this.rebind();
		for (const listener of this.listeners) listener();
	}
	public toggle(resource: ResourceIdentity, line: number): boolean {
		const domain = this.requested[resource.domain + 1];
		let lines = domain.get(resource.path);
		if (lines === undefined) domain.set(resource.path, lines = new Set());
		const added = !lines.has(line);
		if (added) lines.add(line); else lines.delete(line);
		if (lines.size === 0) domain.delete(resource.path);
		this.rebind();
		for (const listener of this.listeners) listener();
		return added;
	}
	public onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	public serialize(): SerializedBreakpoints {
		const result: SerializedBreakpoints = [];
		for (let index = 0; index < this.requested.length; index++) {
			for (const [path, lines] of this.requested[index]) result.push({ domain: (index - 1) as ResourceDomain, path, lines: [...lines].sort((a, b) => a - b) });
		}
		return result.sort((a, b) => a.domain - b.domain || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	}
	public restore(payload: SerializedBreakpoints): void {
		for (const domain of this.requested) domain.clear();
		for (const item of payload) this.requested[item.domain + 1].set(item.path, new Set(item.lines));
		this.rebind();
	}

	/** Compile once per explicit request/image change; never scan symbols in the execution hook. */
	public compile(media: Blua32SourceMedia): RuntimeBreakpointBindings {
		const bindings: RuntimeBreakpointBindings = { pcs: [new Map(), new Map(), new Map()], sources: [new Map(), new Map(), new Map()] };
		for (let index = 0; index < this.requested.length; index++) {
			if (this.requested[index].size === 0) continue;
			const domain = (index - 1) as ResourceDomain, image = blua32ToolingImageForDomain(media, domain);
			const modules = new Map<string, Map<number, RuntimeBreakpoint>>();
			for (const [path, lines] of this.requested[index]) {
				const source = resolveRuntimeLuaSource(this.sources, { domain, path });
				const status = image === null ? 'image-unavailable' : image.symbols === null ? 'symbols-unavailable'
					: source === null ? 'source-unavailable' : 'no-statement';
				const points = [...lines].sort((a, b) => a - b).map((line): RuntimeBreakpoint => ({ line, status, locations: [] }));
				bindings.sources[index].set(path, points);
				if (status === 'no-statement') modules.set(source!.record.module_path, new Map(points.map(point => [point.line, point])));
			}
			if (modules.size === 0) continue;
			for (let fn = 0; fn < image!.layout.functions.length; fn++) {
				const codeAddress = image!.layout.functions[fn].codeAddress;
				for (const point of image!.symbols!.metadata.statementPointsByFunction[fn]) {
					const requested = modules.get(point.range.path)?.get(point.range.start.line);
					if (requested === undefined) continue;
					const pc = codeAddress + point.wordOffset * INSTRUCTION_BYTES, inlineDepth = point.inlineCallSites.length;
					bindings.pcs[index].set(pc, inlineDepth);
					requested.status = 'bound';
					requested.locations.push({ pc, column: point.range.start.column, inlineDepth });
				}
			}
		}
		return bindings;
	}
	public install(bindings: RuntimeBreakpointBindings): void {
		this.bindings = bindings;
		this.bindingsChanged();
	}
	public rebind(): void { this.install(this.compile(this.sources.currentBlua32Media)); }
}
