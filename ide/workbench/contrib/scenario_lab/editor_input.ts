import { ReadonlyEditorInput } from '../../common/editor_input';
import type { ScenarioLabTabId } from '../../ui/tab/id';
import type { ScenarioLabViewState } from './view_model';

/** Retained input for the workbench Scenario Lab. */
export class ScenarioLabInput extends ReadonlyEditorInput<ScenarioLabTabId, 'scenario_lab'> {
	public constructor(public readonly view: ScenarioLabViewState) {
		super('scenario-lab', 'scenario_lab', 'SCENARIO LAB', true);
	}
}
