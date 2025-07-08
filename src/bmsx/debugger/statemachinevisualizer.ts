import { State } from '../fsm/fsm';
import type { Stateful } from '../fsm/fsmtypes';
import type { Identifier } from '../game';
import { FloatingDialog, removeStateMachineVisualizer } from './bmsxdebugger';
import { createObjectTableElement } from './objectpropertydialog';

export class StateMachineVisualizer {
    private dialog: FloatingDialog;
    private parentid: Identifier;
    private machineElements: Map<string, HTMLElement>;
    private stateElements: Map<string, HTMLElement>;

    constructor(id: string) {
        this.parentid = id;
    }

    public frameUpdate(): void {
        this.openDialog();
        const [machineElements, stateElements] = [this.machineElements, this.stateElements];
        highlightCurrentState(stateElements, machineElements, this.parentid);
    }

    public closeDialog(): void {
        this.dialog.close();
        this.dialog = null;
        this.machineElements = null;
        this.stateElements = null;
        removeStateMachineVisualizer(this.parentid);
    }

    public openDialog(): void {
        if (!this.dialog) {
            this.dialog = new FloatingDialog(`FSM: [${this.parentid}]`);
        }
        if (!this.machineElements || !this.stateElements) {
            [, this.machineElements, this.stateElements] = visualizeStateMachine(
                this.dialog.getDialogElement(),
                this.dialog.getContentElement(),
                this.parentid
            );
            this.dialog.updateSize();
        }
    }
}

export function visualizeStateMachine(dialogElement: HTMLElement, container: HTMLElement, bfsmControllerId: Identifier): [HTMLElement, Map<string, HTMLElement>, Map<string, HTMLElement>] {
    let baseTable = document.createElement('table');
    container.appendChild(baseTable);
    let stateElements = new Map<string, HTMLElement>();
    let machineElements = new Map<string, HTMLElement>();

    function addContent(parent: HTMLElement, type: string, content: string | null): HTMLElement {
        let element = document.createElement(type);
        if (content !== null) {
            element.textContent = content;
        }
        parent.appendChild(element);
        return element;
    }

    function visualizeMachine(machine: State, machineName: string, parentElement: HTMLElement, isActive: boolean, path: string): void {
        const bfsmController = $.get<Stateful>(bfsmControllerId).sc;
        let table = document.createElement('table');
        parentElement.appendChild(table);
        let machineNameRow = document.createElement('tr');
        let machineNameCell = document.createElement('td');
        machineNameCell.textContent = machineName;
        machineNameRow.appendChild(machineNameCell);
        table.appendChild(machineNameRow);
        machineElements.set(path, machineNameCell);

        for (let stateId in machine.states) {
            let state = machine.states?.[stateId];
            let stateRow = document.createElement('tr');
            let stateCell = document.createElement('td');
            stateCell.textContent = state?.def_id ?? 'undefined';
            stateCell.classList.add('state');
            stateRow.appendChild(stateCell);
            table.appendChild(stateRow);
            const newpath = `${path}.${stateId}`;
            stateCell.onclick = () => {
                bfsmController.to(newpath);
            };
            stateCell.oncontextmenu = () => {
                const stateDialog = new FloatingDialog(`State: [${newpath}]`, dialogElement);
                createObjectTableElement(stateDialog.getDialogElement(), stateDialog.getContentElement(), state, newpath, ['objects']);
                stateDialog.updateSize();
            };
            stateElements.set(newpath, stateCell);
            if (state.states) {
                let subTableCell = document.createElement('td');
                stateRow.appendChild(subTableCell);
                visualizeMachine(state, state.def_id, subTableCell, isActive && machine.currentid === stateId, newpath);
            }
        }
    }

    const bfsmController = $.get<Stateful>(bfsmControllerId).sc;
    for (let machineName in bfsmController.machines) {
        let machine = bfsmController.machines[machineName];
        let machineRow = document.createElement('tr');
        let machineCell = document.createElement('td');
        machineCell.textContent = machineName;
        machineRow.appendChild(machineCell);
        baseTable.appendChild(machineRow);
        if (bfsmController.current_machine_id === machineName) {
            machineCell.classList.add('active-machine-or-state');
        } else if (machine.parallel) {
            machineCell.classList.add('parallel-machine');
        }
        let subTableCell = document.createElement('td');
        machineRow.appendChild(subTableCell);
        visualizeMachine(machine, machineName, subTableCell, bfsmController.current_machine_id === machineName || machine.parallel, machineName);
    }

    return [container, machineElements, stateElements];
}

export function highlightCurrentState(stateElements: Map<string, HTMLElement>, machineElements: Map<string, HTMLElement>, bfsmControllerId: Identifier): void {
    const bfsmController = $.get<Stateful>(bfsmControllerId)?.sc;
    if (!bfsmController) {
        // If the bfsmController is not available, we cannot highlight the states.
        // This might happen if the associated game object has been destroyed or is not initialized yet (e.g. when rewinding the game state)
        return;
    }
    function updateMachineClasses(machine: State, machineName: string, isActive: boolean, path: string): void {
        let machineElement = machineElements.get(machineName);
        if (machineElement) {
            machineElement.classList.remove('active-machine-or-state', 'parallel-machine');
        }
        if (isActive) {
            machineElement?.classList.add('active-machine-or-state');
        } else if (machine.parallel) {
            machineElement?.classList.add('parallel-machine');
        }
        for (let state_id in machine.states) {
            const newpath = `${path}.${state_id}`;
            let stateElement = stateElements.get(newpath);
            if (stateElement) {
                stateElement.classList.remove('active-machine-or-state');
            }
            if (isActive && machine.currentid === state_id) {
                stateElement?.classList.add('active-machine-or-state');
            } else if (machine.states[state_id].parallel) {
                stateElement?.classList.add('parallel-machine');
            }
            let state = machine.states?.[state_id];
            updateMachineClasses(state, state.def_id, isActive && (machine.currentid === state_id || machine.states[state_id].parallel), newpath);
        }
    }
    for (let machineName in bfsmController.machines) {
        let machine = bfsmController.machines[machineName];
        updateMachineClasses(machine, machineName, true, machineName);
    }
}
