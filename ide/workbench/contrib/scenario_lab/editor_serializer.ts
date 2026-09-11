import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import type { ScenarioLabController } from './controller';
import type { ScenarioLabInput } from './editor_input';
import { captureScenarioLabTestView, restoreScenarioLabTestView, type ScenarioLabTestViewSnapshot } from './view_snapshot';

export class ScenarioLabInputSerializer implements EditorInputSerializer<ScenarioLabInput> {
	public constructor(private readonly controller: ScenarioLabController) {}

	public serialize(input: ScenarioLabInput): string { return JSON.stringify(captureScenarioLabTestView(input.view)); }

	public deserialize(value: string): ScenarioLabInput {
		const state: ScenarioLabTestViewSnapshot = JSON.parse(value);
		const input = this.controller.resolveInput();
		restoreScenarioLabTestView(input.view, state);
		return input;
	}
}
