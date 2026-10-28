import { CallHierarchyDirection, type CallHierarchyModel } from '../../../editor/contrib/call_hierarchy/model';
import { ReadonlyEditorInput } from '../../common/editor_input';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchMenu } from '../../ui/menu/model';
import type { WorkbenchMenuDefinition } from '../../ui/menu/model';
import { CallHierarchyTree } from './tree';

const TITLE_ACTIONS: WorkbenchMenuDefinition<CallHierarchyInput> = [
	{ type: 'command', command: 'callHierarchy.incoming' },
	{ type: 'command', command: 'callHierarchy.outgoing' },
	{ type: 'command', command: 'editor.source', icon: 'source' },
];
const CONTEXT_ACTIONS: WorkbenchMenuDefinition<CallHierarchyInput> = [
	{ type: 'command', command: 'editor.source' },
	{ type: 'command', command: 'editor.sourceToSide' },
	{ type: 'separator' },
	{ type: 'command', command: 'callHierarchy.incoming' },
	{ type: 'command', command: 'callHierarchy.outgoing' },
];
let nextInputId = 0;

/** A captured query is a result subject, not an editable source or a persisted symbol identifier. */
export class CallHierarchyInput extends ReadonlyEditorInput<`call-hierarchy:${number}`, 'call_hierarchy'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public override canMove(): boolean { return true; }
	public readonly contextActions = new WorkbenchMenu(CONTEXT_ACTIONS, this);
	public readonly actions = createWorkbenchActionBar(new WorkbenchMenu(TITLE_ACTIONS, this), true, this.contextActions);
	private readonly directions = new Map<CallHierarchyDirection, CallHierarchyTree>();
	private readonly changeListeners = new Set<() => void>();
	private revisionValue = 0;
	public get revision(): number { return this.revisionValue; }
	public onDidChange(listener: () => void): () => void { this.changeListeners.add(listener); return () => this.changeListeners.delete(listener); }
	private readonly changed = (): void => { this.revisionValue++; for (const listener of this.changeListeners) listener(); };
	public tree: CallHierarchyTree;
	public get direction(): CallHierarchyDirection { return this.tree.direction; }

	public constructor(public readonly model: CallHierarchyModel) {
		super(`call-hierarchy:${nextInputId++}`, 'call_hierarchy', model.rootExpression, true);
		this.setLabel(this.title, model.title);
		this.tree = new CallHierarchyTree(model, CallHierarchyDirection.CallsTo);
		this.directions.set(this.direction, this.tree);
		this.disposables.add({ dispose: this.tree.onDidChange(this.changed) });
		this.disposables.add({ dispose: () => this.changeListeners.clear() });
	}

	public setDirection(direction: CallHierarchyDirection): void {
		if (this.direction === direction) return;
		this.tree.hoverIndex = -1;
		let tree = this.directions.get(direction);
		if (tree === undefined) {
			tree = new CallHierarchyTree(this.model, direction); this.directions.set(direction, tree);
			this.disposables.add({ dispose: tree.onDidChange(this.changed) });
		}
		this.tree = tree;
		tree.hoverIndex = -1;
		this.changed();
	}
}
