/**
 * Keeps a cell's rendered output DOM alive across VS Code output re-mounts:
 * a released host is parked inside the document and adopted by the next
 * render of the same cell with the same body, or dropped after `graceMs`.
 * `release` must run while the output element is still in the document.
 */
interface LiveHost {
  cellId: string;
  body: unknown;
  host: HTMLElement;
}

interface ParkedHost {
  body: unknown;
  host: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
}

export class OutputHostPool {
  private readonly live = new Map<string, LiveHost>();
  private readonly parked = new Map<string, ParkedHost>();
  private parking: HTMLElement | undefined;

  constructor(
    private readonly graceMs: number,
    private readonly onDrop: (host: HTMLElement) => void,
    private readonly doc: Document = document
  ) {}

  /**
   * Returns the host to render `outputId` into, appended to `element`.
   * `reused` is true when the host already holds this cell's rendered body.
   */
  acquire(
    outputId: string,
    cellId: string,
    body: unknown,
    element: HTMLElement
  ): { host: HTMLElement; reused: boolean } {
    const current = this.live.get(outputId);
    if (current) {
      current.body = body;
      if (current.host.parentElement !== element) {
        element.appendChild(current.host);
      }
      return { host: current.host, reused: true };
    }

    const parked = this.parked.get(cellId);
    let host: HTMLElement | undefined;
    if (parked) {
      clearTimeout(parked.timer);
      this.parked.delete(cellId);
      if (typeof body === "string" && parked.body === body) {
        host = parked.host;
        host.style.width = "";
      } else {
        this.drop(parked.host);
      }
    }
    const reused = host !== undefined;
    host ??= this.doc.createElement("div");
    element.appendChild(host);
    this.live.set(outputId, { cellId, body, host });
    return { host, reused };
  }

  /** Parks the host of `outputId`; without an id, drops every host. */
  release(outputId?: string): void {
    if (outputId === undefined) {
      for (const { host } of this.live.values()) {
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

    const current = this.live.get(outputId);
    if (!current) {
      return;
    }
    this.live.delete(outputId);
    const previous = this.parked.get(current.cellId);
    if (previous) {
      clearTimeout(previous.timer);
      this.drop(previous.host);
    }
    if (!current.host.isConnected) {
      this.drop(current.host);
      return;
    }
    current.host.style.width = `${current.host.offsetWidth}px`;
    this.parkingLot().appendChild(current.host);
    const timer = setTimeout(() => {
      if (this.parked.get(current.cellId)?.host === current.host) {
        this.parked.delete(current.cellId);
        this.drop(current.host);
      }
    }, this.graceMs);
    this.parked.set(current.cellId, {
      body: current.body,
      host: current.host,
      timer,
    });
  }

  private drop(host: HTMLElement): void {
    this.onDrop(host);
    host.remove();
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
