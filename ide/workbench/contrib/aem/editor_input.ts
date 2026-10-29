import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import type { Document, Node } from 'yaml';
import { WorkingCopyEditorInput, type AbstractEditorInput } from '../../common/editor_input';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { resourceIdentityKey } from '../../../common/resource';
import { createWorkbenchPropertyTree, type WorkbenchPropertyElement } from '../../ui/property_tree';
import type { StructuredCollection } from '../../../language/yaml/structured_edits';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { computeResourceTabTitle, sourceTabDescription, sourceTabDirectory } from '../../ui/tab/titles';
import { captureWorkbenchTreeView, restoreWorkbenchTreeView } from '../../ui/tree_view';
import { projectAemSource } from './source';
import { AemSourceSelectionState, type AemSourceIdentity } from './source_selection';

export const WORKBENCH_AEM_EDITOR_ID = 'bmsx.aem';
export type AemProperty = WorkbenchPropertyElement & {
	readonly key: string;
	readonly path: readonly (string | number)[];
	readonly node: Node;
	readonly sourceIdentity: AemSourceIdentity;
	readonly event: AemSourceIdentity | undefined;
	readonly eventName?: string;
	readonly inlineEditable: boolean;
	readonly parent?: StructuredCollection;
	readonly index?: number;
};

export class AemEditorInput extends WorkingCopyEditorInput<`aem:${string}`, 'aem_editor'> {
	public readonly tree = createWorkbenchPropertyTree<AemProperty>();
	public readonly editSource = Symbol('AEM source editing');
	public readonly sourceSelection: AemSourceSelectionState;
	public readonly actionBar = createWorkbenchActionBar('aem.title', true, WORKBENCH_MENUS['editor.source.actions']);
	public version = -1;
	public document: Document | undefined;
	public source = '';
	public status = '';
	public applyStatus = '';
	public applying = false;
	public override canMove(destination?: AbstractEditorInput<string, string>): boolean { return destination === undefined || !this.applying; }
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null, };
	public constructor(public readonly workingCopy: EditorTextModel) {
		super(`aem:${resourceIdentityKey(workingCopy.resource)}`, 'aem_editor', computeResourceTabTitle(workingCopy.resource), true);
		this.sourceSelection = this.disposables.add(new AemSourceSelectionState(workingCopy, this.editSource));
		this.setLabel(this.title, `Audio Events / ${sourceTabDescription(workingCopy.resource)}`, 'Audio Events', sourceTabDirectory(workingCopy.resource));
	}
	public createView(): AemEditorInput {
		projectAemSource(this);
		const view = captureWorkbenchTreeView(this.tree, element => element.key), input = new AemEditorInput(this.workingCopy);
		projectAemSource(input);
		restoreWorkbenchTreeView(input.tree, view, element => element.key);
		input.sourceSelection.restore(input.tree.rows[input.tree.selectionIndex]?.element.sourceIdentity);
		return input;
	}
	public override dispose(): void { this.sourceSelection.retire(); super.dispose(); }
}
