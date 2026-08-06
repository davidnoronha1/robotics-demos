import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

export interface CodeEditor {
  el: HTMLElement;
  getValue(): string;
  setValue(v: string): void;
  showError(msg: string | null): void;
  destroy(): void;
}

/** CodeMirror 6 wrapper for the editable fusion source. Applying edits is
 * explicit (the caller reads `getValue()` on its own trigger, e.g. an Apply
 * button) rather than live — there's no change listener here. */
export function createCodeEditor(opts: { value: string; readOnly?: boolean }): CodeEditor {
  const wrap = document.createElement("div");
  wrap.className = "code-editor";

  const error = document.createElement("div");
  error.className = "code-editor-error";
  error.hidden = true;
  wrap.appendChild(error);

  const view = new EditorView({
    doc: opts.value,
    parent: wrap,
    extensions: [
      basicSetup,
      javascript(),
      oneDark,
      EditorView.lineWrapping,
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px" },
        ".cm-scroller": { overflow: "auto" },
      }),
    ],
  });

  return {
    el: wrap,
    getValue: () => view.state.doc.toString(),
    setValue: (v: string) => {
      if (view.state.doc.toString() !== v) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    },
    showError: (msg) => {
      error.textContent = msg ?? "";
      error.hidden = msg == null;
    },
    destroy: () => view.destroy(),
  };
}
