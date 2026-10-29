import type { StudioBuildJob, StudioBuildRequest } from '../../../hosts/common/studio_builds';
import type { WorkspaceBuilds } from '../../../ide/workbench/services/builds';
import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import type { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { inputFocus } from '../../../ide/input/focus';
import { check, type StudioFixture } from './studio_fixture';

const TARGETS = ['alpha_chooser_fixture', 'beta_chooser_fixture'] as const;

type ReceiptRead = { readonly id: string; readonly response: PromiseWithResolvers<StudioBuildJob | undefined> };
type Cancellation = { readonly id: string; readonly response: PromiseWithResolvers<StudioBuildJob> };
type Submission = { readonly request: StudioBuildRequest; readonly response: PromiseWithResolvers<StudioBuildJob> };

/** Controlled remote ingress. A late producer response remains possible after a UI read is withdrawn. */
class BuildChooserFixture implements WorkspaceBuilds {
	public readonly jobs: StudioBuildJob[] = [];
	public readonly pending: StudioBuildRequest[] = [];
	public readonly targetsPending: PromiseWithResolvers<readonly string[]>[] = [];
	public readonly reads: ReceiptRead[] = [];
	public readonly cancellations: Cancellation[] = [];
	public readonly submissions: Submission[] = [];

	public targets(): Promise<readonly string[]> {
		const response = Promise.withResolvers<readonly string[]>(); this.targetsPending.push(response); return response.promise;
	}
	public get(id: string): Promise<StudioBuildJob | undefined> {
		const response = Promise.withResolvers<StudioBuildJob | undefined>(); this.reads.push({ id, response });
		return response.promise.then(job => { if (job !== undefined) this.publish(job); return job; });
	}
	public submit(target: string, debug: boolean, optLevel: 0 | 1 | 2 | 3): Promise<StudioBuildJob> {
		const response = Promise.withResolvers<StudioBuildJob>();
		const request = { requestId: `build-chooser-ui-${this.submissions.length}`, target, debug, optLevel };
		this.submissions.push({ request, response }); this.pending.push(request);
		return response.promise.then(job => { this.pending.splice(this.pending.indexOf(request), 1); this.publish(job); return job; });
	}
	public cancel(id: string): Promise<StudioBuildJob> {
		const response = Promise.withResolvers<StudioBuildJob>(); this.cancellations.push({ id, response });
		return response.promise.then(job => { this.publish(job); return job; });
	}
	public forget(): void { throw new Error('Chooser UI must not forget an accepted request'); }
	public log(): Promise<string> { throw new Error('Chooser UI must not open an unrequested output reader'); }
	private publish(job: StudioBuildJob): void {
		const index = this.jobs.findIndex(current => current.request.requestId === job.request.requestId);
		if (index === -1) this.jobs.push(job); else this.jobs[index] = job;
	}
}

/** Service responses are fixture ingress; every chooser action uses ordinary Workbench input. */
export async function testStudioBuildChooser(test: StudioFixture, client: ScenePrimaryClient, source: CodeEditorInput): Promise<void> {
	const editor = test.ide.editor, picker = editor.quickInput, group = editor.editorParts.findGroup(source)!;
	check(editor.builds === undefined && editor.mainWorkspace.primary === client,
		'build chooser: the dedicated fixture starts without a server producer and retains its authored Main context');
	await test.clickTab(source.id, 1, group);
	const origin = inputFocus.admittedTarget!, selection = client.consumer.selection, recipient = editor.guestInputRecipient;
	const media = test.ide.sources.currentBlua32Media, cycles = test.cycles();
	const groups = editor.editorParts.groups.map(owner => ({ owner, input: owner.model.activeTab, tabs: [...owner.model.tabs] }));
	const models = [...editorTextModelService.models].map(model => ({ model, text: model.buffer.getText(), version: model.version,
		dirty: model.dirty, undo: model.canUndo, redo: model.canRedo }));
	const builds = new BuildChooserFixture(); editor.builds = builds;

	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.runPaletteCommand('Studio: Build Cartridge');
			const targets = builds.targetsPending[builds.targetsPending.length - 1];
			check(picker.visible && picker.busy && !picker.failed && picker.model.list.rows.length === 0
				&& inputFocus.admittedTarget === picker.field.focusTarget && picker.invocationOrigin === origin,
				'build chooser: target discovery owns its native loading presentation before the remote catalog arrives');
			await test.clipboard.writeText('beta'); await test.press('ControlLeft', 'KeyV');
			await test.press('Enter');
			check(builds.submissions.length === font * 2 + theme && picker.busy,
				'build chooser: pending query input cannot accept a target or create a build request');
			await test.capture?.(`build-chooser-${editor.fontVariant}-theme-${theme}-loading`);
			targets.resolve(TARGETS);
			await test.until(() => picker.visible && !picker.busy, 'build chooser: the current target catalog settles in its existing presentation');
			check(!picker.failed && picker.field.text === 'beta' && picker.model.list.rows.length === 1,
				'build chooser: catalog admission preserves and applies the query typed while loading');
			await test.press('Enter'); await test.press('Enter');
			const submission = builds.submissions[builds.submissions.length - 1];
			check(submission.request.target === TARGETS[1] && !picker.visible && inputFocus.admittedTarget === origin,
				'build chooser: the filtered choice submits its exact producer target without changing Source focus');
			const queued: StudioBuildJob = { request: submission.request, state: 'queued', phase: 'queued', acceptedAt: builds.submissions.length,
				updatedAt: 1, version: { generation: 1, sequence: builds.submissions.length * 2 } };
			submission.response.resolve(queued); await test.frame();
			check(builds.jobs.includes(queued) && builds.pending.length === 0,
				'build chooser: the accepted request owns its receipt independently of the dismissed recipe chooser');

			await test.runPaletteCommand('Studio: Build Jobs'); await test.press('Enter');
			const failure = builds.reads[builds.reads.length - 1], diagnostic = new Error('Controlled build receipt observation failed.\nThe admitted request remains available for explicit recheck.');
			check(failure.id === queued.request.requestId && picker.busy && inputFocus.admittedTarget === picker.field.focusTarget,
				'build chooser: inspecting the newest admitted request owns its pending native reader immediately');
			failure.response.reject(diagnostic);
			await test.until(() => picker.failed, 'build chooser: an active remote failure remains in the same owned observation');
			// The producer diagnostic is data, not fixed UI copy: its exact contents must survive the reader boundary.
			check(picker.visible && !picker.busy && picker.message === diagnostic.message && picker.model.list.rows.length === 0,
				'build chooser: failure is distinct from an empty successful catalog and preserves its exact supplied diagnostic');
			await test.capture?.(`build-chooser-${editor.fontVariant}-theme-${theme}-error`);
			await test.press('Escape');

			await test.runPaletteCommand('Studio: Build Jobs'); await test.press('Enter');
			const retired = builds.reads[builds.reads.length - 1];
			await test.press('Escape'); await test.press('ControlLeft', 'ShiftLeft', 'KeyP');
			const nextCatalog = picker.model.items, nextQuery = picker.field.text;
			retired.response.resolve(queued); await test.frame();
			check(picker.visible && !picker.busy && !picker.failed && picker.model.items === nextCatalog && picker.field.text === nextQuery
				&& inputFocus.admittedTarget === picker.field.focusTarget,
				'build chooser: a retired receipt cannot reopen details or replace a newer native command catalog');
			await test.press('Escape');

			await test.runPaletteCommand('Studio: Build Jobs'); await test.press('Enter');
			builds.reads[builds.reads.length - 1].response.resolve(queued);
			await test.until(() => picker.visible && !picker.busy, 'build chooser: explicit recheck presents the exact admitted request');
			await test.press('ControlLeft', 'End'); await test.press('Enter');
			const cancellation = builds.cancellations[builds.cancellations.length - 1];
			check(cancellation.id === queued.request.requestId && picker.visible && picker.busy,
				'build chooser: accepted cancellation starts once and owns a separate pending observation');
			await test.press('Escape'); await test.press('ControlLeft', 'ShiftLeft', 'KeyP');
			const replacement = picker.model.items, feedback = editorFeedbackState.message.text;
			const cancelled: StudioBuildJob = { ...queued, state: 'cancelled', phase: 'cancelled', updatedAt: 2,
				version: { generation: 1, sequence: queued.version.sequence + 1 } };
			cancellation.response.resolve(cancelled); await test.frame();
			check(builds.jobs.includes(cancelled) && builds.cancellations.length === builds.submissions.length
				&& picker.visible && picker.model.items === replacement && !picker.busy && !picker.failed
				&& inputFocus.admittedTarget === picker.field.focusTarget && editorFeedbackState.message.text === feedback,
				'build chooser: dismissed cancellation still completes exactly once without reopening or overwriting newer UI and feedback');
			await test.press('Escape');
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}

	await test.runPaletteCommand('Studio: Build Cartridge');
	const lateFailure = builds.targetsPending[builds.targetsPending.length - 1];
	await test.press('Escape'); await test.press('ControlLeft', 'ShiftLeft', 'KeyP');
	const replacement = picker.model.items, feedback = editorFeedbackState.message.text;
	lateFailure.reject(new Error('Retired target discovery failed')); await test.frame();
	check(picker.visible && picker.model.items === replacement && !picker.failed && !picker.busy
		&& inputFocus.admittedTarget === picker.field.focusTarget && editorFeedbackState.message.text === feedback,
		'build chooser: failure from withdrawn discovery cannot overwrite the newer catalog, feedback or native focus');
	await test.press('Escape');
	await test.runPaletteCommand('Studio: Build Cartridge');
	const retiredBinding = builds.targetsPending[builds.targetsPending.length - 1];
	editor.builds = undefined;
	check(!picker.visible, 'build chooser: retiring the controlled producer immediately withdraws its pending reader');
	retiredBinding.resolve(TARGETS); await test.frame();
	check(!picker.visible && editor.builds === undefined,
		'build chooser: late data cannot revive UI after the fixture producer binding is retired');
	await test.clickTab(source.id, 1, group);
	check(editor.mainWorkspace.primary === client && client.consumer.selection === selection && editor.guestInputRecipient === recipient
		&& editor.editorParts.groups.length === groups.length && groups.every(saved => saved.owner.model.activeTab === saved.input
			&& saved.owner.model.tabs.length === saved.tabs.length && saved.owner.model.tabs.every((input, index) => input === saved.tabs[index]))
		&& models.every(saved => saved.model.buffer.getText() === saved.text && saved.model.version === saved.version
			&& saved.model.dirty === saved.dirty && saved.model.canUndo === saved.undo && saved.model.canRedo === saved.redo)
		&& test.ide.sources.currentBlua32Media === media && test.cycles() === cycles,
		'build chooser: asynchronous chooser lifetimes preserve Main selection, exact document membership, canonical history and guest execution');
}
