import { RECENT_ROM_ARTIFACTS, RomArtifactStore } from '../../../scripts/rompacker/artifacts';
import { BuildLedger } from './ledger';

/** Offline collection takes the same exclusive server ownership as Studio.
 * An older running server cannot lose unregistered active media to a new CLI. */
export async function collectOfflineBuilds(store: RomArtifactStore, apply: boolean, roots: readonly string[] = []) {
	const ledger = await BuildLedger.open(store.root);
	try {
		const jobs = ledger.recent(RECENT_ROM_ARTIFACTS).filter(job => job.state === 'completed');
		return await store.collect({ keepRecent: RECENT_ROM_ARTIFACTS, apply, roots: [...roots, ...jobs.map(job => job.artifact!)],
			retiredReferences: ['jobs', 'sessions'] });
	} finally { ledger.close(); }
}
