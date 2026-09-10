import { EditorPaneSelection } from '../../services/editor/editor_selection';
import type { ResourceViewerState } from './model';

export class ResourceViewerNavigationSelection extends EditorPaneSelection {
	public constructor(private readonly scroll: number) { super(); }

	public matches(other: ResourceViewerNavigationSelection): boolean {
		return this.scroll === other.scroll;
	}

	public restore(view: ResourceViewerState): void {
		view.scroll = this.scroll;
	}
}
