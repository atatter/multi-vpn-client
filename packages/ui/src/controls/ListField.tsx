import { type ReactNode, useState } from "react";
import { TextField } from "./TextField.tsx";

/** Comma- or space-separated values edited as one line (DNS servers, interface addresses). Keeps the typed text as is. */
export function ListField({ values, onChange, ...props }: { label: string; values: readonly string[]; onChange: (values: string[]) => void; error?: string | undefined; hint?: ReactNode; placeholder?: string }) {
  const [text, setText] = useState(values.join(", "));
  return (
    <TextField
      {...props}
      monospace
      value={text}
      onChange={(next) => {
        setText(next);
        onChange(next.split(/[\s,]+/).filter(Boolean));
      }}
    />
  );
}
