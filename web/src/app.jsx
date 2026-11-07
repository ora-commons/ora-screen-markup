import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  newElementWith,
} from "@excalidraw/excalidraw";
import {
  KIND_LABELS,
  allocateNumber,
  appendToScene,
  createMarkerElements,
  freezeScene,
  applyCandidate,
  editableContents,
  editableIdentity,
  isCropBoundary,
  prepareEditable,
  preparePicture,
  markOf,
  newId,
  notesText,
  partOf,
  remapDuplicates,
  snapshot,
  toggleCropDrawing,
} from "./marks.js";
import {
  marksFrom,
  readMarks,
  reconcile,
  setNote,
  toolShape,
} from "./reconcile.js";

const TOOLS = [
  { id: "highlight", glyph: "highlight", label: "Highlight", tool: "freedraw", hint: "Drag across the picture to highlight it." },
  { id: "polygon", glyph: "polygon", label: "Polygon", tool: "line", hint: "Click points, click the first point to close it, double-click to finish." },
  { id: "cloud", glyph: "cloud", label: "Revision cloud", tool: "rectangle", hint: "Drag a box around the area to cloud." },
  { id: "callout", glyph: "callout", label: "Callout", tool: "arrow", hint: "Drag an arrow to the spot, then write the note in the list." },
  { id: "marker", glyph: "marker", label: "Number marker", tool: "selection", hint: "Click the spot to drop a numbered marker." },
];

function postToHost(message) {
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ora;
  if (handler) {
    handler.postMessage(message);
  }
}

const BASIC_TOOLS = [
  ["selection", "Select", "select"], ["hand", "Pan", "pan"],
  ["rectangle", "Box", "box"], ["diamond", "Diamond", "diamond"],
  ["ellipse", "Ellipse", "ellipse"], ["arrow", "Arrow", "arrow"],
  ["line", "Line", "line"], ["freedraw", "Draw", "draw"],
  ["text", "Text", "text"], ["eraser", "Erase", "erase"],
];

const GLYPHS = {
  region: "M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5",
  window: "M3 6h18v14H3zM3 10h18M6 8h.1M9 8h.1",
  screen: "M3 4h18v13H3zM8 21h8M12 17v4",
  select: "m5 3 14 9-7 1-3 7z", pan: "M8 11V5a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v10c0 7-11 8-14 3l-4-6q-1-3 2-2l4 4",
  box: "M4 4h16v16H4z", diamond: "m12 3 9 9-9 9-9-9z",
  ellipse: "M21 12a9 7 0 1 1-18 0 9 7 0 1 1 18 0",
  arrow: "M3 20 21 4M12 4h9v9", line: "M4 20 20 4",
  draw: "m4 19 3-7L17 2l5 5-10 10-8 2M7 12l5 5",
  text: "M4 4h16M12 4v16M8 20h8", erase: "m3 14 10-11 8 8-9 10H9zM7 10l8 8M12 21h10",
  highlight: "m4 14 9-11 7 6-9 11H4zM2 22h13", polygon: "m4 5 15 2 2 12-15 1z",
  cloud: "M5 7q0-5 5-3 4-4 7 1 6 0 4 6 4 5-2 7-1 5-7 2-6 3-7-3-5-1-2-6-2-4 2-4z",
  callout: "M4 3h15v7H4zM6 10 3 19l12-6M3 19l8-1M3 19l1-7",
  marker: "M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0M10 8h2v9M10 17h4",
  crop: "M6 2v16h16M2 6h16v16",
  undo: "M8 4 3 9l5 5M3 9h10q9 0 7 11", redo: "m16 4 5 5-5 5M21 9H11q-9 0-7 11",
  zoomOut: "M4 12h16", zoomIn: "M12 4v16M4 12h16", menu: "M4 6h16M4 12h16M4 18h16",
  fold: "M3 4h18v16H3zM15 4v16M10 9l-3 3 3 3",
  copy: "M8 8h13v13H8zM16 8V3H3v13h5", export: "M5 14v7h14v-7M12 16V3m-5 5 5-5 5 5",
  check: "m5 12 4 4L19 6",
  save: "M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8",
  open: "M3 8V4h7l3 3h8v3M3 8l2 13h14l3-11H7L5 21",
  library: "M3 4h5v16H3zM10 4h5v16h-5zM17 5l4-1 2 15-4 1z",
  image: "M3 5h18v14H3zM8 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM3 16l5-5 4 4 3-3 6 5",
};
function Glyph({ name }) {
  return <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d={GLYPHS[name] || GLYPHS.box} /></svg>;
}
function Command({ glyph, children, ...props }) {
  return <button type="button" className="tool" {...props}><Glyph name={glyph} />{children}</button>;
}
function textEditing(target = document.activeElement) {
  return Boolean(target && target.closest("input, textarea, [contenteditable='true']"));
}

// ORA-347 — copying selected objects or text still copies just those, as
// now: a nonempty object selection (or an active text edit) belongs to the
// editor's own copy; only the empty canvas copies the whole result.
function hasObjectSelection(api) {
  return Boolean(api && Object.keys(api.getAppState().selectedElementIds || {}).length);
}

function drawingOffsets() {
  // The left controls column is gone; fitting and placing incoming pictures
  // use the whole drawing area with equal margins.
  return { left: 16, top: 16, right: 16, bottom: 16 };
}

function fitDrawing(api, elements = api.getSceneElements()) {
  if (elements.length) {
    api.scrollToContent(elements, { fitToContent: true, canvasOffsets: drawingOffsets() });
  }
}

// Puts the keyboard back on the drawing canvas, so Return and Escape reach
// the editor after a toolbar button has been used.
function focusEditor() {
  const container = document.querySelector(".excalidraw-container");
  if (container) {
    container.focus();
  }
}

// Closes the canvas text editor, so a note being written on the picture is
// part of the document before it is copied or exported.
function commitCanvasText() {
  const editor = document.querySelector("textarea.excalidraw-wysiwyg");
  if (editor && document.activeElement === editor) {
    editor.blur();
  }
}

function sameMarks(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (
      a[index].id !== b[index].id ||
      a[index].number !== b[index].number ||
      a[index].kind !== b[index].kind ||
      a[index].note !== b[index].note
    ) {
      return false;
    }
  }
  return true;
}

// Return mode's Send button names its destination: the `--return-to <name>`
// the caller started the app with, or Vibe Coder when it named none. The
// native side injects window.oraReturnTo only in return mode, alongside
// window.oraReturnFolder, before any script here runs.
const returnToName = String(window.oraReturnTo || "").trim() || "Vibe Coder";

function App() {
  const apiRef = useRef(null);
  const modeRef = useRef(null);
  const pendingRef = useRef(false);
  const markerOriginRef = useRef(null);
  const replacementRef = useRef(false);
  const decisionRef = useRef(null);
  const savedRef = useRef(null);
  const requestsRef = useRef(new Map());
  const saveRef = useRef(null);
  const copyingRef = useRef(false);
  const panRef = useRef(null);
  const draftsRef = useRef({});
  const [marks, setMarks] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [armed, setArmed] = useState(null);
  const [status, setStatus] = useState("Capture a picture, add marks, then copy or export the result.");
  const [activeTool, setActiveTool] = useState("selection");
  const [decision, setDecision] = useState(null);
  const [copyState, setCopyState] = useState("idle");
  // The style panel starts folded each time the app opens; the choice is not
  // remembered. Excalidraw rebuilds the panel as tools and selections change,
  // so the fold is a class on our own canvas container.
  const [styleOpen, setStyleOpen] = useState(false);
  const [addingCapture, setAddingCapture] = useState(false);
  const [discardExistingContents, setDiscardExistingContents] = useState(() => {
    try { return localStorage.getItem("ora.discardExistingContents") !== "false"; }
    catch (error) { console.warn("Could not read the capture preference.", error); return true; }
  });

  useEffect(() => {
    try { localStorage.setItem("ora.discardExistingContents", String(discardExistingContents)); }
    catch (error) { console.warn("Could not remember the capture preference.", error); }
  }, [discardExistingContents]);

  useEffect(() => {
    let frame;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (apiRef.current) fitDrawing(apiRef.current);
      });
    });
    observer.observe(document.getElementById("canvas"));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  useEffect(() => {
    const host = document.getElementById("canvas");
    // Match Ora's wheel zoom, anchored at the pointer. Controls and notes
    // keep their own scrolling; only the drawing surface receives zoom.
    const onWheel = (event) => {
      const api = apiRef.current;
      if (!api || !event.target.closest(".excalidraw__canvas-wrapper, canvas.excalidraw__canvas")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (panRef.current || !event.deltaY) return;
      const state = api.getAppState();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, host.clientHeight) : 1;
      const delta = Math.max(-100, Math.min(100, event.deltaY * unit));
      const zoom = state.zoom.value;
      const nextZoom = Math.min(30, Math.max(0.1, Math.round(zoom * Math.exp(-delta * 0.002) * 1000000) / 1000000));
      const x = event.clientX - state.offsetLeft;
      const y = event.clientY - state.offsetTop;
      api.updateScene({
        appState: {
          zoom: { value: nextZoom },
          scrollX: state.scrollX + x / nextZoom - x / zoom,
          scrollY: state.scrollY + y / nextZoom - y / zoom,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    };
    host.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      host.removeEventListener("wheel", onWheel, true);
      panRef.current?.(true);
    };
  }, []);

  const scheduleReconcile = useCallback(() => {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    requestAnimationFrame(() => {
      pendingRef.current = false;
      const api = apiRef.current;
      if (!api) {
        return;
      }
      // ORA-347 — the crop rectangle never rotates: the exported crop is its
      // own sides, so a native rotation gesture is normalized back to zero
      // on the next settled change, without a history entry of its own.
      const boundary = api
        .getSceneElements()
        .find((element) => !element.isDeleted && isCropBoundary(element));
      if (boundary && boundary.angle) {
        api.updateScene({
          elements: api.getSceneElements().map((element) => (
            element.id === boundary.id
              ? newElementWith(element, { angle: 0 })
              : element
          )),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      const result = reconcile(api, { mode: modeRef.current });
      setMarks((previous) =>
        sameMarks(previous, result.marks) ? previous : result.marks,
      );
      if (result.message) {
        setStatus(result.message);
      }
    });
  }, []);

  const commitDrafts = useCallback(() => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    const pending = draftsRef.current;
    const ids = Object.keys(pending);
    if (!ids.length) {
      return;
    }
    const current = readMarks(api);
    for (const id of ids) {
      const mark = current.find((entry) => entry.id === id);
      if (mark && mark.note !== pending[id]) {
        setNote(api, id, pending[id]);
      }
    }
    draftsRef.current = {};
    setDrafts({});
  }, []);

  const onReady = useCallback((api) => {
    apiRef.current = api;
    api.onPointerDown((activeTool, pointerDownState, event) => {
      if (modeRef.current === "marker") {
        markerOriginRef.current = pointerDownState.origin;
      }
      const state = api.getAppState();
      if (
        modeRef.current || activeTool.type !== "selection" ||
        event.pointerType !== "mouse" || event.button !== 0 ||
        event.shiftKey || event.altKey || event.ctrlKey || event.metaKey ||
        pointerDownState.hit.element || pointerDownState.hit.hasHitCommonBoundingBoxOfSelectedElements ||
        pointerDownState.resize.handleType || pointerDownState.resize.isResizing ||
        state.editingTextElement || state.editingLinearElement ||
        state.croppingElementId || state.multiElement
      ) return;

      // Excalidraw has already hit-tested the press. Pan only empty space,
      // leaving picture/mark dragging, handles and drawing tools native.
      // Keep the selection from before its queued blank-click reset, so a
      // pan neither deselects marks nor creates a selection-only Undo step.
      api.updateScene({
        appState: {
          selectedElementIds: state.selectedElementIds,
          selectedGroupIds: state.selectedGroupIds,
          editingGroupId: state.editingGroupId,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      let lastEvent = event.nativeEvent;
      const finish = (completeNative = false) => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", cancel, true);
        window.removeEventListener("blur", cancel);
        panRef.current = null;
        if (completeNative) pointerDownState.eventListeners.onUp?.(lastEvent);
        api.resetCursor();
      };
      const move = (next) => {
        if (next.pointerId !== event.pointerId) return;
        if (!(next.buttons & 1)) { finish(true); return; }
        next.preventDefault();
        next.stopImmediatePropagation();
        const current = api.getAppState();
        api.updateScene({
          appState: {
            scrollX: current.scrollX + (next.clientX - lastEvent.clientX) / current.zoom.value,
            scrollY: current.scrollY + (next.clientY - lastEvent.clientY) / current.zoom.value,
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        lastEvent = next;
      };
      const up = (next) => { if (next.pointerId === event.pointerId) finish(); };
      const cancel = () => finish(true);
      panRef.current = finish;
      api.setCursor("grabbing");
      window.addEventListener("pointermove", move, { capture: true, passive: false });
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", cancel, true);
      window.addEventListener("blur", cancel);
    });
    api.onPointerUp((activeTool, pointerDownState) => {
      panRef.current?.();
      const mode = modeRef.current;
      if (mode === "marker") {
        const origin = markerOriginRef.current;
        markerOriginRef.current = null;
        modeRef.current = null;
        setArmed(null);
        if (!origin || pointerDownState.drag.hasOccurred) {
          return;
        }
        const mark = {
          id: newId("m"),
          number: allocateNumber(api.getSceneElements()),
          kind: "marker",
          note: "",
        };
        const [circle, label] = createMarkerElements(mark, origin.x, origin.y);
        api.updateScene({
          elements: [...api.getSceneElements(), circle, label],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return;
      }
      if (mode !== "cloud") {
        return;
      }
      if (!activeTool || activeTool.type !== "rectangle") {
        return;
      }
      const drawn = api.getAppState().newElement;
      if (!drawn || drawn.type !== "rectangle" || !drawn.width || !drawn.height) {
        return;
      }
      const result = toolShape(api, drawn, mode);
      if (!result.shape) {
        if (result.message) {
          setStatus(result.message);
        }
        return;
      }
      // The drawn box becomes the mark itself, before the editor records
      // the drawing. The change joins the editor's own record of the
      // drawing, so one undo takes the whole mark away and a redo brings
      // it back.
      const elements = api
        .getSceneElementsIncludingDeleted()
        .filter((element) => element.id !== drawn.id)
        .concat([result.shape]);
      api.updateScene({
        elements,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      });
    });
    scheduleReconcile();
  }, [scheduleReconcile]);

  const onChange = useCallback((elements, state) => {
    const type = state.activeTool.type;
    setActiveTool(type);
    const custom = TOOLS.find((tool) => tool.id === modeRef.current);
    if (custom && custom.tool !== type) {
      modeRef.current = null;
      setArmed(null);
    }
    scheduleReconcile();
  }, [scheduleReconcile]);

  const onDuplicate = useCallback((nextElements, prevElements) => {
    return remapDuplicates(nextElements, prevElements);
  }, []);

  const armTool = useCallback((tool) => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    if (modeRef.current === tool.id) {
      modeRef.current = null;
      setArmed(null);
      setStatus(`${tool.label} turned off.`);
      api.setActiveTool({ type: "selection", customType: null });
      focusEditor();
      return;
    }
    modeRef.current = tool.id;
    setArmed(tool.id);
    setStatus(tool.hint);
    api.setActiveTool({ type: tool.tool, customType: null });
    focusEditor();
  }, []);

  // Crop drawing: one tagged, adjustable rectangle around the content.
  // Whatever lies outside it is left out of the finished picture but stays
  // in the drawing. Trimming one picture itself is Excalidraw's own Crop
  // image: double-click the picture, or select it and use Crop image in the
  // opened style panel.
  const cropDrawing = useCallback(() => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    const boundary = toggleCropDrawing(api);
    setStatus(boundary
      ? "Crop rectangle is on the drawing. Drag its handles to set what the finished picture keeps; press Delete to remove it."
      : "Capture or draw something first, then crop the drawing.");
    focusEditor();
  }, []);

  const selectMark = useCallback((mark) => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    // The whole logical mark is selected, not its owning element alone, so
    // the editor's Duplicate copies a callout's text (and the badge) with
    // its arrow instead of the arrow by itself.
    const selectedElementIds = {};
    for (const element of api.getSceneElements()) {
      if (element.isDeleted) {
        continue;
      }
      const part = partOf(element);
      if (element.id === mark.ownerId || (part && part.id === mark.id)) {
        selectedElementIds[element.id] = true;
      }
    }
    api.updateScene({
      appState: { selectedElementIds },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, []);

  const editNote = useCallback((markId, value) => {
    draftsRef.current = { ...draftsRef.current, [markId]: value };
    setDrafts(draftsRef.current);
  }, []);

  const finishNote = useCallback(
    (markId, value) => {
      const api = apiRef.current;
      const mark = marks.find((entry) => entry.id === markId);
      if (api && mark && mark.note !== value) {
        setNote(api, markId, value);
      }
      const next = { ...draftsRef.current };
      delete next[markId];
      draftsRef.current = next;
      setDrafts(next);
    },
    [marks],
  );

  // Commits any editing and takes one snapshot of the document, so the
  // picture and the notes always describe the same state.
  const freezeDocument = useCallback(async () => {
    commitDrafts();
    commitCanvasText();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const api = apiRef.current;
    if (!api) {
      return null;
    }
    reconcile(api, { mode: modeRef.current });
    const frozen = freezeScene(api);
    const current = marksFrom(frozen.elements);
    return { ...frozen, marks: current, notes: notesText(current) };
  }, [commitDrafts]);

  const requestHost = useCallback((type, payload = {}) => new Promise((resolve, reject) => {
    const id = newId("request");
    if (!window.webkit?.messageHandlers?.ora) {
      reject(new Error("The native app is unavailable."));
      return;
    }
    requestsRef.current.set(id, { resolve, reject });
    postToHost({ type, id, ...payload });
  }), []);

  const output = useCallback(async (type) => {
    const copying = type === "copy";
    if (copying && copyingRef.current) return false;
    if (copying) {
      copyingRef.current = true;
      setCopyState("copying");
    }
    let copied = false;
    try {
      const frozen = await freezeDocument();
      if (!frozen) return false;
      const png = await snapshot(frozen);
      const result = await requestHost(type, { png, text: frozen.notes });
      setStatus(result.message);
      if (copying) {
        copied = true;
        setCopyState("copied");
      }
      return true;
    } catch (error) {
      setStatus(error.message);
      return false;
    } finally {
      if (copying) {
        copyingRef.current = false;
        if (!copied) setCopyState("idle");
      }
    }
  }, [freezeDocument, requestHost]);

  const saveEditable = useCallback(() => {
    if (saveRef.current) return saveRef.current;
    saveRef.current = (async () => {
      try {
        const frozen = await freezeDocument();
        if (!frozen) return false;
        const contents = editableContents(frozen);
        const result = await requestHost("save", { contents });
        if (result.cancelled) { setStatus("Save cancelled. Your drawing is unchanged."); return false; }
        savedRef.current = editableIdentity(frozen);
        setStatus(result.message);
        return true;
      } catch (error) {
        setStatus(error.message);
        return false;
      } finally { saveRef.current = null; }
    })();
    return saveRef.current;
  }, [freezeDocument, requestHost]);

  const decide = useCallback((kind) => new Promise((resolve) => {
    decisionRef.current = resolve;
    setDecision(kind);
  }), []);
  const finishDecision = useCallback((accepted) => {
    const resolve = decisionRef.current;
    decisionRef.current = null;
    setDecision(null);
    resolve?.(accepted);
  }, []);

  // Resolve intent before any picker, including captures started by a menu
  // or shortcut. An unchecked Discard setting always keeps the drawing.
  const prepareCapture = useCallback((append) => {
    const api = apiRef.current;
    if (!api || replacementRef.current || saveRef.current) return false;
    const adding = Boolean(append) || !discardExistingContents;
    setAddingCapture(adding);
    return { append: adding };
  }, [discardExistingContents]);

  // Decode a private candidate before touching the current drawing. Only a
  // capture has already resolved its replacement intent; Open still asks here.
  const replaceDocument = useCallback(async (prepare, { editable = false, capture = false } = {}) => {
    if (replacementRef.current) { setStatus("Finish the current replacement first."); return false; }
    replacementRef.current = true;
    postToHost({ type: "replacementBusy", busy: true });
    try {
      const candidate = await prepare();
      const frozen = await freezeDocument();
      if (!frozen) return false;
      if (!capture && frozen.elements.length && editableIdentity(frozen) !== savedRef.current &&
          !await decide("replace")) {
        setStatus("Replacement cancelled. Your picture and notes are unchanged.");
        return false;
      }
      modeRef.current = null;
      setArmed(null);
      draftsRef.current = {};
      setDrafts({});
      applyCandidate(apiRef.current, candidate, drawingOffsets());
      reconcile(apiRef.current, { mode: null });
      savedRef.current = editable ? editableIdentity(freezeScene(apiRef.current)) : null;
      scheduleReconcile();
      setStatus(editable ? "Editable drawing opened." : "Picture ready. Choose a markup tool.");
      return true;
    } catch (error) {
      setStatus(`Nothing was replaced: ${error.message}`);
      return false;
    } finally {
      replacementRef.current = false;
      postToHost({ type: "replacementBusy", busy: false });
    }
  }, [decide, freezeDocument, scheduleReconcile]);

  // One appended picture: the drawing keeps its scene, numbering, notes and
  // saved baseline; the new picture arrives unlocked, selected and one Undo
  // step away. Paste, drop, File > Paste Picture and Add capture use it.
  const appendPicture = useCallback(async (dataURL) => {
    const api = apiRef.current;
    if (!api || replacementRef.current || decisionRef.current) return false;
    replacementRef.current = true;
    postToHost({ type: "replacementBusy", busy: true });
    try {
      const prepared = await preparePicture(dataURL);
      appendToScene(api, prepared, drawingOffsets());
      scheduleReconcile();
      setStatus("Picture added. Drag it to place it; double-click it to crop it.");
      return true;
    } catch (error) {
      setStatus(`The picture was not added: ${error.message}`);
      return false;
    } finally {
      replacementRef.current = false;
      postToHost({ type: "replacementBusy", busy: false });
    }
  }, [scheduleReconcile]);

  const canQuit = useCallback(async () => {
    if (replacementRef.current || saveRef.current) { setStatus("Finish or cancel the current operation before quitting."); return false; }
    const frozen = await freezeDocument();
    if (!frozen || !frozen.elements.length || editableIdentity(frozen) === savedRef.current) return true;
    replacementRef.current = true;
    postToHost({ type: "replacementBusy", busy: true });
    try { return await decide("quit"); }
    finally { replacementRef.current = false; postToHost({ type: "replacementBusy", busy: false }); }
  }, [decide, freezeDocument]);

  useEffect(() => {
    window.oraBridge = {
      prepareCapture,
      captureEnded: () => setAddingCapture(false),
      importCapture: (dataURL) => replaceDocument(() => preparePicture(dataURL), { capture: true }),
      appendCapture: (dataURL) => appendPicture(dataURL),
      openEditable: (contents) => replaceDocument(() => prepareEditable(contents), { editable: true }),
      document: () => {
        const api = apiRef.current;
        const current = readMarks(api);
        return {
          marks: current.map((mark) => ({
            number: mark.number,
            kind: mark.kind,
            note: mark.note,
          })),
          notes: notesText(current),
          elements: api
            .getSceneElements()
            .filter((element) => !element.isDeleted)
            .map((element) => ({
              id: element.id,
              type: element.type,
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
              angle: element.angle || 0,
              locked: Boolean(element.locked),
              text: element.text || null,
              number: markOf(element) ? markOf(element).number : null,
              role: partOf(element) ? partOf(element).role : null,
            })),
        };
      },
      isTextEditing: () => textEditing(),
      // ORA-347 — the native Edit menu's Copy asks this before flattening:
      // with objects selected the editor's own copy runs instead.
      hasSelection: () => hasObjectSelection(apiRef.current),
      undo: () => { if (!decisionRef.current) historyAction("undo"); },
      redo: () => { if (!decisionRef.current) historyAction("redo"); },
      copy: () => output("copy"),
      exportPdf: () => output("export"),
      saveEditable,
      canQuit,
      hostResult: (result) => {
        const request = requestsRef.current.get(result.id);
        if (!request) return;
        requestsRef.current.delete(result.id);
        if (result.error) request.reject(new Error(result.error));
        else request.resolve(result);
      },
    };
    return () => { delete window.oraBridge; };
  }, [appendPicture, canQuit, output, prepareCapture, replaceDocument, saveEditable]);

  // Capture at the document boundary: Excalidraw also has hidden scene-file
  // and paste routes. None may bypass preservation or local native saving.
  useEffect(() => {
    const readPicture = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("Could not read the picture."));
      reader.readAsDataURL(file);
    });
    const onDrop = async (event) => {
      const files = event.dataTransfer?.files;
      if (!files?.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const file = files[0];
      if (/\.excalidraw$/i.test(file.name) || file.type === "application/json") {
        replaceDocument(async () => prepareEditable(await file.text()), { editable: true });
      } else if (file.type.startsWith("image/")) {
        appendPicture(await readPicture(file));
      } else { setStatus("Drop a picture or an editable .excalidraw file."); }
    };
    const onPaste = async (event) => {
      if (textEditing(event.target)) return;
      const file = event.clipboardData?.files[0];
      if (!file?.type.startsWith("image/")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      appendPicture(await readPicture(file));
    };
    const onCopy = (event) => {
      if (textEditing(event.target) || hasObjectSelection(apiRef.current)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      output("copy");
    };
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey)) {
        if (!textEditing(event.target) && !event.altKey &&
            (/^[vhrdoalpxte0-9]$/i.test(event.key) || event.key === "Escape")) {
          modeRef.current = null;
          setArmed(null);
        }
        return;
      }
      const key = event.key.toLowerCase();
      // Carbon owns these global shortcuts. Never let a delivered key event
      // also reach the editor's Save handler or its drawing shortcuts.
      if (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && ["r", "w", "s"].includes(key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (key === "s" || key === "o" || (key === "c" && !textEditing(event.target)
          && !hasObjectSelection(apiRef.current))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (key === "s") saveEditable();
        else if (key === "o") postToHost({ type: "open" });
        else output("copy");
      }
    };
    const onDragOver = (event) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); };
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [appendPicture, output, replaceDocument, saveEditable]);

  const chooseBasicTool = (type) => {
    modeRef.current = null;
    setArmed(null);
    apiRef.current?.setActiveTool({ type, customType: null });
    focusEditor();
  };
  const historyAction = (name) => {
    commitDrafts();
    commitCanvasText();
    document.querySelector(`[data-testid="button-${name}"]`)?.click();
    focusEditor();
  };
  // Zoom forwards to Excalidraw's own zoom controls the way Undo and Redo
  // forward, so one zoom step here is one step in the editor's history.
  const zoomAction = (direction) => {
    document
      .querySelector(`#canvas .${direction === "in" ? "zoom-in-button" : "zoom-out-button"}`)
      ?.click();
    focusEditor();
  };
  // The menu button opens and closes the editor's existing canvas menu; the
  // dropdown appears beside the button and its items are unchanged. The
  // editor's own trigger is hidden, so the dropdown is placed from this
  // button's position once it renders.
  const toggleMenu = (event) => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    const open = api.getAppState().openMenu === "canvas";
    api.updateScene({ appState: { openMenu: open ? null : "canvas" } });
    focusEditor();
    if (open) {
      return;
    }
    const rect = event && event.currentTarget
      && event.currentTarget.getBoundingClientRect();
    requestAnimationFrame(() => {
      const dropdown = document.querySelector('#canvas .excalidraw .dropdown-menu');
      if (!dropdown || !rect) {
        return;
      }
      dropdown.classList.add("ora-beside-menu-button");
      dropdown.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - dropdown.offsetWidth - 8))}px`;
      dropdown.style.top = `${Math.round(rect.bottom + 6)}px`;
    });
  };
  const toggleStylePanel = () => setStyleOpen((open) => !open);
  const copyLabel = copyState === "copying" ? "Copying…" : copyState === "copied" ? "Copied" : "Copy result";
  const copyGlyph = copyState === "copied" ? "check" : "copy";

  return (
    <div id="app">
      <header inert={decision ? "" : undefined}>
        <div className="command-row" aria-label="Capture">
          <span className="step-number" aria-hidden="true">1</span><strong className="step-label">Capture</strong>
          <Command glyph="region" title="Capture Region (Control-Shift-R)" aria-keyshortcuts="Control+Shift+R" onClick={() => postToHost({ type: "captureRegion" })}>Region</Command>
          <Command glyph="window" title="Capture Window (Control-Shift-W)" aria-keyshortcuts="Control+Shift+W" onClick={() => postToHost({ type: "captureWindow" })}>Window</Command>
          <Command glyph="screen" title="Capture Screen (Control-Shift-S)" aria-keyshortcuts="Control+Shift+S" onClick={() => postToHost({ type: "captureScreen" })}>Screen</Command>
          <Command glyph="region" title="Add a captured region to the drawing" onClick={() => postToHost({ type: "captureRegion", append: true })}>Add Region</Command>
          <Command glyph="window" title="Add a captured window to the drawing" onClick={() => postToHost({ type: "captureWindow", append: true })}>Add Window</Command>
          <Command glyph="screen" title="Add a screen capture to the drawing" onClick={() => postToHost({ type: "captureScreen", append: true })}>Add Screen</Command>
          <Command glyph="image" title="Add a picture file to the drawing" onClick={() => postToHost({ type: "insertImage" })}>Insert image</Command>
          <label className={`capture-setting${addingCapture ? " disabled" : ""}`}>
            <input type="checkbox" disabled={addingCapture} checked={!addingCapture && discardExistingContents} onChange={(event) => setDiscardExistingContents(event.target.checked)} />
            Discard existing contents
          </label>
          <Command glyph="open" className="tool open-existing" onClick={() => postToHost({ type: "open" })}>Open Existing</Command>
        </div>
        <div className="command-row markup-row" aria-label="Markup">
          <span className="step-number" aria-hidden="true">2</span><strong className="step-label">Markup</strong>
          <div className="command-group">
            {BASIC_TOOLS.map(([type, label, glyph]) => <Command key={type} glyph={glyph}
              className={!armed && activeTool === type ? "tool armed" : "tool"}
              aria-pressed={!armed && activeTool === type} onClick={() => chooseBasicTool(type)}>{label}</Command>)}
          </div>
          <div className="command-group markup-second-row">
            <div className="command-group history-group">
              <Command glyph="undo" onClick={() => historyAction("undo")}>Undo</Command>
              <Command glyph="redo" onClick={() => historyAction("redo")}>Redo</Command>
              <Command glyph="zoomOut" title="Zoom out" onClick={() => zoomAction("out")}>Zoom out</Command>
              <Command glyph="zoomIn" title="Zoom in" onClick={() => zoomAction("in")}>Zoom in</Command>
              <Command glyph="menu" title="Open the canvas menu" onClick={toggleMenu}>Menu</Command>
            </div>
            <div className="command-group">
              {TOOLS.map((tool) => <Command key={tool.id} glyph={tool.glyph}
                className={armed === tool.id ? "tool armed" : "tool"} aria-pressed={armed === tool.id}
                onClick={() => armTool(tool)}>{tool.label}</Command>)}
              <Command glyph="crop" title="Set what the finished picture keeps" onClick={cropDrawing}>Crop drawing</Command>
              <Command glyph="fold"
                title={styleOpen ? "Hide style panel" : "Show style panel"} aria-pressed={styleOpen}
                onClick={toggleStylePanel}>{styleOpen ? "Hide style panel" : "Show style panel"}</Command>
            </div>
          </div>
        </div>
      </header>
      <div id="body" inert={decision ? "" : undefined}>
        <div id="canvas" className={styleOpen ? undefined : "style-folded"} onClickCapture={(event) => {
          if (event.target.closest(".scroll-back-to-content")) {
            event.stopPropagation();
            fitDrawing(apiRef.current);
          }
        }}>
          <Excalidraw
            // The dark surface lives behind transparent drawing canvases.
            // Keep light rendering so captured images are never inverted.
            theme="light"
            excalidrawAPI={onReady}
            onChange={onChange}
            onDuplicate={onDuplicate}
            initialData={{
              appState: {
                scrollX: 0,
                scrollY: 0,
                zoom: { value: 1 },
                viewBackgroundColor: "transparent",
              },
            }}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: false,
                clearCanvas: false,
                export: false,
                loadScene: false,
                saveToActiveFile: false,
                saveAsImage: false,
                toggleTheme: false,
              },
              tools: { image: false },
            }}
          >
            <MainMenu>
              <MainMenu.Item onSelect={() => chooseBasicTool("frame")}>Frame</MainMenu.Item>
              <MainMenu.Item onSelect={() => chooseBasicTool("embeddable")}>Embed</MainMenu.Item>
              <MainMenu.Item onSelect={() => chooseBasicTool("laser")}>Laser pointer</MainMenu.Item>
              <MainMenu.Item onSelect={() => apiRef.current?.updateScene({ appState: { penMode: !apiRef.current.getAppState().penMode } })}>Toggle pen mode</MainMenu.Item>
              <MainMenu.Item onSelect={() => { const api = apiRef.current; api?.updateScene({ appState: { activeTool: { ...api.getAppState().activeTool, locked: !api.getAppState().activeTool.locked } } }); }}>Keep drawing tool active</MainMenu.Item>
              <MainMenu.Item onSelect={() => apiRef.current?.updateScene({ appState: { openDialog: { name: "ttd", tab: "mermaid" } } })}>Mermaid diagram</MainMenu.Item>
              <MainMenu.DefaultItems.Help />
            </MainMenu>
            <WelcomeScreen>
              <WelcomeScreen.Center>
                <div className="welcome-title">Ora Screen Markup</div>
                <p>Capture a picture above, add a mark, then write its note beside the picture.</p>
              </WelcomeScreen.Center>
            </WelcomeScreen>
          </Excalidraw>
        </div>
        <aside className="spine" aria-label="Ora Screen Markup">
          <svg className="wordmark spine-mark" viewBox="0 0 121 256" role="img" aria-label="Ora" strokeWidth="5"><circle className="wm-stroke-base" cx="60.5" cy="60.5" r="38"/><circle className="wm-stroke-bright" cx="60.5" cy="60.5" r="25"/><path className="wm-stroke-base" d="M 35.5 141 A 25 25 0 0 1 85.5 141"/><rect className="wm-fill-base" x="33" y="113.5" width="5" height="55"/><rect className="wm-fill-base" x="83" y="180.5" width="5" height="55"/><circle className="wm-stroke-bright" cx="60.5" cy="208" r="25"/></svg>
          <span className="spine-name" aria-hidden="true">{["SCREEN", "MARKUP"].map((word) =>
            <span className="spine-word" key={word}>{[...word].map((letter, index) => <span key={index}>{letter}</span>)}</span>
          )}</span>
        </aside>
        <div id="notes">
          <div className="notes-heading">Markups</div>
          {marks.length === 0 ? (
            <div className="notes-empty">
              No marks yet. Draw an arrow, box, polygon, cloud or marker and it
              appears here with its own number.
            </div>
          ) : null}
          {marks.map((mark) => (
            <div className="note-row" key={mark.id}>
              <button
                type="button"
                className="note-number"
                title="Select this mark on the picture"
                onClick={() => selectMark(mark)}
              >
                {mark.number}
              </button>
              <div className="note-body">
                <div className="note-kind">{KIND_LABELS[mark.kind] || mark.kind}</div>
                <textarea
                  className="note-text"
                  rows={2}
                  placeholder="Write the note for this mark"
                  value={drafts[mark.id] !== undefined ? drafts[mark.id] : mark.note}
                  onChange={(event) => editNote(mark.id, event.target.value)}
                  onBlur={(event) => finishNote(mark.id, event.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <footer className="command-row output-row" aria-label="Output" inert={decision ? "" : undefined}>
        <span className="step-number" aria-hidden="true">3</span>
        <Command glyph={copyGlyph} className={`tool copy-action ${copyState}`} disabled={copyState === "copying"}
          aria-busy={copyState === "copying"} aria-live="polite" onClick={() => output("copy")}>{copyLabel}</Command>
        {window.oraReturnFolder ? (
          <Command glyph="export" onClick={() => output("send")}>Send to {returnToName}</Command>
        ) : null}
        <Command glyph="export" onClick={() => output("export")}>Export PDF</Command>
        <Command glyph="save" onClick={saveEditable}>Save editable</Command>
        <Command glyph="library" onClick={() => apiRef.current?.toggleSidebar({ name: "default", tab: "library" })}>Library</Command>
        <span id="status" role="status">{status}</span>
      </footer>
      {decision && <div className="decision-backdrop" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); finishDecision(false); } }}>
        <section className="decision" role="dialog" aria-modal="true" aria-labelledby="decision-title">
          <h2 id="decision-title">{decision === "quit" ? "Save your editable drawing before quitting?" : "Replace this unsaved drawing?"}</h2>
          <p>{decision === "quit" ? "Quitting discards this picture and its editable marks and notes unless you save them." : "The new picture or drawing is ready. Replacing will discard the current editable picture, marks and notes."}</p>
          <p>Copy result shares the picture and notes as one image. Export PDF keeps notes selectable. Save editable keeps the original pictures, including pixels under blur, and the marks for later editing.</p>
          <div className="decision-actions" aria-label="Preserve the current drawing">
            <Command glyph={copyGlyph} className={`tool copy-action ${copyState}`} disabled={copyState === "copying"}
              aria-busy={copyState === "copying"} aria-live="polite" onClick={() => output("copy")}>{copyLabel}</Command>
            <Command glyph="export" onClick={() => output("export")}>Export PDF</Command>
            <Command glyph="save" onClick={async () => { if (await saveEditable() && decision === "quit") { const current = await freezeDocument(); if (editableIdentity(current) === savedRef.current) finishDecision(true); } }}>{`Save editable${decision === "quit" ? " and quit" : ""}`}</Command>
          </div>
          <p className="dialog-status" role="status">{status}</p>
          <div className="decision-actions final-actions">
            <button type="button" className="tool" autoFocus onClick={() => finishDecision(false)}>Cancel</button>
            <button type="button" className="tool primary" onClick={() => finishDecision(true)}>{decision === "quit" ? "Discard and quit" : "Replace"}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
