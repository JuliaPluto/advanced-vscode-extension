import {
  CellResultData,
  PROGRESS_LOG_LEVEL,
  STDOUT_LOG_LEVEL,
} from "@plutojl/rainbow";

import {
  html,
  OutputBody,
  ANSITextOutput,
  useEffect,
  setup_mathjax,
  useState,
  useErrorBoundary,
  useMemo,
} from "@plutojl/rainbow/ui";
import { type RendererContext } from "vscode-notebook-renderer";

const useMathjaxEffect = () =>
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "pluto-external-source";
    link.id = "MathJax-script";
    link.href =
      "https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg-full.js";
    link.type = "text/javascript";
    document.head.appendChild(link);
    setup_mathjax();
  }, []);

/** @jsxImportSource preact */

interface PlutoOutputProps {
  state: CellResultData;
  context: RendererContext<void>;
}
const cutMime = (s: { msg: string }, l = 88) => {
  return (s?.msg?.slice(0, s.msg.lastIndexOf(",")) ?? ``)
    .toString()
    .padEnd(l, ` `);
};

export function PlutoOutput({ state, context }: PlutoOutputProps) {
  useMathjaxEffect();
  const [error, resetError] = useErrorBoundary();

  const [localState, setLocalState] = useState(state);
  const [progress, setProgress] = useState<any>(null);
  const [terminal, setTerminal] = useState<any>(null);
  const [logs, setLogs] = useState<any>(null);

  useEffect(() => {
    // Listen for messages from the controller
    const d = context.onDidReceiveMessage?.((message) => {
      if (message.cell_id !== localState.cell_id) {
        return;
      }
      // Placeholder: Handle different message types from controller
      switch (message.type) {
        case "setState": {
          const state = message.state as CellResultData;
          setLocalState({ ...state });

          const logs = state.logs.filter((log) => {
            return (
              log.level.toString() !== PROGRESS_LOG_LEVEL &&
              log.level.toString() !== STDOUT_LOG_LEVEL
            );
          });
          const stdout = state.logs.filter((log) => {
            return log.level.toString() === STDOUT_LOG_LEVEL;
          });
          const prog = state.logs.filter((log) => {
            return log.level.toString() === PROGRESS_LOG_LEVEL;
          });
          setLogs(logs);
          setTerminal(stdout);
          // TODO: This is more sophisticated; it has mime type in
          const result = prog[prog.length - 1]?.kwargs?.[0]?.[1]?.[0];
          setProgress(100 * parseFloat(result === "done" ? "1" : result));
          break;
        }
        case "bond":
        default:
          console.log("[RENDERER] Unknown message type:", message.type);
      }
    });
    return () => d?.dispose();
  }, [state.cell_id, context]);

  const OUTPUT = useMemo(() => {
    const { mime, body } = localState.output ?? {};
    const fixedMime =
      (mime === "application/vnd.pluto.stacktrace+object" &&
        (typeof body !== "object" ||
          !("stacktrace" in localState.output.body))) ||
      (mime === "application/vnd.pluto.tree+object" &&
        (typeof body !== "object" || !("type" in localState.output.body)))
        ? "text/plain"
        : localState.output.mime;
    if (localState.output?.mime)
      return html`<${OutputBody}
    persist_js_state="${localState.output?.persist_js_state}"
    body="${localState.output?.body}"
    mime="${fixedMime}"
    sanitize_html="${false /* Maybe reconsider */}"
  ></${OutputBody}>`;
    return "Loading...";
  }, [
    localState,
    localState.cell_id,
    localState.output?.mime,
    localState.output?.body,
    localState.running,
    localState.errored,
  ]);

  if (error) {
    console.error(error);
    return html`<div onclick=${resetError}>
      An error occured. Click <button onClick=${resetError}>here</button> to
      reset the view
      <details>
        <summary>View error</summary>
        (Thank you for using a pre-release. This is on us. Please copy-paste
        this and send it our way! Sorry again!)
        <pre>${JSON.stringify(error)}</pre>
      </details>
    </div>`;
  }
  return html` ${localState.running && progress
    ? html`<div>
        <label for=${`progress_${localState.cell_id}`}> ${progress}% </label
        ><progress
          style="width: 240px;"
          id=${`progress_${localState.cell_id}`}
          max="100"
          value=${progress}
        ></progress>
      </div>`
    : null}
  ${OUTPUT}
  ${terminal?.length
    ? html`<details>
          <summary>stdout</summary>
          <${ANSITextOutput}
            body="${terminal.map(cutMime).join("\n")}"
          ></${ANSITextOutput}>
        </details>`
    : null}
  ${logs?.length
    ? html`<details open>
          <summary>Logs</summary>
            <${ANSITextOutput} 
               body="${logs.map(cutMime).join("\n")}"
             ></${ANSITextOutput}>
        </details>`
    : null}`;
}
