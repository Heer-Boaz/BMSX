import type { WorkbenchMenuDefinition } from '../../ui/menu/model';
import { selectedScenarioTestNode } from './projection';
import type { ScenarioLabViewState } from './view_model';

/** Immutable title placements bound to the retained Scenario Lab view. */
export const SCENARIO_LAB_TITLE_ACTIONS = [
	{ type: 'command', command: 'scenarioLab.play', when: view => !view.runActive },
	{ type: 'command', command: 'scenarioLab.run', when: view => !view.runActive },
	{ type: 'command', command: 'scenarioLab.debug', when: view => !view.runActive && selectedScenarioTestNode(view)?.kind === 'test' },
	{ type: 'command', command: 'scenarioLab.continue', when: view => view.debugger?.stopped === true },
	{ type: 'command', command: 'scenarioLab.stepInto', when: view => view.debugger?.stopped === true && view.debugger.source.stop !== undefined },
	{ type: 'command', command: 'scenarioLab.stepOver', when: view => view.debugger?.stopped === true && view.debugger.source.stop !== undefined },
	{ type: 'command', command: 'scenarioLab.stepOut', when: view => view.debugger?.stopped === true && view.debugger.source.stop !== undefined },
	{ type: 'command', command: 'scenarioLab.pause', when: view => view.debugger?.status === 'running' },
	{ type: 'command', command: 'scenarioLab.breakpoints', when: view => view.debugger?.stopped === true || view.debugger?.status === 'running' },
	{ type: 'command', command: 'scenarioLab.inspectStop', when: view => view.debugger?.stopped === true },
	{ type: 'command', command: 'scenarioLab.rerun', when: view => !view.runActive },
	{ type: 'command', command: 'scenarioLab.revealRun', when: view => view.resultService.runs.length !== 0 },
	{ type: 'command', command: 'scenarioLab.cancel', when: view => view.runActive },
	{ type: 'command', command: 'scenarioLab.details', when: view => !view.runActive },
	{ type: 'command', command: 'scenarioLab.inspectTarget', when: view => !view.runActive },
] as const satisfies WorkbenchMenuDefinition<ScenarioLabViewState>;
