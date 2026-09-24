import type { ResourceDomain, ResourceIdentity } from '../../../common/resource';
import type { RuntimeDebuggerState } from '../../../runtime/debugger_state';
import { resolveRuntimeLuaSource } from '../../../runtime/sources';
import { blua32ToolingImageForDomain, type Blua32ToolingImage } from '../../../../toolchain/ts/rompack/blua32_media';
import { StudioToolInputError } from './tool_input';

type DebugSource = { resource: ResourceIdentity; modulePath: string; text: string; image: Blua32ToolingImage };

/** Prompt-owned authority to installed source, separate from working-copy edit receipts. */
export class DebuggerSourceContext {
	private readonly id = crypto.randomUUID();
	private serial = 0;
	private readonly sources = new Map<string, DebugSource>();
	public constructor(private readonly state: RuntimeDebuggerState) {}
	public list() {
		const state = this.state.sources;
		const result: { source: string; domain: ResourceDomain; path: string; symbols: boolean }[] = [];
		this.sources.clear();
		for (const domain of [-1, 0, 1] as const) {
			const image = blua32ToolingImageForDomain(state.currentBlua32Media, domain);
			if (image === null) continue;
			const installed = domain === -1 ? state.systemInstalledBlua32Sources : state.cartridgeSlots[domain]!.installedBlua32Sources;
			for (const [modulePath, text] of installed) {
				const record = resolveRuntimeLuaSource(state, { domain, path: modulePath })!.record;
				const resource = { domain, path: record.source_path }, source = `${this.id}/${this.serial++}`;
				this.sources.set(source, { resource, modulePath, text, image });
				result.push({ source, ...resource, symbols: image.symbols !== null });
			}
		}
		return result;
	}
	private get(handle: string): DebugSource {
		const source = this.sources.get(handle);
		if (source === undefined) throw new StudioToolInputError('Installed-source handle does not belong to the current catalog');
		if (blua32ToolingImageForDomain(this.state.sources.currentBlua32Media, source.resource.domain) !== source.image) {
			throw new StudioToolInputError('Installed source expired; list the target\'s current debug sources');
		}
		return source;
	}
	public read(handle: string) {
		const source = this.get(handle);
		return { source: handle, origin: 'installed' as const, ...source.resource, modulePath: source.modulePath, text: source.text,
			breakpoints: this.state.breakpoints.read(source.resource) };
	}
	public setBreakpoints(handle: string, lines: number[]) {
		const source = this.get(handle);
		this.state.breakpoints.set(source.resource, lines);
		return { source: handle, origin: 'installed' as const, ...source.resource, breakpoints: this.state.breakpoints.read(source.resource) };
	}
	public dispose(): void { this.sources.clear(); }
}
