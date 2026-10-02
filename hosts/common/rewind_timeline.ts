import { clamp } from '../../machine/ts/common/clamp';
import { clear_rect_bounds, create_rect_bounds, point_in_rect, write_rect_bounds } from '../../machine/ts/common/rect';
import { Host2DKind, type Host2DRef } from '../../machine/ts/render/host_overlay/commands';
import type { HostMenuFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { BFont } from '../../machine/ts/render/shared/bitmap_font';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { RectRenderKind, type GlyphRenderSubmission, type RectRenderSubmission } from '../../machine/ts/render/shared/submissions';

const enum TimelineRect { Panel, Track, Fill, Cursor }
const enum TimelineLabel { Position, Previous, Playback, Next, Present, Resume, Cancel }
export const enum TimelineAction { None = -1, Seek, Previous, Playback, Next, Present, Resume, Cancel }

/** Published owner state in machine cycles; this view never runs or restores the machine. */
export type TimelineState = {
	earliestCycles: number; latestCycles: number; positionCycles: number; cpuHz: number;
	status: 'LIVE' | 'PAUSED' | 'REPLAY' | 'SEEKING' | 'STOPPED';
	enabledActions: number; hoveredAction: TimelineAction; focusedAction: TimelineAction;
};
export type TimelineStyle = {
	panel: number; track: number; accent: number; text: number; disabled: number;
	highlight: number; highlightText: number;
	z: number; actions: readonly string[]; pauseLabel: string; visibleActions: number;
};
export const HOST_TIMELINE_STYLE: TimelineStyle = {
	panel: 0xe8070b10, track: 0xff46525e, accent: 0xff5bc6ff, text: 0xffefefef, disabled: 0xff7d8790,
	highlight: 0xff46525e, highlightText: 0xffefefef,
	z: 920, actions: ['<|', '>', '|>', '', 'OK', 'BACK'], pauseLabel: '||',
	visibleActions: (1 << TimelineAction.Seek) | (1 << TimelineAction.Resume) | (1 << TimelineAction.Cancel),
};

/** Retained presentation shared by the host menu and the docked Studio timeline. */
export class HostRewindTimeline {
	public readonly bounds = create_rect_bounds();
	public readonly hitRects = Array.from({ length: 7 }, () => create_rect_bounds());
	private readonly rects: RectRenderSubmission[];
	private readonly labels: GlyphRenderSubmission[];
	private readonly labelWidths = new Float64Array(7);
	public readonly frame: HostMenuFrame;
	private font: BFont | undefined;
	private state!: TimelineState;
	private offsetTenths = -1;
	private playing = false;

	public constructor(private readonly style: TimelineStyle = HOST_TIMELINE_STYLE) {
		this.rects = Array.from({ length: 4 }, (_, index) => ({ kind: RectRenderKind.Fill,
			area: { left: 0, top: 0, right: 0, bottom: 0, z: style.z + index }, color: 0, layer: LAYER_2D_IDE }));
		this.labels = Array.from({ length: 7 }, (_, index) => {
			const text = index < TimelineLabel.Previous ? '' : style.actions[index - TimelineLabel.Previous];
			return { x: 0, y: 0, z: style.z + 4, items: text, item_start: 0, item_end: text.length, font: null,
				color: style.text, has_background_color: false, background_color: style.track, layer: LAYER_2D_IDE };
		});
		const commandKinds = [...this.rects.map(() => Host2DKind.Rect), ...this.labels.map(() => Host2DKind.Glyphs)];
		const commandRefs: Host2DRef[] = [...this.rects, ...this.labels];
		this.frame = { commandKinds, commandRefs, commandCount: commandKinds.length };
	}
	public static height(font: BFont): number { return font.lineHeight + 22; }
	public selectAt(x: number, y: number): TimelineAction {
		for (let index = 0; index < this.hitRects.length; index++) {
			if ((this.state.enabledActions & (1 << index)) !== 0 && point_in_rect(x, y, this.hitRects[index])) return index;
		}
		return TimelineAction.None;
	}
	public cyclesAt(x: number): number {
		const track = this.rects[TimelineRect.Track].area;
		const offset = clamp(x, track.left, track.right) - track.left;
		return this.state.earliestCycles + Math.trunc((this.state.latestCycles - this.state.earliestCycles) * offset / (track.right - track.left));
	}
	private setLabel(index: number, text: string): void {
		const label = this.labels[index];
		if (label.items === text) return;
		label.items = text; label.item_end = text.length;
		if (this.font !== undefined) this.labelWidths[index] = this.font.measure(text);
	}
	public setActionLabel(action: TimelineAction, text: string): void { this.setLabel(action, text); }
	public update(state: TimelineState, left: number, top: number, right: number, font: BFont): void {
		this.state = state;
		const fontChanged = this.font !== font;
		this.font = font;
		if (fontChanged) for (let index = 0; index < this.labels.length; index++) {
			const label = this.labels[index]; label.font = font;
			this.labelWidths[index] = font.measure(label.items as string);
		}
		const range = state.latestCycles - state.earliestCycles;
		const offsetTenths = Math.trunc((state.latestCycles - state.positionCycles) * 10 / state.cpuHz);
		if (offsetTenths !== this.offsetTenths) {
			this.offsetTenths = offsetTenths; this.setLabel(TimelineLabel.Position, offsetTenths === 0 ? 'NOW' : '-' + (offsetTenths / 10).toFixed(1) + 'S');
		}
		const playing = state.status === 'LIVE' || state.status === 'REPLAY';
		if (playing !== this.playing) {
			this.playing = playing; this.setLabel(TimelineLabel.Playback, playing ? this.style.pauseLabel : this.style.actions[1]);
		}
		const bottom = top + HostRewindTimeline.height(font), trackLeft = left + 6, trackRight = right - 6;
		write_rect_bounds(this.bounds, left, top, right, bottom);
		write_rect_bounds(this.rects[TimelineRect.Panel].area, left, top, right, bottom);
		const trackTop = top + 7;
		write_rect_bounds(this.rects[TimelineRect.Track].area, trackLeft, trackTop, trackRight, trackTop + 3);
		write_rect_bounds(this.hitRects[TimelineAction.Seek], trackLeft - 3, trackTop - 3, trackRight + 3, trackTop + 6);
		const cursor = range === 0 ? trackRight : trackLeft + Math.trunc((state.positionCycles - state.earliestCycles) * (trackRight - trackLeft) / range);
		write_rect_bounds(this.rects[TimelineRect.Fill].area, trackLeft, trackTop, cursor, trackTop + 3);
		write_rect_bounds(this.rects[TimelineRect.Cursor].area, cursor - 1, trackTop - 3, cursor + 2, trackTop + 6);
		this.rects[TimelineRect.Panel].color = this.style.panel;
		this.rects[TimelineRect.Track].color = this.style.track;
		this.rects[TimelineRect.Fill].color = this.style.accent;
		this.rects[TimelineRect.Cursor].color = state.status === 'SEEKING' ? this.style.accent : this.style.text;
		const actionTop = trackTop + 8;
		let actionRight = trackRight;
		for (let action = TimelineAction.Cancel; action >= TimelineAction.Present; action--) {
			const index = TimelineLabel.Previous + action - TimelineAction.Previous;
			const width = (this.style.visibleActions & (1 << action)) === 0 ? 0 : this.labelWidths[index] + 4;
			this.labels[index].x = actionRight - width + 2;
			if (width !== 0) actionRight -= width + 6;
		}
		let actionLeft = trackLeft;
		for (let action = TimelineAction.Previous; action <= TimelineAction.Cancel; action++) {
			const index = TimelineLabel.Previous + action - TimelineAction.Previous, label = this.labels[index];
			label.y = actionTop; label.item_end = (label.items as string).length;
			if (action <= TimelineAction.Next && (this.style.visibleActions & (1 << action)) !== 0) {
				label.x = actionLeft + 2; actionLeft += this.labelWidths[index] + 10;
			}
			const enabled = (state.enabledActions & (1 << action)) !== 0;
			const highlighted = enabled && (action === state.hoveredAction || action === state.focusedAction);
			label.color = highlighted ? this.style.highlightText : enabled ? this.style.text : this.style.disabled;
			label.background_color = this.style.highlight;
			label.has_background_color = highlighted;
			if ((this.style.visibleActions & (1 << action)) === 0) { label.item_end = 0; clear_rect_bounds(this.hitRects[action]); }
			else write_rect_bounds(this.hitRects[action], label.x - 2, actionTop - 2, label.x + this.labelWidths[index] + 2, bottom);
		}
		const position = this.labels[TimelineLabel.Position], positionWidth = this.labelWidths[TimelineLabel.Position];
		position.x = actionLeft === trackLeft ? trackLeft : Math.trunc((actionLeft + actionRight - positionWidth) / 2);
		position.y = actionTop; position.color = this.style.text;
		position.item_end = position.x >= actionLeft && position.x + positionWidth <= actionRight - 4 ? (position.items as string).length : 0;
	}
}
