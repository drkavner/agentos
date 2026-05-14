/**
 * Normalizes SKILLS.md–style markdown for agent instance files:
 * LF line endings, trimmed lines, ATX headings spaced, collapsed blank runs, trailing newline.
 */
export function formatSkillsMarkdown(input: string): string {
  let s = String(input ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = s.split("\n");
  const lines: string[] = [];
  for (const line of rawLines) {
    const noTrail = line.replace(/[ \t]+$/, "");
    const hm = noTrail.match(/^(#{1,6})([^#\s].*)$/);
    const fixed = hm ? `${hm[1]!} ${hm[2]!}` : noTrail;
    lines.push(fixed);
  }
  s = lines.join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.trim();
  if (s.length > 0) s += "\n";
  return s;
}
