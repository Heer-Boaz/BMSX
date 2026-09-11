import assert from 'node:assert/strict';
import { EDITOR_COMMAND_IDS, EDITOR_COMMAND_PRESENTATION, editorCommandTitle } from '../../../ide/commands/catalog';
import { CommandQuickPickProvider } from '../../../ide/workbench/contrib/commands/quick_pick_provider';
import { medianMilliseconds } from '../../helpers/performance';

const items = EDITOR_COMMAND_IDS.map(command => ({ command,
	label: `${EDITOR_COMMAND_PRESENTATION[command].category}: ${editorCommandTitle(command, false)}`,
	description: '', detail: '' }));
const provider = new CommandQuickPickProvider(items), projection = provider.getPicks('');
const matches = projection.matches, entries = [...matches];
const QUERIES = 1000;
for (const query of ['', 'h', 'hr', 'hot res', 'Run: Resume', 'scenarioLab.cancel', 'not available']) {
	const elapsed = medianMilliseconds(() => { for (let n = 0; n < QUERIES; n += 1) provider.getPicks(query); });
	assert.equal(provider.getPicks(query), projection); assert.equal(projection.matches, matches);
	for (const match of matches) assert.equal(match, entries[match.itemIndex]);
	console.log(JSON.stringify({ commands: items.length, query, matches: matches.length, microsecondsPerQuery: elapsed * 1000 / QUERIES }));
}
