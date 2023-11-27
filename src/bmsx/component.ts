import { GameObjectId } from './bmsx';
import { onload, exclude_save } from './gameserializer';

/**
 * Represents a container for components.
 */
export interface IComponentContainer {
    /**
     * A map of components, where the key is the component name and the value is the component instance.
     */
    components: Map<string, Component>;

    /**
     * Retrieves a component of the specified type from the container.
     * @param constructor - The constructor function of the component type.
     * @returns The component instance of the specified type, or undefined if not found.
     */
    getComponent<T extends Component>(constructor: { new(): T }): T | undefined;

    /**
     * Adds a component to the container.
     * @param component - The component instance to add.
     */
    addComponent<T extends Component>(component: T): void;
}


export abstract class Component {
    public parentid: GameObjectId | null = null;
    @exclude_save
    public static tags: Set<ComponentTag>;

    constructor(_id: GameObjectId) {
        this.parentid = _id;
        // this.init();
    }

    hasTag(tag: ComponentTag): boolean {
        const componentClass = this.constructor as ConstructorWithTagsProperty;
        return componentClass.tags?.has(tag) ?? false;
    }

    // @onload
    // init() {
    //     this.initEventHandlers();
    // }

    // // Implement this method to handle component initialization
    // initEventHandlers() { }

    // Implement this method to handle component initialization
    initTags() { }

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
export function Tag(tag: ComponentTag) {
    return function (constructor: ConstructorWithTagsProperty) {
        if (!constructor.hasOwnProperty('tags')) {
            constructor.tags = new Set<ComponentTag>();
        }
        constructor.tags.add(tag);
        updateAllTags(constructor);
    };
}

/**
 * Updates all tags for the given constructor by traversing the prototype chain.
 * @param constructor - The constructor function.
 */
function updateAllTags(constructor: any) {
    const tags = new Set<ComponentTag>();
    let currentClass: any = constructor;

    while (currentClass !== Object) {
        if (currentClass.tags) {
            currentClass.tags.forEach((tag: ComponentTag) => tags.add(tag));
        }
        currentClass = Object.getPrototypeOf(currentClass);
    }

    constructor.allTagsCache = tags;
}

/**
 * Decorator that updates all components with a specific tag.
 *
 * @param tag - The tag of the components to update.
 * @returns A decorator function.
 */
function UpdateTaggedComponents(tag: ComponentTag) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args: any[]) {
            (this as IComponentContainer).components.forEach(component => {
                const componentClass = (component.constructor as ConstructorWithTagsProperty);
                if (componentClass.tags && componentClass.tags.has(tag)) {
                    component.update.apply(component, args);
                }
            });
            originalMethod.apply(this, args);
        };
    };
}
