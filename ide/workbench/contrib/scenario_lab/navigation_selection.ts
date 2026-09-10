import { EditorPaneSelection } from '../../services/editor/editor_selection';
import { rebuildScenarioLabTestRows, refreshScenarioLabProjection, updateSelectedScenarioNode } from './projection';
import { updateScenarioLabStatus } from './navigation';
import type { ScenarioTestRootId } from '../../../testing/scenario/test_collection';
import type { ScenarioLabViewState } from './view_model';

/** Result identity is a run/result row id, never the current visible row ordinal. */
export class ScenarioLabNavigationSelection extends EditorPaneSelection {
	private readonly testId: ScenarioLabViewState['testPane']['selectedNodeId'];
	private readonly resultId: string | undefined;
	private readonly focus: ScenarioLabViewState['focus'];
	private readonly testScroll: number;
	private readonly resultScroll: number;
	private readonly collapsedRoots: readonly ScenarioTestRootId[];
	private readonly expandedResults: readonly string[];
	private readonly newestRunId: ScenarioLabViewState['resultPane']['newestRunId'];

	public constructor(view: ScenarioLabViewState) {
		super();
		this.testId = view.testPane.selectedNodeId;
		this.resultId = view.resultPane.rows[view.resultPane.selectionIndex]?.id;
		this.focus = view.focus;
		this.testScroll = view.testPane.scroll;
		this.resultScroll = view.resultPane.scroll;
		this.collapsedRoots = [...view.testPane.collapsedRootIds];
		this.expandedResults = [...view.resultPane.expandedResultIds];
		this.newestRunId = view.resultPane.newestRunId;
	}

	public matches(other: ScenarioLabNavigationSelection): boolean {
		return this.testId === other.testId && this.resultId === other.resultId && this.focus === other.focus;
	}

	public restore(view: ScenarioLabViewState): void {
		view.testPane.collapsedRootIds.clear();
		for (const id of this.collapsedRoots) view.testPane.collapsedRootIds.add(id);
		rebuildScenarioLabTestRows(view);
		view.testPane.selectionIndex = view.testPane.rows.findIndex(row => row.id === this.testId);
		updateSelectedScenarioNode(view);
		view.resultPane.expandedResultIds.clear();
		for (const id of this.expandedResults) view.resultPane.expandedResultIds.add(id);
		view.resultPane.newestRunId = this.newestRunId;
		view.resultPane.projectedRevision = -1;
		refreshScenarioLabProjection(view);
		view.resultPane.selectionIndex = view.resultPane.rows.findIndex(row => row.id === this.resultId);
		view.testPane.scroll = this.testScroll;
		view.resultPane.scroll = this.resultScroll;
		view.focus = this.focus;
		updateScenarioLabStatus(view);
	}
}
