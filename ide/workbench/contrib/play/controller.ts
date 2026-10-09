import type { CartEditor } from '../../../cart_editor';
import type { EditorPlayCommandId } from '../../../common/commands';
import type { ScenarioTestModule } from '../../../testing/scenario/test_collection';
import { showEditorMessage } from '../../../common/feedback_state';
import { COLOR_STATUS_TEXT } from '../../../common/constants';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import type { PlayEvent, PlayService } from '../../services/play/service';
import type { ScenarioRunService } from '../../services/testing/scenario_runs';
import { openHostError } from '../host_error/editor_input';
import { openCompiledDebugSources } from '../debugger/compiled_sources';
import { PlayEditorInput } from './editor_input';

/** Contribution commands select a captured session; no retargeting of authoring state. */
export class PlayController {
	private readonly unbind: () => void;
	public constructor(private readonly editor: CartEditor, public readonly service: PlayService,
		private readonly runs: ScenarioRunService) {
		this.unbind = service.onDidChange(event => this.didChange(event));
	}
	public dispose(): void { this.unbind(); }
	public start(module: ScenarioTestModule): void {
		const handle = this.service.start(module), input = editorTabGroup.findById('play-session');
		if (input !== undefined) { input.handle = handle; openEditorTab(this.editor.editorPanes, input); }
		else openEditorTab(this.editor.editorPanes, new PlayEditorInput(handle, this.service));
	}
	public isCommandEnabled(command: EditorPlayCommandId): boolean {
		const handle = this.service.current;
		if (handle === undefined) return false;
		const session = handle.session;
		switch (command) {
			case 'play.reveal': case 'play.source': return true;
			case 'play.reset': this.runs.refreshSources(); return !this.runs.active && this.currentModule() !== undefined;
			case 'play.stop': return handle.state === 'preparing' || handle.state === 'initializing' || handle.state === 'setup' || handle.state === 'ready';
			case 'play.breakpoints': return session?.ready === true;
			case 'play.continue': return session?.ready === true && session.debuggerExecution.canResume('continue');
			case 'play.stepInto': return session?.ready === true && session.debuggerExecution.canResume('into');
			case 'play.stepOver': return session?.ready === true && session.debuggerExecution.canResume('over');
			case 'play.stepOut': return session?.ready === true && session.debuggerExecution.canResume('out');
			case 'play.details': case 'play.more': return true;
		}
	}
	public execute(command: Exclude<EditorPlayCommandId, 'play.details' | 'play.more'>): void {
		const handle = this.service.current!;
		switch (command) {
			case 'play.reveal': openEditorTab(this.editor.editorPanes, editorTabGroup.findById('play-session')!); return;
			case 'play.stop': this.service.stop(handle); return;
			case 'play.reset': {
				this.runs.refreshSources();
				const next = this.service.reset(handle, this.currentModule()!), input = editorTabGroup.findById('play-session')!;
				input.handle = next; openEditorTab(this.editor.editorPanes, input); return;
			}
			case 'play.source': this.editor.navigation.focusChunkSourceForContext(handle.module.domain, handle.module.path); return;
			case 'play.breakpoints':
				openCompiledDebugSources(this.editor.quickInput, handle.session!.debugSources,
					listener => this.service.onDidChange(event => { if (event.handle === handle && handle.session?.ready !== true) listener(); }),
					text => showEditorMessage(text, COLOR_STATUS_TEXT, 2.5));
				return;
			case 'play.continue': case 'play.stepInto': case 'play.stepOver': case 'play.stepOut':
				handle.session!.debuggerExecution.resume(command === 'play.continue' ? 'continue' : command === 'play.stepInto' ? 'into'
					: command === 'play.stepOver' ? 'over' : 'out', 'workbench'); return;
		}
	}
	private currentModule(): ScenarioTestModule | undefined {
		const handle = this.service.current!;
		return this.runs.collection.roots.find(root => root.domain === handle.module.domain)?.children
			.find(module => module.resource.path === handle.module.path && module.suite?.kind === 'integration');
	}
	private didChange(event: PlayEvent): void {
		const error = event.handle.failure ?? (event.handle.session?.failure?.kind === 'host' ? event.handle.session.failure : undefined);
		if (event.state === 'failed' || event.state === 'faulted') {
			if (error !== undefined) openHostError(this.editor.editorPanes,
				error.error instanceof Error ? error.error.stack ?? error.error.toString() : String(error.error));
		}
	}
}
