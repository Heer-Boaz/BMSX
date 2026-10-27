import { resourceIdentityKey } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { mapTrackedTextRange, type TrackedTextRange } from '../../../editor/text/text_change';
import { CompositeTextEditorInput } from '../../common/composite_text_editor_input';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { createWorkbenchPropertyTree } from '../../ui/property_tree';
import type { WorkbenchListState } from '../../ui/list_view';
import { computeResourceTabTitle, sourceTabDescription } from '../../ui/tab/titles';
import type { AnimationSourceDocument, AnimationTrackSource, AnimationClipSource, AnimationTableSource } from './model';
import type { AnimationProperty } from './details';
import { AnimationKeyViewport } from './key_viewport';
import { AnimationOverview } from './overview';
import { AnimationFramePreview } from './frame_preview';
import { WorkbenchSplitView } from '../../ui/split_view';
import type { AnimationEditorLayout } from './layout';
import { create_rect_bounds } from '../../../../machine/ts/common/rect';

export type AnimationSourceSelection = { readonly path: string; readonly range: TrackedTextRange };
export type AnimationTrackRow = { readonly track: AnimationTrackSource | undefined; readonly clip: AnimationClipSource | undefined; readonly frames: boolean; readonly preserveCase: boolean; label: string; text: string };
export type AnimationClient = 'tracks' | 'keys' | 'details';

let nextInputId = 0;

export class AnimationEditorInput extends CompositeTextEditorInput<`animation:${string}`, 'animation'> {
	public readonly createView?: () => AnimationEditorInput;
	public override canMove(): boolean { return true; }
	public readonly definitionRange: TrackedTextRange | undefined;
	public readonly sourceModels = new Map<string, EditorTextModel>();
	public sourceRevision: symbol | undefined;
	public version = 0;
	public document: AnimationSourceDocument | undefined;
	public trackSelection: AnimationSourceSelection | undefined;
	public keySelection: AnimationSourceSelection | undefined;
	public detailSelection: AnimationSourceSelection | undefined;
	public trackIndex = -1;
	public keyIndex = -1;
	public clipIndex = -1;
	public clipPreview: { readonly index: number; start: number; duration: number } | undefined;
	public framesSelected = false;
	public selectedSource: AnimationTableSource | undefined;
	public readonly tracks: WorkbenchListState<AnimationTrackRow> = { rows: [], selectionIndex: 0, hoverIndex: -1, scroll: 0,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0 } };
	public readonly details = createWorkbenchPropertyTree<AnimationProperty>();
	public readonly keys = new AnimationKeyViewport();
	public readonly overview = new AnimationOverview();
	public readonly framePreview = new AnimationFramePreview();
	public readonly actionBar = createWorkbenchActionBar('animation.title', true, WORKBENCH_MENUS['animation.context']);
	public readonly clientBar = createWorkbenchActionBar('animation.clients');
	public activeClient: AnimationClient = 'tracks';
	public readonly columnSplit = new WorkbenchSplitView(0.36);
	public readonly rowSplit = new WorkbenchSplitView(0.35, 'vertical');
	public readonly layout: AnimationEditorLayout = { bounds: create_rect_bounds(), font: undefined,
		mode: 'compact', rowHeight: 0, tracksVisible: true, keysVisible: false, detailsVisible: false };
	public status = '';
	private readonly projectionListeners = new Set<() => void>();
	public constructor(public readonly workingCopy: EditorTextModel, public readonly projectContextId: string, definitionRange?: TrackedTextRange,
		public readonly definitionLabel = computeResourceTabTitle(workingCopy.resource), public readonly consumerPath?: string,
		createView?: (source: AnimationEditorInput) => AnimationEditorInput) {
		super(`animation:${nextInputId++}`, 'animation', `ANIM ${definitionLabel}`, true);
		if (createView !== undefined) this.createView = () => createView(this);
		this.definitionRange = definitionRange === undefined ? undefined : { ...definitionRange };
		this.sourceModels.set(resourceIdentityKey(workingCopy.resource), workingCopy);
		this.publishModels();
		this.setLabel(this.title, sourceTabDescription(workingCopy.resource));
		this.disposables.add({ dispose: editorTextModelService.onDidChangeContent((model, event) => {
			const address = resourceIdentityKey(model.resource);
			if (this.sourceModels.get(address) !== model) return;
			this.invalidateProjection();
			if (this.workingCopy === model && this.definitionRange !== undefined) mapTrackedTextRange(this.definitionRange, event.changes);
			if (this.trackSelection?.path === address) mapTrackedTextRange(this.trackSelection.range, event.changes);
			if (this.keySelection?.path === address) mapTrackedTextRange(this.keySelection.range, event.changes);
			if (this.detailSelection?.path === address) mapTrackedTextRange(this.detailSelection.range, event.changes);
		}) });
	}
	public publishModels(): void { this.setWorkingCopies(new Set(this.sourceModels.values())); }
	public invalidateProjection(): void { for (const listener of this.projectionListeners) listener(); }
	public onDidInvalidateProjection(listener: () => void): () => void { this.projectionListeners.add(listener); return () => this.projectionListeners.delete(listener); }
	public override dispose(): void { this.invalidateProjection(); this.projectionListeners.clear(); this.framePreview.dispose(); super.dispose(); }
}
