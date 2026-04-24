// Limits of how many things we can have
var MAX_DEVICES = 1024;
var MAX_WIRES = MAX_DEVICES * 2;
var GRID_SIZE = 1024;
var UNDO_DEPTH = 1024;
var MAX_GRID_DOTS = 2048;

// Device kinds are represented by integers
var DEVICE_KIND_NONE = -1;
var DEVICE_KIND_SWITCH = 0;
var DEVICE_KIND_LIGHT = 1;
var DEVICE_KIND_EXTENSION = 2;
var DEVICE_KIND_NOT_GATE = 3;
var DEVICE_KIND_OR_GATE = 4;
var DEVICE_KIND_AND_GATE = 5;

// Constants different for each device kind
var DEVICE_INPUT_COUNT = [0, 1, 1, 1, 2, 2];
var DEVICE_OUTPUT_COUNT = [1, 0, 1, 1, 1, 1];

// Visual constants
var GRID_CELL_SIZE = 36;
var GRID_DOT_RADIUS = 2;
var DEVICE_BORDER_WIDTH = 2;
var NODE_RADIUS = 5;
var NODE_BORDER_WIDTH = 2;
var WIRE_OUTER_WIDTH = 7;
var WIRE_INNER_WIDTH = 3;
var WIRE_NODE_INNER_RADIUS = 5;
var WIRE_NODE_OUTER_RADIUS = 7;
var COLOR_OFF = "black";
var COLOR_ON = "lightyellow";
var SWITCH_TOGGLE_WIDTH = 34;
var SWITCH_TOGGLE_HEIGHT = 20; // also used for light

var GATE_LABELS = [null, null, null, "nie", "alebo", "a"];

var canvasWidth = 600;
var canvasHeight = 600;

var GAME_STORAGE_KEY = "gameData";

// Used for initialization
function fillArray(array, value) {
	for (var i = 0; i < array.length; ++i) array[i] = value;
}

function makeFilledArray(length, value) {
	var array = Array(length);
	fillArray(array, value);
	return array;
}

function createDefaultGameState() {
	return {
		devicePositions: makeFilledArray(MAX_DEVICES, -1),
		deviceKinds: makeFilledArray(MAX_DEVICES, DEVICE_KIND_NONE),
		nodeValues: makeFilledArray(3 * MAX_DEVICES, false),
		wires: makeFilledArray(2 * MAX_WIRES, -1),
		wireStack: makeFilledArray(MAX_WIRES, -1),
		wireCount: 0,
		viewOffsetX: 0,
		viewOffsetY: 0,
		viewScale: 1,
		builtinCount: 0
	};
}

function countUsedWiresFromStack(stack) {
	var count = 0;
	for (var i = 0; i < stack.length; ++i) {
		if (stack[i] === -1) break;
		++count;
	}
	return count;
}

function normalizeLoadedGameState(rawGameState) {
	var defaults = createDefaultGameState();
	if (!rawGameState || typeof rawGameState !== "object") return defaults;

	defaults.devicePositions = Array.isArray(rawGameState.devicePositions)
		? rawGameState.devicePositions.slice(0, MAX_DEVICES)
		: defaults.devicePositions;
	while (defaults.devicePositions.length < MAX_DEVICES) defaults.devicePositions.push(-1);

	defaults.deviceKinds = Array.isArray(rawGameState.deviceKinds)
		? rawGameState.deviceKinds.slice(0, MAX_DEVICES)
		: defaults.deviceKinds;
	while (defaults.deviceKinds.length < MAX_DEVICES) defaults.deviceKinds.push(DEVICE_KIND_NONE);

	defaults.nodeValues = Array.isArray(rawGameState.nodeValues)
		? rawGameState.nodeValues.slice(0, 3 * MAX_DEVICES)
		: defaults.nodeValues;
	while (defaults.nodeValues.length < 3 * MAX_DEVICES) defaults.nodeValues.push(false);

	defaults.wires = Array.isArray(rawGameState.wires)
		? rawGameState.wires.slice(0, 2 * MAX_WIRES)
		: defaults.wires;
	while (defaults.wires.length < 2 * MAX_WIRES) defaults.wires.push(-1);

	defaults.wireStack = Array.isArray(rawGameState.wireStack)
		? rawGameState.wireStack.slice(0, MAX_WIRES)
		: defaults.wireStack;
	while (defaults.wireStack.length < MAX_WIRES) defaults.wireStack.push(-1);

	defaults.wireCount = typeof rawGameState.wireCount === "number"
		? clamp(0, Math.floor(rawGameState.wireCount), MAX_WIRES)
		: countUsedWiresFromStack(defaults.wireStack);
	defaults.viewOffsetX = typeof rawGameState.viewOffsetX === "number" ? rawGameState.viewOffsetX : defaults.viewOffsetX;
	defaults.viewOffsetY = typeof rawGameState.viewOffsetY === "number" ? rawGameState.viewOffsetY : defaults.viewOffsetY;
	defaults.viewScale = typeof rawGameState.viewScale === "number" ? rawGameState.viewScale : defaults.viewScale;
	defaults.builtinCount = typeof rawGameState.builtinCount === "number"
		? clamp(0, Math.floor(rawGameState.builtinCount), MAX_DEVICES)
		: defaults.builtinCount;

	return defaults;
}

var gameState = createDefaultGameState();

function saveGameStateToStorage() {
	localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(gameState));
}

// Arrays of things

// Description of arrays in undo history
var ARRAYS_ALL = [];
var ARRAY_DEVICE_POSITIONS = 0;
var ARRAY_DEVICE_KINDS = 1;
var ARRAY_WIRES = 2;

// Undo history
var undoWhichArray = Array(UNDO_DEPTH); fillArray(undoWhichArray, -1);
var undoValueBefore = Array(UNDO_DEPTH); fillArray(undoValueBefore, -1);
var undoValueAfter = Array(UNDO_DEPTH); fillArray(undoValueAfter, -1);
var undoBatchStart = Array(UNDO_DEPTH); fillArray(undoBatchStart, -1);

// Positions within arrays
var undoStackTop = -1;
var undoCurrentDepth = 0;

// Interface with the page
var canvas = document.getElementById("canvas");
var drawingContext = canvas.getContext("2d");
var buttonAddWire = document.getElementById("add-wire");
var buttonDelete = document.getElementById("delete-selected");
var selectAddDevice = document.getElementById("add-device");
var buttonStartEditing = document.getElementById("start-editing");
var buttonFinishEditing = document.getElementById("finish-editing");
var toolbarView = document.getElementById("toolbar-view");
var toolbarEditing = document.getElementById("toolbar-editing");
var saveButton = document.getElementById("save");
var simulationTimerHandle = null;

// Current selection and action
var editing = true;
var selectedWire = -1;
var selectedDevice = -1;
var draggedWireEnd = -1;
var draggedWireTargetNode = -1;
var draggedDevice = -1;
var draggedDeviceTargetPosition = -1;

// Adding state
var addingDevice = -1;
var addingWire = false;

// When dragging, the original view state before the drag
var draggingView = false;
var viewAnchorX = 0;
var viewAnchorY = 0;
var viewAnchorScale = 1;

// General for any kind of dragging
var dragCurrentX = 0;
var dragCurrentY = 0;
var dragOriginX = 0;
var dragOriginY = 0;
var dragPointerId = -2;

// Current view

var simulationTimeout = 30;

var pendingRedraw = false;

function simulateStep() {
	for (var i = 0; i < MAX_DEVICES; ++i) {
		switch (gameState.deviceKinds[i]) {
			case DEVICE_KIND_EXTENSION:
				gameState.nodeValues[3 * i + 2] = gameState.nodeValues[3 * i];
			break;
			case DEVICE_KIND_NOT_GATE:
				gameState.nodeValues[3 * i + 2] = !gameState.nodeValues[3 * i];
			break;
			case DEVICE_KIND_OR_GATE:
				gameState.nodeValues[3 * i + 2] = gameState.nodeValues[3 * i] || gameState.nodeValues[3 * i + 1];
			break;
			case DEVICE_KIND_AND_GATE:
				gameState.nodeValues[3 * i + 2] = gameState.nodeValues[3 * i] && gameState.nodeValues[3 * i + 1];
			break;
		}
	}
	for (var i = 0; i < MAX_WIRES; ++i) {
		if (gameState.wires[2 * i] === -1 || gameState.wires[2 * i + 1] === -1) continue;
		gameState.nodeValues[gameState.wires[2 * i + 1]] = gameState.nodeValues[gameState.wires[2 * i]];
	}
}

// Tests a circuit that's supposed to be a pure function of its inputs
function test(inputCount, timeLimit, testingFunction) {
	for (var input = 0; input < 1 << inputCount; ++input) {
		fillArray(gameState.nodeValues, false);
		for (var i = 0; i < inputCount; ++i) {
			gameState.nodeValues[3 * i + 2] = (input & (1 << i)) > 0;
		}
		for (var i = 0; i < timeLimit; ++i) simulateStep();
		output = 0;
		for (var i = 0; i < gameState.builtinCount - inputCount; ++i) {
			output |= (gameState.nodeValues[3 * (inputCount + i)] ? 1 : 0) << i;
		}
		if (output !== testingFunction(input)) {
			console.log("input", input, "expected", testingFunction(input), "got", output);
			return false;
		}
	}
	return true;
}

// Begins a new path with the specified rounded rectangle
function drawRoundedRect(x, y, width, height, radius) {
	drawingContext.beginPath();
	drawingContext.moveTo(x + radius, y);
	drawingContext.arcTo(x + width, y, x + width, y + radius, radius);
	drawingContext.arcTo(x + width, y + height, x + width - radius, y + height, radius);
	drawingContext.arcTo(x, y + height, x, y + height - radius, radius);
	drawingContext.arcTo(x, y, x + radius, y, radius);
}

function drawCircle(x, y, radius) {
	drawRoundedRect(x - radius, y - radius, 2 * radius, 2 * radius, radius);
}

function drawWirePath(x0, y0, x1, y1) {
	drawingContext.beginPath();
	drawingContext.moveTo(x0, y0);
	drawingContext.bezierCurveTo(0.625 * x0 + 0.375 * x1, y0, 0.375 * x0 + 0.625 * x1, y1, x1, y1);
	drawingContext.stroke();
}

function gridToScreenX(gridPosition) {
	return (gridPosition % GRID_SIZE) * GRID_CELL_SIZE;
}

function gridToScreenY(gridPosition) {
	return Math.floor(gridPosition / GRID_SIZE) * GRID_CELL_SIZE;
}

function clamp(lower, value, upper) {
	if (value < lower) return lower;
	if (value > upper) return upper;
	return value;
}

function screenToGridPosition(screenX, screenY) {
	var gridX = clamp(0, Math.floor((screenX + gameState.viewOffsetX) / gameState.viewScale / GRID_CELL_SIZE + 0.5), GRID_SIZE - 1);
	var gridY = clamp(0, Math.floor((screenY + gameState.viewOffsetY) / gameState.viewScale / GRID_CELL_SIZE + 0.5), GRID_SIZE - 1);
	return GRID_SIZE * gridY + gridX;
}

function gridPositionFromMiddle(dx, dy) {
	var half = GRID_SIZE / 2;
	return GRID_SIZE * (half + dy) + half + dx;
}

function screenToGridPositionUntransformed(screenX, screenY) {
	var gridX = clamp(0, Math.floor(screenX / GRID_CELL_SIZE + 0.5), GRID_SIZE - 1);
	var gridY = clamp(0, Math.floor(screenY / GRID_CELL_SIZE + 0.5), GRID_SIZE - 1);
	return GRID_SIZE * gridY + gridX;
}

function doesNodeExist(node) {
	var deviceKind = gameState.deviceKinds[Math.floor(node / 3)];
	if (deviceKind === DEVICE_KIND_NONE) return false;
	var nodeOffset = node % 3;
	if (
		nodeOffset >= DEVICE_INPUT_COUNT[deviceKind] && nodeOffset < 2 ||
		nodeOffset - 2 >= DEVICE_OUTPUT_COUNT[deviceKind] && nodeOffset >= 2
	) return false;
	return true;
}

function getNodePosition(node) {
	var device = Math.floor(node / 3);
	if (node % 3 === 2) {
		var kind = gameState.deviceKinds[device];
		return gameState.devicePositions[device] + GRID_SIZE * DEVICE_INPUT_COUNT[kind] + 1;
	}
	return gameState.devicePositions[device] + GRID_SIZE * (node % 3);
}

function drawDevice(index, dx, dy, isSelected) {
	var kind = gameState.deviceKinds[index];
	var width = 2;
	var height = DEVICE_INPUT_COUNT[kind] + DEVICE_OUTPUT_COUNT[kind];

	var position = gameState.devicePositions[index];
	var screenX = gridToScreenX(position) + dx;
	var screenY = gridToScreenY(position) + dy;

	drawingContext.fillStyle = "lightgray";
	drawingContext.strokeStyle = isSelected ? "black" : "darkgray";
	drawingContext.lineWidth = DEVICE_BORDER_WIDTH;
	drawRoundedRect(
		screenX - GRID_CELL_SIZE / 2,
		screenY - GRID_CELL_SIZE / 2,
		width * GRID_CELL_SIZE, height * GRID_CELL_SIZE,
		GRID_CELL_SIZE / 2
	);
	drawingContext.fill();
	drawingContext.stroke();

	// For builtin devices, draw their labels
	if (index < gameState.builtinCount) {
		drawingContext.textAlign = "center";
		drawingContext.textBaseline = "bottom";
		drawingContext.font = "14px system-ui";
		drawingContext.fillStyle = "black";
		drawingContext.fillText(
			builtinLabels[index], screenX + GRID_CELL_SIZE / 2,
			screenY - GRID_CELL_SIZE / 2 - 5
		);
	}

	switch (kind) {
		case DEVICE_KIND_SWITCH:
			drawingContext.fillStyle = gameState.nodeValues[3 * index + 2] ? COLOR_ON : COLOR_OFF;
			drawingContext.strokeStyle = "gray";
			drawRoundedRect(
				screenX - SWITCH_TOGGLE_HEIGHT / 2, screenY - SWITCH_TOGGLE_HEIGHT / 2,
				SWITCH_TOGGLE_WIDTH, SWITCH_TOGGLE_HEIGHT, SWITCH_TOGGLE_HEIGHT / 2
			);
			drawingContext.fill();
			drawingContext.stroke();
			drawingContext.fillStyle = "white";
			drawRoundedRect(
				screenX - SWITCH_TOGGLE_HEIGHT / 2 + (SWITCH_TOGGLE_WIDTH - SWITCH_TOGGLE_HEIGHT) * gameState.nodeValues[3 * index + 2],
				screenY - SWITCH_TOGGLE_HEIGHT / 2,
				SWITCH_TOGGLE_HEIGHT, SWITCH_TOGGLE_HEIGHT, SWITCH_TOGGLE_HEIGHT / 2
			);
			drawingContext.fill();
			drawingContext.stroke();
		break;
		case DEVICE_KIND_LIGHT:
			drawingContext.fillStyle = gameState.nodeValues[3 * index] ? COLOR_ON : COLOR_OFF;
			drawingContext.strokeStyle = "gray";
			drawRoundedRect(
				screenX - SWITCH_TOGGLE_HEIGHT / 2 + GRID_CELL_SIZE, screenY - SWITCH_TOGGLE_HEIGHT / 2,
				SWITCH_TOGGLE_HEIGHT, SWITCH_TOGGLE_HEIGHT, SWITCH_TOGGLE_HEIGHT / 2
			);
			drawingContext.fill();
			drawingContext.stroke();
		break;
		case DEVICE_KIND_NOT_GATE: case DEVICE_KIND_OR_GATE: case DEVICE_KIND_AND_GATE:
			drawingContext.textAlign = "left";
			drawingContext.textBaseline = "alphabetic";
			drawingContext.font = "14px system-ui";
			drawingContext.fillStyle = "black";
			drawingContext.fillText(GATE_LABELS[kind], screenX - 10, screenY + (height - 1) * GRID_CELL_SIZE + 7);
		break;
	}

	// Nodes
	drawingContext.strokeStyle = "gray";
	drawingContext.lineWidth = NODE_BORDER_WIDTH;
	for (var j = 0; j < DEVICE_INPUT_COUNT[kind]; ++j) {
		drawCircle(screenX, screenY + j * GRID_CELL_SIZE, NODE_RADIUS);
		drawingContext.fillStyle = gameState.nodeValues[3 * index + j] ? COLOR_ON : COLOR_OFF;
		drawingContext.fill();
		drawingContext.stroke();
	}
	for (var j = 0; j < DEVICE_OUTPUT_COUNT[kind]; ++j) {
		drawCircle(
			screenX + (width - 1) * GRID_CELL_SIZE,
			screenY + (height - j - 1) * GRID_CELL_SIZE, NODE_RADIUS
		);
		drawingContext.fillStyle = gameState.nodeValues[3 * index + 2 + j] ? COLOR_ON : COLOR_OFF;
		drawingContext.fill();
		drawingContext.stroke();
	}
}

function drawWirePart(x0, y0, x1, y1, color, width, radius) {
	drawingContext.strokeStyle = color;
	drawingContext.fillStyle = color;
	drawingContext.lineWidth = width;
	drawWirePath(x0, y0, x1, y1);
	drawingContext.stroke();
	drawCircle(x0, y0, radius);
	drawingContext.fill();
	drawCircle(x1, y1, radius);
	drawingContext.fill();
}

function drawWire(index, dx0, dy0, dx1, dy1, isSelected) {
	var startNode = gameState.wires[2 * index];
	var endNode = gameState.wires[2 * index + 1];

	var startPosition = getNodePosition(startNode);
	var endPosition = getNodePosition(endNode);

	var x0 = gridToScreenX(startPosition) + dx0;
	var y0 = gridToScreenY(startPosition) + dy0;
	var x1 = gridToScreenX(endPosition) + dx1;
	var y1 = gridToScreenY(endPosition) + dy1;

	drawWirePart(
		x0, y0, x1, y1, "red", WIRE_OUTER_WIDTH + 3 * isSelected,
		WIRE_NODE_OUTER_RADIUS + isSelected
	);
	drawWirePart(
		x0, y0, x1, y1, gameState.nodeValues[startNode] ? COLOR_ON : COLOR_OFF,
		WIRE_INNER_WIDTH, WIRE_NODE_INNER_RADIUS
	)
}

// Redraw the entire view
function draw() {
	pendingRedraw = false;

	// Clear the screen
	drawingContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
	drawingContext.clearRect(0, 0, canvasWidth, canvasHeight);

	// Draw the grid
	var scaledCellSize = GRID_CELL_SIZE * gameState.viewScale;
	var gridDotCount = canvasWidth / scaledCellSize * canvasHeight / scaledCellSize;
	if (gridDotCount <= MAX_GRID_DOTS) {
		drawingContext.fillStyle = "lightgray";
		for (var gridDotY = (-gameState.viewOffsetY % scaledCellSize) - scaledCellSize; gridDotY < canvasHeight + scaledCellSize; gridDotY += scaledCellSize) {
			for (var gridDotX = (-gameState.viewOffsetX % scaledCellSize) - scaledCellSize; gridDotX < canvasWidth + scaledCellSize; gridDotX += scaledCellSize) {
				drawCircle(gridDotX, gridDotY, GRID_DOT_RADIUS * gameState.viewScale);
				drawingContext.fill();
			}
		}
	}

	drawingContext.setTransform(
		gameState.viewScale * devicePixelRatio, 0, 0, gameState.viewScale * devicePixelRatio,
		-gameState.viewOffsetX * devicePixelRatio, -gameState.viewOffsetY * devicePixelRatio
	);

	// Draw devices
	for (var i = 0; i < MAX_DEVICES; ++i) {
		if (i === draggedDevice) continue;
		if (gameState.deviceKinds[i] == DEVICE_KIND_NONE) continue;
		drawDevice(i, 0, 0, selectedDevice === i);
	}

	// If dragging a device, draw its shadow at its target position
	if (draggedDevice !== -1) {
		var draggedKind = gameState.deviceKinds[draggedDevice];
		var draggedWidth = 2;
		var draggedHeight = DEVICE_INPUT_COUNT[draggedKind] + DEVICE_OUTPUT_COUNT[draggedKind];

		var screenX = gridToScreenX(draggedDeviceTargetPosition);
		var screenY = gridToScreenY(draggedDeviceTargetPosition);

		drawingContext.fillStyle = "#0002";
		drawRoundedRect(
			screenX - GRID_CELL_SIZE / 2,
			screenY - GRID_CELL_SIZE / 2,
			draggedWidth * GRID_CELL_SIZE, draggedHeight * GRID_CELL_SIZE,
			GRID_CELL_SIZE / 2
		);
		drawingContext.fill();
	}

	// Draw gameState.wires
	for (var i = 0; i < gameState.wireCount; ++i) {
		var wire = gameState.wireStack[i];
		if (wire === Math.floor(draggedWireEnd / 2)) continue;

		var wireStartDevice = Math.floor(gameState.wires[2 * wire] / 3);
		var wireEndDevice = Math.floor(gameState.wires[2 * wire + 1] / 3);

		if (wireStartDevice === draggedDevice || wireEndDevice === draggedDevice) continue;
		drawWire(wire, 0, 0, 0, 0, selectedWire === wire);
	}

	// Draw the dragged device
	if (draggedDevice !== -1) {
		drawDevice(draggedDevice, dragCurrentX - dragOriginX, dragCurrentY - dragOriginY, true);

		// Draw gameState.wires connected to it
		for (var i = 0; i < gameState.wireCount; ++i) {
			var wire = gameState.wireStack[i];

			var dx0 = 0, dy0 = 0, dx1 = 0, dy1 = 0;
			var wireStartDevice = Math.floor(gameState.wires[2 * wire] / 3);
			var wireEndDevice = Math.floor(gameState.wires[2 * wire + 1] / 3);
			if (wireStartDevice !== draggedDevice && wireEndDevice !== draggedDevice) continue;
			if (wireStartDevice === draggedDevice) {
				dx0 = dragCurrentX - dragOriginX;
				dy0 = dragCurrentY - dragOriginY;
			}
			if (wireEndDevice === draggedDevice) {
				dx1 = dragCurrentX - dragOriginX;
				dy1 = dragCurrentY - dragOriginY;
			}

			drawWire(wire, dx0, dy0, dx1, dy1, 0);
		}
	}

	// Draw the dragged wire
	if (draggedWireEnd !== -1) {
		var draggedWire = Math.floor(draggedWireEnd / 2);
		var isWireEnd = draggedWireEnd % 2; // 0 if start, 1 if end
		var dx = dragCurrentX - dragOriginX;
		var dy = dragCurrentY - dragOriginY;
		drawWire(
			draggedWire,
			(1 - isWireEnd) * dx, (1 - isWireEnd) * dy,
			isWireEnd * dx, isWireEnd * dy, true
		);
	}
}

function requestRedraw() {
	if (pendingRedraw) return;
	pendingRedraw = true;
	//DEBUG_MEASURE_TIME("drawing", function() {
	requestAnimationFrame(draw);
	//});
}

function updateCanvasSize() {
	var canvasClientRect = canvas.getBoundingClientRect();
	canvasWidth = canvasClientRect.width;
	canvasHeight = canvasClientRect.height;
	canvas.setAttribute("width", canvasWidth * devicePixelRatio);
	canvas.setAttribute("height", canvasHeight * devicePixelRatio);
}

function DEBUG_MEASURE_TIME(description, callback) {
	var start = Date.now();
	callback();
	var duration = Date.now() - start;
	console.log(description, "took", duration, "ms");
}

// TODO: make it so that view is anchored to the center of the canvas
function resetView() {
	gameState.viewScale = 1;
	gameState.viewOffsetX = (GRID_CELL_SIZE * GRID_SIZE - canvasWidth) / 2;
	gameState.viewOffsetY = (GRID_CELL_SIZE * GRID_SIZE - canvasHeight) / 2;
}

window.addEventListener("resize", function() {
	updateCanvasSize();
	requestRedraw();
});

window.addEventListener("load",function() {
	if (localStorage.getItem(GAME_STORAGE_KEY) !== null){
		loadFromString(localStorage.getItem(GAME_STORAGE_KEY))
	}
})

// If pointer events are supported, we use only those
if (PointerEvent) {
	canvas.addEventListener("pointerdown", function(event) {
		var selectedPosition = screenToGridPosition(event.offsetX, event.offsetY);
		if (dragPointerId !== -2) return;
		dragPointerId = event.pointerId;
		canvas.setPointerCapture(event.pointerId);
		if (addingDevice !== -1) {
			// Find a free slot in the array to put it
			for (var i = 0; i < MAX_DEVICES; ++i) {
				if (gameState.deviceKinds[i] === DEVICE_KIND_NONE) {
					// TODO: find a place that doesn't intersect
					gameState.deviceKinds[i] = addingDevice;
					gameState.devicePositions[i] = selectedPosition;
					// addingDevice = -1;
					// selectAddDevice.value = "-1";
					requestRedraw();
					return;
				}
			}
			// TODO: unable to add new device
			return;
		}

		if (addingWire) {
			// Find a free slot in the array to put it
			if (gameState.wireCount === MAX_WIRES) {
				addingWire = false;
				buttonAddWire.disabled = false;
				return;
			}; // TODO: error message
			// Find the node at the selected position
			for (var i = 0; i < 3 * MAX_DEVICES; ++i) {
				if (!doesNodeExist(i)) continue;
				if (getNodePosition(i) !== selectedPosition) continue;
				// If it's an input, check if there already isn't a wire connected
				if (i % 3 < 2) {
					for (var j = 0; j < MAX_WIRES; ++j) {
						if (gameState.wires[j] === i) {
							// addingWire = false;
							buttonAddWire.disabled = false;
							return;
						}
					}
				}
				var isOutputNode = i % 3 < 2 ? 0 : 1;
				// Find a place in the array to put it
				for (var j = 0; j < MAX_WIRES; ++j) {
					if (gameState.wires[2 * j] === -1) {
						gameState.wires[2 * j] = i;
						gameState.wires[2 * j + 1] = i;
						gameState.wireStack[gameState.wireCount] = j;
						gameState.wireCount = gameState.wireCount + 1;
						draggedWireEnd = 2 * j + isOutputNode;
						dragOriginX = event.offsetX;
						dragOriginY = event.offsetY;
						dragCurrentX = dragOriginX;
						dragCurrentY = dragOriginY;
						selectedWire = j;
						buttonDelete.disabled = false;
						// addingWire = false;
						buttonAddWire.disabled = false;
						requestRedraw();
						return;
					}
				}
			}
			// There is no node at that position
			buttonAddWire.disabled = false;
			addingWire = false;
			return;
		}

		if (draggedDevice !== -1 || draggedWireEnd !== -1) return;
		if (draggingView) return; // TODO: handle a second pointer for zooming
		dragOriginX = event.offsetX;
		dragOriginY = event.offsetY;
		dragCurrentX = dragOriginX;
		dragCurrentY = dragOriginY;

		// If not editing, we check if we're tapping a light switch
		if (!editing) {
			for (var i = 0; i < MAX_DEVICES; ++i) {
				if (gameState.deviceKinds[i] === DEVICE_KIND_SWITCH && gameState.devicePositions[i] === selectedPosition) {
					gameState.nodeValues[3 * i + 2] = !gameState.nodeValues[3 * i + 2];
				}
			}
		}

		// If editing, we figure out what we are grabbing:

		if (editing) {

			// First we try wire
			// We go down the stack, so we first catch the topmost wire
			for (var i = gameState.wireCount - 1; i >= 0; --i) {
				var wire = gameState.wireStack[i];
				for (var j = 0; j < 2; ++j) {
					var wireNode = gameState.wires[2 * wire + j];
					if (getNodePosition(wireNode) === selectedPosition) {
						draggedWireEnd = 2 * wire + j;
						selectedWire = wire;
						selectedDevice = -1;
						buttonDelete.disabled = false;
						// now we put it on top of the stack
						for (var k = i + 1; k < gameState.wireCount; ++k) {
							gameState.wireStack[k - 1] = gameState.wireStack[k];
						}
						gameState.wireStack[gameState.wireCount - 1] = wire;
						requestRedraw();
						return;
					}
				}
			}

			// If no wire found, then we try device
			for (var i = 0; i < MAX_DEVICES; ++i) {
				var deviceKind = gameState.deviceKinds[i];
				if (deviceKind === -1) continue;

				var selectedX = selectedPosition % GRID_SIZE;
				var selectedY = Math.floor(selectedPosition / GRID_SIZE);
				var deviceX = gameState.devicePositions[i] % GRID_SIZE;
				var deviceY = Math.floor(gameState.devicePositions[i] / GRID_SIZE);
				var deviceHeight = DEVICE_INPUT_COUNT[deviceKind] + DEVICE_OUTPUT_COUNT[deviceKind];

				if (
					deviceX <= selectedX && selectedX <= deviceX + 1 &&
					deviceY <= selectedY && selectedY < deviceY + deviceHeight
				) {
					draggedDevice = i;
					draggedDeviceTargetPosition = gameState.devicePositions[draggedDevice];
					selectedDevice = i;
					selectedWire = -1;
					buttonDelete.disabled = selectedDevice < gameState.builtinCount;
					requestRedraw();
					return;
				}
			}

		}

		// Otherwise, we are dragging the view
		selectedDevice = -1;
		selectedWire = -1;
		buttonDelete.disabled = true;

		draggingView = true;
		viewAnchorX = gameState.viewOffsetX;
		viewAnchorY = gameState.viewOffsetY;
		viewAnchorScale = gameState.viewScale;
		requestRedraw();
	});

	canvas.addEventListener("pointermove", function(event) {
		if (event.pointerId !== dragPointerId) return;
		if (draggedDevice === -1 && draggedWireEnd === -1 && !draggingView) return;
		dragCurrentX = event.offsetX;
		dragCurrentY = event.offsetY;
		if (draggedDevice !== -1) {
			var originalDevicePosition = gameState.devicePositions[draggedDevice];
			var selectedPosition = screenToGridPositionUntransformed(
				gridToScreenX(originalDevicePosition) + event.offsetX - dragOriginX,
				gridToScreenY(originalDevicePosition) + event.offsetY - dragOriginY
			);
			// see if the device intersects anything
			var deviceKind = gameState.deviceKinds[draggedDevice];
			var deviceWidth = 2;
			var deviceHeight = DEVICE_INPUT_COUNT[deviceKind] + DEVICE_OUTPUT_COUNT[deviceKind];
			var deviceX = selectedPosition % GRID_SIZE;
			var deviceY = Math.floor(selectedPosition / GRID_SIZE);
			var isIntersecting = false;
			for (var i = 0; i < MAX_DEVICES; ++i) {
				if (i === draggedDevice) continue;
				var otherKind = gameState.deviceKinds[i];
				if (otherKind === DEVICE_KIND_NONE) continue;
				var otherWidth = 2;
				var otherHeight = DEVICE_INPUT_COUNT[otherKind] + DEVICE_OUTPUT_COUNT[otherKind];
				var otherX = gameState.devicePositions[i] % GRID_SIZE;
				var otherY = Math.floor(gameState.devicePositions[i] / GRID_SIZE);

				if (
					otherX < deviceX + deviceWidth && otherY < deviceY + deviceHeight &&
					deviceX < otherX + otherWidth && deviceY < otherY + otherHeight
				) {
					isIntersecting = true;
					break;
				}
			}
			if (!isIntersecting) draggedDeviceTargetPosition = selectedPosition;
		}
		if (draggingView) {
			gameState.viewOffsetX = viewAnchorX - dragCurrentX + dragOriginX;
			gameState.viewOffsetY = viewAnchorY - dragCurrentY + dragOriginY;
		}
		requestRedraw();
	});

	canvas.addEventListener("pointerup", function(event) {
		if (event.pointerId === dragPointerId) dragPointerId = -2;
		canvas.releasePointerCapture(event.pointerId);
		if (draggedDevice !== -1) {
			if (gameState.devicePositions[draggedDevice] !== draggedDeviceTargetPosition) {
				gameState.devicePositions[draggedDevice] = draggedDeviceTargetPosition;
			}
			draggedDevice = -1;
		}
		if (draggedWireEnd !== -1) {
			var selectedPosition = screenToGridPosition(event.offsetX, event.offsetY);
			finding_node: for (var i = 0; i < 3 * MAX_DEVICES; ++i) {
				if (!doesNodeExist(i)) continue;
				if (getNodePosition(i) === selectedPosition) {
					var targetWireEnd = i % 3 < 2 ? 1 : 0;
					// The start of the wire can only be output and the end only input
					if (targetWireEnd !== draggedWireEnd % 2) continue;
					// If the wire end is an end, it can only be plugged where there is nothing else
					if (targetWireEnd === 1) {
						for (var j = 0; j < 2 * MAX_WIRES; ++j) {
							if (gameState.wires[j] === -1) continue;
							if (gameState.wires[j] === i) continue finding_node;
						}
					}
					if (gameState.wires[draggedWireEnd] !== i) {
						gameState.wires[draggedWireEnd] = i;
					}
				}
			}
			var draggedWire = Math.floor(draggedWireEnd / 2)
			// Special case for gameState.wires being just added
			if (gameState.wires[2 * draggedWire] === gameState.wires[2 * draggedWire + 1]) deleteWire(draggedWire);
			draggedWireEnd = -1;
		}
		if (draggingView) {
			draggingView = false;
		}
		requestRedraw();
	});
}
// Otherwise we need to use mouse events
else {
	// TODO: implement when pointer events are done
}

function deleteWire(wire) {
	gameState.wires[2 * wire] = -1;
	gameState.wires[2 * wire + 1] = -1;
	// remove the wire from the stack
	for (var i = 0; i < gameState.wireCount; ++i) {
		if (gameState.wireStack[i] === wire) {
			for (var j = i + 1; j < gameState.wireCount; ++j) {
				gameState.wireStack[j - 1] = gameState.wireStack[j];
			}
			gameState.wireStack[gameState.wireCount - 1] = -1;
			gameState.wireCount = gameState.wireCount - 1;
			break;
		}
	}
}

function serialize(){
	return JSON.stringify(gameState);
}

function loadFromString(data){
	try {
		var loadedGameState = normalizeLoadedGameState(JSON.parse(data));
		gameState = loadedGameState;
		draw()
	}
	catch (error) {
		console.warn("Failed to load saved game state", error);
	}
}

buttonDelete.addEventListener("click", function() {
	if (selectedDevice !== -1) {
		gameState.deviceKinds[selectedDevice] = DEVICE_KIND_NONE;
		for (var i = 0; i < 2 * MAX_WIRES; ++i) {
			var node = gameState.wires[i];
			if (node === -1) continue;
			if (Math.floor(node / 3) === selectedDevice) {
				deleteWire(Math.floor(i / 2));
			}
		}
	}
	if (selectedWire !== -1) {
		deleteWire(selectedWire);
	}
	selectedDevice = -1;
	buttonDelete.disabled = true;
	requestRedraw();
})

selectAddDevice.addEventListener("input", function() {
	addingDevice = parseInt(selectAddDevice.value);
	selectedWire = -1;
	selectedDevice = -1;
	buttonDelete.disabled = true;
})

buttonAddWire.addEventListener("click", function() {
	addingWire = true;
	selectedWire = -1;
	selectedDevice = -1;
	buttonDelete.disabled = true;
	buttonAddWire.disabled = true;
	addingDevice = -1
	selectAddDevice.value = "-1";
})

buttonStartEditing.addEventListener("click", function() {
	editing = true;
	toolbarView.hidden = true;
	toolbarEditing.hidden = false;
	clearInterval(simulationTimerHandle);
	for (var i = 0; i < gameState.nodeValues.length; ++i) {
		gameState.nodeValues[i] = false;
	}
	requestRedraw();
})

buttonFinishEditing.addEventListener("click", function() {
	editing = false;
	toolbarView.hidden = false;
	toolbarEditing.hidden = true;
	selectedWire = -1;
	selectedDevice = -1;
	draggedDevice = -1;
	draggedWireEnd = -1;
	simulationTimerHandle = setInterval(function() {
		simulateStep();
		requestRedraw();
	}, simulationTimeout);
})

saveButton.addEventListener("click", function() {
	saveGameStateToStorage();
})



updateCanvasSize();
resetView();
requestRedraw();