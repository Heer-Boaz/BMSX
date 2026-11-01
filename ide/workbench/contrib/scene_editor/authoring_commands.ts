import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { KeyModifier } from '../../../../hosts/common/input/text';
import type { EditorCommandId } from '../../../common/commands';
import type { QuickInputController } from '../../services/quick_input/controller';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { InputFocusTarget } from '../../../input/focus';
import type { SceneAuthoringContext } from './authoring_context';
import type { SceneReparentChoice, SceneReparentMode } from './spatial_projection';

type SceneReparentItem = QuickPickItem & {
	keepWorld: SceneReparentChoice | undefined;
	keepLocal: SceneReparentChoice | undefined;
};

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
		actions.push({ command: 'sceneEditor.reparentMember',
			isEnabled: context => context.canReparentSelectedMember('keep_world') || context.canReparentSelectedMember('keep_local'),
			run: context => this.reparent(context, 'keep_world') },
		{ command: 'sceneEditor.reparentMemberKeepLocal', isEnabled: context => context.canReparentSelectedMember('keep_local'),
			run: context => this.reparent(context, 'keep_local') });
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
	private reparent(context: SceneAuthoringContext, mode: SceneReparentMode): void {
		const world = mode === 'keep_world' ? context.captureReparent('keep_world') : undefined;
		const local = context.captureReparent('keep_local');
		if (world === undefined && local === undefined) return;
		const revision = this.revision;
		// A parent may admit local placement without an invertible world transform.
		// Each picker row retains the separately captured operation for each policy.
		const items = new Map<SceneReparentChoice['parent'], SceneReparentItem>();
		if (world !== undefined) for (const choice of world.choices)
			items.set(choice.parent, { label: choice.label, description: choice.description, detail: '', keepWorld: choice, keepLocal: undefined });
		if (local !== undefined) for (const choice of local.choices) {
			const item = items.get(choice.parent);
			if (item !== undefined) item.keepLocal = choice;
			else items.set(choice.parent, { label: choice.label, description: choice.description,
				detail: mode === 'keep_world' ? 'Alt+Enter: keep local; world placement unavailable' : '', keepWorld: undefined, keepLocal: choice });
		}
		this.quickInput.pick('Reparent', mode === 'keep_world' ? 'Choose parent; Enter: keep world; Alt+Enter: keep local' : 'Choose parent; retain local placement',
			() => new TextQuickPickProvider([...items.values()]), (item, modifiers) => {
				const keepLocal = mode === 'keep_local' || (modifiers & KeyModifier.alt) !== 0;
				const request = keepLocal ? local : world, choice = keepLocal ? item.keepLocal : item.keepWorld;
				if (this.context === context && this.revision === revision && request !== undefined && choice !== undefined && request.apply(choice)) this.didMove(context);
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
