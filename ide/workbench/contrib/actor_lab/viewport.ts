import type { FrameBitmap } from '../../../../hosts/common/frame_bitmap';
import type { InputRecipient } from '../../../../hosts/common/input/channel';
import type { VideoPresenter } from '../../../../machine/ts/render/video_presenter';
import type { RuntimeTransport } from '../../../runtime/transport';

/** Actual output, input and transport owners of the inspected physical machine. */
export type ActorLabViewport = {
	readonly transport: RuntimeTransport;
	readonly presenter: VideoPresenter;
	readonly recipient: InputRecipient;
} & ({ readonly kind: 'direct' } | { readonly kind: 'offscreen'; readonly frames: FrameBitmap });
