import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import type { EditorCommandId } from '../../../common/commands';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { InputFocusTarget } from '../../../input/focus';
import type { SceneAuthoringContext } from './authoring_context';

type SceneAction = {
	readonly command: EditorCommandId;
	isEnabled(context: SceneAuthoringContext): boolean;
	run(context: SceneAuthoringContext): void;
};

/** Semantic Scene commands bind one context independently of the document or Main presentations. */
export class SceneAuthoringCommands {
	private context: SceneAuthoringContext | undefined;
	private revision = 0;
	public constructor(private readonly target: InputFocusTarget, private readonly quickInput: QuickInputController,
		private readonly didMove: (context: SceneAuthoringContext) => void) {
		const actions: SceneAction[] = [
			{ command: 'sceneEditor.removeMember', isEnabled: context => context.canRemoveSelectedMember(),
				run: context => { context.removeSelectedMember(); } },
			{ command: 'sceneEditor.removeSubtree', isEnabled: context => context.canRemoveSelectedSubtree(),
				run: context => { context.removeSelectedSubtree(); } },
			{ command: 'sceneEditor.renameMember', isEnabled: context => context.canRenameSelectedMember(),
				run: context => this.rename(context) },
		];
		for (const [command, direction] of [['sceneEditor.moveMemberUp', -1], ['sceneEditor.moveMemberDown', 1]] as const)
			actions.push({ command, isEnabled: context => context.canMoveSelectedMember(direction),
				run: context => { if (context.moveSelectedMember(direction)) didMove(context); } });
		for (const [command, mode] of [['sceneEditor.reparentMember', 'keep_world'], ['sceneEditor.reparentMemberKeepLocal', 'keep_local']] as const)
			actions.push({ command, isEnabled: context => context.canReparentSelectedMember(mode),
				run: context => this.reparent(context, mode) });
		for (const action of actions) target.registerCommand(action.command, {
			contextual: true,
			isEnabled: () => this.context !== undefined && action.isEnabled(this.context),
			run: () => action.run(this.context!),
			capture: () => {
				const context = this.context;
				if (context === undefined) return;
				const revision = this.revision, generation = target.scope.contextGeneration, selection = context.selectionRevision;
				const current = () => this.context === context && this.revision === revision
					&& target.scope.contextGeneration === generation && context.selectionRevision === selection;
				return { editScope: target.scope, isEnabled: () => {
					const enabled = current() && action.isEnabled(context);
					return current() && enabled;
				}, run: () => { if (current()) action.run(context); } };
			},
		});
		for (const direction of ['undo', 'redo'] as const) target.registerCommand(direction, {
			contextual: true,
			isEnabled: () => this.context !== undefined && !this.context.workingCopy.readOnly
				&& (direction === 'undo' ? this.context.workingCopy.canUndo : this.context.workingCopy.canRedo),
			run: () => { executeTextHistoryCommand(this.context!.workingCopy, direction); },
			capture: () => {
				const context = this.context;
				if (context === undefined) return;
				const revision = this.revision, generation = target.scope.contextGeneration;
				const current = () => this.context === context && this.revision === revision && target.scope.contextGeneration === generation;
				return { isEnabled: () => current() && !context.workingCopy.readOnly
					&& (direction === 'undo' ? context.workingCopy.canUndo : context.workingCopy.canRedo),
					run: () => { if (current()) executeTextHistoryCommand(context.workingCopy, direction); } };
			},
		});
	}
	private reparent(context: SceneAuthoringContext, mode: 'keep_world' | 'keep_local'): void {
		const request = context.captureReparent(mode);
		if (request === undefined) return;
		const revision = this.revision;
		const items = request.choices.map(choice => ({ choice, label: choice.label, description: choice.description, detail: '' }));
		this.quickInput.pick('Reparent', mode === 'keep_world' ? 'Choose parent; preserve world placement' : 'Choose parent; retain local placement',
			() => new TextQuickPickProvider(items), item => {
				if (this.context === context && this.revision === revision && request.apply(item.choice)) this.didMove(context);
			}, lifetime => {
				lifetime.add({ dispose: context.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
				lifetime.add({ dispose: context.onDidChangeSelection(() => this.quickInput.hide()) });
				lifetime.add({ dispose: context.onDidChangeSpatialGeneration(() => this.quickInput.hide()) });
			}, { commandTarget: this.target });
	}
	private rename(context: SceneAuthoringContext): void {
		const request = context.captureRename();
		if (request === undefined) return;
		const revision = this.revision;
		this.quickInput.input('Rename Member', 'Scene-local member identity', request.initialName, async name => {
			const error = request.validate(name);
			if (error !== undefined) throw new Error(error);
			return name;
		}, name => {
			if (this.context === context && this.revision === revision && request.apply(name)) this.didMove(context);
		}, lifetime => {
			lifetime.add({ dispose: context.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
			lifetime.add({ dispose: context.onDidChangeSelection(() => this.quickInput.hide()) });
			lifetime.add({ dispose: context.onDidChangeSpatialGeneration(() => this.quickInput.hide()) });
		}, { commandTarget: this.target });
	}
	public bind(context: SceneAuthoringContext): void { this.context = context; this.revision++; }
	public clear(): void { this.context = undefined; this.revision++; }
	public dispose(): void {
		this.clear();
		for (const command of ['sceneEditor.removeMember', 'sceneEditor.removeSubtree', 'sceneEditor.renameMember', 'sceneEditor.reparentMember',
			'sceneEditor.reparentMemberKeepLocal', 'sceneEditor.moveMemberUp', 'sceneEditor.moveMemberDown', 'undo', 'redo'] as const)
			this.target.unregisterCommand(command);
	}
}
