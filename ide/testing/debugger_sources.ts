import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { Blua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
import type { BuiltFixtureProgram } from './fixture_media';
import { readBlua32CompiledSource, type Blua32CompiledSource } from '../../toolchain/ts/rompack/blua32_sources';
import { bindSourceBreakpoints, type SourceBreakpoint } from '../runtime/source_breakpoints';

type DebugSource = { domain: ExecutionDomainId; module: string; image: Blua32ToolingImage; record: Blua32CompiledSource; points: SourceBreakpoint[] };

/** Requests bind only to this derived test's immutable images, never the authoring gutter or working copy. */
export class TestDebuggerSources {
	public readonly catalog: { source: string; domain: ExecutionDomainId; sourceContextId: string; path: string; symbols: boolean }[] = [];
	public readonly pcs: [Map<number, number>, Map<number, number>, Map<number, number>] = [new Map(), new Map(), new Map()];
	private readonly entries = new Map<string, DebugSource>();
	public constructor(id: string, program: BuiltFixtureProgram, private readonly changed: () => void) {
		for (const domain of [-1, 0, 1] as const) {
			const image = domain === -1 ? program.sourceMedia.system : program.sourceMedia.cartridgeSlots[domain];
			if (image === null) continue;
			for (const [module, record] of image.sources) {
				const source = `${id}/source/${this.entries.size}`;
				this.entries.set(source, { domain, module, image, record, points: [] });
				this.catalog.push({ source, domain, sourceContextId: image.sourceContextId,
					path: record.displayPath, symbols: image.symbols !== null });
			}
		}
	}
	private get(source: string): DebugSource {
		const entry = this.entries.get(source);
		if (entry === undefined) throw new Error('Source does not belong to this live test debugger.');
		return entry;
	}
	public read(source: string) {
		const entry = this.get(source);
		return { source, origin: 'compiled-test-images' as const, text: readBlua32CompiledSource(entry.record), breakpoints: entry.points };
	}
	public setBreakpoints(source: string, lines: readonly number[]): readonly SourceBreakpoint[] {
		const entry = this.get(source), requested = [...new Set(lines)].sort((a, b) => a - b);
		if (requested.length === entry.points.length && requested.every((line, index) => line === entry.points[index].line)) return entry.points;
		entry.points = requested.map(line => ({ line, status: 'no-statement', locations: [] }));
		const pcs = this.pcs[entry.domain + 1], modules = new Map<string, Map<number, SourceBreakpoint>>();
		pcs.clear();
		for (const current of this.entries.values()) {
			if (current.domain !== entry.domain || current.points.length === 0) continue;
			for (const point of current.points) {
				point.status = current.image.symbols === null ? 'symbols-unavailable' : 'no-statement';
				point.locations.length = 0;
			}
			if (current.image.symbols !== null) modules.set(current.module, new Map(current.points.map(point => [point.line, point])));
		}
		if (modules.size !== 0) bindSourceBreakpoints(entry.image, modules, pcs);
		this.changed();
		return entry.points;
	}
	public dispose(): void {
		this.entries.clear(); this.catalog.length = 0;
		for (const points of this.pcs) points.clear();
	}
}
