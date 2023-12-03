import { GameObjectId } from './bmsx';
import { onload, exclude_save, insavegame } from './gameserializer';
import { IEventSubscriber, EventEmitter, EventSubscription } from './eventemitter';
import { GameObject } from './gameobject';

export type KeyToComponentMap = { [key: string]: Component };
export type ComponentConstructor<T extends Component> = { new(...args: any[]): T };
/**
 * Represents a container for components.
 */
export interface IComponentContainer {
    /**
     * A map of components, where the key is the component name and the value is the component instance.
     */
    components: KeyToComponentMap;

    /**
     * Retrieves a component of the specified type from the container.
     * @param constructor - The constructor function of the component type.
     * @returns The component instance of the specified type, or undefined if not found.
     */
    getComponent<T extends Component>(constructor: ComponentConstructor<T>): T | undefined;

    /**
     * Adds a component to the container.
     * @param component - The component instance to add.
     */
    addComponent<T extends Component>(component: T): void;

    /**
     * Updates a component of the specified type in the container.
     * @param constructor - The constructor function of the component type.
     * @param args - Additional arguments to pass to the component's update method.
     */
    updateComponent<T extends Component>(constructor: ComponentConstructor<T>, ...args: any[]): void;
}

@insavegame
export abstract class Component {
    public parentid: GameObjectId | null = null;
    @exclude_save
    public static tags: Set<ComponentTag>;
    public static eventSubscriptions: EventSubscription[];

    constructor(_id: GameObjectId) {
        this.parentid = _id;
        this.init();
    }

    hasTag(tag: ComponentTag): boolean {
        const componentClass = this.constructor as ConstructorWithTagsProperty;
        return componentClass.tags?.has(tag) ?? false;
    }

    @onload
    init() {
        this.initEventSubscriptions();
    }

    protected initEventSubscriptions() {
        const constr = this.constructor as IEventSubscriber;
        if (!constr.eventSubscriptions) return;

        const eventEmitter = EventEmitter.getInstance();
        constr.eventSubscriptions.forEach(subscription => {
            const handler = this[subscription.handlerName].bind(this);
            // Note that subscription.scope is not considered here, as all events from Components are emitted by the parent GameObject
            eventEmitter.on(subscription.eventName, handler, this.parentid);
        });
    }

    // Implement this method to handle component updates
    update(...args: any[]): void { }
}

/**
 * Represents a component tag.
 */
export type ComponentTag = string;
/**
 * Represents a constructor function with an optional 'tags' property.
 */
type ConstructorWithTagsProperty = Function & {
    tags?: Set<ComponentTag>;
};

/**
 * Decorator function that adds a tag to a component.
 * @param tag The tag to be added.
 * @returns A decorator function that adds the tag to the component constructor.
 */
export function componenttag(...tags: ComponentTag[]) {
    return function (constructor: ConstructorWithTagsProperty) { // The constructor function is the only argument
        if (!constructor.hasOwnProperty('tags')) { // Check if the constructor has a 'tags' property
            constructor.tags = new Set<ComponentTag>(); // If not, create a new set
        }
        tags.forEach(tag => constructor.tags.add(tag)); // Add the tags to the set
        updateAllTags(constructor); // Update all tags for the constructor's prototype chain
    };
}

/**
 * Updates all tags for the given constructor by traversing the prototype chain.
 * @param constructor - The constructor function.
 */
function updateAllTags(constructor: any) {
    const tags = new Set<ComponentTag>(); // Use a set to avoid duplicate tags
    let currentClass: any = constructor; // Start with the given constructor

    while (currentClass && currentClass !== Object) { // Traverse the prototype chain
        if (currentClass.tags) { // Check if the current class has any tags
            currentClass.tags.forEach((tag: ComponentTag) => tags.add(tag)); // Add the tags to the set
        }
        currentClass = Object.getPrototypeOf(currentClass); // Get the next class in the prototype chain
    }

    constructor.tags = tags; // Update the tags
}

/**
 * Decorator function that updates tagged components.
 * @param tags The tags of the components to update.
 * @returns A decorator function that updates the tagged components.
 */
export function update_tagged_components(...tags: ComponentTag[]) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value; // Save a reference to the original method
        descriptor.value = function (...args: any[]) { // Wrap the original method
            Object.values((this as IComponentContainer).components).forEach(component => { // Iterate over all components
                const componentClass = (component.constructor as ConstructorWithTagsProperty); // Get the component's constructor
                if (componentClass.tags) { // Check if the component has any tags
                    const hasAnyTag = tags.some(tag => componentClass.tags.has(tag)); // Check if the component has any of the specified tags
                    if (hasAnyTag) {
                        component.update.apply(component, args); // Call the component's update method
                    }
                }
            });
            originalMethod.apply(this, args); // Call the original method
        };
    };
}

interface IGameObjectStatic {
    autoAddComponents?: ComponentConstructor<Component>[];
}

type GameObjectConstructor = {
    new(_id?: GameObjectId, _fsm_id?: string): GameObject;
} & IGameObjectStatic;

export function attach_components(...components: ComponentConstructor<Component>[]) {
    return function (constructor: GameObjectConstructor) {
        constructor.autoAddComponents = components;
    };
}
