import type { ActorRuntimeTree } from './runtime';
import { resolveActorPath, type ActorTarget } from './target';

/** Viewport tracking is separate from the inspection/action selection. */
export class ActorActivityFollow {
	public target: ActorTarget | undefined;
	public pending: ActorTarget | undefined;
	private topology = -1;
	private activity = -1;
	private historical = false;

	public start(target: ActorTarget): void {
		this.target = target;
		this.pending = target;
		this.topology = -1;
		this.activity = -1;
	}

	public stop(): void { this.target = undefined; this.pending = undefined; }

	public refresh(tree: ActorRuntimeTree, historical: boolean): void {
		const target = this.target;
		if (target === undefined) return;
		if (this.topology === tree.topologyRevision && this.activity === tree.activityRevision && this.historical === historical) return;
		this.topology = tree.topologyRevision;
		this.activity = tree.activityRevision;
		this.historical = historical;
		if (resolveActorPath(tree.roots, target.path) === undefined) {
			this.pending = undefined;
			if (!historical) this.stop();
			return;
		}
		this.pending = target;
	}
}
