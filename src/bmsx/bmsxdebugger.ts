import { newArea } from './bmsx';
const DEBUG_ELEMENT_ID = 'debug_element_id';

let dragSrcEl: HTMLElement;
let shiftX: number;
let shiftY: number;

function handleMouseDown(e: MouseEvent) {
	shiftX = e.clientX - this.getBoundingClientRect().left;
	shiftY = e.clientY - this.getBoundingClientRect().top;
}

function handleDragStart(e: DragEvent) {
	// this.style.opacity = '0.4';

	dragSrcEl = this;

	e.dataTransfer.effectAllowed = 'move';
	e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e: DragEvent) {
	let me = this as HTMLElement;
	// this.style.opacity = '1';
	// me.style.transform = `translate3d(${e.clientX - e.offsetX}px, ${e.clientY - e.offsetY}px, 0)`;

	this.style.left = e.pageX - shiftX + 'px';
	this.style.top = e.pageY - shiftY + 'px';
}

function handleDrop(e: DragEvent) {
	e.stopPropagation();

	if (dragSrcEl !== this) {
		dragSrcEl.innerHTML = this.innerHTML;
		this.innerHTML = e.dataTransfer.getData('text/html');
	}

	return false;
}

export function debugtest1(e: MouseEvent): void {
	// let target = e.target as HTMLElement;
	// var rect = target.getBoundingClientRect();
	// var x = e.clientX - rect.left; //x position within the element.
	// var y = e.clientY - rect.top;  //y position within the element.
	let x = e.offsetX / global.view.scale;
	let y = e.offsetY / global.view.scale;

	let gameobject_at_cursor = global.model.objects.find(o => o.hitarea && o.collides(newArea(x, y, x, y)));

	if (gameobject_at_cursor) {
		const newDiv = document.createElement('div');
		newDiv.className = 'debugdialog';
		newDiv.id = DEBUG_ELEMENT_ID;
		newDiv.draggable = true;
		newDiv.onmousedown = handleMouseDown;
		newDiv.ondragstart = handleDragStart;
		newDiv.ondragend = handleDragEnd;
		newDiv.ondrop = handleDrop;
		newDiv.ondrop = (e) => {
			e.preventDefault();
			// newDiv.style.left = e.offsetX;
		};

		// and give it some content
		let keys = Object.keys(gameobject_at_cursor);
		let values = Object.values(gameobject_at_cursor);
		for (let i = 0; i < keys.length; i++) {
			newDiv.innerHTML += `[${i}] ${keys[i]}: ${String(values[i])}<br>`;
		}

		// add the newly created element and its content into the DOM
		const currentDiv = document.getElementById('div1');
		document.body.insertBefore(newDiv, currentDiv);
	}
	else {
		console.log(`Debugger - No object @${x}, ${y}.`);
	}
}

export function debugtest2(): void {
	let debugdiv = document.getElementById(DEBUG_ELEMENT_ID);
	debugdiv && document.body.removeChild(debugdiv);
}
