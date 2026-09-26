/**
 * Keeps a cell's rendered output DOM alive across VS Code output re-mounts:
 * a released host is parked inside the document and adopted by the next
 * render of the same cell showing the same result, or dropped after `graceMs`.
 * `release` must run while the output element is still in the document.
 */

import { sentBodyKey } from "../src/outputKind";

/** The part of a Pluto cell output that decides whether a host can be reused */
export interface DisplayedOutput {
  body?: unknown;
  last_run_timestamp?: number;
  persist_js_state?: boolean | string;
}

export interface OutputHost<T> {
  cellId: string;
  element: HTMLElement;
  data: T;
  shown: DisplayedOutput | undefined;
  parked: boolean;
}

/**
 * Same body as sent (text, or the base64 of image bytes), and same run
 * unless the output asks to persist its JS state (Pluto re-mounts HTML on
 * every run otherwise, e.g. to reset `@bind`s).
 */
export function canAdopt(
  shown: DisplayedOutput | undefined,
  next: DisplayedOutput | undefined
): boolean {
  const key = sentBodyKey(next?.body);
  if (!next || !shown || key === undefined || sentBodyKey(shown.body) !== key) {
    return false;
  }
  const persist =
    next.persist_js_state === true || next.persist_js_state === "true";
  return persist || shown.last_run_timestamp === next.last_run_timestamp;
}

export class OutputHostPool<T> {
  private readonly live = new Map<string, OutputHost<T>>();
  private readonly parked = new Map<
    string,
    { host: OutputHost<T>; timer: ReturnType<typeof setTimeout> }
  >();
  private parking: HTMLElement | undefined;

  constructor(
    private readonly graceMs: number,
    private readonly create: (cellId: string, isParked: () => boolean) => T,
    private readonly onDrop: (host: OutputHost<T>) => void,
    private readonly doc: Document = document
  ) {}

  /** Returns the host to render `outputId` into, appended to `element`. */
  acquire(
    outputId: string,
    cellId: string,
    output: DisplayedOutput | undefined,
    element: HTMLElement
  ): { host: OutputHost<T>; reused: boolean } {
    const current = this.live.get(outputId);
    if (current) {
      current.shown = output;
      if (current.element.parentElement !== element) {
        element.appendChild(current.element);
      }
      return { host: current, reused: true };
    }

    let host: OutputHost<T> | undefined;
    const parked = this.parked.get(cellId);
    if (parked) {
      clearTimeout(parked.timer);
      this.parked.delete(cellId);
      if (canAdopt(parked.host.shown, output)) {
        host = parked.host;
        host.parked = false;
        host.element.style.width = "";
      } else {
        this.drop(parked.host);
      }
    }
    const reused = host !== undefined;
    if (!host) {
      const fresh = {
        cellId,
        element: this.doc.createElement("div"),
        shown: output,
        parked: false,
      };
      host = Object.assign(fresh, {
        data: this.create(cellId, () => fresh.parked),
      });
    }
    element.appendChild(host.element);
    this.live.set(outputId, host);
    return { host, reused };
  }

  /**
   * Records that the cell's live hosts now display `output`, updated in place.
   * An update without an output leaves what they display unchanged.
   */
  noteDisplayed(cellId: string, output: DisplayedOutput | undefined): void {
    if (output === undefined) {
      return;
    }
    for (const host of this.live.values()) {
      if (host.cellId === cellId) {
        host.shown = output;
      }
    }
  }

  /** Parks the host of `outputId`; without an id, drops every host. */
  release(outputId?: string): void {
    if (outputId === undefined) {
      for (const host of this.live.values()) {
        this.drop(host);
      }
      this.live.clear();
      for (const { host, timer } of this.parked.values()) {
        clearTimeout(timer);
        this.drop(host);
      }
      this.parked.clear();
      return;
    }

    const host = this.live.get(outputId);
    if (!host) {
      return;
    }
    this.live.delete(outputId);
    const previous = this.parked.get(host.cellId);
    if (previous) {
      clearTimeout(previous.timer);
      this.drop(previous.host);
    }
    if (!host.element.isConnected) {
      this.drop(host);
      return;
    }
    host.parked = true;
    host.element.style.width = `${host.element.offsetWidth}px`;
    this.parkingLot().appendChild(host.element);
    const timer = setTimeout(() => {
      if (this.parked.get(host.cellId)?.host === host) {
        this.parked.delete(host.cellId);
        this.drop(host);
      }
    }, this.graceMs);
    this.parked.set(host.cellId, { host, timer });
  }

  private drop(host: OutputHost<T>): void {
    host.parked = true;
    this.onDrop(host);
    host.element.remove();
  }

  private parkingLot(): HTMLElement {
    if (!this.parking?.isConnected) {
      this.parking = this.doc.createElement("div");
      this.parking.setAttribute("aria-hidden", "true");
      this.parking.style.cssText =
        "position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;";
      this.doc.body.appendChild(this.parking);
    }
    return this.parking;
  }
}
