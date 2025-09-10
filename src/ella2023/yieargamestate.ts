import { Registry } from 'bmsx/core/registry';
import type { Identifier, RegisterablePersistent } from 'bmsx/rompack/rompack';
import { insavegame, type RevivableObjectArgs } from 'bmsx/serializer/gameserializer';
import { RoomMgr } from './roommgr';

@insavegame
export class YieArGameState implements RegisterablePersistent {
	get registrypersistent(): true { return true; }
	public get id(): Identifier { return 'yiear_state'; }

	public currentRoomId: string = '';
	public room_mgr: RoomMgr = new RoomMgr();
	public numOfPlayers: number = 1;

	constructor(_opts?: RevivableObjectArgs) { this.bind(); }

	public bind(): void {
		Registry.instance.register(this);
	}

	public unbind(): void {
		Registry.instance.deregister(this);
	}

	public dispose(): void {
	}
}
