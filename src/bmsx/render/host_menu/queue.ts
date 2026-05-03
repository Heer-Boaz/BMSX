import { FeatureQueue } from '../../common/feature_queue';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../shared/submissions';
import type { Host2DKind, Host2DRef } from '../shared/queues';

const hostMenuKindQueue = new FeatureQueue<Host2DKind>(64);
const hostMenuRefQueue = new FeatureQueue<Host2DRef>(64);

export function clearHostMenuQueue(): void {
	hostMenuKindQueue.clearBack();
	hostMenuRefQueue.clearBack();
}

export function submitHostMenuRectangle(item: RectRenderSubmission): void {
	hostMenuKindQueue.submit('rect');
	hostMenuRefQueue.submit(item);
}

export function submitHostMenuGlyphs(item: GlyphRenderSubmission): void {
	hostMenuKindQueue.submit('glyphs');
	hostMenuRefQueue.submit(item);
}

export function beginHostMenuQueue(): number {
	return hostMenuRefQueue.sizeBack();
}

export function forEachHostMenuQueue(fn: (kind: Host2DKind, item: Host2DRef, index: number) => void): void {
	hostMenuRefQueue.forEachBack((item, index) => fn(hostMenuKindQueue.getBack(index), item, index));
}
