/** @jsxImportSource preact */
import type {
  ActivationFunction,
  RendererContext,
} from "vscode-notebook-renderer";
import { PlutoOutput } from "./components/PlutoOutput";
import { html, PlutoActionsContext, render } from "@plutojl/rainbow/ui";
import { CellResultData } from "@plutojl/rainbow";
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

export const activate: ActivationFunction = (
  context: RendererContext<void>
) => {
  // Inject styles once when renderer activates
  injectStyles();

  // Store messaging API for use in components
  messagingApi = context.postMessage;
  return {
    renderOutputItem(outputItem, element) {
      const state: CellResultData = outputItem.json();
      // Render directly into the provided element
      // This ensures VS Code can properly clear/replace outputs
      const actions = {
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
      render(
        html`<${PlutoActionsContext.Provider} value=${actions}>
          <${PlutoOutput} state="${state}"  context=${context} />
        </${PlutoActionsContext.Provider}>`,
        element
      );
    },
  };
};
