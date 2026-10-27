import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { InputInteraction } from '../../../input/interaction';
import type { GameViewTabId } from '../../ui/tab/id';

let nextInputId = 0;

/** The existing machine display, with shared inspection controls and explicit game focus. */
export class GameViewInput extends ReadonlyEditorInput<GameViewTabId, 'game_view'> {
	public override canMove(): boolean { return true; }
	public get resource(): undefined { return undefined; }
	public readonly interaction = new InputInteraction();
	public readonly frameBounds = create_rect_bounds();
	public readonly layout: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
	};
	public constructor() {
		const sequence = ++nextInputId;
		super(`game-view:${sequence}`, 'game_view', 'GAME', true);
		this.setLabel(this.title, `Game view ${sequence}`, `#${sequence}`);
	}
	public override dispose(): void { this.interaction.setRuntime(null); super.dispose(); }
}

export function openGameView(group: EditorGroupView): void {
	const active = group.model.activeTab;
	group.openEditor(active?.kind === 'game_view' ? active : group.model.tabs.find(input => input.kind === 'game_view') ?? new GameViewInput());
}
