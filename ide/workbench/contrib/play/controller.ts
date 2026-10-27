import type { CartEditor } from '../../../cart_editor';
import { WORKBENCH_TEXT_EDITOR_ID } from '../code_editor/editor_input';
import type { EditorPlayCommandId } from '../../../common/commands';
import type { ScenarioTestModule } from '../../../testing/scenario/test_collection';
import { showEditorMessage } from '../../../common/feedback_state';
import type { PlayEvent, PlayService, PlayHandle } from '../../services/play/service';
import { ActorLabController } from '../actor_lab/controller';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ScenarioRunService } from '../../services/testing/scenario_runs';
import { openHostError } from '../host_error/editor_input';
import { openCompiledDebugSources } from '../debugger/compiled_sources';
import { PlayEditorInput } from './editor_input';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { inputFocus } from '../../../input/focus';

/** Contribution commands select a captured session; no retargeting of authoring state. */
export class PlayController {
	private readonly unbind: () => void;
	private actors: { readonly handle: PlayHandle; readonly controller: ActorLabController } | undefined;
	private currentInput: PlayEditorInput | undefined;
	public get input(): PlayEditorInput | undefined { return this.currentInput; }
	public constructor(private readonly editor: CartEditor, public readonly service: PlayService,
		private readonly runs: ScenarioRunService, private readonly sources: RuntimeSourceState) {
		this.unbind = service.onDidChange(event => this.didChange(event));
	}
	public dispose(): void {
		this.unbind(); this.actors?.controller.dispose(); this.actors = undefined;
		const input = this.currentInput;
		if (input !== undefined) {
			const group = this.editor.editorParts.findGroup(input);
			if (group !== undefined) group.removeEditor(input); else input.dispose();
		}
	}
	public start(module: ScenarioTestModule, group: EditorGroupView, companionContextId: string | null = null): void {
		const handle = this.service.start(module, companionContextId);
		let input = this.currentInput;
		if (input === undefined) {
			input = this.currentInput = new PlayEditorInput(handle, this.service);
			input.onWillDispose(() => { this.currentInput = undefined; });
		} else input.replaceHandle(handle);
		this.editor.editorParts.revealEditor(input, group);
	}

	public startWithCompanion(module: ScenarioTestModule, group: EditorGroupView, picker: QuickInputController): void {
		const catalog = this.sources.catalog;
		const choices: Array<{ label: string; description: string; detail: string; contextId: string | null }> = [
			{ label: 'No companion cartridge', description: 'Primary project only', detail: '', contextId: null },
		];
		for (const context of catalog.contexts.values()) {
			if (context.programDomain !== 'cart') continue;
			choices.push({ label: context.projectRootPath, description: context.id === module.resource.contextId ? 'Primary project' : '',
				detail: 'Use this project as the companion cartridge', contextId: context.id });
		}
		picker.pick('PLAY FIXTURE', `Primary: ${module.resource.path}; choose a companion project`, (_origin, lifetime) => {
			lifetime.add({ dispose: catalog.onDidChange(() => picker.hide()) });
			return new TextQuickPickProvider(choices);
		}, choice => this.start(module, group, choice.contextId));
	}

	public isCommandEnabled(command: EditorPlayCommandId, input: PlayEditorInput | undefined): boolean {
		if (input === undefined) return false;
		if (command === 'play.reveal' || command === 'play.source' || command === 'play.details' || command === 'play.more') return true;
		const handle = input.handle;
		if (handle !== this.service.current) return false;
		const session = handle.session;
		switch (command) {
			case 'play.reset': this.runs.refreshSources(); return !this.runs.active && this.currentModule(handle) !== undefined;
			case 'play.stop': return handle.state === 'preparing' || handle.state === 'initializing' || handle.state === 'setup' || handle.state === 'ready';
			case 'play.actors': case 'play.breakpoints': return session?.ready === true;
			case 'play.continue': return session?.ready === true && session.debuggerExecution.canResume('continue');
			case 'play.stepInto': return session?.ready === true && session.debuggerExecution.canResume('into');
			case 'play.stepOver': return session?.ready === true && session.debuggerExecution.canResume('over');
			case 'play.stepOut': return session?.ready === true && session.debuggerExecution.canResume('out');
		}
	}
	public execute(command: Exclude<EditorPlayCommandId, 'play.details' | 'play.more'>, input: PlayEditorInput,
		group: EditorGroupView, picker: QuickInputController): void {
		const handle = input.handle;
		switch (command) {
			case 'play.reveal': this.editor.editorParts.revealEditor(input, group); return;
			case 'play.actors': {
				if (this.actors === undefined) {
					const session = handle.session!;
					this.actors = { handle, controller: new ActorLabController(session, session.guest, session.target.runtime.machine.cpu,
						this.editor.editorParts, this.editor.navigation, session.actorExecution, session.rewind,
						this.sources, { kind: 'offscreen', presenter: session.target.presenter, recipient: session.input.physical,
							frames: session.frames, transport: session.transport }, `actor-lab:${handle.id}`, 'PLAY ACTORS') };
				}
				this.actors.controller.open(this.editor.editorParts.findGroup(input)!); return;
			}
			case 'play.stop': input.interaction.running = false; this.service.stop(handle); return;
			case 'play.reset': {
				this.runs.refreshSources();
				input.replaceHandle(this.service.reset(handle, this.currentModule(handle)!));
				this.editor.editorParts.revealEditor(input, group); return;
			}
			case 'play.source': {
				const resource = { contextId: handle.module.contextId, path: handle.module.path };
				const destination = this.editor.editorParts.editorDestination(this.editor.editorParts.findGroup(input)!,
					{ resource, editorId: WORKBENCH_TEXT_EDITOR_ID });
				void this.editor.navigation.focusChunkSource(destination, resource); return;
			}
			case 'play.breakpoints':
				openCompiledDebugSources(picker, handle.session!.debugSources,
					listener => this.service.onDidChange(event => { if (event.handle === handle && handle.session?.ready !== true) listener(); }),
					text => showEditorMessage(text, 'info', 2.5));
				return;
			case 'play.continue': case 'play.stepInto': case 'play.stepOver': case 'play.stepOut':
				handle.session!.debuggerExecution.resume(command === 'play.continue' ? 'continue' : command === 'play.stepInto' ? 'into'
					: command === 'play.stepOver' ? 'over' : 'out', 'workbench'); return;
		}
	}
	private currentModule(handle: PlayHandle): ScenarioTestModule | undefined {
		return this.runs.collection.roots.find(root => root.contextId === handle.module.contextId)?.children
			.find(module => module.resource.path === handle.module.path && module.suite?.kind === 'integration');
	}
	private didChange(event: PlayEvent): void {
		if (this.actors?.handle === event.handle && event.handle.session?.ready !== true) {
			this.actors.controller.dispose(); this.actors = undefined;
		}
		const error = event.handle.failure ?? (event.handle.session?.failure?.kind === 'host' ? event.handle.session.failure : undefined);
		if (event.state === 'failed' || event.state === 'faulted') {
			const input = this.currentInput;
			if (error === undefined || input?.handle !== event.handle) return;
			const group = this.editor.editorParts.findGroup(input), focused = inputFocus.target;
			const pane = group?.panes.activePane;
			if (group !== undefined && pane?.input === input && focused !== null && pane.inputScope!.contains(focused.scope))
				openHostError(group, error.error instanceof Error ? error.error.stack ?? error.error.toString() : String(error.error));
		}
	}
}
