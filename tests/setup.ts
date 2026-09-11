import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * jsdom implements the <dialog> element but not always its modal methods.
 * AppDialog is built on the native element for free focus trapping and top-layer
 * behaviour, so tests that render any dialog need these to exist. The shims only
 * fill in what is missing and keep the `open` attribute in sync, which is what
 * assertions and the component's own effects rely on.
 */
const dialogPrototype = globalThis.HTMLDialogElement?.prototype;
if (dialogPrototype) {
  if (typeof dialogPrototype.showModal !== "function") {
    dialogPrototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (typeof dialogPrototype.show !== "function") {
    dialogPrototype.show = function show(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (typeof dialogPrototype.close !== "function") {
    dialogPrototype.close = function close(this: HTMLDialogElement, returnValue?: string) {
      this.open = false;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.dispatchEvent(new Event("close"));
    };
  }
}

/**
 * jsdom has no layout, so it implements no scrolling. Any transcript that
 * keeps itself pinned to the newest message calls this on every update, and
 * without a stub the component throws instead of rendering.
 */
if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

/**
 * jsdom dispatches pointer events but implements no pointer capture. Anything
 * that drags — the workflow preview pans this way — captures the pointer so a
 * gesture survives leaving the element, and would throw here without these.
 * The shims track the captured id so `hasPointerCapture` stays truthful.
 */
if (typeof Element !== "undefined" && typeof Element.prototype.setPointerCapture !== "function") {
  const captured = new WeakMap<Element, Set<number>>();
  Element.prototype.setPointerCapture = function setPointerCapture(this: Element, pointerId: number) {
    const ids = captured.get(this) ?? new Set<number>();
    ids.add(pointerId);
    captured.set(this, ids);
  };
  Element.prototype.releasePointerCapture = function releasePointerCapture(this: Element, pointerId: number) {
    captured.get(this)?.delete(pointerId);
  };
  Element.prototype.hasPointerCapture = function hasPointerCapture(this: Element, pointerId: number) {
    return captured.get(this)?.has(pointerId) ?? false;
  };
}

afterEach(() => {
  cleanup();
});
