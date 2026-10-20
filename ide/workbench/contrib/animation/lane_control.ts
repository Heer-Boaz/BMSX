import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import type { InputFocusTarget } from '../../../input/focus';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { AnimationEditorController } from './controller';
import type { AnimationEditorInput } from './editor_input';
import type { AnimationClipSource } from './model';

type ClipGesture = { readonly clip: AnimationClipSource; readonly mode: 'move' | 'start' | 'end'; readonly x: number;
	readonly start: number; readonly duration: number; previewStart: number; previewDuration: number };

/** Overview selection and native clip transport edits borrow one source generation. */
export class AnimationLaneControl implements PointerCaptureTarget {
	private input: AnimationEditorInput | undefined;
	private gesture: ClipGesture | undefined;
	private unbindSource: (() => void) | undefined;
	private readonly unbindBlur: () => void;
	public constructor(private readonly focus: InputFocusTarget, private readonly controller: AnimationEditorController) {
		this.unbindBlur = focus.onDidBlur(() => this.cancelPointer());
	}
	public setInput(input: AnimationEditorInput): void {
		this.clearInput(); this.input = input;
		this.unbindSource = input.onDidInvalidateProjection(() => this.cancelPointer());
	}
	public clearInput(): void { this.cancelPointer(); this.unbindSource?.(); this.unbindSource = undefined; this.input = undefined; }
	public dispose(): void { this.clearInput(); this.unbindBlur(); }
	public handlePointer(snapshot: PointerSnapshot): boolean {
		const input = this.input!;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, input.overview.bounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) === 0) return true;
		const list = input.tracks, index = list.scroll + ((snapshot.viewportY - list.layout.contentTop) / list.layout.rowHeight | 0);
		if (index >= list.rows.length) return true;
		this.focus.focus();
		if (index !== list.selectionIndex) this.controller.selectTrack(input, index);
		const row = list.rows[index], clip = row.clip;
		if (clip !== undefined) {
			const start = clip.start === undefined ? 0 : clip.start.value, duration = clip.duration?.value;
			if (start === null || duration === undefined || duration === null) return true;
			const left = input.keys.xAt(start), right = input.keys.xAt(start + duration), x = snapshot.viewportX;
			if (x < Math.min(left, right) - 4 || x > Math.max(left, right) + 4) return true;
			const mode = Math.abs(x - left) < 5 ? 'start' : Math.abs(x - right) < 5 ? 'end' : 'move';
			if (!this.controller.authoring.canEditClip(input, clip, mode)) return true;
			pointerCapture.capture(this);
			this.gesture = { clip, mode, x, start, duration, previewStart: start, previewDuration: duration };
			input.clipPreview = { index: input.clipIndex, start, duration };
		} else if (row.frames) {
			const frames = input.document!.framesSource;
			if (frames?.array) {
				const position = input.keys.valueAt(snapshot.viewportX, false);
				if (position >= 0 && position < frames.table.fields.length) {
					const frame = position | 0;
					this.controller.selectProperty(input, frame); input.keys.setCursor(frame);
				}
			}
		} else if (row.track !== undefined) {
			const key = input.keys.keyAt(snapshot.viewportX); this.controller.selectKey(input, key);
			if (key < 0) input.keys.setCursor(input.keys.valueAt(snapshot.viewportX));
		}
		return true;
	}
	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const input = this.input!, gesture = this.gesture!, range = input.keys.range;
		let delta = (snapshot.viewportX - gesture.x) * (range.maximum - range.minimum) / (range.bounds.right - range.bounds.left - 6);
		if (input.keys.snap) delta = Math.round(delta / range.step) * range.step;
		if (gesture.mode === 'move') gesture.previewStart = gesture.start + delta;
		else if (gesture.mode === 'end') gesture.previewDuration = Math.max(0, gesture.duration + delta);
		else {
			const trim = Math.min(delta, gesture.duration);
			gesture.previewStart = gesture.start + trim; gesture.previewDuration = gesture.duration - trim;
		}
		input.clipPreview!.start = gesture.previewStart; input.clipPreview!.duration = gesture.previewDuration;
	}
	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot);
		const gesture = this.gesture!; this.cancelPointer();
		if (gesture.previewStart !== gesture.start || gesture.previewDuration !== gesture.duration) this.controller.authoring.editClip(this.input!, gesture.clip, gesture.mode, gesture.previewStart, gesture.previewDuration);
	}
	public cancelPointer(): void { pointerCapture.release(this); this.gesture = undefined; if (this.input !== undefined) this.input.clipPreview = undefined; }
}
