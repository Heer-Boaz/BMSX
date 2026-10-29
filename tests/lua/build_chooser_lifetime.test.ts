import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { KeyModifier } from '../../hosts/common/input/text';
import type { StudioBuildJob, StudioBuildRequest } from '../../hosts/common/studio_builds';
import { editorFeedbackState, showEditorMessage, updateEditorMessage } from '../../ide/common/feedback_state';
import { inputFocus } from '../../ide/input/focus';
import { chooseBuild, chooseBuildOutput, showBuildJobs } from '../../ide/workbench/contrib/builds/commands';
import { BuildLogInput } from '../../ide/workbench/contrib/builds/editor_input';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { createActualSourcePanes } from '../helpers/source_panes';

const JOB: StudioBuildJob = {
	request: { requestId: 'owned-build-request', target: 'synthetic-build-target', debug: true, optLevel: 0 },
	state: 'running', phase: 'compile', acceptedAt: 1, updatedAt: 2, version: { generation: 1, sequence: 2 },
};
const CANCELLED: StudioBuildJob = { ...JOB, state: 'cancelled', phase: 'cancelled', updatedAt: 3,
	version: { generation: 1, sequence: 3 } };

/** Typed workspace transport. Admitted requests and receipts outlive their transient UI readers. */
class DeferredBuilds implements WorkspaceBuilds {
	public readonly jobs: StudioBuildJob[] = [];
	public readonly pending: StudioBuildRequest[] = [];
	public readonly targetReads: PromiseWithResolvers<readonly string[]>[] = [];
	public readonly targetSignals: (AbortSignal | undefined)[] = [];
	public readonly gets: { id: string; signal: AbortSignal | undefined; response: PromiseWithResolvers<StudioBuildJob | undefined> }[] = [];
	public readonly cancellations: { id: string; response: PromiseWithResolvers<StudioBuildJob> }[] = [];
	public readonly submissions: { request: StudioBuildRequest; response: PromiseWithResolvers<StudioBuildJob> }[] = [];
	public readonly forgotten: string[] = [];
	public readonly logs: string[] = [];
	public targets(signal?: AbortSignal): Promise<readonly string[]> {
		this.targetSignals.push(signal);
		const response = Promise.withResolvers<readonly string[]>(); this.targetReads.push(response); return response.promise;
	}
	public get(id: string, signal?: AbortSignal): Promise<StudioBuildJob | undefined> {
		const response = Promise.withResolvers<StudioBuildJob | undefined>(); this.gets.push({ id, signal, response });
		return response.promise.then(job => { if (job !== undefined) this.publish(job); return job; });
	}
	public cancel(id: string): Promise<StudioBuildJob> {
		const response = Promise.withResolvers<StudioBuildJob>(); this.cancellations.push({ id, response });
		return response.promise.then(job => { this.publish(job); return job; });
	}
	public submit(target: string, debug: boolean, optLevel: 0 | 1 | 2 | 3): Promise<StudioBuildJob> {
		const response = Promise.withResolvers<StudioBuildJob>();
		const request = { requestId: `accepted-request-${this.submissions.length}`, target, debug, optLevel };
		this.submissions.push({ request, response }); this.pending.push(request);
		return response.promise.then(job => {
			this.pending.splice(this.pending.indexOf(request), 1); this.publish(job); return job;
		});
	}
	public forget(id: string): void { this.forgotten.push(id); }
	public log(id: string): Promise<string> { this.logs.push(id); return Promise.resolve(''); }
	private publish(job: StudioBuildJob): void {
		const index = this.jobs.findIndex(current => current.request.requestId === job.request.requestId);
		if (index === -1) this.jobs.push(job); else this.jobs[index] = job;
	}
}

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t), builds = new DeferredBuilds();
	f.editor.builds = builds; f.first.focus();
	t.after(() => updateEditorMessage(editorFeedbackState.message.timer));
	return { ...f, builds };
}

type Fixture = ReturnType<typeof fixture>;
type Withdrawal = 'Escape' | 'deactivate' | 'replacement picker' | 'origin retirement' | 'provider replacement' | 'picker disposal';

function withdraw(f: Fixture, withdrawal: Withdrawal) {
	const replacement = { label: 'Independent choice', description: '', detail: '' };
	switch (withdrawal) {
		case 'Escape': f.key('Escape'); f.second.focus(); break;
		case 'deactivate': f.editor.deactivate(); f.editor.activate(); f.second.focus(); break;
		case 'replacement picker':
			f.second.focus();
			f.editor.quickInput.pick('Independent operation', '', () => new TextQuickPickProvider([replacement]), () => {});
			break;
		case 'origin retirement': f.first.commandTarget.scope.retireContext(); f.second.focus(); break;
		case 'provider replacement': f.editor.builds = new DeferredBuilds(); f.second.focus(); break;
		case 'picker disposal': f.editor.quickInput.dispose(); f.second.focus(); break;
	}
	return replacement;
}

test('build target discovery immediately admits cancellable owned UI before its transport settles', async t => {
	const f = fixture(t), picker = f.editor.quickInput, origin = inputFocus.admittedTarget;
	const choosing = chooseBuild(f.editor), immediatelyVisible = picker.visible;
	const immediatelyBusy = picker.busy;
	const immediatelyFocused = inputFocus.admittedTarget === picker.field.focusTarget;
	const immediateOrigin = picker.visible ? picker.invocationOrigin : undefined;
	assert.ok(f.builds.targetSignals[0] !== undefined); assert.equal(f.builds.targetSignals[0].aborted, false);
	f.key('Escape'); f.builds.targetReads[0].resolve(['synthetic-build-target']); await choosing; await setImmediate();
	assert.equal(immediatelyVisible, true); assert.equal(immediatelyBusy, true); assert.equal(immediatelyFocused, true); assert.ok(immediateOrigin === origin);
	assert.equal(picker.visible, false); assert.ok(inputFocus.admittedTarget === origin);
	assert.equal(f.builds.targetSignals[0].aborted, true);
	assert.equal(f.builds.submissions.length, 0);
});

for (const withdrawal of ['Escape', 'deactivate', 'replacement picker', 'origin retirement', 'provider replacement', 'picker disposal'] as const)
	for (const outcome of ['catalog', 'error'] as const)
		test(`${withdrawal} prevents a late target ${outcome} from replacing UI, feedback or native focus`, async t => {
			const f = fixture(t), picker = f.editor.quickInput;
			const choosing = chooseBuild(f.editor), read = f.builds.targetReads[0];
			const replacement = withdraw(f, withdrawal);
			assert.ok(f.builds.targetSignals[0] !== undefined); assert.equal(f.builds.targetSignals[0].aborted, true);
			showEditorMessage('An observation owned by the newer UI', 'info', 30);
			const feedback = { ...editorFeedbackState.message }, focused = inputFocus.admittedTarget;
			const documents = [...f.editor.editorParts.documents], version = f.firstInput.workingCopy.version;
			if (outcome === 'catalog') read.resolve(['synthetic-build-target']); else read.reject(new Error('Retired target read'));
			await choosing; await setImmediate();
			if (withdrawal === 'replacement picker') {
				assert.equal(picker.visible, true); assert.ok(picker.model.items[0] === replacement);
			} else assert.equal(picker.visible, false);
			assert.ok(inputFocus.admittedTarget === focused);
			// Exact producer feedback is retained data, not a frozen UI caption.
			assert.deepEqual(editorFeedbackState.message, feedback);
			assert.deepEqual(f.editor.editorParts.documents, documents);
			assert.equal(f.firstInput.workingCopy.version, version); assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source);
			assert.equal(f.builds.submissions.length, 0); assert.equal(f.builds.targetReads.length, 1);
		});

test('accepting a build receipt immediately owns the deferred inspection instead of leaving a focusless gap', async t => {
	const f = fixture(t), picker = f.editor.quickInput; f.builds.jobs.push(JOB);
	showBuildJobs(f.editor, f.firstGroup); f.key('Enter');
	const immediatelyVisible = picker.visible, immediatelyFocused = inputFocus.admittedTarget === picker.field.focusTarget;
	const immediatelyBusy = picker.busy;
	assert.equal(f.builds.gets[0].id, JOB.request.requestId);
	f.key('Escape'); f.builds.gets[0].response.resolve(JOB); await setImmediate();
	assert.equal(immediatelyVisible, true); assert.equal(immediatelyBusy, true); assert.equal(immediatelyFocused, true); assert.equal(picker.visible, false);
	assert.equal(f.builds.gets[0].signal!.aborted, true);
	assert.equal(f.builds.submissions.length, 0); assert.equal(f.builds.gets.length, 1);
});

for (const withdrawal of ['Escape', 'deactivate', 'replacement picker', 'origin retirement', 'provider replacement'] as const)
	for (const outcome of ['receipt', 'missing receipt', 'error'] as const)
		test(`${withdrawal} revokes deferred inspection UI when its original request later produces ${outcome}`, async t => {
			const f = fixture(t), picker = f.editor.quickInput; f.builds.jobs.push(JOB);
			showBuildJobs(f.editor, f.firstGroup); f.key('Enter'); const read = f.builds.gets[0];
			assert.equal(read.id, JOB.request.requestId);
			const replacement = withdraw(f, withdrawal);
			showEditorMessage('A newer retained observation', 'info', 30);
			const feedback = { ...editorFeedbackState.message }, focused = inputFocus.admittedTarget;
			const tabs = [...f.firstGroup.model.tabs], second = f.secondGroup.model.activeTab;
			if (outcome === 'error') read.response.reject(new Error('Retired receipt read'));
			else read.response.resolve(outcome === 'receipt' ? JOB : undefined);
			await setImmediate();
			if (withdrawal === 'replacement picker') {
				assert.equal(picker.visible, true); assert.ok(picker.model.items[0] === replacement);
			} else assert.equal(picker.visible, false);
			assert.ok(inputFocus.admittedTarget === focused); assert.deepEqual(editorFeedbackState.message, feedback);
			assert.deepEqual(f.firstGroup.model.tabs, tabs); assert.ok(f.secondGroup.model.activeTab === second);
			assert.equal(f.builds.submissions.length, 0); assert.equal(f.builds.cancellations.length, 0);
			assert.equal(f.builds.gets.length, 1); assert.deepEqual(f.builds.forgotten, []);
		});

async function openDetails(f: Fixture, job = JOB): Promise<void> {
	f.builds.jobs.push(job); showBuildJobs(f.editor, f.firstGroup); f.key('Enter');
	f.builds.gets[0].response.resolve(job); await setImmediate();
	assert.equal(f.editor.quickInput.visible, true);
}

for (const outcome of ['receipt', 'error'] as const)
	test(`an accepted cancellation continues independently without reopening retired details after its ${outcome}`, async t => {
		const f = fixture(t), picker = f.editor.quickInput; await openDetails(f);
		// The nonterminal producer's final action is cancellation. The assertion
		// concerns the exact admitted request, not any presentation wording.
		f.key('End', KeyModifier.ctrl); f.key('Enter');
		assert.equal(f.builds.cancellations.length, 1); assert.equal(f.builds.cancellations[0].id, JOB.request.requestId);
		const immediatelyVisible = picker.visible;
		const immediatelyBusy = picker.busy;
		f.key('Escape'); f.second.focus();
		showEditorMessage('A newer retained observation', 'info', 30);
		const feedback = { ...editorFeedbackState.message }, focused = inputFocus.admittedTarget;
		if (outcome === 'receipt') f.builds.cancellations[0].response.resolve(CANCELLED);
		else f.builds.cancellations[0].response.reject(new Error('Retired cancel acknowledgement'));
		await setImmediate();
		assert.equal(immediatelyVisible, true); assert.equal(immediatelyBusy, true); assert.equal(picker.visible, false); assert.ok(inputFocus.admittedTarget === focused);
		assert.deepEqual(editorFeedbackState.message, feedback);
		if (outcome === 'receipt') assert.ok(f.builds.jobs[0] === CANCELLED);
		assert.equal(f.builds.cancellations.length, 1); assert.equal(f.builds.submissions.length, 0); assert.equal(f.builds.gets.length, 1);
	});

test('a missing receipt can be checked again only by explicit acceptance and never repeats the build', async t => {
	const f = fixture(t), picker = f.editor.quickInput; f.builds.pending.push(JOB.request);
	showBuildJobs(f.editor, f.firstGroup); f.key('Enter'); assert.equal(f.builds.gets.length, 1);
	f.builds.gets[0].response.resolve(undefined); await setImmediate();
	assert.equal(picker.visible, true); assert.equal(f.builds.gets.length, 1);
	f.key('Enter'); assert.equal(f.builds.gets.length, 2);
	assert.equal(f.builds.gets[1].id, JOB.request.requestId);
	f.builds.gets[1].response.resolve(undefined); await setImmediate();
	assert.equal(picker.visible, true); assert.equal(f.builds.submissions.length, 0);
	assert.equal(f.builds.cancellations.length, 0); assert.deepEqual(f.builds.forgotten, []);
	assert.ok(f.builds.pending[0] === JOB.request);
});

test('an accepted build submission retains one request and receipt independently of replacement UI', async t => {
	const f = fixture(t), picker = f.editor.quickInput, choosing = chooseBuild(f.editor);
	f.builds.targetReads[0].resolve(['synthetic-build-target']); await choosing; await setImmediate();
	f.key('Enter');
	type Recipe = QuickPickItem & { debug: boolean; optLevel: 0 | 1 | 2 | 3 };
	const index = picker.model.list.rows.findIndex(row => !(row.item as Recipe).debug && (row.item as Recipe).optLevel === 1);
	assert.ok(index >= 0); picker.model.list.selectionIndex = index; f.key('Enter');
	assert.equal(f.builds.submissions.length, 1);
	const submission = f.builds.submissions[0], request = submission.request;
	assert.equal(request.target, 'synthetic-build-target'); assert.equal(request.debug, false); assert.equal(request.optLevel, 1);
	const replacement = withdraw(f, 'replacement picker'), focused = inputFocus.admittedTarget, version = f.firstInput.workingCopy.version;
	const accepted: StudioBuildJob = { ...JOB, request, state: 'queued', phase: 'queued' };
	submission.response.resolve(accepted); await setImmediate();
	assert.ok(f.builds.jobs[0] === accepted); assert.equal(f.builds.pending.length, 0); assert.equal(f.builds.submissions.length, 1);
	assert.equal(picker.visible, true); assert.ok(picker.model.items[0] === replacement && inputFocus.admittedTarget === focused);
	assert.equal(f.firstInput.workingCopy.version, version); assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source);
});

for (const handoff of ['target to recipe', 'jobs to details', 'refresh request'] as const)
	for (const destination of ['sibling focus', 'explicit release', 'replacement picker'] as const)
	test(`${destination} chosen during return focus supersedes ${handoff} without another request`, async t => {
		const f = fixture(t), picker = f.editor.quickInput;
		if (handoff === 'target to recipe') {
			chooseBuild(f.editor); f.builds.targetReads[0].resolve([JOB.request.target]); await setImmediate();
		} else if (handoff === 'jobs to details') { f.builds.jobs.push(JOB); showBuildJobs(f.editor, f.firstGroup); }
		else await openDetails(f);
		const gets = f.builds.gets.length, replacement = { label: 'New native interaction', description: '', detail: '' };
		const unbind = f.first.commandTarget.onDidFocus(() => {
			unbind();
			if (destination === 'explicit release') inputFocus.setTarget(null);
			else {
				f.second.focus();
				if (destination === 'replacement picker') picker.pick('New owner', '', () => new TextQuickPickProvider([replacement]), () => {});
			}
		}); t.after(unbind);
		f.key('Enter'); await setImmediate();
		if (destination === 'replacement picker') {
			assert.equal(picker.visible, true); assert.equal(picker.busy, false); assert.ok(picker.model.items[0] === replacement);
			assert.ok(inputFocus.admittedTarget === picker.field.focusTarget && picker.invocationOrigin === f.second.commandTarget);
		} else {
			assert.equal(picker.visible, false);
			assert.ok(inputFocus.admittedTarget === (destination === 'explicit release' ? null : f.second.commandTarget));
		}
		assert.equal(f.builds.gets.length, gets); assert.equal(f.builds.submissions.length, 0); assert.equal(f.builds.cancellations.length, 0);
	});

for (const outcome of ['receipt', 'error'] as const)
	test(`accepted cancellation remains observed when a new UI vetoes its follow-up prepare before ${outcome}`, async t => {
		const f = fixture(t), picker = f.editor.quickInput; await openDetails(f);
		const replacement = { label: 'New admitted catalog', description: '', detail: '' };
		const unbind = f.first.commandTarget.onDidBlur(() => {
			unbind(); picker.pick('New owner', '', () => new TextQuickPickProvider([replacement]), () => {});
		}); t.after(unbind);
		f.key('End', KeyModifier.ctrl); f.key('Enter');
		assert.equal(f.builds.cancellations.length, 1); assert.equal(f.builds.cancellations[0].id, JOB.request.requestId);
		assert.ok(picker.model.items[0] === replacement); assert.equal(picker.busy, false);
		showEditorMessage('A newer retained observation', 'info', 30);
		const feedback = { ...editorFeedbackState.message }, focused = inputFocus.admittedTarget;
		if (outcome === 'receipt') f.builds.cancellations[0].response.resolve(CANCELLED);
		else f.builds.cancellations[0].response.reject(new Error('Retired follow-up acknowledgement'));
		await setImmediate();
		assert.ok(picker.model.items[0] === replacement && inputFocus.admittedTarget === focused);
		assert.deepEqual(editorFeedbackState.message, feedback);
		if (outcome === 'receipt') assert.ok(f.builds.jobs[0] === CANCELLED);
		assert.equal(f.builds.cancellations.length, 1); assert.equal(f.builds.gets.length, 1); assert.equal(f.builds.submissions.length, 0);
	});

test('an explicitly accepted background cancellation keeps producer error feedback without taking newer native focus', async t => {
	const f = fixture(t), picker = f.editor.quickInput; await openDetails(f);
	const unbind = f.first.commandTarget.onDidFocus(() => { unbind(); f.second.focus(); }); t.after(unbind);
	f.key('End', KeyModifier.ctrl); f.key('Enter');
	assert.equal(f.builds.cancellations.length, 1); assert.equal(picker.visible, false);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	const error = new Error('The accepted background cancellation failed');
	f.builds.cancellations[0].response.reject(error); await setImmediate();
	assert.equal(picker.visible, false); assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	assert.equal(editorFeedbackState.message.kind, 'error'); assert.equal(editorFeedbackState.message.text, String(error));
	assert.equal(f.builds.cancellations.length, 1); assert.equal(f.builds.submissions.length, 0);
});

const PUBLISHED: StudioBuildJob = { ...JOB, state: 'completed', phase: 'published', artifact: 'synthetic-artifact',
	project: { target: JOB.request.target, system: { id: 'synthetic-system', projectRoot: 'synthetic-system-root' },
		cartridge: { id: 'synthetic-project', projectRoot: 'synthetic-project-root' } } };

for (const replacement of ['focus', 'workspace binding'] as const)
	test(`published-open recovery cannot overwrite ${replacement} chosen by the actual open callback`, async t => {
		const f = fixture(t), picker = f.editor.quickInput, requests: string[] = [];
		const item = { label: 'Independent native choice', description: '', detail: '' };
		f.editor.openPublishedBuild = id => {
			requests.push(id); f.second.focus();
			if (replacement === 'workspace binding') {
				f.editor.builds = new DeferredBuilds();
				picker.pick('New owner', '', () => new TextQuickPickProvider([item]), () => {});
			}
			return { status: 'blocked', url: 'https://build.invalid/published' };
		};
		await openDetails(f, PUBLISHED); f.key('Enter'); await setImmediate();
		assert.deepEqual(requests, [JOB.request.requestId]);
		if (replacement === 'focus') { assert.equal(picker.visible, false); assert.ok(inputFocus.admittedTarget === f.second.commandTarget); }
		else { assert.equal(picker.visible, true); assert.ok(picker.model.items[0] === item && inputFocus.admittedTarget === picker.field.focusTarget); }
		assert.equal(f.builds.submissions.length, 0); assert.equal(f.builds.cancellations.length, 0);
	});

test('a published-open recovery retry cannot navigate after return-focus callbacks selected newer UI', async t => {
	const f = fixture(t), picker = f.editor.quickInput, requests: string[] = [];
	f.editor.openPublishedBuild = id => { requests.push(id); return { status: 'blocked', url: 'https://build.invalid/published' }; };
	await openDetails(f, PUBLISHED); f.key('Enter'); await setImmediate();
	assert.equal(picker.visible, true); assert.equal(requests.length, 1);
	const unbind = f.first.commandTarget.onDidFocus(() => {
		unbind(); f.second.focus();
	}); t.after(unbind);
	f.key('Enter'); await setImmediate();
	assert.deepEqual(requests, [JOB.request.requestId]);
	assert.equal(picker.visible, false); assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
});

test('a published-open retry callback cannot publish its blocked feedback over a newer workspace UI', async t => {
	const f = fixture(t), picker = f.editor.quickInput, requests: string[] = [];
	const replacement = { label: 'New workspace choice', description: '', detail: '' };
	f.editor.openPublishedBuild = id => {
		requests.push(id);
		if (requests.length === 2) {
			f.editor.builds = new DeferredBuilds(); f.second.focus();
			picker.pick('New owner', '', () => new TextQuickPickProvider([replacement]), () => {});
		}
		return { status: 'blocked', url: 'https://build.invalid/published' };
	};
	await openDetails(f, PUBLISHED); f.key('Enter'); await setImmediate();
	showEditorMessage('A newer retained observation', 'info', 30); const feedback = { ...editorFeedbackState.message };
	f.key('Enter'); await setImmediate();
	assert.deepEqual(requests, [JOB.request.requestId, JOB.request.requestId]);
	assert.ok(picker.model.items[0] === replacement && inputFocus.admittedTarget === picker.field.focusTarget);
	assert.deepEqual(editorFeedbackState.message, feedback);
});

test('an obsolete provider retirement cannot close a fresh binding of the same reusable provider admitted by output cleanup', async t => {
	const f = fixture(t), editor = f.editor, retiredOutput = editor.buildOutputs!.get(JOB);
	let rebound = 0;
	t.after(retiredOutput.onDidChange(() => {
		if (!retiredOutput.isDisposed || rebound !== 0) return;
		rebound++; editor.builds = f.builds; chooseBuild(editor);
	}));
	editor.builds = new DeferredBuilds();
	const freshVisible = editor.quickInput.visible;
	assert.equal(rebound, 1); assert.ok(editor.builds === f.builds);
	f.builds.targetReads[0].resolve([JOB.request.target]); await setImmediate();
	assert.equal(freshVisible, true); assert.equal(editor.quickInput.visible, true); assert.equal(editor.quickInput.busy, false);
	assert.ok(inputFocus.admittedTarget === editor.quickInput.field.focusTarget);
	assert.equal(f.builds.submissions.length, 0);
});

for (const outcome of ['receipt', 'error'] as const)
	test(`cancellation accepted before its producer replaces the workspace cannot admit or revive obsolete follow-up UI after ${outcome}`, async t => {
		const f = fixture(t), picker = f.editor.quickInput; await openDetails(f);
		const replacement = { label: 'New workspace choice', description: '', detail: '' };
		const cancel = f.builds.cancel.bind(f.builds);
		t.mock.method(f.builds, 'cancel', id => {
			const operation = cancel(id);
			f.editor.builds = new DeferredBuilds(); f.second.focus();
			picker.pick('New owner', '', () => new TextQuickPickProvider([replacement]), () => {});
			return operation;
		});
		f.key('End', KeyModifier.ctrl); f.key('Enter');
		assert.equal(f.builds.cancellations.length, 1); assert.equal(f.builds.cancellations[0].id, JOB.request.requestId);
		assert.ok(picker.model.items[0] === replacement); assert.equal(picker.busy, false);
		showEditorMessage('A newer retained observation', 'info', 30);
		const feedback = { ...editorFeedbackState.message }, focused = inputFocus.admittedTarget;
		if (outcome === 'receipt') f.builds.cancellations[0].response.resolve(CANCELLED);
		else f.builds.cancellations[0].response.reject(new Error('Acknowledgement from the retired workspace'));
		await setImmediate();
		assert.ok(picker.model.items[0] === replacement && inputFocus.admittedTarget === focused);
		assert.deepEqual(editorFeedbackState.message, feedback);
		if (outcome === 'receipt') assert.ok(f.builds.jobs[0] === CANCELLED);
		assert.equal(f.builds.cancellations.length, 1); assert.equal(f.builds.submissions.length, 0);
	});

for (const handoff of ['initial receipt', 'refreshed receipt', 'cancellation receipt'] as const)
	test(`View Log retains the original receiving group through ${handoff} despite a later part activation`, async t => {
		const f = fixture(t); await openDetails(f);
		const job = handoff === 'cancellation receipt' ? CANCELLED : JOB;
		if (handoff === 'refreshed receipt') {
			f.key('Enter'); f.builds.gets[1].response.resolve(job); await setImmediate();
		} else if (handoff === 'cancellation receipt') {
			f.key('End', KeyModifier.ctrl); f.key('Enter');
			f.builds.cancellations[0].response.resolve(job); await setImmediate();
		}
		const result = f.editor.buildOutputs!.get(job), otherTabs = [...f.secondGroup.model.tabs];
		const documents = [...f.editor.editorParts.documents];
		let activated = false, retainedFocus = false;
		const unbind = f.first.commandTarget.onDidFocus(() => {
			unbind(); f.editor.editorParts.activate(f.secondPart);
			activated = f.editor.editorParts.activePart === f.secondPart;
			retainedFocus = inputFocus.admittedTarget === f.first.commandTarget;
		}); t.after(unbind);
		// View Log is the receipt provider's third action. Exercise its native
		// selection/acceptance, not a presentation-label lookup.
		f.key('Home', KeyModifier.ctrl); f.key('ArrowDown'); f.key('ArrowDown'); f.key('Enter'); await setImmediate();
		assert.equal(activated, true); assert.equal(retainedFocus, true);
		const input = f.firstGroup.model.activeTab;
		assert.ok(input instanceof BuildLogInput); assert.ok(input.view.result === result);
		assert.deepEqual(f.secondGroup.model.tabs, otherTabs); assert.deepEqual(f.editor.editorParts.documents, documents);
		assert.equal(f.editor.quickInput.visible, false); assert.ok(inputFocus.admittedTarget === f.firstGroup.panes.activePane?.commandTarget);
		assert.equal(f.builds.gets.at(-1)!.id, JOB.request.requestId);
		f.builds.gets.at(-1)!.response.resolve(job); await setImmediate();
		assert.deepEqual(f.builds.logs, [JOB.request.requestId]); assert.equal(f.builds.submissions.length, 0);
	});

test('an explicitly captured receiving group can retire during inspection without borrowing the current native origin', async t => {
	const f = fixture(t), picker = f.editor.quickInput; f.builds.jobs.push(JOB); f.second.focus();
	showBuildJobs(f.editor, f.firstGroup); f.key('Enter');
	assert.equal(picker.busy, true); assert.ok(picker.invocationOrigin === f.second.commandTarget);
	assert.equal(await f.editor.editorParts.close(f.firstPart), true); assert.equal(f.firstPart.retired, true);
	const tabs = [...f.secondGroup.model.tabs], documents = [...f.editor.editorParts.documents];
	f.builds.gets[0].response.resolve(JOB); await setImmediate();
	assert.equal(picker.visible, true); assert.equal(picker.busy, false);
	f.key('Home', KeyModifier.ctrl); f.key('ArrowDown'); f.key('ArrowDown'); f.key('Enter'); await setImmediate();
	assert.equal(picker.visible, false); assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	assert.deepEqual(f.secondGroup.model.tabs, tabs); assert.deepEqual(f.editor.editorParts.documents, documents);
	assert.equal(f.builds.gets.length, 1); assert.deepEqual(f.builds.logs, []);
	assert.equal(f.builds.submissions.length, 0); assert.equal(f.builds.cancellations.length, 0);
});

test('View Log does not refresh an observation retired by the receiving pane departure', async t => {
	const f = fixture(t); await openDetails(f);
	const result = f.editor.buildOutputs!.get(JOB), next = new DeferredBuilds(), gets = f.builds.gets.length;
	let replacements = 0;
	const unbind = f.first.inputScope.onDidRetireContext(() => {
		unbind(); replacements++; f.editor.builds = next;
	}); t.after(unbind);
	showEditorMessage('A retained observation from the current workflow', 'info', 30);
	const feedback = { ...editorFeedbackState.message };
	f.key('Home', KeyModifier.ctrl); f.key('ArrowDown'); f.key('ArrowDown');
	assert.doesNotThrow(() => f.key('Enter')); await setImmediate();
	assert.equal(replacements, 1); assert.ok(f.editor.builds === next); assert.equal(result.isDisposed, true);
	assert.equal(f.builds.gets.length, gets); assert.deepEqual(f.builds.logs, []);
	assert.equal(f.editor.quickInput.visible, false); assert.deepEqual(editorFeedbackState.message, feedback);
	// Retirement may leave a captured, unavailable reader. It must never turn
	// that retained observation back into a live read capability.
	for (const input of f.firstGroup.model.tabs) if (input instanceof BuildLogInput) assert.ok(input.view.result === result);
	assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source);
});

for (const command of ['choose output', 'receipt Main output'] as const)
	test(`${command} retains its captured observation without refreshing after selection blur retires its source`, async t => {
		const f = fixture(t);
		if (command === 'choose output') { f.builds.jobs.push(JOB); chooseBuildOutput(f.editor); }
		else {
			await openDetails(f);
			// The fourth action hands the captured receipt to Main Output.
			f.key('Home', KeyModifier.ctrl); f.key('ArrowDown'); f.key('ArrowDown'); f.key('ArrowDown');
		}
		const result = f.editor.buildOutputs!.get(JOB), next = new DeferredBuilds(), gets = f.builds.gets.length;
		let replacements = 0;
		const unbind = f.first.commandTarget.onDidBlur(() => {
			unbind(); replacements++; f.editor.builds = next;
		}); t.after(unbind);
		showEditorMessage('A retained observation from the current workflow', 'info', 30);
		const feedback = { ...editorFeedbackState.message };
		assert.doesNotThrow(() => f.key('Enter')); await setImmediate();
		assert.equal(replacements, 1); assert.ok(f.editor.builds === next); assert.equal(result.isDisposed, true);
		assert.ok(f.editor.buildOutput.selectedResult === result);
		assert.equal(f.builds.gets.length, gets); assert.deepEqual(f.builds.logs, []);
		assert.equal(f.editor.quickInput.visible, false); assert.deepEqual(editorFeedbackState.message, feedback);
		assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source);
	});
