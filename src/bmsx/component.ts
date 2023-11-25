import { GameObject } from './gameObject'; // Add the import statement for GameObject
import { GameObjectId } from './bmsx'; // Add the import statement for ObjectId
import { exclude_save } from './gameserializer';

export abstract class Component {
    public parentid: GameObjectId | null = null;

    initialize(_id: GameObjectId): void {
        this.parentid = _id;
    }

    // Implement this method to handle component updates
    update(): void { }
}
