import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { PlayHandle, PlayService } from '../../services/play/service';
import { createWorkbenchActionBar } from '../../ui/action_bar';

/** One transient run viewport; Reset replaces its handle, not the authoring machine. */
export class PlayEditorInput extends ReadonlyEditorInput<'play-session', 'play_session'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly frame = create_rect_bounds();
	public readonly actionBar = createWorkbenchActionBar('play.title');
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public constructor(public handle: PlayHandle, private readonly service: PlayService) { super('play-session', 'play_session', 'PLAY', true); }
	public override dispose(): void {
		void this.service.close(this.handle);
		super.dispose();
	}
}
