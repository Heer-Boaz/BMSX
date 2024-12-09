import { BitmapId } from './resourceids';
import { gamemodel } from "./gamemodel";
import { Direction, SpriteObject, StateMachineBlueprint, build_fsm } from '../bmsx/bmsx';

export class RoomMgr {
    constructor() {
        this.rooms = {};
        this.adjacentRooms = {} as Record<Direction, string>;
    }

    public rooms: Record<string, Room>;
    public adjacentRooms: Record<Direction, string>;

    public loadRoom(room_id: string) {
        const model = $.modelAs<gamemodel>();
        model.currentRoomId = room_id;
        this.adjacentRooms = {} as Record<Direction, string>;
        if (!this.rooms[room_id]) {
            this.rooms[room_id] = new Room(room_id);
        }
        switch (room_id) {
            case 'room1':
                this.adjacentRooms['left'] = 'room2';
                break;
            case 'room2':
                this.adjacentRooms['right'] = 'room1';
                break;
        }
    }

    public transitionToRoom(_room_id: string) {
        // Do nothing for now
    }
}

export class Room extends SpriteObject {
    constructor(room_id: string) {
        super(room_id);
        switch (room_id) {
            case 'room1':
                this.imgid = BitmapId.hallway;
                break;
            case 'room2':
                this.imgid = BitmapId.wuguan;
                break;
        }
    }

    @build_fsm()
    public static bouw(): StateMachineBlueprint {
        function defaultrun(this: Room) {
        }

        return {
            states: {
                _default: {
                    run: defaultrun,
                },
            }
        };
    }
}