import type { BrowserBootMedia } from '../../hosts/browser/boot';
import type { RomArtifact, RomBuildUnit } from '../../toolchain/ts/rompack/build_manifest';
import type { StudioHttpSession } from './http_session';

/** Both ROMs come from one immutable manifest, never the mutable dist exports. */
export async function loadPublishedMedia(session: StudioHttpSession, id: string): Promise<BrowserBootMedia> {
	const path = `/__bmsx__/builds/artifacts/${encodeURIComponent(id)}`;
	const response = await session.request(path, { cache: 'no-store' });
	if (!response.ok) throw new Error(`Cannot open published build (${response.status}): ${await response.text()}`);
	const artifact: RomArtifact = await response.json();
	const load = async (unit: RomBuildUnit): Promise<Uint8Array> => {
		const output = unit.outputs.find(output => output.file.endsWith('.rom'))!;
		const response = await session.request(`${path}/${output.file}`);
		if (!response.ok) throw new Error(`Cannot load published ROM (${response.status}): ${await response.text()}`);
		return new Uint8Array(await response.arrayBuffer());
	};
	const [systemRom, cart] = await Promise.all([load(artifact.system), artifact.cart === undefined ? null : load(artifact.cart)]);
	return { systemRom, cartridgeSlots: [cart, null] };
}

/** Explicit new-window navigation preserves the current machine and all its unsaved working copies. */
export function openPublishedBuild(id: string): void {
	const url = new URL(location.href);
	url.search = '';
	url.hash = '';
	url.searchParams.set('artifact', id);
	window.open(url, '_blank', 'noopener');
}
