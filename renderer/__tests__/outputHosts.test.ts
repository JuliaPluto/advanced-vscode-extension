/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import { jest } from "@jest/globals";
import {
  canAdopt,
  OutputHostPool,
  type DisplayedOutput,
  type OutputHost,
} from "../outputHosts.js";

function outputElement(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

/** What VS Code does on replaceOutput: dispose, then remove the element */
function vscodeClear(pool: OutputHostPool<unknown>, id: string, el: Element) {
  pool.release(id);
  el.remove();
}

const out = (body: unknown, stamp = 1, persist = false): DisplayedOutput => ({
  body,
  last_run_timestamp: stamp,
  persist_js_state: persist,
});

describe("canAdopt", () => {
  it("needs the same string body from the same run", () => {
    expect(canAdopt(out("a"), out("a"))).toBe(true);
    expect(canAdopt(out("a"), out("b"))).toBe(false);
    expect(canAdopt(out("a", 1), out("a", 2))).toBe(false);
    const tree = { type: "tree" };
    expect(canAdopt(out(tree), out(tree))).toBe(false);
    expect(canAdopt(undefined, out("a"))).toBe(false);
  });

  it("adopts an image re-sent with the same bytes", () => {
    const image = { $bytes: "iVBORw0K" };
    expect(canAdopt(out(image), out({ $bytes: "iVBORw0K" }))).toBe(true);
    expect(canAdopt(out(image), out({ $bytes: "R0lGODlh" }))).toBe(false);
    expect(canAdopt(out(image, 1), out({ $bytes: "iVBORw0K" }, 2))).toBe(false);
    expect(canAdopt(out(image), out("iVBORw0K"))).toBe(false);
  });

  it("ignores the run when the output persists its JS state", () => {
    expect(canAdopt(out("a", 1), out("a", 2, true))).toBe(true);
    expect(
      canAdopt(out("a", 1), { ...out("a", 2), persist_js_state: "true" })
    ).toBe(true);
  });
});

describe("OutputHostPool", () => {
  let dropped: OutputHost<unknown>[];
  let pool: OutputHostPool<unknown>;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = "";
    dropped = [];
    pool = new OutputHostPool<unknown>(
      1000,
      () => ({}),
      (host) => dropped.push(host)
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("re-mounts the live host when the cell re-renders the same result", () => {
    const first = outputElement();
    const { host } = pool.acquire("out-1", "cell", out("fig"), first);
    host.element.textContent = "live state";

    vscodeClear(pool, "out-1", first);
    expect(host.element.isConnected).toBe(true);
    expect(host.parked).toBe(true);

    const second = outputElement();
    const again = pool.acquire("out-2", "cell", out("fig"), second);
    expect(again).toEqual({ host, reused: true });
    expect(host.parked).toBe(false);
    expect(host.element.parentElement).toBe(second);
    expect(host.element.textContent).toBe("live state");

    jest.advanceTimersByTime(5000);
    expect(dropped).toEqual([]);
  });

  it("adopts by what the host displays after an in-place update", () => {
    const first = outputElement();
    const { host } = pool.acquire("out-1", "cell", out("A", 1), first);
    pool.noteDisplayed("cell", out("B", 2));
    vscodeClear(pool, "out-1", first);

    expect(pool.acquire("out-2", "cell", out("B", 2), outputElement())).toEqual(
      { host, reused: true }
    );
  });

  it("keeps the host identity for an update without an output", () => {
    const first = outputElement();
    const { host } = pool.acquire("out-1", "cell", out("A", 1), first);
    pool.noteDisplayed("cell", undefined);
    vscodeClear(pool, "out-1", first);

    expect(pool.acquire("out-2", "cell", out("A", 1), outputElement())).toEqual(
      { host, reused: true }
    );
  });

  it("does not update parked hosts in place", () => {
    const first = outputElement();
    pool.acquire("out-1", "cell", out("A", 1), first);
    vscodeClear(pool, "out-1", first);
    pool.noteDisplayed("cell", out("B", 2));

    expect(
      pool.acquire("out-2", "cell", out("B", 2), outputElement()).reused
    ).toBe(false);
  });

  it("mounts fresh when the cell re-runs, even with the same body", () => {
    const first = outputElement();
    const { host } = pool.acquire("out-1", "cell", out("slider", 1), first);
    vscodeClear(pool, "out-1", first);

    const next = pool.acquire(
      "out-2",
      "cell",
      out("slider", 2),
      outputElement()
    );
    expect(next.reused).toBe(false);
    expect(dropped).toEqual([host]);
    expect(host.element.isConnected).toBe(false);
  });

  it("does not reuse hosts across cells", () => {
    const a = outputElement();
    pool.acquire("out-1", "a", out("same"), a);
    vscodeClear(pool, "out-1", a);
    expect(
      pool.acquire("out-2", "b", out("same"), outputElement()).reused
    ).toBe(false);
  });

  it("drops an unclaimed parked host after the grace period", () => {
    const element = outputElement();
    const { host } = pool.acquire("out-1", "cell", out("body"), element);
    vscodeClear(pool, "out-1", element);

    jest.advanceTimersByTime(999);
    expect(dropped).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(dropped).toEqual([host]);
    expect(host.element.isConnected).toBe(false);
  });

  it("returns the same host when VS Code re-renders the same output id", () => {
    const element = outputElement();
    const { host } = pool.acquire("out-1", "cell", out("a"), element);
    expect(pool.acquire("out-1", "cell", out("b"), element)).toEqual({
      host,
      reused: true,
    });
  });

  it("drops every host when released without an id", () => {
    const live = pool.acquire("out-1", "a", out("x"), outputElement()).host;
    const element = outputElement();
    const parked = pool.acquire("out-2", "b", out("y"), element).host;
    vscodeClear(pool, "out-2", element);

    pool.release();
    expect(dropped).toEqual([live, parked]);
    expect(live.parked && parked.parked).toBe(true);
    jest.advanceTimersByTime(5000);
    expect(dropped).toHaveLength(2);
  });

  it("gives each new host its own data and a parked-state probe", () => {
    const probes: (() => boolean)[] = [];
    const withData = new OutputHostPool<number>(
      1000,
      (_cellId, isParked) => probes.push(isParked),
      () => {}
    );
    const element = outputElement();
    const { host } = withData.acquire("out-1", "cell", out("x"), element);
    expect(host.data).toBe(1);
    expect(probes[0]()).toBe(false);
    withData.release("out-1");
    expect(probes[0]()).toBe(true);
  });
});
