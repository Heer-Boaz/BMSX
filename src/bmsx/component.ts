import { GameObjectId } from './bmsx';
import { onload, exclude_save, insavegame } from './gameserializer';
import { IEventSubscriber, EventEmitter, EventSubscription } from './eventemitter';
import { GameObjectConstructor, IIdentifiable } from './gameobject';

export type KeyToComponentMap = { [key: string]: Component };
export type ComponentConstructor<T extends Component> = { new(...args: any[]): T };
export type ComponentId = string;

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

    /**
     * Updates all components with the specified tag in the container.
     * @param tag - The tag of the components to update.
     * @param args - Additional arguments to pass to the components' update method.
     */
    updateComponentsWithTag(tag: ComponentTag, ...args: any[]): void;
}

@insavegame
export abstract class Component implements IIdentifiable {
    public parentid: GameObjectId | null = null;
    public id: ComponentId; // The component id is the parent id + the component name
    public static tagsPre: Set<ComponentTag>;
    public static tagsPost: Set<ComponentTag>;
    public static eventSubscriptions: EventSubscription[]; // Note: This property is only used by the event emitter
    constructor(_id: GameObjectId) {
        this.parentid = _id; // Store the parent id for later use
        this.id = this.parentid + '_' + this.constructor.name; // Note: A component can be added once per game object
        this.init();
    }

    /**
     * Checks if the component has the specified tag.
     * @param tag The tag to check.
     * @returns True if the component has the tag, false otherwise.
     */
    hasPreprocessingTag(tag: ComponentTag): boolean {
        const componentClass = this.constructor as ConstructorWithTagsProperty; // Get the component's constructor
        return componentClass.tagsPre?.has(tag) ?? false; // Check if the component has the specified tag
    }

    /**
     * Checks if the component has the specified tag.
     * @param tag The tag to check.
     * @returns True if the component has the tag, false otherwise.
     */
    hasPostprocessingTag(tag: ComponentTag): boolean {
        const componentClass = this.constructor as ConstructorWithTagsProperty; // Get the component's constructor
        return componentClass.tagsPost?.has(tag) ?? false; // Check if the component has the specified tag
    }

    @onload
    /**
     * Initializes the component.
     */
    init() {
        this.initEventSubscriptions(); // Initialize event subscriptions
    }

    /**
     * Initializes the event subscriptions for the component.
     * It subscribes to the specified events and binds the corresponding handlers to the component instance.
     */
    protected initEventSubscriptions() {
        const constr = this.constructor as IEventSubscriber;
        if (!constr.eventSubscriptions) return; // No event subscriptions

        const eventEmitter = EventEmitter.getInstance();
        constr.eventSubscriptions.forEach(subscription => { // Iterate over all event subscriptions
            const handler = this[subscription.handlerName].bind(this); // Bind the handler to the component instance
            let emitterFilter: string;
            switch (subscription.scope) {
                case 'all': emitterFilter = 'all'; break;
                case 'parent':
                    emitterFilter = (this as Component & { parentid?: string }).parentid;
                    if (!emitterFilter) throw `Cannot subscribe Component ${this.id} to event ${subscription.eventName} with scope ${subscription.scope} as the class (instance) ${this.constructor.name} does not have a "parentid".`;
                    emitterFilter = this.parentid;
                    break;
                case 'self': emitterFilter = this.id; break;
            }
            eventEmitter.on(subscription.eventName, handler, emitterFilter); // Subscribe to the event
        });
    }

    // Implement this method to handle component updates
    update(..._args: any[]): void {
        // Override this method in derived classes to handle component updates (optional)
    }
}

/**
 * Represents a component tag.
 */
export type ComponentTag = string;
/**
 * Represents a constructor function with an optional 'tags' property.
 */
type ConstructorWithTagsProperty = Function & {
    tagsPre?: Set<ComponentTag>;
    tagsPost?: Set<ComponentTag>;
};

/**
 * Decorator function that adds a tag to a component.
 * @param tag The tag to be added.
 * @returns A decorator function that adds the tag to the component constructor.
 */
export function componenttags_preprocessing(...tags: ComponentTag[]) {
    return function (constructor: ConstructorWithTagsProperty) { // The constructor function is the only argument
        if (!constructor.hasOwnProperty('tags')) { // Check if the constructor has a 'tags' property
            constructor.tagsPre = new Set<ComponentTag>(); // If not, create a new set
        }
        tags.forEach(tag => constructor.tagsPre.add(tag)); // Add the tags to the set
        updateAllPreprocessingTags(constructor); // Update all tags for the constructor's prototype chain
    };
}

/**
 * Updates all tags for the given constructor by traversing the prototype chain.
 * @param constructor - The constructor function.
 */
function updateAllPreprocessingTags(constructor: ConstructorWithTagsProperty) {
    const tags = new Set<ComponentTag>(); // Use a set to avoid duplicate tags
    let currentClass = constructor as ConstructorWithTagsProperty; // Start with the given constructor

    while (currentClass && currentClass !== Object) { // Traverse the prototype chain
        if (currentClass.tagsPre) { // Check if the current class has any tags
            currentClass.tagsPre.forEach((tag: ComponentTag) => tags.add(tag)); // Add the tags to the set
        }
        currentClass = Object.getPrototypeOf(currentClass); // Get the next class in the prototype chain
    }

    constructor.tagsPre = tags; // Update the tags
}

/**
 * Decorator function that adds a tag to a component.
 * @param tag The tag to be added.
 * @returns A decorator function that adds the tag to the component constructor.
 */
export function componenttags_postprocessing(...tags: ComponentTag[]) {
    return function (constructor: ConstructorWithTagsProperty) { // The constructor function is the only argument
        if (!constructor.hasOwnProperty('tags')) { // Check if the constructor has a 'tags' property
            constructor.tagsPost = new Set<ComponentTag>(); // If not, create a new set
        }
        tags.forEach(tag => constructor.tagsPost.add(tag)); // Add the tags to the set
        updateAllPostprocessingTags(constructor); // Update all tags for the constructor's prototype chain
    };
}

/**
 * Updates all tags for the given constructor by traversing the prototype chain.
 * @param constructor - The constructor function.
 */
function updateAllPostprocessingTags(constructor: ConstructorWithTagsProperty) {
    const tags = new Set<ComponentTag>(); // Use a set to avoid duplicate tags
    let currentClass = constructor as ConstructorWithTagsProperty; // Start with the given constructor

    while (currentClass && currentClass !== Object) { // Traverse the prototype chain
        if (currentClass.tagsPost) { // Check if the current class has any tags
            currentClass.tagsPost.forEach((tag: ComponentTag) => tags.add(tag)); // Add the tags to the set
        }
        currentClass = Object.getPrototypeOf(currentClass); // Get the next class in the prototype chain
    }

    constructor.tagsPost = tags; // Update the tags
}

/**
 * Decorator function that updates tagged components.
 * @param tags The tags of the components to update.
 * @returns A decorator function that updates the tagged components.
 */
export function update_tagged_components<T extends IComponentContainer>(...tags: ComponentTag[]) {
    return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {

        const originalMethod = descriptor.value; // Save a reference to the original method
        descriptor.value = function (...args: any[]) { // Wrap the original method
            const components = Object.values((this as IComponentContainer).components); // Get all components
            for (const component of components) { // Iterate over all components
                const componentClass = component.constructor as ConstructorWithTagsProperty; // Get the component's constructor
                if (componentClass.tagsPre && tags.some(tag => componentClass.tagsPre.has(tag))) { // Check if the component has any of the specified tags
                    component.update.apply(component, args); // Call the component's update method
                }
            }
            let returnvalue = originalMethod.apply(this, args); // Call the original method
            for (const component of components) { // Iterate over all components
                const componentClass = component.constructor as ConstructorWithTagsProperty; // Get the component's constructor
                if (componentClass.tagsPost && tags.some(tag => componentClass.tagsPost.has(tag))) { // Check if the component has any of the specified tags
                    component.update.apply(component, [...args, returnvalue]); // Call the component's update method
                }
            }
        };
    };
}

/**
 * Attaches the specified components to a game object constructor.
 *
 * @param components - The components to attach.
 * @returns A decorator function that attaches the components to the game object constructor.
 */
export function attach_components(...components: ComponentConstructor<Component>[]) {
    return function (constructor: GameObjectConstructor) {
        constructor.autoAddComponents = components;
    };
}
