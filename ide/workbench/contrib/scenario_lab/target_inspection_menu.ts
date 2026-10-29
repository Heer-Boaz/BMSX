import type { WorkbenchMenuDefinition } from '../../ui/menu/model';
import type { TestTargetInspectionModel } from './target_inspection_model';

/** A borrowed live stop has execution actions; a case-end target is read-only. */
export const SCENARIO_TARGET_ACTIONS = [
	{ type: 'command', command: 'scenarioLab.continue', when: model => model.inspection.state.role === 'live-test' },
	{ type: 'command', command: 'scenarioLab.stepInto', when: model => model.inspection.state.role === 'live-test' && model.inspection.state.stop !== undefined },
	{ type: 'command', command: 'scenarioLab.stepOver', when: model => model.inspection.state.role === 'live-test' && model.inspection.state.stop !== undefined },
	{ type: 'command', command: 'scenarioLab.stepOut', when: model => model.inspection.state.role === 'live-test' && model.inspection.state.stop !== undefined },
	{ type: 'command', command: 'scenarioLab.breakpoints', when: model => model.inspection.state.role === 'live-test' },
	{ type: 'command', command: 'scenarioLab.cancel', when: model => model.inspection.state.role === 'live-test' },
	{ type: 'command', command: 'scenarioLab.details' },
	{ type: 'command', command: 'scenarioLab.closeTarget' },
] as const satisfies WorkbenchMenuDefinition<TestTargetInspectionModel>;
