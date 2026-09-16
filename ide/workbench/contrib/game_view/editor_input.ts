import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import type { EditorPanes } from '../../services/editor/editor_panes';

/** The existing machine display, with inspection controls rather than guest input. */
export class GameViewInput extends ReadonlyEditorInput<'game-view', 'game_view'> {
	public get resource(): undefined { return undefined; }
	public readonly frameBounds = create_rect_bounds();
	public readonly actionBar = createWorkbenchActionBar('gameView.title');
	public readonly layout: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		viewportWidth: -1, viewportHeight: -1, codeAreaTop: -1, codeAreaBottom: -1,
	};
	public constructor() { super('game-view', 'game_view', 'GAME', true); }
}

export function openGameView(panes: EditorPanes): void {
	openEditorTab(panes, editorTabGroup.findById('game-view') ?? new GameViewInput());
}
