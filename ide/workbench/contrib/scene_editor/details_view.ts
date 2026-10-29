import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import type { SceneAuthoringContext } from './authoring_context';
import { SceneDetailsProjection, type SceneDetailsSubject, type ScenePositionProperty } from './details_projection';
import type { SceneOptionProperty } from './option_properties';

export type SceneDetailsProperty<Descriptor> = {
	descriptor: Descriptor;
	text: string;
	readonly contentBounds: RectBounds;
	readonly bounds: RectBounds;
};
export type ScenePositionViewProperty = SceneDetailsProperty<ScenePositionProperty>;
export type SceneOptionViewProperty = SceneDetailsProperty<SceneOptionProperty>;

/** Details reading state and placement belong to this view, not its semantic subject or a hierarchy. */
export class SceneDetailsViewState {
	public readonly projection: SceneDetailsProjection;
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly properties: ScenePositionViewProperty[] = [];
	public readonly optionProperties: SceneOptionViewProperty[] = [];
	public readonly detailsText: { text: string; top: number; warning: boolean }[] = [];
	public readonly wrappedLines: string[] = [];
	public position: number | undefined;
	public readonly layout: FullWidthWorkbenchLayout & { projectedOffsetTop: number } = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null, projectedOffsetTop: 0,
	};
	private readonly changeListeners = new Set<() => void>();
	private readonly unsubscribeScroll: () => void;

	public constructor(public readonly authoring: SceneAuthoringContext) {
		this.projection = new SceneDetailsProjection(authoring);
		this.unsubscribeScroll = this.viewport.scrollbar.onDidScroll(() => this.notifyPresentationChanged());
	}

	public refresh(): boolean {
		if (!this.projection.refresh()) return false;
		const subject = this.projection.subject;
		bindProperties(this.properties, subject?.properties ?? NO_PROPERTIES);
		bindProperties(this.optionProperties, subject?.optionProperties ?? NO_PROPERTIES);
		return true;
	}

	public onDidChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => { this.changeListeners.delete(listener); };
	}
	public notifyPresentationChanged(): void {
		for (const listener of this.changeListeners) listener();
	}
	public dispose(): void {
		this.unsubscribeScroll();
		this.changeListeners.clear();
	}
}

/** A field draft is bound to one admitted selection and attachment, never to a later array index. */
export type SceneDetailsFieldBinding = {
	readonly view: SceneDetailsViewState;
	readonly subject: SceneDetailsSubject;
	isCurrent(): boolean;
};

const NO_PROPERTIES = [] as const;

function bindProperties<Descriptor>(target: SceneDetailsProperty<Descriptor>[], descriptors: readonly Descriptor[]): void {
	for (let index = 0; index < descriptors.length; index++) {
		if (index === target.length) target.push({ descriptor: descriptors[index], text: '', contentBounds: create_rect_bounds(), bounds: create_rect_bounds() });
		else target[index].descriptor = descriptors[index];
	}
	target.length = descriptors.length;
}
