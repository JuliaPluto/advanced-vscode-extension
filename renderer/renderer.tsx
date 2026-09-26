/** @jsxImportSource preact */
import type {
  ActivationFunction,
  RendererContext,
} from "vscode-notebook-renderer";
import { PlutoOutput } from "./components/PlutoOutput";
import { html, PlutoActionsContext, render } from "@plutojl/rainbow/ui";
import { CellResultData } from "@plutojl/rainbow";
import { OutputHostPool } from "./outputHosts";
import { fromTransport } from "../src/outputKind";
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

interface HostData {
  actions: object;
  context: RendererContext<void>;
}

export const activate: ActivationFunction = (
  context: RendererContext<void>
) => {
  // Inject styles once when renderer activates
  injectStyles();

  // Store messaging API for use in components
  messagingApi = context.postMessage;
  const pool = new OutputHostPool<HostData>(
    PARKED_OUTPUT_GRACE_MS,
    (cellId, isParked) => ({
      actions: {
        // TODO: Make get notebook actually get the notebook
        get_notebook: () => ({ cell_inputs: {} }),
        request_js_link_response: () => {},
        update_notebook: () => {},
        set_bond: (name: string, value: any) => {
          if (isParked()) {
            return;
          }
          postMessageToController({
            type: "bond",
            name,
            value,
            cell_id: cellId,
          });
        },
      },
      context: Object.create(context, {
        onDidReceiveMessage: {
          value: ((listener, thisArg, disposables) =>
            context.onDidReceiveMessage!(
              (message) => {
                if (!isParked()) {
                  listener.call(thisArg, message);
                }
              },
              undefined,
              disposables
            )) satisfies RendererContext<void>["onDidReceiveMessage"],
        },
      }),
    }),
    (host) => render("", host.element)
  );
  context.onDidReceiveMessage?.((message) => {
    if (message?.type === "setState") {
      pool.noteDisplayed(message.cell_id, message.state?.output);
    }
  });

  return {
    renderOutputItem(outputItem, element) {
      const sent: CellResultData = outputItem.json();
      const { host } = pool.acquire(
        outputItem.id,
        sent.cell_id,
        sent.output,
        element
      );
      const state = { ...sent, output: fromTransport(sent.output) };
      render(
        html`<${PlutoActionsContext.Provider} value=${host.data.actions}>
          <${PlutoOutput} state=${state} context=${host.data.context} />
        </${PlutoActionsContext.Provider}>`,
        host.element
      );
    },
    disposeOutputItem(id) {
      pool.release(id);
    },
  };
};
