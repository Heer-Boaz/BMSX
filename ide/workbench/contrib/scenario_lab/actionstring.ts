import type { HostClock } from '../../../../hosts/common/clock';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ResourceDomain } from '../../../common/resource';
import { showEditorWarningBanner } from '../../../common/feedback_state';
import { createLuaResource } from '../../../workspace/workspace';
import { quoteLuaString } from '../../../../toolchain/ts/lua/syntax/string_literal';
import { validateLuaTableFieldExpression } from '../../../language/lua/table_field_insertion';
import type { QuickInputController } from '../../services/quick_input/controller';
import { ScenarioRunAdmissionError, type ScenarioRunService } from '../../services/testing/scenario_runs';
import type { ScenarioLabController } from './controller';

/** Authored, rerunnable input experiments use Scenario Lab's isolated machine and real cartlib parser. */
export class ActionStringTester {
	public constructor(private readonly sources: RuntimeSourceState, private readonly clock: HostClock,
		private readonly quickInput: QuickInputController, private readonly runs: ScenarioRunService, private readonly lab: ScenarioLabController) {}
	public canStart(domain: ResourceDomain): boolean { return domain !== -1 && !this.runs.active; }
	public open(domain: ResourceDomain, pattern = ''): void {
		if (domain === -1) throw new Error('Input experiments require a cartridge project.');
		this.quickInput.input('TEST ACTIONSTRING', "Uses the cart's real player mappings; no replacement bindings", pattern, async text => text, expression => {
			this.quickInput.input('INPUT EXPERIMENT', 'Lua: player, clock.frame / clock.gameplay, steps; optional verify(t, index, match) for cart assertions',
				"{ player = 1, clock = clock.frame, steps = { { key = 'KeyX', down = true, expect = true, max_ticks = 30 }, { key = 'KeyX', down = false, expect = false, max_ticks = 30 } } }",
				async text => validateLuaTableFieldExpression(text), experiment => {
					this.quickInput.input('SCENARIO SOURCE', 'Creates a reusable test; no changes to the authoring runtime', 'tests/actionstring_assert.lua', async relativePath => {
						const resource = await createLuaResource(this.clock, this.sources, { domain, relativePath,
							contents: actionStringScenarioSource(expression, experiment) });
						return resource;
					}, resource => {
						this.runs.refreshSources();
						const module = this.runs.collection.findModuleBySourcePath(domain, resource.path);
						try { this.lab.revealRun(this.runs.start(module.id)); }
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
