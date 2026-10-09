import { WorkbenchSplitView } from '../../ui/split_view';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { ScrollableWorkbenchTree } from '../../ui/scrollable_tree';
import { ActorRuntimeTree } from './runtime';
import type { ActorRow } from './projection';
import type { ResourceDomain } from '../../../common/resource';
import { ActorTimelineTransport } from './timeline';
import { ActorTimelineLayout } from './timeline_layout';
import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import type { GuestInvalidationReason } from '../../../runtime/suspended_guest';
import type { ActorStateGraph } from './state_graph';
import { ActorActivityFollow } from './activity_follow';
import type { ActorNodeIdentity } from './target';
import type { ActorDetails, ActorDetailsSelection } from './details';
import type { ActorLabTabId } from '../../ui/tab/id';
import type { ActorLabController } from './controller';

/** View state only. Borrowed rows are released before guest execution. */
export class ActorLabInput extends ReadonlyEditorInput<ActorLabTabId, 'actor_lab'> {
	public get resource(): undefined { return undefined; }
	public domain: ResourceDomain = 0;
	public actorHashId = 0;
	public worldHashId: number | undefined;
	public actorPresent = false;
	public historical = false;
	public running = false;
	public selectionPath: readonly ActorNodeIdentity[] | undefined;
	public details: ActorDetails | undefined;
	public detailsOpen = false;
	public detailsSelection: ActorDetailsSelection | undefined;
	public detailsScroll = 0;
	public dirty = true;
	public status = 'CHOOSE A RUNNING ACTOR';
	public readonly runtime = new ActorRuntimeTree();
	public stateGraph: ActorStateGraph | undefined;
	public presentation: 'outline' | 'graph' = 'outline';
	public readonly follow = new ActorActivityFollow();
	public readonly outline = new ScrollableWorkbenchTree<ActorRow>();
	public readonly timeline = new ActorTimelineTransport();
	public readonly timelineLayout = new ActorTimelineLayout();
	public readonly split = new WorkbenchSplitView(0.4);
	public readonly detailsSplit = new WorkbenchSplitView(0.42, 'vertical');
	public readonly detailsBounds = create_rect_bounds();
	public readonly previewBounds = create_rect_bounds();
	public readonly actionBar = createWorkbenchActionBar('actorLab.title');
	public readonly stateGraphActions = createWorkbenchActionBar('actorLab.stateGraph.title');
	public readonly layout: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
	};
	public constructor(public readonly controller: ActorLabController, id: ActorLabTabId, title: string,
		public override readonly serializable: boolean) {
		super(id, 'actor_lab', title, true);
		this.onWillDispose(() => { this.runtime.dispose(); this.details?.dispose(); });
	}
	public invalidate(reason: GuestInvalidationReason = 'execution'): void {
		this.runtime.release();
		this.details?.invalidate(reason);
		if (reason !== 'execution') {
			this.timeline.clear();
			this.running = false;
			this.follow.pending = undefined;
		}
		if (reason === 'history-restored') this.historical = true;
		if (reason === 'heap-replaced') {
			this.stateGraph?.retire(reason);
			this.runtime.dispose();
			this.follow.stop(); this.actorPresent = false; this.historical = false;
			this.actorHashId = 0; this.worldHashId = undefined; this.selectionPath = undefined;
			this.outline.roots.length = 0; this.outline.rows.length = 0; this.outline.selectionIndex = -1;
		}
		this.dirty = true;
	}
	/** Explicit view navigation records membership once, never on each CPU slice. */
	public rememberSelection(): void {
		let row = this.outline.rows[this.outline.selectionIndex];
		if (row === undefined) { this.selectionPath = undefined; return; }
		const path: ActorNodeIdentity[] = [];
		for (;;) {
			const node = row.element.node;
			path.push({ hashId: node.hashId, kind: node.kind, key: node.keyIdentity });
			if (row.parent === null) break;
			row = row.parent;
		}
		this.selectionPath = path.reverse();
	}
}
