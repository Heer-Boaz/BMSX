import { RomArtifactStore, romBuildConfigurationKey, romBuildKey } from '../../../scripts/rompacker/artifacts';
import { BuildLedger } from './ledger';

/** Adopt actual completed results once per unowned configuration, never by file age.
 * Existing current slots may have been selected more recently by another producer. */
export function initializeBuildOutputs(store: RomArtifactStore, ledger: BuildLedger, apply: boolean): Promise<string[]> {
	return store.withSharedAccess(async () => {
		const artifacts = new Map((await store.list()).map(artifact => [artifact.id, artifact]));
		const current = await store.currentArtifacts();
		const configurations = new Set<string>();
		for (const job of ledger.completed()) {
			const artifact = artifacts.get(job.artifact!), artifactAvailable = artifact !== undefined;
			if (apply && job.artifactAvailable !== artifactAvailable)
				ledger.record({ ...job, artifactAvailable, version: { generation: ledger.generation, sequence: 0 } });
			const request = job.request, selector = romBuildKey([request.target, job.project?.cartridge.projectRoot, request.debug, request.optLevel]);
			if (configurations.has(selector)) continue;
			configurations.add(selector);
			if (artifact === undefined) continue; // Do not promote an older result when the selected output was collected.
			const configuration = romBuildConfigurationKey(artifact);
			if (current.has(configuration)) continue;
			if (apply) await store.retainCurrent(artifact, false);
			current.set(configuration, artifact.id);
		}
		return [...current.values()];
	});
}

/** Offline collection takes the same exclusive server ownership as Studio.
 * An older running server cannot lose unregistered active media to a new CLI. */
export async function collectOfflineBuilds(store: RomArtifactStore, apply: boolean, roots: readonly string[] = []) {
	const ledger = await BuildLedger.open(store.root);
	try {
		const current = await initializeBuildOutputs(store, ledger, apply);
		const result = await store.collect({ apply, roots: apply ? roots : [...roots, ...current],
			retiredReferences: ['jobs', 'sessions'] });
		if (apply) for (const id of result.removed) for (const job of ledger.artifactJobs(id))
			ledger.record({ ...job, artifactAvailable: false, version: { generation: ledger.generation, sequence: 0 } });
		return result;
	} finally { ledger.close(); }
}
