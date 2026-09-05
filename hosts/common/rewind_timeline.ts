import { clamp } from '../../machine/ts/common/clamp';
import { create_rect_bounds, write_rect_bounds } from '../../machine/ts/common/rect';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { Host2DKind, type Host2DRef } from '../../machine/ts/render/host_overlay/commands';
import type { HostMenuFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { RectRenderKind, TextAlign, TextBaseline, type GlyphRenderSubmission, type RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostRewind } from './rewind';

const enum TimelineRect { Panel, Track, Fill, Cursor }
const enum TimelineLabel { Range, Position, Status, Navigation, Resume, Cancel }
const RECT_COLORS = [0xe8070b10, 0xff46525e, 0xff5bc6ff, 0xffefefef] as const;
const LABEL_TEXT = ['', '', '', 'LB <  RB >', 'START PLAY', 'B CANCEL'] as const;
const COLOR_TEXT = 0xffefefef;
const COLOR_SEEKING = 0xffffce66;

/** Host transport view. Snapshot storage and replay remain in their existing owners. */
export class HostRewindTimeline {
	public readonly hitRect = create_rect_bounds();
	private readonly font = new Font({ variant: 'tiny' });
	private readonly rects: RectRenderSubmission[] = new Array(RECT_COLORS.length);
	private readonly labels: GlyphRenderSubmission[] = new Array(LABEL_TEXT.length);
	private readonly labelWidths: number[] = new Array(LABEL_TEXT.length);
	private readonly commandKinds: Host2DKind[] = new Array(RECT_COLORS.length + LABEL_TEXT.length);
	private readonly commandRefs: Host2DRef[] = new Array(this.commandKinds.length);
	private readonly renderFrame: HostMenuFrame = {
		commandKinds: this.commandKinds,
		commandRefs: this.commandRefs,
		commandCount: this.commandKinds.length,
	};
	private rangeTenths = -1;
	private offsetTenths = -1;
	private statusText = '';

	public constructor() {
		for (let index = 0; index < this.rects.length; index += 1) {
			const rect: RectRenderSubmission = { kind: RectRenderKind.Fill, area: { left: 0, top: 0, right: 0, bottom: 0, z: 920 + index }, color: RECT_COLORS[index], layer: LAYER_2D_IDE };
			this.rects[index] = rect;
			this.commandKinds[index] = Host2DKind.Rect;
			this.commandRefs[index] = rect;
		}
		for (let index = 0; index < this.labels.length; index += 1) {
			const text = LABEL_TEXT[index];
			const label: GlyphRenderSubmission = { x: 0, y: 0, z: 924, items: text, item_start: 0, item_end: text.length, font: this.font, color: COLOR_TEXT, has_background_color: false, background_color: 0, wrap_chars: 0, center_block_width: 0, align: TextAlign.Start, baseline: TextBaseline.Top, layer: LAYER_2D_IDE };
			this.labels[index] = label;
			this.labelWidths[index] = this.font.measure(text);
			this.commandKinds[this.rects.length + index] = Host2DKind.Glyphs;
			this.commandRefs[this.rects.length + index] = label;
		}
		this.labels[TimelineLabel.Status].color = COLOR_SEEKING;
	}

	public moveCursor(runtime: Runtime, rewind: HostRewind, direction: number): void {
		const history = runtime.history;
		const cycles = clamp(rewind.positionCycles + direction * runtime.timing.cpuHz, history.earliestCycles, history.latestCycles);
		if (cycles !== rewind.positionCycles) rewind.seekTo(cycles);
	}

	public seekAt(runtime: Runtime, rewind: HostRewind, x: number): void {
		const history = runtime.history;
		const track = this.rects[TimelineRect.Track].area;
		const offset = clamp(x, track.left, track.right) - track.left;
		const cycles = history.earliestCycles + Math.trunc((history.latestCycles - history.earliestCycles) * offset / (track.right - track.left));
		if (cycles !== rewind.positionCycles) rewind.seekTo(cycles);
	}

	public queueRenderCommands(runtime: Runtime, presenter: VideoPresenter, rewind: HostRewind): void {
		const history = runtime.history;
		const range = history.latestCycles - history.earliestCycles;
		const position = rewind.positionCycles;
		const rangeTenths = Math.trunc(range * 10 / runtime.timing.cpuHz);
		const offsetTenths = Math.trunc((history.latestCycles - position) * 10 / runtime.timing.cpuHz);
		if (rangeTenths !== this.rangeTenths) {
			this.rangeTenths = rangeTenths;
			const label = this.labels[TimelineLabel.Range];
			const text = `REWIND ${(rangeTenths / 10).toFixed(1)}S`;
			label.items = text;
			label.item_end = text.length;
			this.labelWidths[TimelineLabel.Range] = this.font.measure(text);
		}
		if (offsetTenths !== this.offsetTenths) {
			this.offsetTenths = offsetTenths;
			const label = this.labels[TimelineLabel.Position];
			const text = offsetTenths === 0 ? 'NOW' : `-${(offsetTenths / 10).toFixed(1)}S`;
			label.items = text;
			label.item_end = text.length;
			this.labelWidths[TimelineLabel.Position] = this.font.measure(text);
		}
		const status = rewind.stopped ? 'STOPPED' : rewind.seeking ? 'SEEKING' : '';
		if (status !== this.statusText) {
			this.statusText = status;
			this.labels[TimelineLabel.Status].items = status;
			this.labels[TimelineLabel.Status].item_end = status.length;
			this.labelWidths[TimelineLabel.Status] = this.font.measure(status);
		}
		const left = 6;
		const right = presenter.viewportSize.x - 6;
		const top = presenter.viewportSize.y - 38;
		const trackLeft = left + 6;
		const trackRight = right - 6;
		write_rect_bounds(this.hitRect, left, top + 10, right, top + 22);
		const cursor = range === 0 ? trackRight : trackLeft + Math.trunc((position - history.earliestCycles) * (trackRight - trackLeft) / range);
		write_rect_bounds(this.rects[TimelineRect.Panel].area, left, top, right, top + 32);
		write_rect_bounds(this.rects[TimelineRect.Track].area, trackLeft, top + 15, trackRight, top + 18);
		write_rect_bounds(this.rects[TimelineRect.Fill].area, trackLeft, top + 15, cursor, top + 18);
		write_rect_bounds(this.rects[TimelineRect.Cursor].area, cursor - 1, top + 12, cursor + 2, top + 21);
		this.rects[TimelineRect.Cursor].color = rewind.seeking ? COLOR_SEEKING : COLOR_TEXT;
		const center = Math.trunc(presenter.viewportSize.x / 2);
		this.labels[TimelineLabel.Range].x = trackLeft;
		this.labels[TimelineLabel.Position].x = trackRight - this.labelWidths[TimelineLabel.Position];
		this.labels[TimelineLabel.Status].x = center - Math.trunc(this.labelWidths[TimelineLabel.Status] / 2);
		this.labels[TimelineLabel.Navigation].x = trackLeft;
		this.labels[TimelineLabel.Resume].x = center - Math.trunc(this.labelWidths[TimelineLabel.Resume] / 2);
		this.labels[TimelineLabel.Cancel].x = trackRight - this.labelWidths[TimelineLabel.Cancel];
		for (let index = 0; index < this.labels.length; index += 1) {
			this.labels[index].y = top + (index < TimelineLabel.Navigation ? 4 : 24);
		}
		presenter.hostOverlayQueue.publishHostMenuFrame(this.renderFrame);
	}
}
