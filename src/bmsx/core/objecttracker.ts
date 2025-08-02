import type { Identifier } from '../rompack/rompack';
import { GameObject } from "./gameobject";

/**
 * Class representing an ObjectTracker, which tracks the properties of game objects.
 * It can be used to determine which properties have changed since the last update, based on
 * a list of tracked properties that are specified when tracking an object.
 */
export class ObjectTracker {
    /**
     * An object that tracks the properties of game objects.
     * @remarks
     * The `trackedObjects` property is a dictionary that maps GameObjectIds to an array of tracked properties.
     * Each tracked property is represented by an object with a `property` field and an optional `key` field.
     */
    private trackedObjects: { [id: Identifier]: Array<{ property: string, key?: string }> } = {};
    /**
     * Stores the last values of properties for each game object.
     * @remarks Used for determining which properties have changed.
     * @type {Object.<Identifier, Object.<string, any>>}
     */
    private lastValues: { [id: Identifier]: { [property: string]: any } } = {};

    /**
     * Tracks the specified object and its properties.
     * @param target - The object to track.
     * @param properties - The properties to track.
     */
    trackObject<T extends GameObject>(target: T, properties: Array<{ property: keyof T, key?: string }>): void {
        this.trackedObjects[target.id] = properties as Array<{ property: string, key?: string }>;
    }

    /**
     * Stops tracking the object with the specified ID.
     * @param id - The ID of the object to untrack.
     */
    untrackObject(id: Identifier): void {
        delete this.trackedObjects[id];
    }

    /**
     * Gets the updates for the tracked objects.
     * @returns An object containing the updates for each tracked object.
     */
    getUpdates(): { [id: Identifier]: Array<{ property: string, value: any, key?: string }> } {
        let updates: { [id: Identifier]: Array<{ property: string, value: any, key?: string }> } = {};

        for (let [id, properties] of Object.entries(this.trackedObjects)) {
            for (let { property, key } of properties) {
                let gameObject = $.model.getGameObject<GameObject>(id);
                let value = gameObject[property];

                // Only include the property in the updates if it has changed
                if (value !== this.lastValues[id][property]) {
                    updates[id] = updates[id] || [];
                    updates[id].push({ property, value, key });

                    // Update the last value
                    this.lastValues[id][property] = value;
                }
            }
        }

        return updates;
    }
}
