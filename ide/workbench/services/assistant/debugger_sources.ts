import { generateUuid } from '../../../common/uuid';
import type { ResourceDomain, ResourceIdentity } from '../../../common/resource';
import type { RuntimeDebuggerState } from '../../../runtime/debugger_state';
import type { Blua32SourceImage } from '../../../runtime/sources';
import { readBlua32CompiledSource } from '../../../../toolchain/ts/rompack/blua32_sources';
import { StudioToolInputError } from './tool_input';

type DebugSource = { resource: ResourceIdentity; domain: ResourceDomain; modulePath: string; text: string; image: Blua32SourceImage };

/** Prompt-owned exact installation authority, separate from working-copy edit receipts. */
export class DebuggerSourceContext {
	private readonly id = generateUuid();
	private serial = 0;
	private readonly sources = new Map<string, DebugSource>();
	public constructor(private readonly state: RuntimeDebuggerState) {}
	public list() {
		const state = this.state.sources;
		const result: { source: string; domain: ResourceDomain; contextId: string; path: string; symbols: boolean }[] = [];
		this.sources.clear();
		for (const domain of [-1, 0, 1] as const) {
			const image = domain === -1 ? state.currentBlua32Media.system : state.currentBlua32Media.cartridgeSlots[domain];
			if (image === null) continue;
			for (const [modulePath, record] of image.sources) {
				const resource = { contextId: image.sourceContextId, path: record.displayPath }, source = `${this.id}/${this.serial++}`;
				this.sources.set(source, { resource, domain, modulePath, text: readBlua32CompiledSource(record), image });
				result.push({ source, domain, ...resource, symbols: image.symbols !== null });
			}
		}
		return result;
	}
	private get(handle: string): DebugSource {
		const source = this.sources.get(handle);
		if (source === undefined) throw new StudioToolInputError('Installed-source handle does not belong to the current catalog');
		const media = this.state.sources.currentBlua32Media;
		if ((source.domain === -1 ? media.system : media.cartridgeSlots[source.domain]) !== source.image) {
			throw new StudioToolInputError('Installed source expired; list the target\'s current debug sources');
		}
		return source;
	}
	public read(handle: string) {
		const source = this.get(handle);
		return { source: handle, origin: 'installed' as const, domain: source.domain, ...source.resource, modulePath: source.modulePath, text: source.text,
			breakpoints: this.state.breakpoints.readInstallation(source.resource, source.domain) };
	}
	public setBreakpoints(handle: string, lines: number[]) {
		const source = this.get(handle);
		this.state.breakpoints.setInstallation(source.resource, source.domain, source.image, lines);
		return { source: handle, origin: 'installed' as const, domain: source.domain, ...source.resource,
			breakpoints: this.state.breakpoints.readInstallation(source.resource, source.domain) };
	}
	public dispose(): void { this.sources.clear(); }
}
