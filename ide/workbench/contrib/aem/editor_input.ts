import type { Document, Node } from 'yaml';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { resourceIdentityKey } from '../../../common/resource';
import { createWorkbenchPropertyTree, type WorkbenchPropertyElement } from '../../ui/property_tree';
import type { StructuredCollection } from '../../../language/yaml/structured_edits';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { sourceTabDescription } from '../../ui/tab/titles';

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
	public readonly actionBar = createWorkbenchActionBar('aem.title');
	public version = -1;
	public document: Document | undefined;
	public source = '';
	public status = '';
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null, };
	public constructor(public readonly workingCopy: EditorTextModel) {
		super(`aem:${resourceIdentityKey(workingCopy.resource)}`, 'aem_editor', 'AUDIO EVENTS', true);
		this.setLabel(this.title, sourceTabDescription(workingCopy.resource));
	}
}
