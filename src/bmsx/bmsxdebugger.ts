import { newArea } from './bmsx';
const DEBUG_ELEMENT_ID = 'debug_element_id';

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
