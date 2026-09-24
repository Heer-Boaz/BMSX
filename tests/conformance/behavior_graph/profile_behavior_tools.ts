import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { EditorTextModelService } from '../../../ide/editor/model/model_service';
import { WorkspaceSourceContext } from '../../../ide/workbench/services/working_copy/source_context';
import { WorkspaceBehaviorTools } from '../../../ide/workbench/services/assistant/behavior_tools';
import { BehaviorSourceDocuments } from '../../../ide/workbench/contrib/behavior_lens/source_documents';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../../helpers/scenario_sources';
import { medianMilliseconds } from '../../helpers/performance';

for (const count of [32, 1024]) {
	const source = `local fsm<const> = require('cartlib/fsm/library')
local bt<const> = require('cartlib/behaviour_tree/library')
local fx<const> = require('cartlib/actioneffects')
local machine<const> = {initial='idle',states={idle={on={next='../active'}},active={}}}
local tree<const> = {root={type='sequence',children={{type='task'},{type='wait'}}}}
local effect<const> = {cooldown_ms=10,required_tags={'active'}}
` + Array.from({ length: count }, (_, index) => `fsm.register('machine.${index}',machine)
bt.register('tree.${index}',tree)
fx.register_effect('effect.${index}',effect)`).join('\n');
	const models = new EditorTextModelService(), sources = createScenarioTestSourceState([createScenarioTestSourceRecord('profile.lua', 1, source)]);
	const context = new WorkspaceSourceContext(models, sources), documents = new BehaviorSourceDocuments(models, sources);
	const tools = new WorkspaceBehaviorTools('profile', context, sources, documents);
	const started = performance.now();
	const catalog = tools.execute('studio_list_behaviors', {}); assert.ok(catalog.kind === 'behaviors');
	const listed = performance.now();
	const reads = catalog.data.slice(0, 3).map(entry => {
		const result = tools.execute('studio_read_behavior', { behavior: entry.behavior });
		assert.ok(result.kind === 'behavior'); return result;
	});
	const read = performance.now();
	assert.equal(catalog.data.length, count * 3);
	const requests = catalog.data.slice(0, 3).map(entry => ({ behavior: entry.behavior }));
	const warmReadMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 3000; i++) {
			const result = tools.execute('studio_read_behavior', requests[i % 3]);
			assert.ok(result.kind === 'behavior'); assert.equal(result.data, reads[i % 3].data);
		}
	}) * 1000 / 3000;
	console.log(JSON.stringify({ registrations: catalog.data.length, coldDiscoveryMs: listed - started, coldFirstThreeReadsMs: read - listed,
		warmReadMicroseconds, responseBytes: JSON.stringify(reads).length,
		boundary: 'explicit source queries only; cold discovery includes semantic admission; first read includes whole-file topology; excludes network, rendering and guest execution' }));
	context.dispose(); models.clear();
}
