import { new_vec2, new_vec3 } from '../../utils/utils';
import * as SpritesPipeline from '../2d/sprites_pipeline';
import type { RectRenderSubmission } from '../shared/render_types';
import type { EditorOverlayFrame, OverlayCommand } from './editor_overlay_queue';
import { consumeOverlayFrame } from './editor_overlay_queue';

function submitRect(cmd: OverlayCommand, scaleX: number, scaleY: number): void {
	const rect = cmd as OverlayCommand & { type: 'rect' };
	const submission: RectRenderSubmission = {
		kind: rect.kind,
		area: {
			start: { x: rect.x0 * scaleX, y: rect.y0 * scaleY, z: 0 },
			end: { x: rect.x1 * scaleX, y: rect.y1 * scaleY },
		},
		color: rect.color,
		layer: 'editor',
	};
	if (rect.kind === 'fill') {
		SpritesPipeline.fillRectangle(submission);
	} else {
		SpritesPipeline.drawRectangle(submission);
	}
}

function submitSprite(cmd: OverlayCommand, scaleX: number, scaleY: number): void {
	const sprite = cmd as OverlayCommand & { type: 'sprite' };
	SpritesPipeline.drawImg({
		imgid: sprite.imgId,
		pos: new_vec3(sprite.x * scaleX, sprite.y * scaleY, 0),
		scale: new_vec2(sprite.scaleX * scaleX, sprite.scaleY * scaleY),
		flip: sprite.flipH || sprite.flipV ? { flip_h: sprite.flipH, flip_v: sprite.flipV } : undefined,
		colorize: sprite.color ?? undefined,
		layer: 'editor',
	});
}

export function drainOverlayFrameIntoSpriteQueue(_renderWidth: number, _renderHeight: number, logicalWidth: number, logicalHeight: number): void {
	const frame: EditorOverlayFrame | null = consumeOverlayFrame();
	if (!frame || frame.commands.length === 0) {
		return;
	}
	const scaleX = frame.width > 0 ? logicalWidth / frame.width : 1;
	const scaleY = frame.height > 0 ? logicalHeight / frame.height : 1;
	for (const command of frame.commands) {
		if (command.type === 'rect') {
			submitRect(command, scaleX, scaleY);
		} else {
			submitSprite(command, scaleX, scaleY);
		}
	}
}
