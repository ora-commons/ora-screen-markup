import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToBlob,
  getCommonBounds,
  newElementWith,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";

// One logical mark = one numbered note. The owning element carries the
// number, the kind and the note in its customData. Generated companions
// (badges, callout text) are tagged with the owner id and their role, so they
// never create a row of their own.

export const MARK = "oraMark";
export const PART = "oraPart";
export const BACKGROUND = "oraBackground";
// Marks the box a user drew for one of the tools, so the tool's own shape
// can take its place.
export const TOOL = "oraTool";
// The drawing-crop boundary: one tagged, unnumbered, adjustable ordinary
// rectangle. Its geometry lives only in the scene; every exporter omits the
// control rectangle itself and clips the rendered composition to its bounds.
export const CROP_DRAWING = "oraCropDrawing";

export function isCropBoundary(element) {
  return Boolean(
    element &&
      element.type === "rectangle" &&
      element.customData &&
      element.customData[CROP_DRAWING] === true,
  );
}

export const BADGE_HEIGHT = 26;
export const BADGE_FONT_SIZE = 16;
export const NOTE_FONT_SIZE = 16;
export const EXPORT_PADDING = 40;

export const KIND_LABELS = {
  arrow: "Arrow",
  shape: "Shape",
  line: "Line",
  polygon: "Polygon",
  cloud: "Revision cloud",
  highlight: "Highlight",
  freehand: "Freehand",
  text: "Text",
  marker: "Marker",
  callout: "Callout",
  blur: "Blur",
  crop: "Crop",
};

let idCounter = 0;

export function newId(prefix) {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function markOf(element) {
  return element && element.customData ? element.customData[MARK] || null : null;
}

export function partOf(element) {
  return element && element.customData ? element.customData[PART] || null : null;
}

export function isBackground(element) {
  return Boolean(element && element.customData && element.customData[BACKGROUND]);
}

export function isMarkable(element) {
  return (
    element.type !== "selection" &&
    element.type !== "frame" &&
    element.type !== "magicframe" &&
    element.type !== "embeddable" &&
    element.type !== "iframe"
  );
}

// Numbers never repeat inside one document: the counter only ever grows.
let numberCounter = 0;

export function resetNumbering() {
  numberCounter = 0;
}

function raiseNumberCounterTo(elements) {
  for (const element of elements) {
    const mark = markOf(element);
    if (mark && typeof mark.number === "number" && mark.number > numberCounter) {
      numberCounter = mark.number;
    }
  }
}

export function allocateNumber(elements) {
  raiseNumberCounterTo(elements);
  numberCounter += 1;
  return numberCounter;
}

// --- geometry -------------------------------------------------------------

function relativePoints(element) {
  if (
    element.type === "line" ||
    element.type === "arrow" ||
    element.type === "freedraw"
  ) {
    return element.points || [];
  }
  return [
    [0, 0],
    [element.width, 0],
    [element.width, element.height],
    [0, element.height],
  ];
}

export function elementCenter(element) {
  const points = relativePoints(element);
  if (!points.length) {
    return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  return {
    x: element.x + (minX + maxX) / 2,
    y: element.y + (minY + maxY) / 2,
  };
}

// A point given in the element's own coordinate space (the same space as
// element.points) becomes a scene point, honouring the element's rotation.
export function toScene(element, localPoint) {
  const center = elementCenter(element);
  const angle = element.angle || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const px = element.x + localPoint[0];
  const py = element.y + localPoint[1];
  const dx = px - center.x;
  const dy = py - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function rotatedUp(element) {
  const angle = element.angle || 0;
  return { x: Math.sin(angle), y: -Math.cos(angle) };
}

// Turns a direction in the element's own space into the scene.
function rotateDirection(direction, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: direction.x * cos - direction.y * sin,
    y: direction.x * sin + direction.y * cos,
  };
}

// The direction that points out of the shape at one of its points: the
// normals of the edges that meet there, each turned away from the middle of
// the shape.
function outwardAt(points, index) {
  const count = points.length;
  let middleX = 0;
  let middleY = 0;
  for (const point of points) {
    middleX += point[0];
    middleY += point[1];
  }
  const centre = { x: middleX / count, y: middleY / count };
  const here = points[index];
  const edges = [];
  if (index > 0) {
    edges.push([points[index - 1], here]);
  }
  if (index < count - 1) {
    edges.push([here, points[index + 1]]);
  }
  if (!edges.length) {
    edges.push([here, here]);
  }
  let sumX = 0;
  let sumY = 0;
  for (const [from, to] of edges) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy) || 1;
    let nx = dy / length;
    let ny = -dx / length;
    if (nx * (here[0] - centre.x) + ny * (here[1] - centre.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    sumX += nx;
    sumY += ny;
  }
  const length = Math.hypot(sumX, sumY) || 1;
  return { x: sumX / length, y: sumY / length };
}

// The point on the element's actual outside outline where the number sits,
// and the direction that leads out of the shape there.
// An arrow keeps its number at its back (starting) end; every other shape
// carries it just outside its highest outline point.
export function outlineAnchor(element) {
  const up = rotatedUp(element);
  if (element.type === "arrow") {
    const start =
      element.points && element.points.length ? element.points[0] : [0, 0];
    return { point: toScene(element, start), up };
  }
  if (element.type === "line" || element.type === "freedraw") {
    const points = element.points || [];
    let best = -1;
    let bestY = Infinity;
    for (let index = 0; index < points.length; index += 1) {
      const scene = toScene(element, points[index]);
      if (scene.y < bestY) {
        bestY = scene.y;
        best = index;
      }
    }
    if (best >= 0) {
      const outward = rotateDirection(outwardAt(points, best), element.angle || 0);
      return { point: toScene(element, points[best]), up: outward };
    }
  }
  return { point: toScene(element, [element.width / 2, 0]), up };
}

// --- element factories ----------------------------------------------------

function ellipseElement(spec) {
  const [element] = convertToExcalidrawElements([spec], { regenerateIds: false });
  return element;
}

function textElement(spec) {
  const [element] = convertToExcalidrawElements([spec], { regenerateIds: false });
  return element;
}

export function createTextElement(text, x, y, options = {}) {
  return textElement({
    type: "text",
    id: newId("t"),
    x,
    y,
    text,
    originalText: text,
    fontSize: options.fontSize || NOTE_FONT_SIZE,
    fontFamily: 5,
    textAlign: "left",
    verticalAlign: "top",
    autoResize: true,
    strokeColor: options.strokeColor || "#1b1b1f",
    roughness: 0,
    opacity: 100,
    groupIds: options.groupIds || [],
    customData: options.customData,
  });
}

// Re-measures a text element the way Excalidraw does, so a note typed in the
// list and a note typed on the canvas always agree on size and position.
export function resizeTextElement(element, text) {
  const probe = textElement({
    type: "text",
    id: newId("probe"),
    x: element.x,
    y: element.y,
    text,
    originalText: text,
    fontSize: element.fontSize,
    fontFamily: element.fontFamily,
    textAlign: element.textAlign,
    verticalAlign: element.verticalAlign,
    autoResize: element.autoResize,
  });
  return newElementWith(element, {
    text,
    originalText: text,
    width: probe.width,
    height: probe.height,
  });
}

// `points` are absolute scene coordinates; the element keeps them relative to
// its own origin, the way Excalidraw stores linear elements.
export function createLineElement(points, options = {}) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  const relative = points.map((point) => [point[0] - minX, point[1] - minY]);
  const [element] = convertToExcalidrawElements(
    [
      {
        type: "line",
        id: newId("l"),
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        points: relative,
        strokeColor: options.strokeColor || "#1b1b1f",
        backgroundColor: options.backgroundColor || "transparent",
        fillStyle: options.fillStyle || "solid",
        strokeWidth: options.strokeWidth || 2,
        strokeStyle: "solid",
        roughness: options.roughness !== undefined ? options.roughness : 0,
        opacity: options.opacity !== undefined ? options.opacity : 100,
        roundness:
          options.roundness !== undefined ? options.roundness : { type: 2 },
        customData: options.customData,
      },
    ],
    { regenerateIds: false },
  );
  return element;
}

// A revision cloud: a scalloped closed line walking the perimeter of a
// rectangle. The points are absolute scene coordinates.
export function cloudPoints(rect, amplitude = 9) {
  const { x, y, width, height } = rect;
  const points = [];
  const edges = [
    { from: [x, y], to: [x + width, y], normal: [0, -1] },
    { from: [x + width, y], to: [x + width, y + height], normal: [1, 0] },
    { from: [x + width, y + height], to: [x, y + height], normal: [0, 1] },
    { from: [x, y + height], to: [x, y], normal: [-1, 0] },
  ];
  for (const edge of edges) {
    const dx = edge.to[0] - edge.from[0];
    const dy = edge.to[1] - edge.from[1];
    const length = Math.hypot(dx, dy) || 1;
    const steps = Math.max(1, Math.round(length / (amplitude * 2)));
    const tx = dx / length;
    const ty = dy / length;
    for (let step = 0; step < steps; step += 1) {
      const baseX = edge.from[0] + dx * (step / steps);
      const baseY = edge.from[1] + dy * (step / steps);
      points.push([baseX, baseY]);
      for (let inner = 1; inner < 4; inner += 1) {
        const theta = (Math.PI * inner) / 4;
        const along = amplitude * (1 - Math.cos(theta));
        const out = amplitude * Math.sin(theta);
        points.push([
          baseX + tx * along + edge.normal[0] * out,
          baseY + ty * along + edge.normal[1] * out,
        ]);
      }
    }
  }
  points.push([points[0][0], points[0][1]]);
  return points;
}

// --- badge and marker -----------------------------------------------------

export function badgeSize(number) {
  const digits = String(number).length;
  return { width: BADGE_HEIGHT + (digits - 1) * 9, height: BADGE_HEIGHT };
}

// The number drawn inside a badge circle.
export function createNumberLabel(mark, circle, role) {
  const size = badgeSize(mark.number);
  const numberText = String(mark.number);
  const label = textElement({
    type: "text",
    id: newId(role === "marker-number" ? "mt" : "bt"),
    x: 0,
    y: 0,
    text: numberText,
    originalText: numberText,
    fontSize: BADGE_FONT_SIZE,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    autoResize: true,
    strokeColor: "#1b1b1f",
    roughness: 0,
    opacity: 100,
    // The number inside a bare marker belongs to the marker itself; the
    // number in a badge is placed by the editor, so it can be moved on its
    // own and the mark can still be turned.
    groupIds: role === "marker-number" ? [mark.id] : [],
    customData: { [PART]: { id: mark.id, role } },
  });
  return newElementWith(label, {
    x: circle.x + (size.width - label.width) / 2,
    y: circle.y + (size.height - label.height) / 2,
  });
}

function numberBadge(mark, x, y, ownerIsTheCircle) {
  const size = badgeSize(mark.number);
  const circle = ellipseElement({
    type: "ellipse",
    id: newId(ownerIsTheCircle ? "m" : "b"),
    x: x - size.width / 2,
    y: y - size.height / 2,
    width: size.width,
    height: size.height,
    strokeColor: "#1b1b1f",
    backgroundColor: "#ffd60a",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: null,
    groupIds: ownerIsTheCircle ? [mark.id] : [],
    customData: ownerIsTheCircle
      ? { [MARK]: mark }
      : { [PART]: { id: mark.id, role: "badge" } },
  });
  const label = createNumberLabel(
    mark,
    circle,
    ownerIsTheCircle ? "marker-number" : "badge-text",
  );
  return [circle, label];
}

// The numbered badge that sits outside a mark's outline.
export function createBadgeElements(mark, x, y) {
  return numberBadge(mark, x, y, false);
}

// A bare numbered marker dropped on the picture: the circle owns the mark and
// carries the number itself, so it needs no extra badge.
export function createMarkerElements(mark, x, y) {
  return numberBadge(mark, x, y, true);
}

// --- note text ------------------------------------------------------------

export function notesText(marks) {
  const ordered = [...marks].sort((a, b) => a.number - b.number);
  return ordered
    .map((mark) => {
      const label = `${mark.number}. ${KIND_LABELS[mark.kind] || mark.kind}`;
      const note = (mark.note || "").trim();
      return note ? `${label}\n${note}` : label;
    })
    .join("\n\n");
}

// --- import ---------------------------------------------------------------

// Decode every image before changing the live scene, so an unreadable
// picture is refused before anything moves.
async function decodeFiles(files, elements) {
  const decoded = new Set();
  for (const element of elements) {
    if (element.type !== "image" || element.isDeleted) continue;
    const file = files[element.fileId];
    if (!file || !/^data:image\//.test(file.dataURL || "")) {
      throw new Error("An embedded picture is missing.");
    }
    if (decoded.has(element.fileId)) continue;
    const image = new Image();
    image.src = file.dataURL;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("An embedded picture is empty.");
    }
    decoded.add(element.fileId);
  }
}

export async function preparePicture(dataURL) {
  const image = new Image();
  image.src = dataURL;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("The picture is empty.");
  const fileId = newId("img");
  const now = Date.now();
  const files = { [fileId]: {
    id: fileId, dataURL,
    mimeType: dataURL.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png",
    created: now, lastRetrieved: now,
  } };
  // Every picture arrives unlocked: an object to select, move, resize and
  // erase like anything drawn on it.
  const elements = convertToExcalidrawElements([{
    type: "image", id: newId("bg"), x: 0, y: 0,
    width: image.naturalWidth, height: image.naturalHeight,
    fileId, locked: false, status: "saved", scale: [1, 1],
    customData: { [BACKGROUND]: true },
  }], { regenerateIds: false });
  return { elements, files };
}

export async function prepareEditable(contents) {
  const data = JSON.parse(contents);
  if (!data || data.type !== "excalidraw" || !Array.isArray(data.elements) ||
      !data.files || typeof data.files !== "object" || Array.isArray(data.files)) {
    throw new Error("Choose an editable .excalidraw file with embedded pictures.");
  }
  if (data.elements.some((element) => !element || typeof element.id !== "string" ||
      typeof element.type !== "string" ||
      ![element.x, element.y, element.width, element.height].every(Number.isFinite))) {
    throw new Error("The editable drawing contains an invalid shape.");
  }
  const live = data.elements.filter((element) => !element.isDeleted);
  for (const element of live) {
    const mark = markOf(element);
    if (mark && (typeof mark.id !== "string" || !Number.isInteger(mark.number) ||
        mark.number < 1 || typeof mark.note !== "string" || !KIND_LABELS[mark.kind])) {
      throw new Error("The editable drawing contains an invalid numbered note.");
    }
  }
  const elements = restoreElements(live, null, { repairBindings: true });
  if (elements.length !== live.length) {
    throw new Error("The editable drawing contains an unsupported shape.");
  }
  // Install only pictures used by the restored scene. Validate the IDs before
  // resetScene: Excalidraw installs files by file.id, not by the table key.
  const files = Object.fromEntries(elements.filter((element) => element.type === "image")
    .map((element) => {
      const file = Object.hasOwn(data.files, element.fileId) ? data.files[element.fileId] : null;
      if (typeof element.fileId !== "string" || !element.fileId ||
          !file || typeof file !== "object" || file.id !== element.fileId) {
        throw new Error("An embedded picture is missing or has an invalid ID.");
      }
      return [element.fileId, file];
    }));
  await decodeFiles(files, elements);
  return { elements, files };
}

export function applyCandidate(api, candidate, canvasOffsets) {
  // resetScene clears the previous document's history and files; Undo is an
  // editing tool, not an accidental way to navigate between captures.
  api.resetScene();
  resetNumbering();
  raiseNumberCounterTo(candidate.elements);
  api.addFiles(Object.values(candidate.files));
  api.updateScene({
    elements: candidate.elements,
    appState: { viewBackgroundColor: "transparent", theme: "light", selectedElementIds: {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.scrollToContent(candidate.elements, { fitToContent: true, canvasOffsets });
}

// One appended picture: added unlocked and selected beside the drawing as its
// own object, just above the pictures already there and below the marks, in
// one Undo step. The scene, numbering, notes and the saved baseline are left
// alone; nothing already in the drawing is replaced.
export function appendToScene(api, prepared, canvasOffsets) {
  const existing = api.getSceneElements().filter((element) => !element.isDeleted);
  const [image] = prepared.elements;
  const maxX = existing.reduce(
    (value, element) => Math.max(value, element.x + element.width),
    0,
  );
  const placed = existing.length
    ? newElementWith(image, { x: maxX + EXPORT_PADDING * 2 })
    : image;
  const pictures = existing.filter((element) => element.type === "image");
  const marks = existing.filter((element) => element.type !== "image");
  api.addFiles(Object.values(prepared.files));
  api.updateScene({
    elements: [...pictures, placed, ...marks],
    appState: { selectedElementIds: { [placed.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.scrollToContent(placed, { fitToContent: true, canvasOffsets });
  return placed;
}

// Creates the drawing-crop boundary at the content bounds plus the export
// padding, or re-selects the existing one. One history entry makes creation
// undoable; later native handle moves, Undo, Redo and Delete are the
// editor's own. The rectangle stays a plain, unnumbered scene element.
export function toggleCropDrawing(api) {
  const existing = api
    .getSceneElements()
    .find((element) => !element.isDeleted && isCropBoundary(element));
  if (existing) {
    api.updateScene({
      appState: { selectedElementIds: { [existing.id]: true } },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    return existing;
  }
  const content = api
    .getSceneElements()
    .filter((element) => !element.isDeleted && !isCropBoundary(element));
  if (!content.length) {
    return null;
  }
  const [minX, minY, maxX, maxY] = getCommonBounds(content);
  const [rectangle] = convertToExcalidrawElements([{
    type: "rectangle",
    id: newId("crop"),
    x: minX - EXPORT_PADDING,
    y: minY - EXPORT_PADDING,
    width: maxX - minX + EXPORT_PADDING * 2,
    height: maxY - minY + EXPORT_PADDING * 2,
    angle: 0,
    strokeColor: "#e03131",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "dashed",
    roughness: 0,
    opacity: 100,
    locked: false,
    customData: { [CROP_DRAWING]: true },
  }], { regenerateIds: false });
  api.updateScene({
    elements: [
      ...api.getSceneElements().filter((element) => !element.isDeleted),
      rectangle,
    ],
    appState: { selectedElementIds: { [rectangle.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return rectangle;
}

// The editable format keeps images and all Ora customData. View/selection
// settings do not define whether the user's drawing has been saved.
export function editableContents(scene) {
  return serializeAsJSON(scene.elements, { viewBackgroundColor: "transparent" }, scene.files, "local");
}

export function editableIdentity(scene) {
  const data = JSON.parse(editableContents(scene));
  return JSON.stringify({
    elements: data.elements.map(({ version, versionNonce, updated, ...element }) => element),
    files: Object.entries(data.files).map(([id, file]) => [id, file.mimeType, file.dataURL]),
  });
}

// --- snapshot for copy and export -----------------------------------------

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(index, index + chunk),
    );
  }
  return btoa(binary);
}

// The editor mutates nested element values in place while it works (a crop
// drag writes the crop object itself), so the frozen copy takes those nested
// values too. Nothing the snapshot shares with the live scene can be changed
// by later edits while the picture is being rendered.
function freezeElement(element) {
  const copy = { ...element };
  if (copy.points) {
    copy.points = copy.points.map((point) => [...point]);
  }
  if (Array.isArray(copy.scale)) {
    copy.scale = [...copy.scale];
  }
  if (Array.isArray(copy.groupIds)) {
    copy.groupIds = [...copy.groupIds];
  }
  if (Array.isArray(copy.boundElements)) {
    copy.boundElements = copy.boundElements.map((bound) => ({ ...bound }));
  }
  if (copy.crop) {
    copy.crop = { ...copy.crop };
  }
  if (copy.customData) {
    const customData = { ...copy.customData };
    if (customData[MARK]) {
      customData[MARK] = { ...customData[MARK] };
    }
    if (customData[PART]) {
      customData[PART] = { ...customData[PART] };
    }
    copy.customData = customData;
  }
  return copy;
}

// Takes the scene, its files and its view settings at one moment, so a copy
// and an export always describe the same document. The elements are copied,
// nested values included, so later edits cannot change the picture while it
// is being rendered.
export function freezeScene(api) {
  return {
    elements: api
      .getSceneElements()
      .filter((element) => !element.isDeleted)
      .map(freezeElement),
    files: api.getFiles(),
    appState: api.getAppState(),
  };
}

export async function snapshot(scene) {
  // A drawing crop clips the fully rendered composition to the boundary:
  // everything outside it is left out of the finished picture but stays in
  // the drawing. The boundary itself is never rendered, and the crop bounds
  // are derived in scene coordinates before the existing output scaling,
  // keeping the scene-to-output origin. The numbered notes are added by the
  // host after this picture, so they stay beneath it, outside any crop.
  const boundary = scene.elements.find(isCropBoundary);
  const elements = boundary
    ? scene.elements.filter((element) => !isCropBoundary(element))
    : scene.elements;
  if (!elements.length) {
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_PADDING * 2;
    canvas.height = EXPORT_PADDING * 2;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  }
  // The whole composition renders first — frame clipping and frame names
  // stay native, because the pinned exporter's frame-export path drops
  // elements assigned to other frames and suppresses their names.
  const blob = await exportToBlob({
    elements,
    appState: {
      ...scene.appState,
      theme: "light",
      exportBackground: true,
      exportEmbedScene: false,
      exportWithDarkMode: false,
      exportScale: 1,
      viewBackgroundColor: "#ffffff",
    },
    files: scene.files,
    mimeType: "image/png",
    exportPadding: EXPORT_PADDING,
  });
  if (!boundary) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return toBase64(bytes);
  }
  // Then the rendered canvas is cropped to the boundary (exportScale is 1,
  // so rendered pixels are scene units plus padding). Frame-name labels can
  // extend the render above the content bounds, so the vertical origin comes
  // from the rendered height and the unchanged bottom edge.
  const url = URL.createObjectURL(blob);
  try {
    const picture = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The drawing could not be rendered."));
      image.src = url;
    });
    const [minX, , , maxY] = getCommonBounds(elements);
    const originY = maxY + EXPORT_PADDING * 2 - picture.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(boundary.width));
    canvas.height = Math.max(1, Math.round(boundary.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, minX - EXPORT_PADDING - boundary.x, originY - EXPORT_PADDING - boundary.y);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

// --- duplication ----------------------------------------------------------

// A duplicated mark is a new mark: it gets its own identity and its own
// number. Companions follow their new owner.
export function remapDuplicates(nextElements, prevElements) {
  const previousIds = new Set(prevElements.map((element) => element.id));
  const duplicates = nextElements.filter(
    (element) => !previousIds.has(element.id),
  );
  if (!duplicates.length) {
    return nextElements;
  }
  const markMap = new Map();
  for (const element of duplicates) {
    const mark = markOf(element);
    if (mark) {
      markMap.set(mark.id, newId("m"));
    }
  }
  return nextElements.map((element) => {
    if (previousIds.has(element.id)) {
      return element;
    }
    // A group belongs to the mark it was made for, so a copy gets its own.
    const groupIds = (element.groupIds || []).map(
      (groupId) => markMap.get(groupId) || groupId,
    );
    const mark = markOf(element);
    if (mark) {
      return newElementWith(element, {
        groupIds,
        customData: {
          // Keep the rest of the element's own data — a duplicated cropped
          // picture stays a source picture (oraBackground), not just a mark.
          ...element.customData,
          [MARK]: { ...mark, id: markMap.get(mark.id), number: null },
        },
      });
    }
    const part = partOf(element);
    if (part) {
      const owner = markMap.get(part.id);
      if (!owner) {
        return element;
      }
      return newElementWith(element, {
        groupIds,
        customData: { [PART]: { ...part, id: owner } },
      });
    }
    return element;
  });
}
