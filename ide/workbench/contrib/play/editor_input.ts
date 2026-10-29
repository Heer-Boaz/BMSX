import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { PlayHandle, PlayService } from '../../services/play/service';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { InputInteraction } from '../../../input/interaction';
import type { PlayTabId } from '../../ui/tab/id';

let nextInputId = 0;

/** One transient run viewport; Reset replaces its handle, not the authoring machine. */
export class PlayEditorInput extends ReadonlyEditorInput<PlayTabId, 'play_session'> {
	public override canMove(): boolean { return true; }
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly frame = create_rect_bounds();
	public readonly actionBar = createWorkbenchActionBar('play.title');
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public readonly interaction = new InputInteraction();
	private readonly handleListeners = new Set<() => void>();
	private bindingRevisionValue = 0;
	private disposed = false;
	public get handle(): PlayHandle { return this.handleValue; }
	public get bindingRevision(): number { return this.bindingRevisionValue; }
	public isBindingCurrent(handle: PlayHandle, revision: number): boolean {
		return !this.disposed && this.handleValue === handle && this.bindingRevisionValue === revision;
	}
	public constructor(private handleValue: PlayHandle, service: PlayService) {
		const sequence = ++nextInputId;
		super(`play-session:${sequence}`, 'play_session', 'PLAY', true);
		this.setLabel(this.title, `Play view ${sequence}`, `#${sequence}`);
		if (handleValue.session?.ready === true) this.interaction.setRuntime(handleValue.session.transport);
		this.disposables.add({ dispose: service.onDidChange(event => {
			if (event.handle !== this.handle) return;
			if (event.handle.closing) this.interaction.setRuntime(null);
			else if (event.handle.session?.ready === true) this.interaction.setRuntime(event.handle.session.transport, this.interaction.running);
		}) });
		this.disposables.add({ dispose: () => { this.handleListeners.clear(); this.interaction.setRuntime(null); void service.close(this.handle); } });
	}
	public onWillChangeHandle(listener: () => void): () => void {
		this.handleListeners.add(listener); return () => this.handleListeners.delete(listener);
	}
	public replaceHandle(handle: PlayHandle): number | undefined {
		if (this.disposed) return;
		const revision = ++this.bindingRevisionValue;
		for (const listener of this.handleListeners) {
			listener();
			if (this.disposed || this.bindingRevisionValue !== revision) return;
		}
		this.interaction.setRuntime(null);
		if (this.disposed || this.bindingRevisionValue !== revision) return;
		this.handleValue = handle;
		if (handle.session?.ready === true) this.interaction.setRuntime(handle.session.transport);
		return this.isBindingCurrent(handle, revision) ? revision : undefined;
	}
	public override dispose(): void {
		if (this.disposed) return;
		this.disposed = true; this.bindingRevisionValue++;
		super.dispose();
	}
}
