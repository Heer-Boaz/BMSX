import { ReadonlyEditorInput } from '../../common/editor_input';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import type { EditorFont } from '../../../editor/ui/view/font';

/** Host diagnostics have no guest resource, working copy or persisted session. */
export class HostErrorInput extends ReadonlyEditorInput<'host-error', 'host_error'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public readonly lines: string[] = [];
	public projectedStack: string | undefined;
	public projectedFont: EditorFont | null = null;
	public projectedWidth = -1;
	public constructor(public stack: string) { super('host-error', 'host_error', 'HOST ERROR', true); }
}

export function openHostError(group: EditorGroupView, stack: string): void {
	const input = group.model.findById('host-error') ?? new HostErrorInput(stack);
	input.stack = stack;
	group.openEditor(input);
}
