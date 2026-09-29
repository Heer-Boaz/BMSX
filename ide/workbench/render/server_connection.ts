import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import type { StudioServerConnectionState } from '../common/server_connection';

const CONNECTED = [0, 3, 2, 5, 6, 1];
const DISCONNECTED = [0, 0, 6, 6];
const DISCONNECTED_CROSS = [0, 6, 6, 0];
const CONNECTING = [0, 0, 6, 0, 0, 6, 6, 6, 0, 0];
const LOCAL = [0, 0, 6, 0, 6, 4, 0, 4, 0, 0];
const LOCAL_STAND = [3, 4, 3, 6, 1, 6, 5, 6];

/** Shape as well as color distinguishes transport state; no dependency on font glyph coverage. */
export function renderServerConnection(state: StudioServerConnectionState, top: number): void {
	switch (state) {
		case 'connected': api.polyline(CONNECTED, 3, top + 3, 0, 1, colors.COLOR_SERVER_CONNECTED); break;
		case 'connecting': api.polyline(CONNECTING, 3, top + 3, 0, 1, colors.COLOR_SERVER_CONNECTING); break;
		case 'disconnected':
			api.polyline(DISCONNECTED, 3, top + 3, 0, 1, colors.COLOR_SERVER_DISCONNECTED);
			api.polyline(DISCONNECTED_CROSS, 3, top + 3, 0, 1, colors.COLOR_SERVER_DISCONNECTED); break;
		case 'standalone':
			api.polyline(LOCAL, 3, top + 3, 0, 1, colors.COLOR_STATUS_TEXT);
			api.polyline(LOCAL_STAND, 3, top + 3, 0, 1, colors.COLOR_STATUS_TEXT); break;
	}
}
