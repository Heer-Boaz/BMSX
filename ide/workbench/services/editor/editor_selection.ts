import { DisposableStore } from '../../../common/lifecycle';

/** Contribution-owned location data; only the matching concrete pane restores it. */
export abstract class EditorPaneSelection extends DisposableStore {
	public abstract matches(other: EditorPaneSelection): boolean;
}
