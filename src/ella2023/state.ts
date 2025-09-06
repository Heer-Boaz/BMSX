import { Registry } from 'bmsx/core/registry';
import type { Identifier, RegisterablePersistent } from 'bmsx/rompack/rompack';
import { insavegame } from 'bmsx/serializer/gameserializer';
import { RoomMgr } from './roommgr';

@insavegame
export class EilaGameState implements RegisterablePersistent {
	get registrypersistent(): true { return true; }
	public get id(): Identifier { return 'eila_state'; }

	public currentRoomId: string = '';
	public room_mgr: RoomMgr = new RoomMgr();
	public numOfPlayers: number = 1;

	constructor() { Registry.instance.register(this); }

	public dispose(): void {
	}
}
