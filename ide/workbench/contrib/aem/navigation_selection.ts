import { EditorPaneSelection } from '../../services/editor/editor_selection';
import { captureWorkbenchTreeView, restoreWorkbenchTreeView, type WorkbenchTreeViewSnapshot } from '../../ui/tree_view';
import type { AemEditorInput } from './editor_input';
import { projectAemSource } from './source';
import { resourceIdentityEquals, type ResourceIdentity } from '../../../common/resource';
import { trackedTextLocationsEqual, type TrackedTextLocation } from '../../../editor/text/text_location';
import type { AemSourceRole } from './source_selection';

/** Authored property identity and reading state survive another pane attachment. */
export class AemNavigationSelection extends EditorPaneSelection {
	private readonly view: WorkbenchTreeViewSnapshot;
	private readonly resource: ResourceIdentity;
	private readonly selected: { readonly role: AemSourceRole; readonly location: TrackedTextLocation } | undefined;

	public constructor(input: AemEditorInput) {
		super();
		projectAemSource(input);
		this.view = captureWorkbenchTreeView(input.tree, element => element.key);
		this.resource = input.workingCopy.identity;
		const source = input.sourceSelection.selected;
		if (source !== undefined) {
			const location = { ...source.range, resource: this.resource };
			this.selected = { role: source.role, location };
			this.add({ dispose: input.workingCopy.trackRanges(new Map([['selected', location]])) });
			this.add({ dispose: input.workingCopy.onDidApplyChanges(() => { if (location.start === location.end) this.dispose(); }) });
		}
		this.add({ dispose: input.workingCopy.onWillDispose(() => this.dispose()) });
	}

	public matches(other: AemNavigationSelection): boolean {
		return resourceIdentityEquals(this.resource, other.resource) && (this.selected === undefined || other.selected === undefined
			? this.selected === other.selected : this.selected.role === other.selected.role && trackedTextLocationsEqual(this.selected.location, other.selected.location));
	}

	public restore(input: AemEditorInput): void {
		projectAemSource(input);
		restoreWorkbenchTreeView(input.tree, { ...this.view, selected: undefined }, element => element.key);
		const selected = this.selected !== undefined && resourceIdentityEquals(this.selected.location.resource, input.workingCopy.identity)
			? input.sourceSelection.find(this.selected.role, this.selected.location) : undefined;
		input.sourceSelection.restore(selected);
		input.tree.selectionIndex = input.tree.rows.findIndex(row => row.element.sourceIdentity === selected);
	}
}
