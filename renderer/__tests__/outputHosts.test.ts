import { jest } from "@jest/globals";
import { JSDOM } from "jsdom";
import { OutputHostPool } from "../outputHosts.js";

let document: Document;

function outputElement(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

/** What VS Code does on replaceOutput: dispose, then remove the element */
function vscodeClear(pool: OutputHostPool, id: string, element: HTMLElement) {
  pool.release(id);
  element.remove();
}

describe("OutputHostPool", () => {
  let dropped: HTMLElement[];
  let pool: OutputHostPool;

  beforeEach(() => {
    jest.useFakeTimers();
    document = new JSDOM("<!doctype html><body></body>").window.document;
    dropped = [];
    pool = new OutputHostPool(
      1000,
      (host: HTMLElement) => dropped.push(host),
      document
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("re-mounts the live host when the same cell re-renders the same body", () => {
    const first = outputElement();
    const { host } = pool.acquire("out-1", "cell", "<div>fig</div>", first);
    host.textContent = "live state";

    vscodeClear(pool, "out-1", first);
    expect(host.isConnected).toBe(true);

    const second = outputElement();
    const again = pool.acquire("out-2", "cell", "<div>fig</div>", second);
    expect(again).toEqual({ host, reused: true });
    expect(host.parentElement).toBe(second);
    expect(host.textContent).toBe("live state");

    jest.advanceTimersByTime(5000);
    expect(dropped).toEqual([]);
  });

  it("drops the parked host when the cell renders a different body", () => {
    const first = outputElement();
    const { host } = pool.acquire("out-1", "cell", "old", first);
    vscodeClear(pool, "out-1", first);

    const next = pool.acquire("out-2", "cell", "new", outputElement());
    expect(next.reused).toBe(false);
    expect(next.host).not.toBe(host);
    expect(dropped).toEqual([host]);
    expect(host.isConnected).toBe(false);
  });

  it("does not reuse hosts across cells or for non-string bodies", () => {
    const a = outputElement();
    pool.acquire("out-1", "a", "same", a);
    vscodeClear(pool, "out-1", a);
    expect(pool.acquire("out-2", "b", "same", outputElement()).reused).toBe(
      false
    );

    const body = { type: "tree" };
    const c = outputElement();
    pool.acquire("out-3", "c", body, c);
    vscodeClear(pool, "out-3", c);
    expect(pool.acquire("out-4", "c", body, outputElement()).reused).toBe(
      false
    );
  });

  it("drops an unclaimed parked host after the grace period", () => {
    const element = outputElement();
    const { host } = pool.acquire("out-1", "cell", "body", element);
    vscodeClear(pool, "out-1", element);

    jest.advanceTimersByTime(999);
    expect(dropped).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(dropped).toEqual([host]);
    expect(host.isConnected).toBe(false);
  });

  it("returns the same host when VS Code re-renders the same output id", () => {
    const element = outputElement();
    const { host } = pool.acquire("out-1", "cell", "a", element);
    expect(pool.acquire("out-1", "cell", "b", element)).toEqual({
      host,
      reused: true,
    });
  });

  it("drops every host when released without an id", () => {
    const live = pool.acquire("out-1", "a", "x", outputElement()).host;
    const element = outputElement();
    const parked = pool.acquire("out-2", "b", "y", element).host;
    vscodeClear(pool, "out-2", element);

    pool.release();
    expect(dropped).toEqual([live, parked]);
    jest.advanceTimersByTime(5000);
    expect(dropped).toHaveLength(2);
  });
});
