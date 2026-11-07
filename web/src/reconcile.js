import {
  CaptureUpdateAction,
  newElementWith,
} from "@excalidraw/excalidraw";
import {
  BACKGROUND,
  BADGE_HEIGHT,
  MARK,
  PART,
  allocateNumber,
  badgeSize,
  cloudPoints,
  createBadgeElements,
  createLineElement,
  createNumberLabel,
  createTextElement,
  isBackground,
  isMarkable,
  markOf,
  newId,
  outlineAnchor,
  partOf,
  resizeTextElement,
  toScene,
} from "./marks.js";

// Where a callout's text sits beside the arrow it belongs to.
const CALLOUT_OFFSET = { x: 14, y: -10 };

// A cropped picture carries a mark of its own while the crop is there. When
// the crop is undone the mark goes with it.
function isMarkOwner(element) {
  if (isBackground(element)) {
    return Boolean(element.crop);
  }
  return true;
}

/** The marks in a list of elements, in number order. */
export function marksFrom(elements) {
  const marks = [];
  for (const element of elements) {
    if (element.isDeleted) {
      continue;
    }
    const mark = markOf(element);
    if (!mark || !isMarkOwner(element)) {
      continue;
    }
    marks.push({
      id: mark.id,
      number: mark.number,
      kind: mark.kind,
      note: mark.note || "",
      ownerId: element.id,
    });
  }
  marks.sort((a, b) => (a.number || 0) - (b.number || 0));
  return marks;
}

export function readMarks(api) {
  return marksFrom(api.getSceneElements());
}

function nativeKind(element) {
  switch (element.type) {
    case "arrow":
      return "arrow";
    case "rectangle":
    case "ellipse":
    case "diamond":
      return "shape";
    case "line":
      return "line";
    case "freedraw":
      return "freehand";
    case "text":
      return "text";
    default:
      return null;
  }
}

function applyElements(api, elements, captureUpdate) {
  api.updateScene({ elements, captureUpdate });
}

function badgeElements(mark, x, y) {
  const [circle, label] = createBadgeElements(mark, x, y);
  return { circle, label, size: badgeSize(mark.number) };
}

/**
 * Turns the rectangle the user has just drawn into the shape the tool makes:
 * a revision cloud.
 */
export function toolShape(api, drawn, kind) {
  if (kind === "cloud") {
    const mark = {
      id: newId("m"),
      number: allocateNumber(api.getSceneElements()),
      kind: "cloud",
      note: "",
    };
    const cloud = createLineElement(
      cloudPoints({
        x: drawn.x,
        y: drawn.y,
        width: drawn.width,
        height: drawn.height,
      }),
      {
        strokeColor: "#1b1b1f",
        strokeWidth: 2,
        customData: { [MARK]: mark },
      },
    );
    return { shape: cloud, message: null };
  }
  return { shape: null, message: null };
}

/**
 * Brings the derived state back in line with the live scene: every drawn
 * element becomes a numbered mark, badges follow their owner's geometry and
 * companions never outlive their owner. Derived updates are never captured by
 * the undo history, so badges never cost an undo step of their own.
 */
export function reconcile(api, state) {
  const appState = api.getAppState();
  const elements = api.getSceneElementsIncludingDeleted();
  const busy = Boolean(
    appState.newElement ||
      appState.multiElement ||
      appState.editingTextElement ||
      appState.editingLinearElement ||
      appState.croppingElementId,
  );
  if (busy) {
    return { changed: false, marks: readMarks(api), message: null };
  }

  const mode = state.mode || null;
  const next = elements.slice();
  const indexById = new Map(next.map((element, index) => [element.id, index]));
  const additions = [];
  let changed = false;
  let message = null;

  const replaceAt = (id, updated) => {
    const index = indexById.get(id);
    if (index === undefined) {
      return;
    }
    next[index] = updated;
    changed = true;
  };

  // 1. Brand new elements become numbered marks, and the tools turn the
  //    element the user just drew into their own shape.
  for (const element of next.slice()) {
    if (element.isDeleted) {
      continue;
    }
    // Clouds outline content without covering it, including older drawings
    // and clouds whose fill was changed in the style panel.
    if (markOf(element)?.kind === "cloud" && element.backgroundColor !== "transparent") {
      replaceAt(element.id, newElementWith(element, { backgroundColor: "transparent" }));
    }
    if (element.customData && Object.keys(element.customData).length) {
      continue;
    }
    if (!isMarkable(element)) {
      continue;
    }

    if (mode === "polygon" && element.type === "line") {
      const points = element.points || [];
      const closed =
        points.length > 2
          ? [...points, [points[0][0], points[0][1]]]
          : points;
      const mark = {
        id: newId("m"),
        number: allocateNumber(next),
        kind: closed.length > points.length ? "polygon" : "line",
        note: "",
      };
      replaceAt(
        element.id,
        newElementWith(element, {
          points: closed,
          backgroundColor: "#e8f0fe",
          fillStyle: "solid",
          roundness: null,
          customData: { [MARK]: mark },
          groupIds: [mark.id],
        }),
      );
      continue;
    }

    if (mode === "highlight" && element.type === "freedraw") {
      const mark = {
        id: newId("m"),
        number: allocateNumber(next),
        kind: "highlight",
        note: "",
      };
      replaceAt(
        element.id,
        newElementWith(element, {
          strokeWidth: 8,
          strokeColor: "#ffd60a",
          backgroundColor: "transparent",
          fillStyle: "solid",
          opacity: 45,
          simulatePressure: false,
          customData: { [MARK]: mark },
          groupIds: [mark.id],
        }),
      );
      continue;
    }

    const kind = nativeKind(element);
    if (!kind) {
      continue;
    }
    const mark = {
      id: newId("m"),
      number: allocateNumber(next),
      kind: mode === "callout" && element.type === "arrow" ? "callout" : kind,
      note: "",
    };
    replaceAt(
      element.id,
      newElementWith(element, {
        customData: { [MARK]: mark },
        groupIds: [mark.id],
      }),
    );
  }

  // 2. A cropped picture becomes a mark of its own, at its visible boundary.
  //    An undone crop keeps its mark attached but hidden (an uncropped
  //    picture is not a mark owner), so redoing the crop or cropping again
  //    brings back the same identity and number instead of a fresh one. The
  //    picture keeps its lock state and any group the user gave it; nothing
  //    here relocks a source picture.
  for (const element of next.slice()) {
    if (element.isDeleted || !isBackground(element)) {
      continue;
    }
    const mark = markOf(element);
    if (element.crop && !mark) {
      const cropMark = {
        id: newId("m"),
        number: allocateNumber(next),
        kind: "crop",
        note: "",
      };
      replaceAt(element.id, newElementWith(element, {
        customData: {
          ...element.customData,
          [BACKGROUND]: true,
          [MARK]: cropMark,
        },
      }));
    }
  }

  // 3. Companions and badges never outlive their owner.
  const owners = new Map();
  for (const element of next) {
    if (element.isDeleted) {
      continue;
    }
    const mark = markOf(element);
    if (mark && isMarkOwner(element)) {
      owners.set(mark.id, element);
    }
  }
  const partsByMark = new Map();
  // Companions whose element is deleted but still in the scene. A missing
  // companion is brought back under its old identity, so undoing its
  // deletion restores that same element instead of a second copy.
  const departedPartsByMark = new Map();
  for (const element of next) {
    const part = partOf(element);
    if (!part) {
      continue;
    }
    const map = element.isDeleted ? departedPartsByMark : partsByMark;
    if (!map.has(part.id)) {
      map.set(part.id, []);
    }
    map.get(part.id).push({ ...part, element });
  }

  for (const element of next) {
    // Companions already deleted stay as they are: touching them again would
    // change the scene on every pass and keep the editor churning forever.
    if (element.isDeleted) {
      continue;
    }
    const part = partOf(element);
    if (part && !owners.has(part.id)) {
      replaceAt(element.id, newElementWith(element, { isDeleted: true }));
    }
  }

  // Brings a deleted companion of a living mark back under its old identity.
  // Native undo/redo only knows elements it has seen, so restoring the same
  // element — instead of adding a fresh one — keeps one number on the picture
  // after the deletion is undone as well.
  const restorePart = (markId, role) => {
    const departed = (departedPartsByMark.get(markId) || []).find(
      (part) => part.role === role,
    );
    if (!departed) {
      return null;
    }
    replaceAt(departed.element.id, newElementWith(departed.element, { isDeleted: false }));
    return departed.element;
  };

  // 4. Badges follow their owner's geometry and always carry the right number.
  for (const [markId, owner] of owners) {
    const mark = markOf(owner);
    const parts = partsByMark.get(markId) || [];
    if (typeof mark.number !== "number") {
      const number = allocateNumber(next);
      replaceAt(
        owner.id,
        newElementWith(owner, {
          customData: { ...owner.customData, [MARK]: { ...mark, number } },
        }),
      );
      continue;
    }
    if (mark.kind === "marker") {
      const numberPart = parts.find((part) => part.role === "marker-number");
      if (!numberPart) {
        if (!restorePart(markId, "marker-number")) {
          additions.push(createNumberLabel(mark, owner, "marker-number"));
        }
        continue;
      }
      const label = numberPart.element;
      const size = badgeSize(mark.number);
      const resized =
        (label.text || "") !== String(mark.number)
          ? resizeTextElement(label, String(mark.number))
          : label;
      const targetX = owner.x + (size.width - resized.width) / 2;
      const targetY = owner.y + (size.height - resized.height) / 2;
      if (
        Math.abs(resized.x - targetX) > 0.01 ||
        Math.abs(resized.y - targetY) > 0.01 ||
        resized !== label
      ) {
        replaceAt(label.id, newElementWith(resized, { x: targetX, y: targetY }));
      }
      continue;
    }
    const badge = parts.find((part) => part.role === "badge");
    if (!badge) {
      // Restore the missing parts under their old identities where they
      // exist; only a mark that never had them gets fresh ones.
      if (restorePart(markId, "badge")) {
        if (!parts.some((part) => part.role === "badge-text")) {
          restorePart(markId, "badge-text");
        }
        // The next pass moves whatever came back onto the owner's current
        // geometry and creates anything still missing.
        continue;
      }
      const anchor = outlineAnchor(owner);
      const created = badgeElements(
        mark,
        anchor.point.x + anchor.up.x * (BADGE_HEIGHT / 2),
        anchor.point.y + anchor.up.y * (BADGE_HEIGHT / 2),
      );
      // A number label still on the picture is kept, and the next pass moves
      // it onto the new circle.
      additions.push(created.circle);
      if (
        !parts.some((part) => part.role === "badge-text") &&
        !restorePart(markId, "badge-text")
      ) {
        additions.push(created.label);
      }
      continue;
    }
    const anchor = outlineAnchor(owner);
    const size = badgeSize(mark.number);
    const targetX =
      anchor.point.x + anchor.up.x * (BADGE_HEIGHT / 2) - size.width / 2;
    const targetY =
      anchor.point.y + anchor.up.y * (BADGE_HEIGHT / 2) - size.height / 2;
    if (
      Math.abs(badge.element.x - targetX) > 0.01 ||
      Math.abs(badge.element.y - targetY) > 0.01 ||
      Math.abs(badge.element.width - size.width) > 0.01 ||
      Math.abs(badge.element.height - size.height) > 0.01
    ) {
      replaceAt(
        badge.element.id,
        newElementWith(badge.element, {
          x: targetX,
          y: targetY,
          width: size.width,
          height: size.height,
        }),
      );
    }
    const labelPart = parts.find((part) => part.role === "badge-text");
    if (labelPart) {
      const label = labelPart.element;
      const resized =
        (label.text || "") !== String(mark.number)
          ? resizeTextElement(label, String(mark.number))
          : label;
      const labelX = targetX + (size.width - resized.width) / 2;
      const labelY = targetY + (size.height - resized.height) / 2;
      if (
        Math.abs(resized.x - labelX) > 0.01 ||
        Math.abs(resized.y - labelY) > 0.01 ||
        resized !== label
      ) {
        replaceAt(label.id, newElementWith(resized, { x: labelX, y: labelY }));
      }
    } else if (!restorePart(markId, "badge-text")) {
      // The number alone can be selected and deleted; put it back so the
      // mark keeps its identifying number on the picture and in exports.
      additions.push(
        createNumberLabel(mark, { x: targetX, y: targetY }, "badge-text"),
      );
    }
  }

  // 5. A callout's text sits at the end of its arrow, and a note typed on
  //    the canvas is the note in the list.
  for (const [markId, owner] of owners) {
    const mark = markOf(owner);
    const parts = partsByMark.get(markId) || [];
    const companion = parts.find((part) => part.role === "callout-text");
    // Undoing a callout's deletion brings the owner back without its text:
    // the editor's history recorded only the owner going away. Bring the
    // text back under its old identity, as the badge parts are brought
    // back, so undo returns the complete mark. The next pass moves it to
    // the arrow's tip. But undoing a first note restores the empty note
    // and takes the text away, and that is the state Undo was asked for:
    // the text is only revived while the note it belongs to still has
    // text, so reconciliation cannot resurrect what Undo removed.
    if (
      mark.kind === "callout" &&
      !companion &&
      mark.note &&
      restorePart(markId, "callout-text")
    ) {
      continue;
    }
    if (mark.kind === "callout" && companion) {
      const points = owner.points || [[0, 0]];
      const tip = toScene(owner, points[points.length - 1]);
      const targetX = tip.x + CALLOUT_OFFSET.x;
      const targetY = tip.y + CALLOUT_OFFSET.y;
      if (
        Math.abs(companion.element.x - targetX) > 0.01 ||
        Math.abs(companion.element.y - targetY) > 0.01
      ) {
        replaceAt(
          companion.element.id,
          newElementWith(companion.element, { x: targetX, y: targetY }),
        );
      }
    }
    const textElement =
      mark.kind === "text" ? owner : companion ? companion.element : null;
    if (!textElement) {
      continue;
    }
    const canvasText = textElement.text || "";
    if (canvasText !== (mark.note || "")) {
      replaceAt(
        owner.id,
        newElementWith(owner, {
          customData: { ...owner.customData, [MARK]: { ...mark, note: canvasText } },
        }),
      );
    }
  }

  if (changed || additions.length) {
    applyElements(api, next.concat(additions), CaptureUpdateAction.NEVER);
  }

  return {
    changed: Boolean(changed || additions.length),
    marks: readMarks(api),
    message,
  };
}

/** Writes a note typed in the list, keeping the canvas text in step. */
export function setNote(api, markId, text) {
  const elements = api.getSceneElements();
  const owner = elements.find(
    (element) => !element.isDeleted && markOf(element) && markOf(element).id === markId,
  );
  if (!owner) {
    return;
  }
  const mark = markOf(owner);
  const indexById = new Map(elements.map((element, index) => [element.id, index]));
  const next = elements.slice();
  const updates = [];
  const additions = [];

  if (mark.kind === "text") {
    // One change carries both the new canvas text and the new note.
    const resized = resizeTextElement(owner, text);
    updates.push(
      newElementWith(resized, {
        customData: { ...owner.customData, [MARK]: { ...mark, note: text } },
      }),
    );
  } else {
    updates.push(
      newElementWith(owner, {
        customData: { ...owner.customData, [MARK]: { ...mark, note: text } },
      }),
    );
    const companion = elements.find(
      (element) =>
        !element.isDeleted &&
        partOf(element) &&
        partOf(element).id === markId &&
        partOf(element).role === "callout-text",
    );
    if (companion) {
      updates.push(resizeTextElement(companion, text));
    } else if (text && mark.kind === "callout") {
      const points = owner.points || [[0, 0]];
      const tip = toScene(owner, points[points.length - 1]);
      additions.push(
        createTextElement(text, tip.x + CALLOUT_OFFSET.x, tip.y + CALLOUT_OFFSET.y, {
          customData: { [PART]: { id: markId, role: "callout-text" } },
          groupIds: [markId],
        }),
      );
    }
  }

  for (const updated of updates) {
    const index = indexById.get(updated.id);
    if (index !== undefined) {
      next[index] = updated;
    }
  }
  applyElements(api, next.concat(additions), CaptureUpdateAction.IMMEDIATELY);
}
