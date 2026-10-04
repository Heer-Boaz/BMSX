import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import stringWidth from 'string-width';
import { CliTerminal, truncateTerminalText } from '../../scripts/lib/cli_terminal';
import { TaskProgressReporter } from '../../scripts/lib/task_progress';

function capture() {
	let text = '';
	const stream = new Writable({ write(chunk, _encoding, done) { text += chunk.toString(); done(); } });
	return { stream, text: () => text };
}

test('terminal elision respects display cells and does not split grapheme clusters', () => {
	for (const source of ['Compile source.lua', '图像像素', 'e\u0301'.repeat(20), '👩‍💻'.repeat(20)]) {
		for (let columns = 0; columns < 30; columns++) {
			const line = truncateTerminalText(source, columns);
			assert.ok(stringWidth(line) <= columns);
			const [prefix, suffix] = line.split('…');
			const segments = [...new Intl.Segmenter().segment(source)];
			assert.ok(prefix === '' || segments.some(segment => segment.index + segment.segment.length === prefix.length));
			if (suffix !== undefined && suffix !== '') assert.ok(segments.some(segment => segment.index === source.length - suffix.length));
		}
	}
});

test('plain build logs retain phases and diagnostics without one line per asset', () => {
	const out = capture(), err = capture();
	const progress = new TaskProgressReporter(new CliTerminal(out.stream, err.stream));
	progress.report({ type: 'phase', message: 'compile-fixture' });
	for (let current = 1; current <= 1000; current++) {
		progress.report({ type: 'item', message: `fixture-asset-${current}`, current, total: 1000 });
	}
	progress.report({ type: 'diagnostic', level: 'warning', message: 'fixture-warning' });
	progress.report({ type: 'diagnostic', level: 'info', message: 'fixture-info' });
	progress.finish('fixture-finished');
	assert.ok(out.text().includes('compile-fixture'));
	assert.ok(out.text().includes('fixture-info'));
	assert.ok(out.text().includes('fixture-finished'));
	assert.ok(!out.text().includes('fixture-asset-'));
	assert.ok(err.text().includes('fixture-warning'));
	assert.ok(!out.text().includes('\u001b[1G'));
	assert.ok(!out.text().includes('\u001b[2K'));
});

test('verbose output retains asset details, and failure retains the last item on stderr', () => {
	const out = capture(), err = capture();
	const progress = new TaskProgressReporter(new CliTerminal(out.stream, err.stream), true);
	progress.report({ type: 'phase', message: 'fixture-phase' });
	for (let current = 1; current <= 3; current++) {
		progress.report({ type: 'item', message: `fixture-item-${current}`, current, total: 3 });
		assert.ok(out.text().includes(`fixture-item-${current}`));
	}
	progress.fail();
	assert.ok(err.text().includes('fixture-phase'));
	assert.ok(err.text().includes('fixture-item-3'));
});

test('interactive progress coalesces updates, survives diagnostics, and cancels redraws on completion', () => {
	// Child environment controls terminal capabilities without changing the test runner's environment.
	execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
		import assert from 'node:assert/strict';
		import { Writable } from 'node:stream';
		import { CliTerminal } from './scripts/lib/cli_terminal.ts';
		import { TaskProgressReporter } from './scripts/lib/task_progress.ts';
		let text = '';
		const output = Object.assign(new Writable({ write(chunk, encoding, done) { text += chunk; done(); } }), { isTTY: true, columns: 40 });
		const terminal = new CliTerminal(output, output);
		assert.equal(terminal.interactiveProgress, true);
		const progress = new TaskProgressReporter(terminal);
		progress.report({ type: 'phase', message: 'fixture-phase' });
		for (let current = 1; current <= 1000; current++) progress.report({ type: 'item', message: 'x'.repeat(100), current, total: 1000 });
		assert.ok(text.length < 1000);
		progress.report({ type: 'diagnostic', level: 'warning', message: 'fixture-warning' });
		assert.ok(text.indexOf('fixture-warning') < text.lastIndexOf('fixture-phase'));
		output.columns = 20;
		progress.report({ type: 'phase', message: 'next-phase-with-a-long-description' });
		assert.ok(!text.includes('next-phase-with-a-long-description'));
		progress.report({ type: 'detail', message: 'pending-detail' });
		progress.finish('fixture-finished');
		const completed = text;
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.equal(text, completed);
	`], { env: { ...process.env, TERM: 'xterm', CI: '', NO_COLOR: '1', FORCE_COLOR: '0' } });
});

test('dumb terminals and CI do not receive cursor-control sequences', () => {
	for (const environment of [{ TERM: 'dumb', CI: '' }, { TERM: 'xterm', CI: '1' }]) {
		execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
			import assert from 'node:assert/strict';
			import { Writable } from 'node:stream';
			import { CliTerminal } from './scripts/lib/cli_terminal.ts';
			let text = '';
			const output = Object.assign(new Writable({ write(chunk, encoding, done) { text += chunk; done(); } }), { isTTY: true });
			const terminal = new CliTerminal(output);
			assert.equal(terminal.interactiveProgress, false);
			terminal.showProgress('not-a-log-record');
			terminal.stopProgress();
			assert.equal(text, '');
		`], { env: { ...process.env, ...environment } });
	}
});
