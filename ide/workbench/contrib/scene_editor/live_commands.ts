import { showEditorMessage } from '../../../common/feedback_state';
import type { FocusCommand, InputFocusTarget } from '../../../input/focus';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { ActorLabController } from '../actor_lab/controller';
import type { SceneAuthoringContext } from './authoring_context';
import type { SceneLiveMember, SceneLiveService } from './live';

const UNAVAILABLE = {
	'source-changed': 'Run the current source before inspecting its objects in the game.',
	'not-observed': 'This declaration has not been observed in the running program. Run the cart from startup to link its objects.',
	'not-live': 'This Scene or member is not live. Play the game until it creates the instance.',
};

/** The selected authored occurrence opens an actual instance in the existing
 * runtime editor. No independent boot, test setup or controller reconstruction. */
export class SceneLiveCommands {
	private readonly command: FocusCommand;
	private attached: InputFocusTarget | undefined;
	public constructor(private readonly target: InputFocusTarget, authoring: SceneAuthoringContext, live: SceneLiveService,
		actors: ActorLabController, destination: () => EditorGroupView, quickInput: QuickInputController, isCurrent: () => boolean) {
		const enabled = () => isCurrent() && authoring.subject?.resolution === 'complete' && actors.canInteract();
		const capture = () => {
			const generation = target.scope.contextGeneration, version = authoring.workingCopy.version, selection = authoring.selectionRevision;
			const current = () => enabled() && target.scope.contextGeneration === generation && authoring.workingCopy.version === version
				&& authoring.selectionRevision === selection;
			return { editScope: target.scope, isEnabled: current, run: () => {
				if (!current()) return;
				actors.viewport.transport.pause();
				const result = live.select(authoring);
				if (result.status !== 'available') { showEditorMessage(UNAVAILABLE[result.status], 'info', 5); return; }
				const open = (member: SceneLiveMember) => {
					if (!current() || !live.isCurrent(member)) return;
					const input = actors.resolveInput();
					actors.inspectActor(input, member.domain, member.actorHashId);
					actors.open(destination());
				};
				if (result.members.length === 1) { open(result.members[0]); return; }
				quickInput.pick('Inspect in Game', 'Choose a live instance', () => new TextQuickPickProvider(result.members), open, lifetime => {
					lifetime.add({ dispose: actors.guest.onDidInvalidate(() => quickInput.hide()) });
					lifetime.add({ dispose: authoring.workingCopy.onDidChangeContent(() => quickInput.hide()) });
					lifetime.add({ dispose: authoring.onDidChangeSelection(() => quickInput.hide()) });
				}, { commandTarget: target });
			} };
		};
		this.command = { contextual: true, capture, isEnabled: enabled, run: () => capture().run() };
		target.registerCommand('sceneEditor.inspectLive', this.command);
	}
	public attach(target: InputFocusTarget): void { this.attached = target; target.registerCommand('sceneEditor.inspectLive', this.command); }
	public dispose(): void {
		this.target.unregisterCommand('sceneEditor.inspectLive');
		if (this.attached?.getCommand('sceneEditor.inspectLive') === this.command) this.attached.unregisterCommand('sceneEditor.inspectLive');
		this.attached = undefined;
	}
}
