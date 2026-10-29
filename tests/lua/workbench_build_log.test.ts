import assert from 'node:assert/strict';
import test from 'node:test';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { BuildLogInput } from '../../ide/workbench/contrib/builds/editor_input';
import { BuildOutputs } from '../../ide/workbench/contrib/builds/output';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import { TEXT_VIEW_PADDING } from '../../ide/workbench/ui/text_view/layout';

const job: StudioBuildJob = {
	request: { requestId: 'request-one', target: 'fixture-product', debug: true, optLevel: 0 },
	state: 'completed', phase: 'Published', acceptedAt: 1, updatedAt: 2,
	version: { generation: 1, sequence: 2 },
};

/** Controlled typed read producer: these tests do not execute a product build or depend on a cart. */
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

test('a build reader binds the exact shared request and distinguishes unfetched from fetched-empty output', async t => {
	const source = new BuildReads(), outputs = new BuildOutputs(source), result = outputs.get(job), input = new BuildLogInput(result);
	t.after(() => { input.dispose(); outputs.dispose(); });
	const view = input.view, initial = result.output;
	assert.equal(input.description, job.request.requestId); assert.ok(view.result === result);
	assert.equal(input.kind, 'build_log'); assert.equal(input.resource, undefined);
	assert.equal(input.serializable, false); assert.equal(input.isDirty(), false);
	assert.equal(result.outputText, undefined); assert.equal(view.output.buffer.getText(), '');
	assert.equal(view.channel, 'output'); assert.ok(view.document === view.output);
	const loading = result.refresh(); assert.equal(result.loading, true); await loading;
	assert.equal(result.outputText, ''); assert.equal(view.output.buffer.getText(), '');
	assert.ok(result.output !== initial && view.output.buffer === result.output, 'the actual empty response is a shared captured document');
	assert.equal(result.loading, false); assert.equal(result.readError, undefined);
	assert.deepEqual(source.gets.map(read => read.id), ['request-one']);
	assert.deepEqual(source.logs.map(read => read.id), ['request-one']);
	assert.ok(source.gets[0].signal === source.logs[0].signal);
});

test('raw output and diagnostic readers preserve separate CRLF, blank lines, tabs, whitespace and Unicode', async t => {
	const error = 'path/😀.lua:1:3\r\n\tUnexpected token\r\n\r\n  ^  \n';
	const output = '\r\nphase\tstart  \r\n\r\nİTEM 😀\rTAIL\n';
	const failed = { ...job, state: 'failed' as const, error }, source = new BuildReads(), outputs = new BuildOutputs(source);
	source.getResult = Promise.resolve(failed); source.logResult = Promise.resolve(output);
	const result = outputs.get(failed), input = new BuildLogInput(result), view = input.view;
	t.after(() => { input.dispose(); outputs.dispose(); });
	assert.equal(view.channel, 'error'); assert.ok(view.document === view.error);
	assert.equal(result.outputText, undefined); assert.equal(view.error!.buffer.getText(), error);
	await result.refresh();
	view.output.selectAll(); view.error!.selectAll();
	assert.equal(result.outputText, output); assert.equal(view.output.buffer.getText(), output);
	assert.equal(view.output.copy(), output); assert.equal(view.error!.copy(), error);
	assert.equal(view.error!.buffer.getText(), error, 'output and failure diagnostic never concatenate into another document');
	const outputBuffer = view.output.buffer;
	view.channel = 'output'; source.getResult = Promise.resolve({ ...failed, error: 'new diagnostic\n' });
	await result.refresh();
	assert.equal(view.channel, 'output', 'new diagnostics do not replace the reader\'s chosen output channel');
	assert.ok(view.output.buffer === outputBuffer); assert.equal(view.error!.buffer.getText(), 'new diagnostic\n');
	source.getResult = Promise.resolve(job); view.channel = 'error'; await result.refresh();
	assert.equal(view.error, undefined); assert.equal(view.channel, 'output'); assert.ok(view.document === view.output);
	assert.ok(view.output.buffer === outputBuffer);
});

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} an identical shared observation retains each reader's selection, query and reading`, async t => {
		const source = new BuildReads(), outputs = new BuildOutputs(source), result = outputs.get(job), input = new BuildLogInput(result);
		t.after(() => { input.dispose(); outputs.dispose(); });
		const font = new EditorFont(variant), bounds = { left: 20, top: 30, right: 384, bottom: 120 };
		const text = Array.from({ length: 100 }, (_, index) => `entry ${index} alpha\n`).join('');
		source.logResult = Promise.resolve(text); await result.refresh();
		const document = input.view.output, buffer = document.buffer;
		document.layout(bounds, font, font.lineHeight); document.select(3, 11); document.setQuery('alpha');
		document.noteUserScroll(); document.viewport.scrollbar.setScroll(TEXT_VIEW_PADDING + font.lineHeight * 25.5);
		document.layout(bounds, font, font.lineHeight); const scroll = document.viewport.scrollTop;
		await result.refresh(); document.layout(bounds, font, font.lineHeight);
		assert.ok(input.view.output === document && document.buffer === buffer);
		assert.equal(document.selectionAnchor, 3); assert.equal(document.cursorOffset, 11);
		assert.equal(document.copy(), text.slice(3, 11)); assert.equal(document.query, 'alpha');
		assert.equal(document.viewport.scrollTop, scroll);
	});

	test(`${variant} changed shared output maps two independently retained selections and reading occurrences`, async t => {
		const source = new BuildReads(), outputs = new BuildOutputs(source), result = outputs.get(job), first = new BuildLogInput(result), second = first.createView();
		t.after(() => { first.dispose(); second.dispose(); outputs.dispose(); });
		const font = new EditorFont(variant), bounds = { left: 20, top: 30, right: 384, bottom: 120 };
		const text = Array.from({ length: 100 }, (_, index) => `entry ${index} alpha\n`).join('');
		source.logResult = Promise.resolve(text); await result.refresh();
		const firstDocument = first.view.output, secondDocument = second.view.output, buffer = result.output;
		const firstStart = text.indexOf('entry 40'), secondStart = text.indexOf('entry 60');
		firstDocument.layout(bounds, font, font.lineHeight); firstDocument.select(firstStart, firstStart + 8); firstDocument.setQuery('40');
		secondDocument.layout(bounds, font, font.lineHeight); secondDocument.select(secondStart, secondStart + 8); secondDocument.setQuery('60');
		firstDocument.noteUserScroll(); firstDocument.viewport.scrollbar.setScroll(TEXT_VIEW_PADDING + font.lineHeight * 25.5);
		secondDocument.noteUserScroll(); secondDocument.viewport.scrollbar.setScroll(TEXT_VIEW_PADDING + font.lineHeight * 45.5);
		firstDocument.layout(bounds, font, font.lineHeight); secondDocument.layout(bounds, font, font.lineHeight);
		const firstScroll = firstDocument.viewport.scrollTop, secondScroll = secondDocument.viewport.scrollTop;
		source.logResult = Promise.resolve('HEADER\n' + text); await result.refresh();
		firstDocument.layout(bounds, font, font.lineHeight); secondDocument.layout(bounds, font, font.lineHeight);
		assert.ok(first.view.output === firstDocument && second.view.output === secondDocument && firstDocument !== secondDocument);
		assert.ok(result.output !== buffer && firstDocument.buffer === result.output && secondDocument.buffer === result.output);
		assert.equal(firstDocument.selectionAnchor, firstStart + 7); assert.equal(firstDocument.cursorOffset, firstStart + 15);
		assert.equal(secondDocument.selectionAnchor, secondStart + 7); assert.equal(secondDocument.cursorOffset, secondStart + 15);
		assert.equal(firstDocument.copy(), 'entry 40'); assert.equal(secondDocument.copy(), 'entry 60');
		assert.equal(firstDocument.query, '40'); assert.equal(secondDocument.query, '60');
		assert.equal(firstDocument.viewport.scrollTop, firstScroll + font.lineHeight);
		assert.equal(secondDocument.viewport.scrollTop, secondScroll + font.lineHeight);
		assert.equal(result.outputText, 'HEADER\n' + text);
	});
}

test('closing one reader leaves the shared pending read and the surviving reader alive', async t => {
	const source = new BuildReads(), outputs = new BuildOutputs(source), receipt = Promise.withResolvers<StudioBuildJob | undefined>();
	source.getResult = receipt.promise;
	const result = outputs.get(job), closed = new BuildLogInput(result), survivor = closed.createView();
	t.after(() => { survivor.dispose(); outputs.dispose(); });
	const pending = result.refresh(), joined = survivor.view.result.refresh();
	assert.ok(pending === joined); assert.equal(source.gets.length, 1);
	closed.dispose(); const revision = closed.view.revision;
	assert.equal(source.gets[0].signal!.aborted, false);
	receipt.resolve({ ...job, error: 'a newly captured failure\n' }); await pending;
	assert.equal(result.loading, false); assert.equal(source.logs.length, 1);
	assert.equal(survivor.view.error!.buffer.getText(), 'a newly captured failure\n');
	assert.equal(closed.view.error, undefined); assert.equal(closed.view.revision, revision);
	const fresh = new BuildLogInput(outputs.get(job)); t.after(() => fresh.dispose());
	assert.ok(fresh.view.result === result && fresh.view.error!.buffer === survivor.view.error!.buffer);
	assert.equal(source.gets.length, 1, 'attaching another reader does not request source');
});

for (const phase of ['receipt', 'output'] as const) test(`disposing the output store aborts a pending ${phase} read and publishes explicit retirement to retained readers`, async t => {
	const source = new BuildReads(), outputs = new BuildOutputs(source), result = outputs.get(job), input = new BuildLogInput(result);
	t.after(() => { input.dispose(); outputs.dispose(); });
	source.logResult = Promise.resolve('cached\r\n'); await result.refresh();
	const buffer = result.output, receipt = Promise.withResolvers<StudioBuildJob | undefined>(), output = Promise.withResolvers<string>();
	if (phase === 'receipt') source.getResult = receipt.promise;
	else source.logResult = output.promise;
	const pending = result.refresh(); await Promise.resolve();
	const signal = source.gets.at(-1)!.signal!;
	const published = t.mock.fn(); t.after(result.onDidChange(published));
	outputs.dispose(); const publications = published.mock.callCount(), viewRevision = input.view.revision;
	assert.equal(signal.aborted, true); assert.equal(result.isDisposed, true); assert.equal(result.loading, false);
	assert.notEqual(result.readError, undefined);
	if (phase === 'receipt') receipt.resolve({ ...job, error: 'late diagnostic' });
	else output.resolve('late replacement');
	await pending;
	assert.ok(result.output === buffer && input.view.output.buffer === buffer);
	assert.equal(input.view.output.buffer.getText(), 'cached\r\n'); assert.equal(input.view.error, undefined);
	assert.equal(published.mock.callCount(), publications); assert.equal(input.view.revision, viewRevision);
	assert.throws(() => result.refresh());
});

test('read failure retains the shared snapshot and each reader\'s actual selection and query', async t => {
	const source = new BuildReads(), outputs = new BuildOutputs(source), result = outputs.get(job), input = new BuildLogInput(result);
	t.after(() => { input.dispose(); outputs.dispose(); });
	source.logResult = Promise.resolve('cached 😀\r\n'); await result.refresh(); input.view.output.selectAll(); input.view.output.setQuery('cached');
	const buffer = result.output, logs = source.logs.length;
	source.getResult = Promise.resolve(undefined); await result.refresh();
	assert.notEqual(result.readError, undefined); assert.equal(source.logs.length, logs);
	assert.ok(input.view.output.buffer === buffer); assert.equal(input.view.output.copy(), 'cached 😀\r\n'); assert.ok(result.job === job);
	source.getResult = Promise.resolve(job); source.logResult = Promise.reject(new Error('Output transport unavailable'));
	await result.refresh();
	assert.equal(result.loading, false); assert.notEqual(result.readError, undefined);
	assert.ok(input.view.output.buffer === buffer); assert.equal(input.view.output.copy(), 'cached 😀\r\n'); assert.equal(input.view.output.query, 'cached');
});

test('same-result views share captured documents but not channel, selection, query, actions or layout', async t => {
	const source = new BuildReads(), outputs = new BuildOutputs(source), failed = { ...job, error: 'failure alpha\n' }, result = outputs.get(failed);
	source.getResult = Promise.resolve(failed); source.logResult = Promise.resolve('output alpha\n'); await result.refresh();
	const first = new BuildLogInput(result), second = first.createView();
	t.after(() => { first.dispose(); second.dispose(); outputs.dispose(); });
	assert.notEqual(first.id, second.id); assert.equal(first.matches(second), true); assert.equal(first.canMove(), true);
	assert.ok(first.view !== second.view && first.view.result === second.view.result);
	assert.ok(first.view.output !== second.view.output && first.view.error !== second.view.error);
	assert.ok(first.view.output.buffer === second.view.output.buffer && first.view.error!.buffer === second.view.error!.buffer);
	assert.ok(first.view.actions !== second.view.actions && first.view.layout !== second.view.layout);
	first.view.output.select(0, 6); first.view.output.setQuery('output'); first.view.channel = 'output';
	assert.equal(second.view.output.copy(), null); assert.equal(second.view.output.query, ''); assert.equal(second.view.channel, 'error');
	second.view.error!.selectAll(); second.view.error!.setQuery('failure');
	assert.equal(first.view.error!.copy(), null); assert.equal(first.view.error!.query, '');
});
