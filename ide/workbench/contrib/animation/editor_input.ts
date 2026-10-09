import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { CompositeTextEditorInput } from '../../common/composite_text_editor_input';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { createWorkbenchPropertyTree } from '../../ui/property_tree';
import type { WorkbenchListState } from '../../ui/list_view';
import { computeResourceTabTitle, sourceTabDescription } from '../../ui/tab/titles';
import type { AnimationSourceDocument, AnimationTrackSource } from './model';
import type { AnimationProperty } from './details';
import { AnimationKeyViewport } from './key_viewport';

export type AnimationSourceSelection = { readonly path: string; readonly range: TrackedTextRange };
export type AnimationTrackRow = { readonly track: AnimationTrackSource | undefined; label: string; text: string };

let nextInputId = 0;

export class AnimationEditorInput extends CompositeTextEditorInput<`animation:${string}`, 'animation'> {
	public readonly definitionRange: TrackedTextRange | undefined;
	public readonly sourceModels = new Map<string, EditorTextModel>();
	public sourceRevision: symbol | undefined;
	public version = 0;
	public document: AnimationSourceDocument | undefined;
	public trackSelection: AnimationSourceSelection | undefined;
	public keySelection: AnimationSourceSelection | undefined;
	public trackIndex = -1;
	public keyIndex = -1;
	public readonly tracks: WorkbenchListState<AnimationTrackRow> = { rows: [], selectionIndex: 0, hoverIndex: -1, scroll: 0,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0 } };
	public readonly details = createWorkbenchPropertyTree<AnimationProperty>();
	public readonly keys = new AnimationKeyViewport();
	public readonly actionBar = createWorkbenchActionBar('animation.title');
	public status = '';
	private readonly projectionListeners = new Set<() => void>();
	public constructor(public readonly workingCopy: EditorTextModel, definitionRange?: TrackedTextRange,
		public readonly definitionLabel = computeResourceTabTitle(workingCopy.resource)) {
		super(`animation:${nextInputId++}`, 'animation', `ANIM ${definitionLabel}`, true);
		this.definitionRange = definitionRange === undefined ? undefined : { ...definitionRange };
		this.sourceModels.set(workingCopy.resource.path, workingCopy);
		this.publishModels();
		this.setLabel(this.title, sourceTabDescription(workingCopy.resource));
	}
	public publishModels(): void { this.setWorkingCopies(new Set(this.sourceModels.values())); }
	public invalidateProjection(): void { for (const listener of this.projectionListeners) listener(); }
	public onDidInvalidateProjection(listener: () => void): () => void { this.projectionListeners.add(listener); return () => this.projectionListeners.delete(listener); }
	public override dispose(): void { this.invalidateProjection(); this.projectionListeners.clear(); super.dispose(); }
}
