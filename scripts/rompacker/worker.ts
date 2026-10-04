import { prepareMediaBuild } from './build';
import { RomArtifactStore } from './artifacts';
import type { MediaBuildOptions } from './build';
import { reportBuildDiagnostics } from '../lib/build_reporter';

// Workers cannot publish. Losing their owner ends compilation, not just observation.
const orphaned = () => process.exit(1);
process.once('disconnect', orphaned);
process.once('message', async ({ options, root, stage }: { options: MediaBuildOptions; root: string; stage: string }) => {
	try {
		const result = await prepareMediaBuild(options, new RomArtifactStore(root), stage,
			event => {
				if (event.type === 'diagnostic') reportBuildDiagnostics(event);
				else process.send!({ type: 'progress', phase: event.message });
			});
		process.send!({ type: 'prepared', result }, () => { process.removeListener('disconnect', orphaned); process.disconnect(); });
	} catch (error) { process.send!({ type: 'failed', error: error instanceof Error ? error.message : String(error) }, () => { process.removeListener('disconnect', orphaned); process.disconnect(); }); }
});
