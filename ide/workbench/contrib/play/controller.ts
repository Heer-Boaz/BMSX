import type { CartEditor } from '../../../cart_editor';
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
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { inputFocus } from '../../../input/focus';
import type { EditorSourceLocationRequest } from '../../../editor/navigation/source_location';
import { editorTextModelService } from '../../../editor/model/model_service';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';

export type PlaySessionCommand = Exclude<EditorPlayCommandId, 'play.reveal' | 'play.details' | 'play.more'>;
export type PlayCommandIntent = {
	readonly command: PlaySessionCommand;
	readonly input: PlayEditorInput;
	readonly handle: PlayHandle;
	readonly binding: number;
	readonly module?: ScenarioTestModule;
};

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
		if (this.service.current !== handle || handle.closing) return;
		let input = this.currentInput;
		if (input === undefined) {
			input = this.currentInput = new PlayEditorInput(handle, this.service);
			input.onWillDispose(() => { if (this.currentInput === input) this.currentInput = undefined; });
		} else {
			const binding = input.replaceHandle(handle);
			if (binding === undefined || this.currentInput !== input || this.service.current !== handle || !input.isBindingCurrent(handle, binding)) {
				if (this.currentInput?.handle !== handle) void this.service.close(handle);
				return;
			}
		}
		this.editor.editorParts.revealEditor(input, group);
	}

	public get canRevealCurrent(): boolean { return this.currentInput !== undefined; }
	public revealCurrent(group: EditorGroupView): void {
		if (this.currentInput !== undefined) this.editor.editorParts.revealEditor(this.currentInput, group);
	}

	public captureSourceLocation(input: PlayEditorInput): EditorSourceLocationRequest {
		const handle = input.handle, binding = input.bindingRevision;
		const isCurrent = () => input.isBindingCurrent(handle, binding);
		return { isCurrent, readLocation: () => {
			if (!isCurrent()) return;
			const resource = this.sources.catalog.resolveResource(handle.module);
			if (resource === undefined) return;
			const model = resolveLuaTextFileModel(editorTextModelService, this.sources.catalog, resource);
			return isCurrent() && this.sources.catalog.resolveResource(handle.module) === resource ? { model, modelVersion: model.version } : undefined;
		} };
	}

	public captureCommand(command: PlaySessionCommand, input: PlayEditorInput): PlayCommandIntent | undefined {
		const handle = input.handle, binding = input.bindingRevision;
		if (!input.isBindingCurrent(handle, binding)) return;
		const module = command === 'play.reset' ? this.currentModule(handle) : undefined;
		if (command === 'play.reset' && module === undefined) return;
		return { command, input, handle, binding, module };
	}

	public isCommandCurrent(intent: PlayCommandIntent): boolean {
		return intent.input.isBindingCurrent(intent.handle, intent.binding) && intent.handle === this.service.current
			&& (intent.module === undefined || this.runs.collection.getNode(intent.module.id) === intent.module);
	}

	public isCommandInvocationEnabled(intent: PlayCommandIntent): boolean {
		if (!this.isCommandCurrent(intent)) return false;
		if (intent.command === 'play.reset') this.runs.refreshSources();
		return this.isCommandCurrent(intent) && this.isCommandEnabled(intent.command, intent.input);
	}

	/** Presentation reads the retained fixture membership; only an accepted Reset refreshes source. */
	public isCommandEnabled(command: PlaySessionCommand, input: PlayEditorInput): boolean {
		const handle = input.handle;
		if (!input.isBindingCurrent(handle, input.bindingRevision) || handle !== this.service.current) return false;
		const session = handle.session;
		switch (command) {
			case 'play.reset': return !this.runs.active && this.currentModule(handle)?.suite?.kind === 'integration';
			case 'play.stop': return handle.state === 'preparing' || handle.state === 'initializing' || handle.state === 'setup' || handle.state === 'ready';
			case 'play.actors': case 'play.breakpoints': return session?.ready === true;
			case 'play.continue': return session?.ready === true && session.debuggerExecution.canResume('continue');
			case 'play.stepInto': return session?.ready === true && session.debuggerExecution.canResume('into');
			case 'play.stepOver': return session?.ready === true && session.debuggerExecution.canResume('over');
			case 'play.stepOut': return session?.ready === true && session.debuggerExecution.canResume('out');
		}
	}
	public executeCommand(intent: PlayCommandIntent, group: EditorGroupView, picker: QuickInputController, attachmentCurrent: () => boolean): void {
		if (!attachmentCurrent() || !this.isCommandCurrent(intent)) return;
		const { input, handle, command } = intent;
		switch (command) {
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
			case 'play.stop':
				input.interaction.running = false;
				if (attachmentCurrent() && this.isCommandCurrent(intent)) this.service.stop(handle);
				return;
			case 'play.reset': {
				const next = this.service.reset(handle, intent.module!);
				if (next === undefined) return;
				if (!attachmentCurrent() || this.currentInput !== input || !input.isBindingCurrent(handle, intent.binding)) {
					if (this.currentInput?.handle !== next) void this.service.close(next);
					return;
				}
				const binding = input.replaceHandle(next);
				if (binding === undefined || this.service.current !== next || !input.isBindingCurrent(next, binding)) {
					if (this.currentInput?.handle !== next) void this.service.close(next);
					return;
				}
				this.editor.editorParts.revealEditor(input, group); return;
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
		for (const root of this.runs.collection.roots) {
			if (root.contextId !== handle.module.contextId) continue;
			for (const module of root.children) if (module.resource.path === handle.module.path) return module;
		}
		return undefined;
	}
	private didChange(event: PlayEvent): void {
		const actors = this.actors;
		if (actors?.handle === event.handle && event.handle.session?.ready !== true) {
			this.actors = undefined; actors.controller.dispose();
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
