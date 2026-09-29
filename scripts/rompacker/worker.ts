import { prepareMediaBuild } from './build';
import { RomArtifactStore } from './artifacts';
import type { MediaBuildOptions } from './build';

// Workers cannot publish. Losing their owner ends compilation, not just observation.
const orphaned = () => process.exit(1);
process.once('disconnect', orphaned);
process.once('message', async ({ options, root, stage }: { options: MediaBuildOptions; root: string; stage: string }) => {
	try {
		const result = await prepareMediaBuild(options, new RomArtifactStore(root), stage,
			phase => process.send!({ type: 'progress', phase }));
		process.send!({ type: 'prepared', result }, () => { process.removeListener('disconnect', orphaned); process.disconnect(); });
	} catch (error) { process.send!({ type: 'failed', error: error instanceof Error ? error.message : String(error) }, () => { process.removeListener('disconnect', orphaned); process.disconnect(); }); }
});
