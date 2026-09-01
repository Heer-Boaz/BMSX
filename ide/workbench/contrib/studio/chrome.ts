import type { Input } from '../../../../hosts/common/input/manager';
import type { Memory } from '../../../../machine/ts/machine/memory/memory';
import type { VideoPresenter } from '../../../../machine/ts/render/video_presenter';
import type { OverlayRenderer } from '../../../runtime/overlay_renderer';
import { StudioChromeController } from './chrome_controller';
import { renderStudioChrome } from './chrome_render';
import { StudioChromeState } from './chrome_state';
import { StudioBoardConnection } from './connection';
import type { StudioSocketPair } from './media_admission';
import { StudioDescriptorModel } from './model';

export class StudioWorkbench {
	public readonly model: StudioDescriptorModel;
	private readonly state = new StudioChromeState();
	private readonly controller: StudioChromeController;

	public constructor(
		memory: Memory,
		private readonly presenter: VideoPresenter,
		input: Input,
		private readonly overlayRenderer: OverlayRenderer,
		sockets: StudioSocketPair,
	) {
		this.model = new StudioDescriptorModel(
			new StudioBoardConnection(memory, sockets),
		);
		this.controller = new StudioChromeController(
			this.model,
			this.state,
			presenter,
			input,
		);
		this.controller.prepareLayout();
	}

	public synchronize(): void {
		if (this.model.synchronize()) {
			this.controller.descriptorPublished();
		}
	}

	public tickInput(): void {
		this.controller.prepareLayout();
		this.controller.tickInput();
	}

	public draw(): void {
		this.controller.prepareLayout();
		renderStudioChrome(
			this.overlayRenderer,
			this.presenter,
			this.model,
			this.state,
		);
	}
}
