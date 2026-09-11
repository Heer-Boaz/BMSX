import { EditorPaneSelection } from '../../services/editor/editor_selection';
import type { BehaviorLensInput } from './editor_input';
import { behaviorSourceBookmarksEqual } from './source_bookmark';
import { captureBehaviorLensView, mapBehaviorLensView, restoreBehaviorLensView, type BehaviorLensViewSnapshot } from './view_snapshot';

/** Navigation owns the lifetime of its mapped copy, not the snapshot format. */
export class BehaviorLensNavigationSelection extends EditorPaneSelection {
	public readonly snapshot: BehaviorLensViewSnapshot;

	public constructor(input: BehaviorLensInput) {
		super();
		this.snapshot = captureBehaviorLensView(input);
		this.add({ dispose: input.workingCopy.onDidChangeContent(event => mapBehaviorLensView(this.snapshot, event.changes)) });
	}

	public matches(other: BehaviorLensNavigationSelection): boolean {
		return behaviorSourceBookmarksEqual(this.snapshot.definition, other.snapshot.definition)
			&& behaviorSourceBookmarksEqual(this.snapshot.selected, other.snapshot.selected)
			&& this.snapshot.selectedGroup === other.snapshot.selectedGroup;
	}

	public restore(input: BehaviorLensInput): void {
		restoreBehaviorLensView(input, this.snapshot);
	}
}
