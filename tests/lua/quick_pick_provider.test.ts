import assert from 'node:assert/strict';
import test from 'node:test';
import { WordMatcher } from '../../ide/common/word_matcher';
import { CommandQuickPickProvider } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { matchesWords } from '../helpers/vscode_word_filter';

test('retained iterative word matching agrees with the production VS Code ASCII recurrence', () => {
	const matcher = new WordMatcher();
	const queries = [''];
	let start = 0, end = 1;
	for (let length = 1; length <= 4; length += 1) {
		for (let index = start; index < end; index += 1) {
			for (const char of 'ab .-') queries.push(queries[index] + char);
		}
		start = end; end = queries.length;
	}
	const targets = ['', 'a', 'b', 'ab', 'a b', 'b.a (ab)', 'aaab - ab', 'a--- --b', 'ab.a-b.ab', 'a\tb\na',
		'run: hot resume', 'git: pull', 'files: open', 'editor.action', `${'a . '.repeat(32)}b`];
	queries.push('hr', 'rhr', 'hot r', 'gp', 'g p', 'pull', 'editor action', 'a'.repeat(16), `${'a-'.repeat(12)}c`);
	for (const target of targets) {
		for (const query of queries) {
			assert.equal(matcher.test(query, target), matchesWords(query, target) !== null,
				JSON.stringify({ query, target }));
		}
	}
});

test('command providers match word initials, substrings and exact ids, not shortcut metadata', () => {
	const items: CommandQuickPickItem[] = [
		{ command: 'hot-resume', label: 'Run: Hot Resume', description: '', detail: 'Ctrl+Shift+P' },
		{ command: 'scenarioLab.cancel', label: 'Scenario Lab: Cancel', description: '', detail: '' },
		{ command: 'debugContinue', label: 'Debug: Continue', description: '', detail: 'Ctrl+P' },
		{ command: 'pause', label: 'Run: Resume', description: '', detail: '' },
	];
	const provider = new CommandQuickPickProvider(items);
	const original = provider.getPicks(''), storage = original.matches;
	const retained = [...storage];
	assert.deepEqual(retained.map(match => match.itemIndex), [0, 1, 2, 3]);
	for (const query of ['hr', 'h r', 'HOT:RES', 'rhr', 'hot-resume']) {
		const picks = provider.getPicks(query);
		assert.equal(picks, original); assert.equal(picks.matches, storage);
		assert.deepEqual(picks.matches, [retained[0]], query);
		assert.equal(picks.selectionIndex, 0);
	}
	assert.deepEqual(provider.getPicks('run').matches, [retained[0], retained[3]], 'control-independent catalog order');
	assert.deepEqual(provider.getPicks('esu').matches, [retained[0], retained[3]], 'contiguous substrings still match inside words');
	assert.deepEqual(provider.getPicks('Run: Resume').matches, [retained[3], retained[0]],
		'an exact command outranks a longer word-boundary match, without excluding the latter');
	assert.deepEqual(provider.getPicks('scenarioLab.cancel').matches, [retained[1]], 'exact command id is a provider alias');
	for (const query of ['resume hot', 'Ctrl', 'no such command']) {
		const picks = provider.getPicks(query);
		assert.equal(picks.matches.length, 0); assert.equal(picks.selectionIndex, -1);
	}
	assert.deepEqual(provider.getPicks('').matches, retained);
});

test('literal choice providers retain match records and result storage without imposing command semantics', () => {
	const items = [
		{ label: 'Run: Hot Resume', description: 'SLOT 0', detail: 'Ctrl+P' },
		{ label: 'Run: Hot Resume', description: 'SLOT 1', detail: 'Ctrl+P' },
	];
	const provider = new TextQuickPickProvider(items);
	const picks = provider.getPicks(''), storage = picks.matches, second = picks.matches[1];
	assert.equal(provider.getPicks('hr').matches.length, 0, 'literal choices do not acquire command abbreviation rules');
	assert.equal(provider.getPicks(' resume hot slot 1 ').matches, storage);
	assert.deepEqual(storage, [second]);
	assert.equal(provider.items[second.itemIndex], items[1]);
});
