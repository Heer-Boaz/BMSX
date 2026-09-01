import type { RuntimeIdeState } from '../runtime/state';
import type { StudioWorkbench } from './contrib/studio/chrome';

export class WorkbenchState {
	public constructor(
		public readonly ide: RuntimeIdeState,
		public readonly studio: StudioWorkbench | null,
	) {
	}
}
