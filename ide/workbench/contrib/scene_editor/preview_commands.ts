import type { FocusCommand, InputFocusTarget } from '../../../input/focus';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { SceneViewportViewState } from './viewport/view_state';
import type { ResourceIdentity } from '../../../common/resource';
import type { ScenePreviewService } from './preview';

/** Active-document canvas commands, with the same captured-context lifetime as
 * source editing. Panel chrome and hierarchy rows do not own these subjects. */
export class ScenePreviewCommands {
	private readonly commands: readonly (readonly ['scenePreview.toggle' | 'scenePreview.timeline' | 'scenePreview.initialization', FocusCommand])[];
	private attached: InputFocusTarget | undefined;
	public constructor(target: InputFocusTarget, view: SceneViewportViewState, previews: ScenePreviewService,
		quickInput: QuickInputController, isCurrent: () => boolean) {
		const actions = [
			{ id: 'scenePreview.initialization' as const, enabled: () => view.authoring.subject !== undefined,
				checked: undefined, run: () => {
					const preview = view.runtime!, subject = view.authoring.subject;
					const items: { label: string; description: string; detail: string; resource: ResourceIdentity | undefined }[] = [
						{ label: 'Cart startup', description: 'Use an instance created by ordinary boot', detail: '', resource: undefined },
						...previews.initializations(view.authoring.workingCopy.identity.contextId).map(module => ({ label: module.label, description: module.resource.path,
							detail: 'Run setup; use its t.scene instance', resource: module.resource })),
					];
					quickInput.pick('Preview initialization', 'Cart startup or integration setup', () => new TextQuickPickProvider(items), item => {
						if (isCurrent() && view.authoring.subject === subject) preview.chooseInitialization(item.resource);
					}, undefined, { commandTarget: target });
				} },
			{ id: 'scenePreview.toggle' as const, enabled: () => view.authoring.subject !== undefined,
				checked: () => view.runtime!.enabled, run: () => {
					if (view.runtime!.enabled) view.runtime!.stop(); else { view.camera.setMode('2d'); void view.runtime!.start(); }
				} },
			{ id: 'scenePreview.timeline' as const, enabled: () => view.runtime!.state === 'ready' && view.runtime!.session!.timelines.length > 0,
				checked: undefined, run: () => {
					const preview = view.runtime!, session = preview.session!;
					const items = session.timelines.map(timeline => ({ label: timeline.label, description: `${timeline.duration} ms`, detail: '', timeline }));
					quickInput.pick('Preview timeline', 'Choose the initialized member timeline', () => new TextQuickPickProvider(items), item => {
						if (preview.session === session && isCurrent()) preview.selectTimeline(item.timeline);
					}, lifetime => lifetime.add({ dispose: preview.onDidChange(() => { if (preview.session !== session) quickInput.hide(); }) }),
					{ commandTarget: target });
				} },
		];
		this.commands = actions.map(action => {
			const capture = () => {
				const generation = target.scope.contextGeneration, subject = view.authoring.subject;
				const current = () => isCurrent() && target.scope.contextGeneration === generation && view.authoring.subject === subject;
				return { editScope: target.scope, isEnabled: () => current() && action.enabled(),
					run: () => { if (current() && action.enabled()) action.run(); } };
			};
			const command: FocusCommand = { contextual: true, capture, isEnabled: () => isCurrent() && action.enabled(),
				isChecked: action.checked, run: () => { const request = capture(); if (request.isEnabled()) request.run(); } };
			target.registerCommand(action.id, command);
			return [action.id, command] as const;
		});
	}
	public attach(target: InputFocusTarget): void {
		this.attached = target;
		for (const [id, command] of this.commands) target.registerCommand(id, command);
	}
	public dispose(): void {
		for (const [id, command] of this.commands) if (this.attached?.getCommand(id) === command) this.attached.unregisterCommand(id);
		this.attached = undefined;
	}
}
