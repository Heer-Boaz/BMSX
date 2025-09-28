import { Platform } from '../../core/platform';
import type { InputEvt } from '../../core/platform';
import { HeadlessPlatformServices, type HeadlessPlatformOptions } from './platform_headless';
import { createHeadlessGameViewHost } from '../../render/headless/headless_view';
import type { vec2 } from '../../rompack/rompack';
import type { GameViewHost } from '../../render/platform/gameview_host';

export interface HeadlessBootstrapOptions extends HeadlessPlatformOptions {
	viewportSize?: vec2;
}

export interface HeadlessBootstrapHandle {
  postInput(evt: InputEvt): void;
  readonly viewHost: GameViewHost;
}

export function bootstrapHeadlessPlatform(options: HeadlessBootstrapOptions = {}): HeadlessBootstrapHandle {
  const services = new HeadlessPlatformServices(options);
  if (!Platform.isInitialized) Platform.initialize(services);
  const viewport = options.viewportSize ?? { x: 256, y: 192 };
  const viewHost = createHeadlessGameViewHost(viewport);
  return {
    postInput: (evt: InputEvt) => services.input.post(evt),
    viewHost,
  };
}
