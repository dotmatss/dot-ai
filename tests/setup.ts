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

afterEach(() => {
  cleanup();
});
