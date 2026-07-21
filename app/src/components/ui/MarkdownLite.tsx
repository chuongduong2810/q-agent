import { Fragment, type ReactNode } from "react";

/**
 * A tiny, dependency-free Markdown renderer for the subset AI-generated ticket
 * comments actually use: paragraphs, `---` rules, `#`–`####` headings, `-`/`*`
 * bullet lists, fenced ``` code blocks, and inline **bold** / *italic* / `code`.
 *
 * Renders to React elements (never `dangerouslySetInnerHTML`), so there is no HTML
 * injection surface — untrusted text can't smuggle markup. Not a full CommonMark
 * implementation; it just makes the comment preview readable instead of showing
 * raw `**` / `-` characters (#comment-editor).
 */

/** Inline spans: **bold**, *italic*, `code`. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(<strong key={key++} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code key={key++} className="rounded bg-white/[0.08] px-1 py-0.5 font-mono text-[12px] text-ink">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const HR = /^(-{3,}|\*{3,}|_{3,})$/;
const BULLET = /^[-*]\s+/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const FENCE = /^```/;

export function MarkdownLite({ text, className = "" }: { text: string; className?: string }) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      i++;
      continue;
    }

    if (FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded-[10px] border border-white/[0.08] bg-black/30 p-3 font-mono text-[12px] leading-[1.5] text-ink-soft"
        >
          {code.join("\n")}
        </pre>,
      );
      continue;
    }

    if (HR.test(line)) {
      blocks.push(<hr key={key++} className="my-3 border-white/[0.1]" />);
      i++;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      const big = h[1].length <= 2;
      blocks.push(
        <div key={key++} className={`mb-1 mt-2.5 font-bold text-ink ${big ? "text-[15px]" : "text-[13px]"}`}>
          {renderInline(h[2])}
        </div>,
      );
      i++;
      continue;
    }

    if (BULLET.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && BULLET.test(lines[i].trim())) {
        items.push(<li key={items.length}>{renderInline(lines[i].trim().replace(BULLET, ""))}</li>);
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-1.5 list-disc space-y-1 pl-5">
          {items}
        </ul>,
      );
      continue;
    }

    // Paragraph: gather consecutive plain lines (soft line breaks kept as <br>).
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HR.test(lines[i].trim()) &&
      !BULLET.test(lines[i].trim()) &&
      !HEADING.test(lines[i].trim()) &&
      !FENCE.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1.5">
        {para.map((l, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(l)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className={`text-[13px] leading-[1.6] text-ink-soft ${className}`}>{blocks}</div>;
}
