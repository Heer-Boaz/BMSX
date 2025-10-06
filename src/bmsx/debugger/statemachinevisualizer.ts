import { $ } from '../core/game';
import type { Stateful } from '../fsm/fsmtypes';
import { State } from '../fsm/state';
import type { Identifier } from '../rompack/rompack';
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

	const owner = $.get<Stateful>(bfsmControllerId);
	if (!owner) throw new Error(`[StateMachineVisualizer] Stateful owner '${bfsmControllerId}' not found.`);
	const bfsmController = owner.sc;
	if (!bfsmController) throw new Error(`[StateMachineVisualizer] Stateful owner '${bfsmControllerId}' has no state controller instance.`);

	function visualizeMachine(machine: State, machineName: string, parentElement: HTMLElement, isActive: boolean, path: string): void {
		let table = document.createElement('table');
		parentElement.appendChild(table);
		let machineNameRow = document.createElement('tr');
		let machineNameCell = document.createElement('td');
		machineNameCell.textContent = machineName;
		machineNameRow.appendChild(machineNameCell);
		table.appendChild(machineNameRow);
		machineElements.set(path, machineNameCell);

		if (!machine.states) throw new Error(`[StateMachineVisualizer] Machine '${machineName}' has no states map.`);
		for (let stateId in machine.states) {
			const state = machine.states[stateId];
			if (!state) throw new Error(`[StateMachineVisualizer] Machine '${machineName}' is missing state '${stateId}'.`);
			let stateRow = document.createElement('tr');
			let stateCell = document.createElement('td');
			if (!state.localdef_id) throw new Error(`[StateMachineVisualizer] State '${stateId}' has no local definition id.`);
			stateCell.textContent = state.localdef_id;
			stateCell.classList.add('state');
			stateRow.appendChild(stateCell);
			table.appendChild(stateRow);
			// The path to this state is the machineName:/stateId + '/' + substateId + '/' ...
			const newpath = `${path}/${stateId}`;
			stateCell.onclick = () => {
				bfsmController.transition_to(newpath);
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
				visualizeMachine(state, state.localdef_id, subTableCell, isActive && machine.currentid === stateId, newpath);
			}
		}
	}

	for (let machineName in bfsmController.machines) {
		let machine = bfsmController.machines[machineName];
		if (!machine) throw new Error(`[StateMachineVisualizer] Controller '${bfsmControllerId}' lists missing machine '${machineName}'.`);
		let machineRow = document.createElement('tr');
		let machineCell = document.createElement('td');
		machineCell.textContent = machineName;
		machineRow.appendChild(machineCell);
		baseTable.appendChild(machineRow);
		// if (bfsmController.current_machine_id === machineName) {
		// 	machineCell.classList.add('active-machine-or-state');
		// } else if (machine.is_concurrent) {
			machineCell.classList.add('parallel-machine');
		// }
		let subTableCell = document.createElement('td');
		machineRow.appendChild(subTableCell);
		// visualizeMachine(machine, machineName, subTableCell, bfsmController.current_machine_id === machineName || machine.is_concurrent, machineName + ':');
		visualizeMachine(machine, machineName, subTableCell, true, machineName + ':');
	}

	return [container, machineElements, stateElements];
}

export function highlightCurrentState(stateElements: Map<string, HTMLElement>, machineElements: Map<string, HTMLElement>, bfsmControllerId: Identifier): void {
	const owner = $.get<Stateful>(bfsmControllerId);
	if (!owner) throw new Error(`[StateMachineVisualizer] Stateful owner '${bfsmControllerId}' not found while highlighting current state.`);
	const bfsmController = owner.sc;
	if (!bfsmController) throw new Error(`[StateMachineVisualizer] Stateful owner '${bfsmControllerId}' lost its state controller.`);
	function updateMachineClasses(machine: State, machineName: string, isActive: boolean, path: string): void {
		const states = machine.states ?? {};
		const hasChildMachines = Object.keys(states).length > 0;
		const machineElement = machineElements.get(path);
		if (hasChildMachines && !machineElement) {
			throw new Error(`[StateMachineVisualizer] Machine element for path '${path}' is missing.`);
		}
		if (machineElement) {
			machineElement.classList.remove('active-machine-or-state', 'parallel-machine');
			if (isActive) {
				machineElement.classList.add('active-machine-or-state');
			} else if (machine.is_concurrent) {
				machineElement.classList.add('parallel-machine');
			}
		}
		for (let state_id in states) {
			// The path to this state is the machineName:/stateId + '/' + substateId + '/' ...
			const newpath = `${path}/${state_id}`;
			let stateElement = stateElements.get(newpath);
			if (!stateElement) throw new Error(`[StateMachineVisualizer] State element for path '${newpath}' is missing.`);
			stateElement.classList.remove('active-machine-or-state');
			const currentState = states[state_id];
			if (!currentState) throw new Error(`[StateMachineVisualizer] Machine '${machineName}' is missing state '${state_id}'.`);
			if (isActive && machine.currentid === state_id) {
				stateElement.classList.add('active-machine-or-state');
			} else if (currentState.is_concurrent) {
				stateElement.classList.add('parallel-machine');
			}
			const childStates = currentState.states ?? {};
			if (Object.keys(childStates).length > 0) {
				updateMachineClasses(currentState, currentState.localdef_id, isActive && (machine.currentid === state_id || currentState.is_concurrent), newpath);
			}
		}
	}
	for (let machineName in bfsmController.machines) {
		let machine = bfsmController.machines[machineName];
		if (!machine) throw new Error(`[StateMachineVisualizer] Controller '${bfsmControllerId}' lost machine '${machineName}'.`);
		updateMachineClasses(machine, machineName, true, machineName + ':');
	}
}
