import type { RuntimeSourceStatus } from '../../services/working_copy/runtime_source_status';

/** The installed code comparison is independent of Save and guest execution. */
export const SCENE_SOURCE_STATUS = {
	applied: 'SOURCE MATCHES INSTALLED CODE',
	pending: 'SOURCE NOT MATCHING INSTALLED CODE',
	failed: 'SOURCE UPDATE FAILED',
	untracked: 'INSTALLED SOURCE UNKNOWN',
	source_only: 'SOURCE NOT INSTALLED',
} satisfies Record<RuntimeSourceStatus, string>;
