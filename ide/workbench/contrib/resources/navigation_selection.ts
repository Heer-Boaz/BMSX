import { EditorPaneSelection } from '../../services/editor/editor_selection';
import type { ResourceViewerInput } from './editor_input';
import type { ResourceViewerContentView } from './model';
import type { WorkbenchImageViewState } from '../../ui/image_viewport';

export class ResourceViewerNavigationSelection extends EditorPaneSelection {
	private readonly scroll: number;
	private readonly scrollLeft: number;
	private readonly view: ResourceViewerContentView;
	private readonly image: WorkbenchImageViewState | undefined;
	public constructor(input: ResourceViewerInput) {
		super();
		this.scroll = input.view.scroll; this.scrollLeft = input.view.scrollLeft; this.view = input.view.contentView;
		this.image = input.imagePosition ?? input.preview?.view.saveState();
	}

	public matches(other: ResourceViewerNavigationSelection): boolean {
		return this.scroll === other.scroll && this.scrollLeft === other.scrollLeft && this.view === other.view
			&& this.image?.scale === other.image?.scale && this.image?.scrollLeft === other.image?.scrollLeft && this.image?.scrollTop === other.image?.scrollTop;
	}

	public restore(input: ResourceViewerInput): void {
		input.view.scroll = this.scroll; input.view.scrollLeft = this.scrollLeft; input.view.contentView = this.view;
		input.imagePosition = this.image;
	}
}
