import assert from 'node:assert/strict';
import test from 'node:test';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { BuildLogInput } from '../../ide/workbench/contrib/builds/editor_input';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import { TEXT_VIEW_PADDING } from '../../ide/workbench/ui/text_view/layout';

const job: StudioBuildJob = {
	request: { requestId: 'request-one', target: 'cpu_soak', debug: true, optLevel: 0 },
	state: 'completed', phase: 'Published', acceptedAt: 1, updatedAt: 2,
	version: { generation: 1, sequence: 2 },
};

/** Controlled typed read producer: model-contract evidence, not a worker or visible build-job fixture. */
class BuildReads implements WorkspaceBuilds {
	public readonly jobs = [job];
	public readonly pending = [];
	public readonly gets: { id: string; signal: AbortSignal | undefined }[] = [];
	public readonly logs: { id: string; signal: AbortSignal | undefined }[] = [];
	public getResult: Promise<StudioBuildJob | undefined> = Promise.resolve(job);
	public logResult: Promise<string> = Promise.resolve('');
	public targets(): Promise<readonly string[]> { throw new Error('Unexpected targets read'); }
	public submit(): Promise<StudioBuildJob> { throw new Error('Unexpected build admission'); }
	public cancel(): Promise<StudioBuildJob> { throw new Error('Unexpected producer cancellation'); }
	public forget(): void { throw new Error('Unexpected receipt deletion'); }
	public get(id: string, signal?: AbortSignal): Promise<StudioBuildJob | undefined> {
		this.gets.push({ id, signal }); return this.getResult;
	}
	public log(id: string, signal?: AbortSignal): Promise<string> {
		this.logs.push({ id, signal }); return this.logResult;
	}
}

test('build log identity is the exact request, with a distinct unfetched and fetched-empty output', async () => {
	const source = new BuildReads(), input = new BuildLogInput(job, source), initial = input.output.buffer;
	assert.equal(input.id, 'build-log:request-one'); assert.equal(input.description, job.request.requestId);
	assert.equal(input.kind, 'build_log'); assert.equal(input.resource, undefined);
	assert.equal(input.serializable, false); assert.equal(input.isDirty(), false);
	assert.equal(input.outputText, undefined); assert.equal(input.output.buffer.getText(), '');
	assert.equal(input.channel, 'output'); assert.equal(input.document, input.output);
	const loading = input.refresh(); assert.equal(input.loading, true); await loading;
	assert.equal(input.outputText, ''); assert.equal(input.output.buffer.getText(), '');
	assert.notEqual(input.output.buffer, initial, 'the first actual empty response is an observed document');
	assert.equal(input.loading, false); assert.equal(input.readError, undefined);
	assert.deepEqual(source.gets.map(read => read.id), ['request-one']);
	assert.deepEqual(source.logs.map(read => read.id), ['request-one']);
	assert.equal(source.gets[0].signal, source.logs[0].signal); input.dispose();
});

test('raw output and diagnostic channels retain separate CRLF, blank lines, tabs, whitespace and Unicode', async () => {
	const error = 'path/😀.lua:1:3\r\n\tUnexpected token\r\n\r\n  ^  \n';
	const output = '\r\nphase\tstart  \r\n\r\nİTEM 😀\rTAIL\n';
	const failed = { ...job, state: 'failed' as const, error }, source = new BuildReads();
	source.getResult = Promise.resolve(failed); source.logResult = Promise.resolve(output);
	const input = new BuildLogInput(failed, source);
	assert.equal(input.channel, 'error'); assert.equal(input.document, input.error);
	assert.equal(input.outputText, undefined); assert.equal(input.error!.buffer.getText(), error);
	await input.refresh();
	input.output.selectAll(); input.error!.selectAll();
	assert.equal(input.outputText, output); assert.equal(input.output.buffer.getText(), output);
	assert.equal(input.output.copy(), output); assert.equal(input.error!.copy(), error);
	assert.equal(input.error!.buffer.getText(), error, 'output publication must not concatenate its error into either channel');
	const outputBuffer = input.output.buffer;
	input.channel = 'output'; source.getResult = Promise.resolve({ ...failed, error: 'new diagnostic\n' });
	await input.refresh();
	assert.equal(input.channel, 'output', 'new diagnostics do not replace the chosen output channel');
	assert.equal(input.output.buffer, outputBuffer); assert.equal(input.error!.buffer.getText(), 'new diagnostic\n');
	source.getResult = Promise.resolve(job); input.channel = 'error'; await input.refresh();
	assert.equal(input.error, undefined); assert.equal(input.channel, 'output'); assert.equal(input.document, input.output);
	assert.equal(input.output.buffer, outputBuffer); input.dispose();
});

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} identical refresh retains buffer, selection, query and reading position`, async () => {
		const source = new BuildReads(), input = new BuildLogInput(job, source), font = new EditorFont(variant);
		const bounds = { left: 20, top: 30, right: 384, bottom: 120 };
		const text = Array.from({ length: 100 }, (_, index) => `entry ${index} alpha\n`).join('');
		source.logResult = Promise.resolve(text); await input.refresh();
		const document = input.output, buffer = document.buffer;
		document.layout(bounds, font, font.lineHeight); document.select(3, 11); document.setQuery('alpha');
		document.noteUserScroll(); document.viewport.scrollbar.setScroll(TEXT_VIEW_PADDING + font.lineHeight * 25.5);
		document.layout(bounds, font, font.lineHeight); const scroll = document.viewport.scrollTop;
		await input.refresh(); document.layout(bounds, font, font.lineHeight);
		assert.equal(input.output, document); assert.equal(document.buffer, buffer);
		assert.equal(document.selectionAnchor, 3); assert.equal(document.cursorOffset, 11);
		assert.equal(document.copy(), text.slice(3, 11)); assert.equal(document.query, 'alpha');
		assert.equal(document.viewport.scrollTop, scroll); input.dispose();
	});

	test(`${variant} changed refresh maps the retained document selection and reading occurrence`, async () => {
		const source = new BuildReads(), input = new BuildLogInput(job, source), font = new EditorFont(variant);
		const bounds = { left: 20, top: 30, right: 384, bottom: 120 };
		const text = Array.from({ length: 100 }, (_, index) => `entry ${index} alpha\n`).join('');
		source.logResult = Promise.resolve(text); await input.refresh();
		const document = input.output, buffer = document.buffer, start = text.indexOf('entry 40');
		document.layout(bounds, font, font.lineHeight); document.select(start, start + 8);
		document.noteUserScroll(); document.viewport.scrollbar.setScroll(TEXT_VIEW_PADDING + font.lineHeight * 25.5);
		document.layout(bounds, font, font.lineHeight); const scroll = document.viewport.scrollTop;
		source.logResult = Promise.resolve('HEADER\n' + text); await input.refresh(); document.layout(bounds, font, font.lineHeight);
		assert.equal(input.output, document); assert.notEqual(document.buffer, buffer);
		assert.equal(document.selectionAnchor, start + 7); assert.equal(document.cursorOffset, start + 15);
		assert.equal(document.copy(), 'entry 40'); assert.equal(document.viewport.scrollTop, scroll + font.lineHeight);
		assert.equal(input.outputText, 'HEADER\n' + text); input.dispose();
	});
}

test('closing a pending receipt read aborts before output and a late receipt cannot publish or reopen', async () => {
	const source = new BuildReads(), delayed = Promise.withResolvers<StudioBuildJob | undefined>();
	source.getResult = delayed.promise;
	const input = new BuildLogInput(job, source), loading = input.refresh();
	input.dispose(); assert.equal(source.gets[0].signal!.aborted, true);
	delayed.resolve({ ...job, error: 'late diagnostic' }); await loading;
	assert.equal(source.logs.length, 0); assert.equal(input.job, job);
	assert.equal(input.outputText, undefined); assert.equal(input.error, undefined);
	await input.refresh(); assert.equal(source.gets.length, 1, 'a disposed input cannot admit another read');
});

test('closing a pending output read aborts its real signal while retaining the previously read snapshot', async () => {
	const source = new BuildReads(), input = new BuildLogInput(job, source);
	source.logResult = Promise.resolve('cached\r\n'); await input.refresh();
	const buffer = input.output.buffer, delayed = Promise.withResolvers<string>(); source.logResult = delayed.promise;
	const loading = input.refresh(); await Promise.resolve();
	assert.equal(source.logs.length, 2); input.dispose(); assert.equal(source.logs[1].signal!.aborted, true);
	delayed.resolve('late replacement'); await loading;
	assert.equal(input.outputText, 'cached\r\n'); assert.equal(input.output.buffer, buffer);
	assert.equal(input.output.buffer.getText(), 'cached\r\n'); assert.equal(input.readError, undefined);
});

for (const phase of ['receipt', 'output'] as const) {
	test(`superseding a pending ${phase} read retires its generation before a late response can publish`, async () => {
		const source = new BuildReads(), receipt = Promise.withResolvers<StudioBuildJob | undefined>();
		const output = Promise.withResolvers<string>(), input = new BuildLogInput(job, source);
		if (phase === 'receipt') source.getResult = receipt.promise;
		else source.logResult = output.promise;
		const previous = input.refresh(); await Promise.resolve();
		const oldSignal = source.gets[0].signal!;
		const current = { ...job, updatedAt: 3, version: { generation: 1, sequence: 3 } };
		source.getResult = Promise.resolve(current); source.logResult = Promise.resolve('current output\n');
		await input.refresh(); const revision = input.revision;
		assert.equal(oldSignal.aborted, true); assert.equal(input.loading, false);
		if (phase === 'receipt') receipt.resolve({ ...job, error: 'stale error' });
		else output.resolve('stale output');
		await previous;
		assert.equal(input.job, current); assert.equal(input.outputText, 'current output\n');
		assert.equal(input.output.buffer.getText(), 'current output\n'); assert.equal(input.error, undefined);
		assert.equal(input.readError, undefined); assert.equal(input.revision, revision);
		assert.ok(source.gets.every(read => read.id === job.request.requestId)); input.dispose();
	});
}

test('unavailable reads retain the cached snapshot, selection and explicit readError instead of replacing it', async () => {
	const source = new BuildReads(), input = new BuildLogInput(job, source);
	source.logResult = Promise.resolve('cached 😀\r\n'); await input.refresh(); input.output.selectAll();
	const buffer = input.output.buffer, logs = source.logs.length;
	source.getResult = Promise.resolve(undefined); await input.refresh();
	assert.equal(input.readError, 'This build request is no longer available.'); assert.equal(source.logs.length, logs);
	assert.equal(input.output.buffer, buffer); assert.equal(input.output.copy(), 'cached 😀\r\n'); assert.equal(input.job, job);
	source.getResult = Promise.resolve(job); source.logResult = Promise.reject(new Error('Output transport unavailable'));
	await input.refresh();
	assert.equal(input.readError, 'Error: Output transport unavailable'); assert.equal(input.loading, false);
	assert.equal(input.output.buffer, buffer); assert.equal(input.output.copy(), 'cached 😀\r\n'); input.dispose();
});

test('a fresh receipt and diagnostic publish independently of a failing output read, without rolling back cached output', async () => {
	const source = new BuildReads(), input = new BuildLogInput(job, source);
	source.logResult = Promise.resolve('previous raw output\r\n'); await input.refresh();
	const buffer = input.output.buffer, pending = Promise.withResolvers<string>();
	const failed = { ...job, state: 'failed' as const, updatedAt: 3, error: 'fresh diagnostic\r\n  ^\n',
		version: { generation: 1, sequence: 3 } };
	source.getResult = Promise.resolve(failed); source.logResult = pending.promise;
	const refreshing = input.refresh(); await Promise.resolve();
	assert.equal(input.job, failed); assert.equal(input.error!.buffer.getText(), failed.error);
	assert.equal(input.loading, true); assert.equal(input.readError, undefined);
	assert.equal(input.output.buffer, buffer); assert.equal(input.outputText, 'previous raw output\r\n');
	const diagnostic = input.error;
	pending.reject(new Error('Output read failed')); await refreshing;
	assert.equal(input.job, failed); assert.equal(input.error, diagnostic);
	assert.equal(input.error!.buffer.getText(), failed.error); assert.equal(input.readError, 'Error: Output read failed');
	assert.equal(input.loading, false); assert.equal(input.output.buffer, buffer);
	assert.equal(input.output.buffer.getText(), 'previous raw output\r\n'); input.dispose();
});
