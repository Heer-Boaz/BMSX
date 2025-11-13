export function svgToPng(svgElement, filename) {
	svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	var svgData = new XMLSerializer().serializeToString(svgElement);

	var canvas = document.createElement('canvas');
	canvas.width = 100;
	canvas.height = 100;
	var ctx = canvas.getContext('2d');

	var img = document.createElement('img');

	var svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
	var svgUrl = URL.createObjectURL(svgBlob);

	img.onload = function () {
		ctx.drawImage(img, 0, 0);
		URL.revokeObjectURL(svgUrl);

		var imgsrc = canvas.toDataURL('image/png');

		// Create a link element
		var link = document.createElement('a');

		// Set the href of the link to the data URL and the download attribute to the desired file name
		link.href = imgsrc;
		link.download = filename;

		// Append the link to the body
		document.body.appendChild(link);

		// Programmatically click the link to start the download
		link.click();

		// Remove the link from the body
		document.body.removeChild(link);
	};

	img.src = svgUrl;
}
