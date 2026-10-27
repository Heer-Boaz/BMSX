import type { HostClock } from '../../../../hosts/common/clock';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { showEditorWarningBanner } from '../../../common/feedback_state';
import { createTextResource } from '../../../workspace/workspace';
import { quoteLuaString } from '../../../../toolchain/ts/lua/syntax/string_literal';
import { validateLuaTableFieldExpression } from '../../../language/lua/table_field_insertion';
import type { QuickInputController } from '../../services/quick_input/controller';
import { ScenarioRunAdmissionError, type ScenarioRunService } from '../../services/testing/scenario_runs';
import type { ScenarioLabController } from './controller';
import type { EditorGroupView } from '../../services/editor/editor_group';

/** Authored, rerunnable input experiments use Scenario Lab's isolated machine and real cartlib parser. */
export class ActionStringTester {
	public constructor(private readonly catalog: WorkspaceSourceCatalog, private readonly clock: HostClock,
		private readonly runs: ScenarioRunService, private readonly lab: ScenarioLabController) {}
	public canStart(contextId: string): boolean { return this.catalog.getContext(contextId).programDomain === 'cart' && !this.runs.active; }
	public open(contextId: string, group: EditorGroupView, quickInput: QuickInputController, pattern = ''): void {
		if (this.catalog.getContext(contextId).programDomain !== 'cart') throw new Error('Input experiments require a cartridge project.');
		quickInput.input('TEST ACTIONSTRING', "Uses the cart's real player mappings; no replacement bindings", pattern, async text => text, expression => {
			quickInput.input('INPUT EXPERIMENT', 'Lua: player, clock.frame / clock.gameplay, steps; optional verify(t, index, match) for cart assertions',
				"{ player = 1, clock = clock.frame, steps = { { key = 'KeyX', down = true, expect = true, max_ticks = 30 }, { key = 'KeyX', down = false, expect = false, max_ticks = 30 } } }",
				async text => validateLuaTableFieldExpression(text), experiment => {
					quickInput.input('SCENARIO SOURCE', 'Creates a reusable test; no changes to the authoring runtime', 'tests/actionstring_assert.lua', async relativePath => {
						const resource = await createTextResource(this.clock, this.catalog, { contextId, relativePath,
							contents: actionStringScenarioSource(expression, experiment) });
						return resource;
					}, resource => {
						this.runs.refreshSources();
						const module = this.runs.collection.findModuleBySourcePath(contextId, resource.path);
						try { this.lab.start(module.id, group); }
						catch (error) {
							if (!(error instanceof ScenarioRunAdmissionError)) throw error;
							showEditorWarningBanner(`${error.message} The scenario source was created and can be run from Scenario Lab.`);
						}
					});
				});
		});
	}
}

export function actionStringScenarioSource(pattern: string, experiment: string): string {
	return `local input<const> = require('cartlib/input/input')
local clock<const> = require('cartlib/clock')
return {
\tkind = 'integration',
\ttests = {
\t\tactionstring = function(t)
\t\t\tlocal experiment<const> = ${experiment}
\t\t\tt:wait_until('player initialized', function() return input.has_player(experiment.player) end, 120)
\t\t\tlocal evaluate<const> = input.bind(experiment.player, experiment.clock, ${quoteLuaString(pattern)})
\t\t\tlocal steps<const> = experiment.steps
\t\t\tfor index, step in ipairs(steps) do
\t\t\t\tif step.down then t:down(step.key, step.gamepad) else t:up(step.key, step.gamepad) end
\t\t\t\tif step.after_ticks then t:wait_ticks(step.after_ticks) end
\t\t\t\tt:wait_until('input step ' .. index, function() return (not not evaluate()) == step.expect end, step.max_ticks)
\t\t\t\tt:log('step ' .. index .. ': ' .. tostring(evaluate()))
\t\t\t\tif experiment.verify then experiment.verify(t, index, evaluate()) end
\t\t\tend
\t\tend,
\t},
}
`;
}
