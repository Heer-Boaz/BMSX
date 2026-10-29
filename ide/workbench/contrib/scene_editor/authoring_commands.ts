import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import type { InputFocusTarget } from '../../../input/focus';
import type { SceneAuthoringContext } from './authoring_context';

/** Semantic Scene commands bind one context independently of the document or Main presentations. */
export class SceneAuthoringCommands {
	private context: SceneAuthoringContext | undefined;
	private revision = 0;
	public constructor(private readonly target: InputFocusTarget, didMove: (context: SceneAuthoringContext) => void) {
		target.registerCommand('sceneEditor.removeMember', {
			contextual: true,
			isEnabled: () => this.context?.canRemoveSelectedMember() === true,
			run: () => { this.context!.removeSelectedMember(); },
			capture: () => {
				const context = this.context;
				if (context === undefined) return;
				const revision = this.revision, generation = target.scope.contextGeneration, selection = context.selectionRevision;
				const current = () => this.context === context && this.revision === revision
					&& target.scope.contextGeneration === generation && context.selectionRevision === selection;
				return { editScope: target.scope, isEnabled: () => {
					const enabled = current() && context.canRemoveSelectedMember();
					return current() && enabled;
				},
					run: () => { if (current()) context.removeSelectedMember(); } };
			},
		});
		for (const [command, direction] of [['sceneEditor.moveMemberUp', -1], ['sceneEditor.moveMemberDown', 1]] as const) {
			target.registerCommand(command, {
				contextual: true,
				isEnabled: () => this.context?.canMoveSelectedMember(direction) === true,
				run: () => {
					const context = this.context!;
					if (context.moveSelectedMember(direction)) didMove(context);
				},
				capture: () => {
					const context = this.context;
					if (context === undefined) return;
					const revision = this.revision, generation = target.scope.contextGeneration, selection = context.selectionRevision;
					const current = () => this.context === context && this.revision === revision
						&& target.scope.contextGeneration === generation && context.selectionRevision === selection;
					return { editScope: target.scope, isEnabled: () => {
						const enabled = current() && context.canMoveSelectedMember(direction);
						return current() && enabled;
					},
						run: () => { if (current() && context.moveSelectedMember(direction)) didMove(context); } };
				},
			});
		}
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
	public bind(context: SceneAuthoringContext): void { this.context = context; this.revision++; }
	public clear(): void { this.context = undefined; this.revision++; }
	public dispose(): void {
		this.clear();
		for (const command of ['sceneEditor.removeMember', 'sceneEditor.moveMemberUp', 'sceneEditor.moveMemberDown', 'undo', 'redo'] as const)
			this.target.unregisterCommand(command);
	}
}
