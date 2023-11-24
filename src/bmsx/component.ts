import { GameObject } from './gameObject'; // Add the import statement for GameObject
import { exclude_save } from './gameserializer';

export abstract class Component {
    @exclude_save
    public gameObject: GameObject | null = null;

    initialize(gameObject: GameObject): void {
        this.gameObject = gameObject;
    }

    // Implement this method to handle component updates
    update(): void { }
}
