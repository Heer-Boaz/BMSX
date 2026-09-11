import { EditorPaneSelection } from '../../services/editor/editor_selection';
import { refreshScenarioLabProjection } from './projection';
import { updateScenarioLabStatus } from './navigation';
import { captureScenarioLabTestView, restoreScenarioLabTestView, type ScenarioLabTestViewSnapshot } from './view_snapshot';
import type { ScenarioLabViewState } from './view_model';

/** Result identity is a run/result row id, never the current visible row ordinal. */
export class ScenarioLabNavigationSelection extends EditorPaneSelection {
	private readonly tests: ScenarioLabTestViewSnapshot;
	private readonly resultId: string | undefined;
	private readonly focus: ScenarioLabViewState['focus'];
	private readonly resultScroll: number;
	private readonly expandedResults: readonly string[];
	private readonly newestRunId: ScenarioLabViewState['resultPane']['newestRunId'];

	public constructor(view: ScenarioLabViewState) {
		super();
		this.tests = captureScenarioLabTestView(view);
		this.resultId = view.resultPane.rows[view.resultPane.selectionIndex]?.id;
		this.focus = view.focus;
		this.resultScroll = view.resultPane.scroll;
		this.expandedResults = [...view.resultPane.expandedResultIds];
		this.newestRunId = view.resultPane.newestRunId;
	}

	public matches(other: ScenarioLabNavigationSelection): boolean {
		return this.tests.testId === other.tests.testId && this.resultId === other.resultId && this.focus === other.focus;
	}

	public restore(view: ScenarioLabViewState): void {
		restoreScenarioLabTestView(view, this.tests);
		view.resultPane.expandedResultIds.clear();
		for (const id of this.expandedResults) view.resultPane.expandedResultIds.add(id);
		view.resultPane.newestRunId = this.newestRunId;
		view.resultPane.projectedRevision = -1;
		refreshScenarioLabProjection(view);
		view.resultPane.selectionIndex = view.resultPane.rows.findIndex(row => row.id === this.resultId);
		view.resultPane.scroll = this.resultScroll;
		view.focus = this.focus;
		updateScenarioLabStatus(view);
	}
}
