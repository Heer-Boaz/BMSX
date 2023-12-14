import { BitmapId } from './resourceids';
import { Direction, get_gamemodel } from "../bmsx/bmsx";
import { SpriteObject } from "../bmsx/sprite";
import { gamemodel } from "./gamemodel";

const get_model = get_gamemodel<gamemodel>;

export class RoomMgr {
    constructor() {
        this.rooms = {};
        this.adjacentRooms = {} as Record<Direction, string>;
    }

    public rooms: Record<string, Room>;
    public adjacentRooms: Record<Direction, string>;

    public loadRoom(room_id: string) {
        const model = get_model();
        model.currentRoomId = room_id;
        this.adjacentRooms = {} as Record<Direction, string>;
        if (!this.rooms[room_id]) {
            this.rooms[room_id] = new Room(room_id);
        }
        switch (room_id) {
            case 'room1':
                this.adjacentRooms[Direction.Left] = 'room2';
                break;
            case 'room2':
                this.adjacentRooms[Direction.Right] = 'room1';
                break;
        }
    }

    public transitionToRoom(room_id: string) {
        // Handle the logic to move to an adjacent room
        // Update currentRoom and adjacent rooms
    }

    // Other methods for room management...
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
}