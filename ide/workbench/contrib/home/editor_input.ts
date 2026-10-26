import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { StudioSourceContext } from '../../../../hosts/common/studio_projects';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { createWorkbenchActionBar, type WorkbenchActionBarState } from '../../ui/action_bar';
import type { WorkbenchActionMenuId } from '../../ui/menu/registry';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';

export const HOME_SECTIONS: readonly { readonly title: string; readonly menu: WorkbenchActionMenuId }[] = [
	{ title: 'Work', menu: 'home.work' },
	{ title: 'Author', menu: 'home.author' },
	{ title: 'Run', menu: 'home.run' },
	{ title: 'Tools', menu: 'home.tools' },
];

export type HomeSection = {
	readonly title: string;
	readonly actions: WorkbenchActionBarState;
	readonly bounds: RectBounds;
	readonly labels: string[];
	visibleCount: number;
};

/** Home observes the attached workspace; it neither selects projects nor owns a machine. */
export class HomeInput extends ReadonlyEditorInput<'home', 'home'> {
	public get resource(): undefined { return undefined; }
	public readonly layout: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
	};
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly sections: readonly HomeSection[] = HOME_SECTIONS.map(section => {
		const actions = createWorkbenchActionBar(section.menu);
		return { title: section.title, actions, bounds: create_rect_bounds(), labels: actions.items.map(item => item.label), visibleCount: 0 };
	});

	public constructor(public readonly workspaceContext: StudioSourceContext | null) {
		super('home', 'home', 'Home', true);
	}
}

export function openHome(group: EditorGroupView, workspaceContext: StudioSourceContext | null): void {
	group.openEditor(group.model.findById('home') ?? new HomeInput(workspaceContext));
}
