import assert from 'node:assert/strict';
import test from 'node:test';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import { BuildOutputs } from '../../ide/workbench/contrib/builds/output';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';

const job: StudioBuildJob = {
	request: { requestId: 'build-one', target: 'fixture', debug: true, optLevel: 0 },
	state: 'running', phase: 'Compiling', acceptedAt: 1, updatedAt: 2,
	version: { generation: 1, sequence: 2 },
};

/** Controlled reads exercise workspace observation, not worker execution or frontend presentation. */
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

test('build output identity is request-scoped within its workspace owner, not a reader or caller receipt', async () => {
	const source = new BuildReads(), outputs = new BuildOutputs(source), otherWorkspace = new BuildOutputs(source);
	const result = outputs.get(job);
	assert.equal(result.job, job);
	assert.equal(source.gets.length, 0, 'obtaining an observation never admits a read');
	const fresh = { ...job, updatedAt: 3, version: { generation: 1, sequence: 3 } };
	source.getResult = Promise.resolve(fresh); await result.refresh();
	assert.equal(result.job, fresh);
	assert.equal(outputs.get(job), result);
	assert.equal(result.job, fresh, 'opening from an older receipt cannot overwrite the observed receipt');
	assert.notEqual(otherWorkspace.get(job), result);
	const otherRequest = { ...job, request: { ...job.request, requestId: 'build-two' } };
	assert.notEqual(outputs.get(otherRequest), result);
	outputs.dispose(); otherWorkspace.dispose();
});

test('refresh publishes its shared operation before notifying synchronous readers', async () => {
	const source = new BuildReads(), outputs = new BuildOutputs(source), result = outputs.get(job);
	const receipt = Promise.withResolvers<StudioBuildJob | undefined>(), output = Promise.withResolvers<string>();
	source.getResult = receipt.promise; source.logResult = output.promise;
	const joined: Promise<void>[] = [];
	const unbind = result.onDidChange(() => { if (result.loading) joined.push(result.refresh()); });
	const refreshing = result.refresh();
	assert.equal(result.loading, true);
	assert.equal(result.refresh(), refreshing);
	assert.equal(joined[0], refreshing, 'a reader joining the initial publication must share the same request');
	assert.deepEqual(source.gets.map(read => read.id), [job.request.requestId]);
	receipt.resolve(job); await Promise.resolve();
	assert.equal(result.refresh(), refreshing, 'joining the output phase does not repeat the receipt read');
	assert.deepEqual(source.logs.map(read => read.id), [job.request.requestId]);
	assert.equal(source.gets[0].signal, source.logs[0].signal);
	output.resolve('raw\r\noutput\t😀\n'); await refreshing;
	assert.ok(joined.length > 1);
	assert.ok(joined.every(operation => operation === refreshing));
	assert.equal(result.loading, false);
	assert.equal(result.outputText, 'raw\r\noutput\t😀\n');
	assert.equal(result.output.getText(), result.outputText);
	unbind();
	const next = result.refresh(); assert.notEqual(next, refreshing); await next;
	assert.equal(source.gets.length, 2); assert.equal(source.logs.length, 2);
	outputs.dispose();
});

test('receipt and diagnostic publication are independent of the pending captured-output read', async () => {
	const source = new BuildReads(), outputs = new BuildOutputs(source), result = outputs.get(job);
	source.logResult = Promise.resolve('earlier output\r\n'); await result.refresh();
	const buffer = result.output;
	const diagnostic = 'path/😀.lua:1:3\r\n\tUnexpected token\r\n\r\n  ^  \n';
	const failed = { ...job, state: 'failed' as const, error: diagnostic, updatedAt: 3,
		version: { generation: 1, sequence: 3 } };
	const output = Promise.withResolvers<string>();
	source.getResult = Promise.resolve(failed); source.logResult = output.promise;
	let observed = false;
	const unbind = result.onDidChange(() => {
		if (result.job !== failed) return;
		observed = true;
		assert.equal(result.error!.getText(), diagnostic);
		assert.equal(result.output, buffer);
		assert.equal(result.outputText, 'earlier output\r\n');
	});
	const refreshing = result.refresh(); await Promise.resolve();
	assert.equal(observed, true);
	assert.equal(result.loading, true);
	output.reject(new Error('Output read failed')); await refreshing;
	assert.equal(result.job, failed);
	assert.equal(result.error!.getText(), diagnostic);
	assert.equal(result.output, buffer);
	assert.equal(result.readError, 'Error: Output read failed');
	assert.equal(result.loading, false);
	unbind(); outputs.dispose();
});

test('workspace disposal during receipt publication retires observation before admitting the output read', async () => {
	const source = new BuildReads(), outputs = new BuildOutputs(source), result = outputs.get(job);
	const failed = { ...job, state: 'failed' as const, error: 'diagnostic', updatedAt: 3,
		version: { generation: 1, sequence: 3 } };
	source.getResult = Promise.resolve(failed);
	const publications: { job: StudioBuildJob; loading: boolean; disposed: boolean }[] = [];
	result.onDidChange(() => {
		publications.push({ job: result.job, loading: result.loading, disposed: result.isDisposed });
		if (result.job !== failed) return;
		outputs.dispose();
	});
	await result.refresh();
	assert.equal(source.gets[0].signal!.aborted, true);
	assert.equal(source.logs.length, 0);
	assert.equal(result.job, failed);
	assert.equal(result.error!.getText(), failed.error);
	assert.equal(result.outputText, undefined);
	assert.equal(result.isDisposed, true);
	assert.equal(result.loading, false);
	assert.notEqual(result.readError, undefined);
	assert.deepEqual(publications, [
		{ job, loading: true, disposed: false },
		{ job: failed, loading: true, disposed: false },
		{ job: failed, loading: false, disposed: true },
	], 'workspace retirement is the final publication, not a completed output read');
	assert.throws(() => result.refresh()); assert.equal(source.gets.length, 1);
	assert.throws(() => outputs.get(job), /disposed workspace/);
});
