import { DisposableStore } from '../../../common/lifecycle';
import type { PrimaryNavigationLocation } from '../../../navigation/navigation_history';
import type { MainWorkspace } from '../../main_workspace';
import type { ScenePrimaryBookmark } from './primary_bookmark';

type RestoreOptions = Parameters<PrimaryNavigationLocation['restore']>[0];
export type RestoreScenePrimaryBookmark = (bookmark: ScenePrimaryBookmark, options: RestoreOptions) => Promise<boolean>;

/** History owns the source bookmark, while the persistent Main workspace owns admission. */
export class ScenePrimaryNavigationLocation extends DisposableStore implements PrimaryNavigationLocation {
	private readonly retirementListeners = new Set<() => void>();

	public constructor(private readonly bookmark: ScenePrimaryBookmark, main: Pick<MainWorkspace, 'onWillDispose'>,
		private readonly restoreBookmark: RestoreScenePrimaryBookmark) {
		super();
		if (bookmark.isDisposed) { super.dispose(); return; }
		this.add({ dispose: main.onWillDispose(this.retire) });
		this.add({ dispose: bookmark.onDidRetire(this.retire) });
		this.add(bookmark);
	}

	public matches(other: PrimaryNavigationLocation): boolean {
		return other instanceof ScenePrimaryNavigationLocation && this.bookmark.matches(other.bookmark);
	}

	public onDidRetire(listener: () => void): () => void {
		if (this.isDisposed) listener(); else this.retirementListeners.add(listener);
		return () => this.retirementListeners.delete(listener);
	}

	public restore(options: RestoreOptions): Promise<boolean> {
		return this.isDisposed ? Promise.resolve(false) : this.restoreBookmark(this.bookmark, options);
	}

	private readonly retire = (): void => {
		if (this.isDisposed) return;
		super.dispose();
		for (const listener of this.retirementListeners) listener();
		this.retirementListeners.clear();
	};

	public override dispose(): void {
		if (this.isDisposed) return;
		super.dispose(); this.retirementListeners.clear();
	}
}
