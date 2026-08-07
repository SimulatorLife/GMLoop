import path from "node:path";

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function severityName(severity) {
  return severity === 2 ? "error" : "warning";
}

export default function checkstyleFormatter(results) {
  const files = results
    .filter((result) => result.messages.length > 0)
    .map((result) => {
      const relativePath = path.relative(process.cwd(), result.filePath);
      const filename = (relativePath || result.filePath).split(path.sep).join("/");
      const messages = result.messages
        .map((message) => {
          const line = Math.max(1, Number(message.line) || 1);
          const column = Math.max(1, Number(message.column) || 1);
          const source = message.ruleId ? `eslint.${message.ruleId}` : "eslint";
          return `    <error line="${line}" column="${column}" severity="${severityName(message.severity)}" message="${escapeXml(message.message)}" source="${escapeXml(source)}" />`;
        })
        .join("\n");

      return `  <file name="${escapeXml(filename)}">\n${messages}\n  </file>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>\n<checkstyle version="8.0">\n${files}${files ? "\n" : ""}</checkstyle>\n`;
}
