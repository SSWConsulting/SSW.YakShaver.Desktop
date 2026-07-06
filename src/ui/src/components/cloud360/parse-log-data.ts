/** Parsed display item from the agent stream */
export type DisplayItem =
  | { kind: "status"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | { kind: "tool-result"; text: string }
  | { kind: "error"; text: string }
  | { kind: "result"; summary: string; artifacts: string[] };

/** Redact proxy tokens and other secrets from display text */
export function redactSecrets(text: string): string {
  return text
    .replace(/x-yakshaver-proxy-token:\s*[^\s"'}\]]+/gi, "x-yakshaver-proxy-token: [REDACTED]")
    .replace(
      /-H\s+"x-yakshaver-proxy-token:\s*[^"]+"/gi,
      '-H "x-yakshaver-proxy-token: [REDACTED]"',
    )
    .replace(/[a-f0-9-]{36}\|[^|]+\|\d+\|[a-f0-9]{64}/gi, "[PROXY_TOKEN]")
    .replace(/oauth2:[^@]+@/gi, "oauth2:[REDACTED]@")
    .replace(/"temp_clone_token":"[^"]+"/g, '"temp_clone_token":"[REDACTED]"');
}

export function parseLogData(data: string, stream: string): DisplayItem[] {
  if (stream === "stderr") {
    return [{ kind: "error", text: redactSecrets(data) }];
  }

  const items: DisplayItem[] = [];
  const lines = data.split("\n").filter(Boolean);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);

      if (parsed.type === "system" || parsed.type === "start" || parsed.type === "ping") {
        continue;
      }
      if (parsed.type === "text" && parsed.file) {
        const path = parsed.file?.filePath ?? "";
        const name = path.split("/").pop() ?? path;
        items.push({
          kind: "tool-result",
          text: `Read ${name} (${parsed.file?.totalLines ?? "?"} lines)`,
        });
        continue;
      }
      if (parsed.stdout !== undefined) {
        const text = parsed.stdout ?? "";
        if (text.trim()) items.push({ kind: "tool-result", text: text.slice(0, 500) });
        continue;
      }

      if (parsed.type === "assistant" && parsed.message?.content) {
        for (const block of parsed.message.content) {
          if (block.type === "text" && block.text) {
            items.push({ kind: "text", text: block.text });
          } else if (block.type === "tool_use") {
            const name = block.name ?? "Tool";
            let detail = "";
            if (name === "Bash") detail = block.input?.command ?? "";
            else if (name === "Read") detail = block.input?.file_path ?? "";
            else if (name === "Write") detail = block.input?.file_path ?? "";
            else if (name === "Edit") detail = block.input?.file_path ?? "";
            else if (name === "Grep") detail = `"${block.input?.pattern ?? ""}"`;
            else if (name === "Glob") detail = block.input?.pattern ?? "";
            else detail = JSON.stringify(block.input ?? {}).slice(0, 150);
            items.push({ kind: "tool", name, detail: redactSecrets(detail) });
          } else if (block.type === "thinking" && block.thinking) {
            items.push({ kind: "thinking", text: block.thinking });
          }
        }
      } else if (parsed.type === "user") {
        const rawResult = parsed.tool_use_result;
        if (
          rawResult?.type === "image" ||
          (typeof rawResult === "object" && rawResult?.file?.type?.startsWith("image/"))
        ) {
          items.push({ kind: "tool-result", text: "[Image frame viewed by agent]" });
          continue;
        }

        const content = parsed.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              if (Array.isArray(block.content)) {
                const hasImage = block.content.some(
                  (c: Record<string, unknown>) => c.type === "image",
                );
                if (hasImage) {
                  items.push({ kind: "tool-result", text: "[Image frame viewed by agent]" });
                  continue;
                }
              }
              if (block.content) {
                const text =
                  typeof block.content === "string" ? block.content : JSON.stringify(block.content);
                if (text) items.push({ kind: "tool-result", text: redactSecrets(text) });
              }
            }
          }
        } else if (rawResult) {
          const text = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);
          items.push({ kind: "tool-result", text: redactSecrets(text) });
        }
      } else if (parsed.type === "result") {
        items.push({ kind: "result", summary: parsed.result ?? parsed.text ?? "", artifacts: [] });
      }
    } catch {
      const trimmed = line.trim();
      if (trimmed) {
        if (/^\d+\s{2,}/.test(trimmed)) continue;
        if (trimmed.startsWith('"type":"') || trimmed.startsWith('{"type":')) continue;
        items.push({ kind: "text", text: trimmed });
      }
    }
  }

  return items;
}
