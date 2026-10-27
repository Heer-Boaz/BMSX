import type { Document, Node } from 'yaml';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { resourceIdentityKey } from '../../../common/resource';
import { createWorkbenchPropertyTree, type WorkbenchPropertyElement } from '../../ui/property_tree';
import type { StructuredCollection } from '../../../language/yaml/structured_edits';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { computeResourceTabTitle, sourceTabDescription } from '../../ui/tab/titles';
import { captureWorkbenchTreeView, restoreWorkbenchTreeView } from '../../ui/tree_view';
import { projectAemSource } from './source';

export const WORKBENCH_AEM_EDITOR_ID = 'bmsx.aem';
export type AemProperty = WorkbenchPropertyElement & {
	readonly key: string;
	readonly path: readonly (string | number)[];
	readonly node: Node;
	readonly inlineEditable: boolean;
	readonly parent?: StructuredCollection;
	readonly index?: number;
};

export class AemEditorInput extends WorkingCopyEditorInput<`aem:${string}`, 'aem_editor'> {
	public readonly tree = createWorkbenchPropertyTree<AemProperty>();
	public readonly actionBar = createWorkbenchActionBar('aem.title', true);
	public version = -1;
	public document: Document | undefined;
	public source = '';
	public status = '';
	public applyStatus = '';
	public applying = false;
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null, };
	public constructor(public readonly workingCopy: EditorTextModel) {
		super(`aem:${resourceIdentityKey(workingCopy.resource)}`, 'aem_editor', computeResourceTabTitle(workingCopy.resource), true);
		this.setLabel(this.title, `Audio Events / ${sourceTabDescription(workingCopy.resource)}`, 'Audio Events');
	}
	public createView(): AemEditorInput {
		projectAemSource(this);
		const view = captureWorkbenchTreeView(this.tree, element => element.key), input = new AemEditorInput(this.workingCopy);
		projectAemSource(input);
		restoreWorkbenchTreeView(input.tree, view, element => element.key);
		return input;
	}
}
