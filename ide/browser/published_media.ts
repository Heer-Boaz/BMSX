import type { BrowserBootMedia } from '../../hosts/browser/boot';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import type { StudioProjectAdmission } from '../../hosts/common/studio_projects';
import type { RomArtifact, RomBuildUnit } from '../../toolchain/ts/rompack/build_manifest';
import type { StudioHttpSession } from './http_session';
import type { PublishedBuildOpenResult } from '../workbench/services/builds';
import { createBrowserWorkspaceIdentity } from './workspace_session';

export type PublishedBuild = { media: BrowserBootMedia; project: StudioProjectAdmission };

/** The receipt owns source admission; its immutable artifact owns the matching ROM bytes. */
export async function loadPublishedBuild(session: StudioHttpSession, requestId: string): Promise<PublishedBuild> {
	const receipt = await session.request(`/__bmsx__/builds/jobs/${encodeURIComponent(requestId)}`, { cache: 'no-store' });
	if (!receipt.ok) throw new Error(`Cannot open published build (${receipt.status}): ${await receipt.text()}`);
	const job: StudioBuildJob = await receipt.json();
	if (job.state !== 'completed') throw new Error('The build has no completed published artifact.');
	if (job.project === undefined) throw new Error('This build has no source project admission. Rebuild the project before opening Studio.');
	const path = `/__bmsx__/builds/artifacts/${encodeURIComponent(job.artifact!)}`;
	const response = await session.request(path, { cache: 'no-store' });
	if (!response.ok) throw new Error(`Cannot open published build (${response.status}): ${await response.text()}`);
	const artifact: RomArtifact = await response.json();
	const load = async (unit: RomBuildUnit): Promise<Uint8Array> => {
		const output = unit.outputs.find(output => output.file.endsWith('.rom'))!;
		const response = await session.request(`${path}/${output.file}`);
		if (!response.ok) throw new Error(`Cannot load published ROM (${response.status}): ${await response.text()}`);
		return new Uint8Array(await response.arrayBuffer());
	};
	const [systemRom, cart] = await Promise.all([load(artifact.system), load(artifact.cart!)]);
	return { media: { systemRom, cartridgeSlots: [cart, null] }, project: job.project };
}

/** Explicit new-window navigation preserves the current machine and all its unsaved working copies. */
export function openPublishedBuild(requestId: string): PublishedBuildOpenResult {
	const url = new URL(location.href);
	url.search = '';
	url.hash = '';
	url.searchParams.set('build', requestId);
	// With the noopener feature, window.open returns null even on success. Open a
	// blank same-origin tab, sever its opener before navigation, and report denial.
	const opened = window.open('about:blank', '_blank');
	if (opened === null) return { status: 'blocked', url: url.href };
	opened.opener = null;
	createBrowserWorkspaceIdentity(opened.sessionStorage);
	opened.location.replace(url.href);
	return { status: 'opened', url: url.href };
}
