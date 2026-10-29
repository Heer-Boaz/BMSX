import type { ScenarioTestNodeId } from '../../../testing/scenario/test_collection';

/** Retained test identity, independent of discovery's replaceable case objects and list rows. */
export class ScenarioLabTestSelection {
	private selected: ScenarioTestNodeId | null = null;
	private version = 0;

	public get nodeId(): ScenarioTestNodeId | null { return this.selected; }
	public get revision(): number { return this.version; }

	public select(nodeId: ScenarioTestNodeId | null): boolean {
		if (nodeId === this.selected) return false;
		this.selected = nodeId;
		this.version++;
		return true;
	}
}
