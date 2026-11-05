import { ActorWorldView } from './world_view';
import { ActorWorldOutliner } from './world_outliner';
import { InputInteraction } from '../../../input/interaction';
import { WorkbenchSplitView } from '../../ui/split_view';
import { ReadonlyEditorInput, type AbstractEditorInput } from '../../common/editor_input';
import type { ActorLabLayout } from './layout';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { ScrollableWorkbenchTree } from '../../ui/scrollable_tree';
import { ActorRuntimeTree, type ActorNode } from './runtime';
import type { ActorRow } from './projection';
import type { ResourceDomain } from '../../../common/resource';
import { ActorTimelineTransport } from './timeline';
import { ActorTimelineLayout } from './timeline_layout';
import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import type { GuestInvalidationReason } from '../../../runtime/suspended_guest';
import type { ActorStateGraph } from './state_graph';
import { ActorActivityFollow } from './activity_follow';
import { actorPathsEqual, resolveActorPath, type ActorNodeIdentity } from './target';
import type { ActorDetails, ActorDetailsSelection } from './details';
import type { ActorLabTabId } from '../../ui/tab/id';
import type { ActorLabController } from './controller';
import { WorkbenchWindowModel } from '../../ui/window/model';

/** View state only. Borrowed rows are released before guest execution. */
export class ActorLabInput extends ReadonlyEditorInput<ActorLabTabId, 'actor_lab'> {
	private readonly selectionListeners = new Set<() => void>();
	public override canMove(destination?: AbstractEditorInput<string, string>): boolean { return destination === undefined; }
	public get resource(): undefined { return undefined; }
	public domain: ResourceDomain = 0;
	public actorHashId = 0;
	public worldHashId: number | undefined;
	public actorPresent = false;
	public historical = false;
	public readonly interaction = new InputInteraction();
	public selectionPath: readonly ActorNodeIdentity[] | undefined;
	private resolvedSelectionPath: readonly ActorNodeIdentity[] | undefined;
	private selectionTopology = -1;
	private selectionNode: ActorNode | undefined;
	public details: ActorDetails | undefined;
	public detailsSelection: ActorDetailsSelection | undefined;
	public detailsScroll = 0;
	public dirty = true;
	public status = 'CHOOSE A RUNNING ACTOR';
	public readonly runtime = new ActorRuntimeTree();
	public readonly worldOutliner = new ActorWorldOutliner();
	public stateGraph: ActorStateGraph | undefined;
	public navigation: 'world' | 'actor' = 'world';
	public inspection: 'outline' | 'graph' = 'outline';
	/** Showing world membership does not replace the actor's inspected member. */
	public get presentation(): 'world' | 'outline' | 'graph' { return this.navigation === 'world' ? 'world' : this.inspection; }
	public readonly follow = new ActorActivityFollow();
	/** Visible keyboard navigation is independent of the inspected membership. */
	public readonly outline = new ScrollableWorkbenchTree<ActorRow>();
	public readonly timeline = new ActorTimelineTransport();
	public readonly timelineLayout = new ActorTimelineLayout();
	public readonly split = new WorkbenchSplitView(0.4);
	public readonly rowSplit = new WorkbenchSplitView(0.4, 'vertical');
	public readonly detailsWindow = new WorkbenchWindowModel(undefined, 0, 0);
	public override readonly windowPlacements: readonly WorkbenchWindowModel[] = [this.detailsWindow];
	public readonly detailsActions = createWorkbenchActionBar('actorLab.details.title');
	public readonly worldView: ActorWorldView;
	public readonly viewportActions = createWorkbenchActionBar('actorLab.viewport', true);
	public readonly previewBounds = create_rect_bounds();
	public readonly actionBar = createWorkbenchActionBar('actorLab.title');
	public readonly worldActions = createWorkbenchActionBar('actorLab.world.title');
	public readonly stateGraphActions = createWorkbenchActionBar('actorLab.stateGraph.title');
	public readonly layout: ActorLabLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		primaryRight: 0, primaryBottom: 0, previewVisible: false, split: undefined,
	};
	public constructor(public readonly controller: ActorLabController, id: ActorLabTabId, title: string,
		public override readonly serializable: boolean) {
		super(id, 'actor_lab', title, true);
		this.worldView = new ActorWorldView(controller.authoringSources, controller.renderFrames);
		this.onWillDispose(() => this.worldView.dispose());
		this.onWillDispose(() => { this.selectionListeners.clear(); this.interaction.setRuntime(null); this.runtime.dispose(); this.details?.dispose(); });
	}
	public onDidChangeSelection(listener: () => void): () => void {
		this.selectionListeners.add(listener);
		return () => this.selectionListeners.delete(listener);
	}
	/** Retained identity resolves only on selection/topology changes, independently of the runtime's guest borrows. */
	public get selectedOutlineNode(): ActorNode | undefined {
		if (this.resolvedSelectionPath !== this.selectionPath || this.selectionTopology !== this.runtime.topologyRevision) {
			this.resolvedSelectionPath = this.selectionPath;
			this.selectionTopology = this.runtime.topologyRevision;
			this.selectionNode = this.selectionPath === undefined ? undefined
				: resolveActorPath(this.runtime.roots, this.selectionPath);
		}
		return this.selectionNode;
	}
	public invalidate(reason: GuestInvalidationReason = 'execution'): void {
		this.runtime.release();
		this.details?.invalidate(reason);
		if (reason !== 'execution') {
			this.worldOutliner.invalidate();
			this.worldView.retire();
			this.timeline.clear();
			this.interaction.running = false;
			this.follow.pending = undefined;
		}
		if (reason === 'history-restored') this.historical = true;
		if (reason === 'heap-replaced') {
			this.stateGraph?.retire(reason);
			this.runtime.dispose();
			this.worldOutliner.clear();
			this.follow.stop(); this.actorPresent = false; this.historical = false;
			this.actorHashId = 0; this.worldHashId = undefined; this.selectionPath = undefined;
			this.outline.roots.length = 0; this.outline.rows.length = 0; this.outline.selectionIndex = -1;
		}
		this.dirty = true;
	}
	/** Explicit view navigation records membership once, never on each CPU slice. */
	public rememberSelection(): void {
		const previous = this.selectionPath;
		let row = this.outline.rows[this.outline.selectionIndex];
		if (row === undefined) this.selectionPath = undefined;
		else {
			const path: ActorNodeIdentity[] = [];
			for (;;) {
				const node = row.element.node;
				path.push({ hashId: node.hashId, kind: node.kind, key: node.keyIdentity });
				if (row.parent === null) break;
				row = row.parent;
			}
			this.selectionPath = path.reverse();
		}
		const changed = previous === undefined ? this.selectionPath !== undefined
			: this.selectionPath === undefined || !actorPathsEqual(previous, this.selectionPath);
		if (!changed) this.selectionPath = previous;
		this.details?.followSelection(this.domain, this.worldHashId, this.actorHashId, this.selectionPath, this.runtime);
		if (changed) for (const listener of this.selectionListeners) listener();
	}
}
