import type { Input } from '../../../../hosts/common/input/manager';
import { HostPauseReason } from '../../../../hosts/common/execution_control';
import { InputChannel } from '../../../../hosts/common/input/channel';
import type { MachineModelSpec } from '../../../../machine/ts/spec/bmsx/model';
import { buildFixtureProgram } from '../../../testing/fixture_media';
import { generateUuid } from '../../../common/uuid';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ScenarioTestModule } from '../../../testing/scenario/test_collection';
import type { WorkspaceRecord } from '../../../workspace/records';
import { buildFixtureMedia } from '../execution/fixture_media';
import type { RunTargetSelection } from '../execution/run_target';
import { captureLuaTextModelSources } from '../working_copy/lua_sources';
import { PlayInput } from './input';
import type { PlaySession, PlaySessionFactory } from './session';

/** Captured fixture identity and asynchronous lifetime; no case or result is invented. */
export class PlayHandle {
	public readonly id = generateUuid();
	public session: PlaySession | undefined;
	public failure: { readonly error: unknown } | undefined;
	public closing = false;
	public closed = false;
	public preparation!: Promise<void>;
	public closeOperation: Promise<void> | undefined;
	public constructor(public readonly module: ScenarioTestModule['resource'], public readonly title: string,
		public readonly source: string, public readonly sourceRevision: number, public readonly companionContextId: string | null,
		public selectionRequest: number | undefined) {}
	public get state() {
		return this.closed ? 'closed' : this.closing ? 'closing' : this.failure !== undefined ? 'failed'
			: this.session === undefined ? 'preparing' : this.session.state;
	}
}

export type PlayEvent = { readonly handle: PlayHandle; readonly state: PlayHandle['state'] };

/** One interactive world, with identity-bound Stop/Reset/close and captured source admission. */
export class PlayService {
	public current: PlayHandle | undefined;
	private closed = false;
	private retirement = Promise.resolve();
	private readonly listeners = new Set<(event: PlayEvent) => void>();
	private readonly unbindModels: () => void;
	private publishedState: PlayHandle['state'] | undefined;
	public constructor(private readonly models: EditorTextModelService, private readonly sources: RuntimeSourceState,
		private readonly dirtyRecords: ReadonlyMap<string, WorkspaceRecord>, private readonly model: MachineModelSpec,
		private readonly input: Input, private readonly runTargets: RunTargetSelection, private readonly factory: PlaySessionFactory) {
		this.unbindModels = models.onWillClear(() => { if (this.current !== undefined) void this.close(this.current); });
	}
	public onDidChange(listener: (event: PlayEvent) => void): () => void {
		this.listeners.add(listener); return () => this.listeners.delete(listener);
	}
	public start(module: ScenarioTestModule, companionContextId: string | null = null): PlayHandle {
		if (this.closed) throw new Error('Play service is closed.');
		if (this.current !== undefined) throw new Error('Close or reset the current Play session first.');
		if (module.suite?.kind !== 'integration') throw new Error('Play requires an integration fixture.');
		// Capture working copies and begin the independent build before the first await.
		const handle = new PlayHandle({ ...module.resource }, module.label, module.source, module.sourceTimestamp, companionContextId,
			this.runTargets.request());
		const snapshots = captureLuaTextModelSources(this.models, this.sources.catalog, true);
		const media = buildFixtureMedia(this.sources, new Map(this.dirtyRecords), snapshots, module.resource.contextId, this.model, companionContextId);
		this.current = handle;
		handle.preparation = this.prepare(handle, media, this.retirement);
		this.publish(handle);
		return handle;
	}
	private async prepare(handle: PlayHandle, mediaBuild: ReturnType<typeof buildFixtureMedia>, retirement: Promise<void>): Promise<void> {
		try {
			const [media] = await Promise.all([mediaBuild, retirement]);
			if (handle.closing) return;
			const companion = media.cartridgeSlots[1];
			const program = await buildFixtureProgram(media, { sourcePath: handle.module.path, source: handle.source });
			if (handle.closing) return;
			handle.session = this.factory(media.systemRom, [program.layer.bytes, companion], media.machineModel,
				new PlayInput(new InputChannel(this.input)), program);
		} catch (error) {
			handle.selectionRequest = undefined;
			if (!handle.closing) handle.failure = { error };
		}
		if (!handle.closing) this.publish(handle);
	}
	public advance(hostDeltaMs: number, enabled: boolean): void {
		const handle = this.current;
		if (handle === undefined || handle.closing) return;
		const session = handle.session;
		if (session !== undefined) {
			session.execution.setPauseReason(HostPauseReason.Workbench, !enabled);
			session.advance(hostDeltaMs);
			const request = handle.selectionRequest;
			if (request !== undefined) {
				if (session.ready) {
					handle.selectionRequest = undefined;
					this.runTargets.complete(request, session);
				} else if (session.state === 'failed' || session.failure !== undefined) handle.selectionRequest = undefined;
			}
		}
		if (handle.state !== this.publishedState) this.publish(handle);
	}
	public stop(handle: PlayHandle): void {
		if (this.current !== handle) throw new Error('Play handle is not the current session.');
		handle.selectionRequest = undefined;
		if (handle.session === undefined) void this.close(handle);
		else handle.session.stop();
	}
	/** Reset recaptures source now, waits for the old physical lifetime, then admits a new world. */
	public reset(handle: PlayHandle, module: ScenarioTestModule): PlayHandle {
		if (this.current !== handle) throw new Error('Play handle is not the current session.');
		void this.close(handle);
		return this.start(module, handle.companionContextId);
	}
	public close(handle: PlayHandle): Promise<void> {
		if (handle.closeOperation !== undefined) return handle.closeOperation;
		handle.closing = true;
		handle.selectionRequest = undefined;
		if (this.current === handle) this.current = undefined;
		// Revoke admission/input immediately; join preparation and backend work before completion.
		if (handle.session !== undefined) this.runTargets.retire(handle.session);
		const disposing = handle.session?.dispose();
		handle.closeOperation = (async () => {
			await handle.preparation;
			await disposing;
			handle.closed = true;
			this.publish(handle);
		})();
		this.retirement = handle.closeOperation;
		this.publish(handle);
		return handle.closeOperation;
	}
	public async dispose(): Promise<void> {
		this.closed = true; this.unbindModels();
		if (this.current !== undefined) await this.close(this.current);
		await this.retirement; this.listeners.clear();
	}
	private publish(handle: PlayHandle): void {
		if (handle === this.current) this.publishedState = handle.state;
		for (const listener of this.listeners) listener({ handle, state: handle.state });
	}
}
