// BehaviourTreeVisualizer extracted from bmsxdebugger.ts
import { BTNode } from '../ai/behaviourtree';
import { Component, componenttags_postprocessing, type ComponentAttachOptions } from '../component/basecomponent';
import { $ } from '../core/game';
import type { Identifier } from '../rompack/rompack';
import { excludeclassfromsavegame } from '../serializer/serializationhooks';
import { FloatingDialog } from './bmsxdebugger';

@componenttags_postprocessing('render')
@excludeclassfromsavegame
export class BTVisualizer extends Component {
	static override get unique() { return true; }
	static { this.autoRegister(); }
	private dialog: FloatingDialog;
	private machineElements: Map<string, HTMLElement>;

	constructor(opts: ComponentAttachOptions) {
		super(opts);
		this.enabled = false;
	}

	override postprocessingUpdate(): void {
		this.openDialog();
		[, this.machineElements] = visualizeBehaviorTree(this.dialog.getContentElement(), this.parent.id);
	}

	public closeDialog(): void {
		this.dialog.close();
		this.dialog = null;
		this.machineElements = null;
	}

	public openDialog(): void {
		if (!this.dialog) {
			this.dialog = new FloatingDialog(`BT: [${this.parent.id}]`);
		}
		if (!this.machineElements) {
			[, this.machineElements] = visualizeBehaviorTree(this.dialog.getContentElement(), this.parent.id);
			this.dialog.updateSize();
		}
	}
}

export function visualizeBehaviorTree(container: HTMLElement, btControllerId: Identifier): [HTMLElement, Map<string, HTMLElement>] {
	let baseTable = document.createElement('table');
	container.appendChild(baseTable);
	let nodeElements = new Map<string, HTMLElement>();

	function visualizeNode(_node: BTNode, _nodeName: string, _parentElement: HTMLElement, _path: string): void {
		// const btController = $.get<WorldObject>(btControllerId);
		// let table = document.createElement('table');
		// parentElement.appendChild(table);
		// let nodeNameRow = document.createElement('tr');
		// let nodeNameCell = document.createElement('td');
		// nodeNameCell.textContent = nodeName;
		// nodeNameRow.appendChild(nodeNameCell);
		// table.appendChild(nodeNameRow);
		// nodeElements.set(path, nodeNameCell);
		// let nodeInPath = btController.blackboards[node.id]?.executionPath?.find((n: any) => n.node.id === node.id);
		// let nodeResultRow = document.createElement('tr');
		// let nodeResultCell = document.createElement('td');
		// nodeResultCell.textContent = 'Result: ' + (nodeInPath ? nodeInPath.result : 'Not executed');
		// nodeResultCell.classList.add('result');
		// nodeResultRow.appendChild(nodeResultCell);
		// table.appendChild(nodeResultRow);
		// let any_node = node;
		// if (any_node.child) {
		//     let childNode = any_node.child;
		//     let childNodeRow = document.createElement('tr');
		//     let childNodeCell = document.createElement('td');
		//     childNodeCell.textContent = childNode.name;
		//     childNodeCell.classList.add('node');
		//     childNodeRow.appendChild(childNodeCell);
		//     table.appendChild(childNodeRow);
		//     const newPath = `${path}.child`;
		//     visualizeNode(childNode, childNode.name, childNodeCell, newPath);
		// }
		// if (any_node.children) {
		//     for (let i = 0; i < any_node.children.length; i++) {
		//         let childNode = any_node.children[i];
		//         let childNodeRow = document.createElement('tr');
		//         let childNodeCell = document.createElement('td');
		//         childNodeCell.textContent = childNode.name;
		//         childNodeCell.classList.add('node');
		//         childNodeRow.appendChild(childNodeCell);
		//         table.appendChild(childNodeRow);
		//         const newPath = `${path}.${i}`;
		//         visualizeNode(childNode, childNode.name, childNodeCell, newPath);
		//     }
		// }
	}

	const btController = $.get(btControllerId) as any;
	for (let treeName in btController.btreecontexts) {
		let tree = btController.btreecontexts[treeName].root;
		let treeRow = document.createElement('tr');
		let subTableCell = document.createElement('td');
		treeRow.appendChild(subTableCell);
		baseTable.appendChild(treeRow);
		visualizeNode(tree, treeName, subTableCell, treeName);
	}

	return [container, nodeElements];
}
