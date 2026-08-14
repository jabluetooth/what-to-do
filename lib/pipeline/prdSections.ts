import type { PrdSection } from "@/lib/types";

export function replaceSection(sections: PrdSection[], key: string, content: string): PrdSection[] {
  return sections.map((s) => (s.key === key ? { ...s, content } : s));
}
