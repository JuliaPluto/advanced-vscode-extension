/** @jsxImportSource preact */
import type {
  ActivationFunction,
  RendererContext,
} from "vscode-notebook-renderer";
import { PlutoOutput } from "./components/PlutoOutput";
import { html, PlutoActionsContext, render } from "@plutojl/rainbow/ui";
import { CellResultData } from "@plutojl/rainbow";
import { OutputHostPool } from "./outputHosts";
import plutoOutputStyles from "./styles/pluto-output.css";
import treeStyles from "./styles/tree.css";

/**
 * Communication bridge for sending messages to the controller
 */
let messagingApi: RendererContext<void>["postMessage"] | undefined;

/**
 * Send a message to the notebook controller
 */
export function postMessageToController(message: any): void {
  if (messagingApi) {
    messagingApi(message);
    console.log("[RENDERER] Sent message to controller:", message);
  } else {
    console.warn("[RENDERER] Messaging API not available");
  }
}

// Inject styles into the document
function injectStyles() {
  const styleId = "pluto-renderer-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = plutoOutputStyles + "\n" + treeStyles;
    document.head.appendChild(style);
  }
}

const PARKED_OUTPUT_GRACE_MS = 10_000;

export const activate: ActivationFunction = (
  context: RendererContext<void>
) => {
  // Inject styles once when renderer activates
  injectStyles();

  // Store messaging API for use in components
  messagingApi = context.postMessage;
  const pool = new OutputHostPool(PARKED_OUTPUT_GRACE_MS, (host) =>
    render(null, host)
  );
  const actionsByHost = new WeakMap<HTMLElement, object>();

  return {
    renderOutputItem(outputItem, element) {
      const state: CellResultData = outputItem.json();
      const { host } = pool.acquire(
        outputItem.id,
        state.cell_id,
        state.output?.body,
        element
      );
      let actions = actionsByHost.get(host);
      if (!actions) {
        actions = {
          // TODO: Make get notebook actually get the notebook
          get_notebook: () => ({ cell_inputs: {} }),
          request_js_link_response: () => {},
          update_notebook: () => {},
          set_bond: (name: string, value: any) => {
            postMessageToController({
              type: "bond",
              name,
              value,
              cell_id: state.cell_id,
            });
          },
        };
        actionsByHost.set(host, actions);
      }
      render(
        html`<${PlutoActionsContext.Provider} value=${actions}>
          <${PlutoOutput} state="${state}"  context=${context} />
        </${PlutoActionsContext.Provider}>`,
        host
      );
    },
    disposeOutputItem(id) {
      pool.release(id);
    },
  };
};
