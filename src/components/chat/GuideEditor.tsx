import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { WAVE2_LIMITS } from "@shared/constants";
import type { DiscussionGuide, DiscussionRoom, GuideSection } from "@shared/types";
import { Alert, Button, cx, IconButton, Input, Select, Textarea } from "@/components/ui";

export interface GuideDraftQuestion {
  id?: string;
  text: string;
  roomId: string | null;
}
export interface GuideDraftSection {
  title: string;
  questions: GuideDraftQuestion[];
}

const fromGuide = (guide: DiscussionGuide | null): GuideDraftSection[] =>
  guide?.sections.length ? guide.sections.map((s) => ({ title: s.title, questions: s.questions.map((q) => ({ id: q.id, text: q.text, roomId: q.roomId })) })) : [{ title: "Questions", questions: [{ text: "", roomId: null }] }];

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
}

/**
 * Edit the discussion guide: sections of questions, each question optionally
 * pinned to a room. Saved as a whole with the version we started from.
 */
export function GuideEditor({ guide, rooms, onSave, onCancel, saving, error }: { guide: DiscussionGuide | null; rooms: DiscussionRoom[]; onSave: (sections: GuideSection[], expectedVersion: number | undefined) => void; onCancel: () => void; saving?: boolean; error?: string | null }) {
  const [sections, setSections] = useState<GuideDraftSection[]>(() => fromGuide(guide));
  const total = sections.reduce((n, s) => n + s.questions.length, 0);

  const patchSection = (i: number, p: Partial<GuideDraftSection>) => setSections((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const patchQuestion = (i: number, k: number, p: Partial<GuideDraftQuestion>) =>
    patchSection(i, { questions: (sections[i]?.questions ?? []).map((q, j) => (j === k ? { ...q, ...p } : q)) });

  const submit = () => {
    const cleaned: GuideSection[] = sections
      .map((s) => ({
        title: s.title.trim() || "Questions",
        questions: s.questions.filter((q) => q.text.trim()).map((q) => ({ id: q.id ?? "", text: q.text.trim(), roomId: q.roomId })),
      }))
      .filter((s) => s.questions.length > 0);
    onSave(cleaned, guide?.version);
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {sections.map((s, i) => (
        <fieldset key={i} className="rounded-card border border-line p-4">
          <div className="mb-3 flex items-center gap-2">
            <Input aria-label={`Section ${i + 1} title`} value={s.title} maxLength={120} onChange={(e) => patchSection(i, { title: e.target.value })} className="h-10" />
            <IconButton icon={ArrowUp} label="Move section up" className="size-9" disabled={i === 0} onClick={() => setSections((p) => move(p, i, i - 1))} />
            <IconButton icon={ArrowDown} label="Move section down" className="size-9" disabled={i === sections.length - 1} onClick={() => setSections((p) => move(p, i, i + 1))} />
            <IconButton icon={Trash2} label="Remove section" className="size-9" disabled={sections.length === 1} onClick={() => setSections((p) => p.filter((_, j) => j !== i))} />
          </div>
          <ol className="space-y-2">
            {s.questions.map((q, k) => (
              <li key={q.id ?? `new-${k}`} className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
                <Textarea aria-label={`Question ${k + 1} in ${s.title || `section ${i + 1}`}`} rows={2} maxLength={500} value={q.text} onChange={(e) => patchQuestion(i, k, { text: e.target.value })} placeholder="Write a question" />
                <Select aria-label="Pin to room" value={q.roomId ?? ""} onChange={(e) => patchQuestion(i, k, { roomId: e.target.value || null })} className="h-10">
                  <option value="">Not pinned</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </Select>
                <div className="flex">
                  <IconButton icon={ArrowUp} label="Move question up" className="size-9" disabled={k === 0} onClick={() => patchSection(i, { questions: move(s.questions, k, k - 1) })} />
                  <IconButton icon={ArrowDown} label="Move question down" className="size-9" disabled={k === s.questions.length - 1} onClick={() => patchSection(i, { questions: move(s.questions, k, k + 1) })} />
                  <IconButton icon={Trash2} label="Remove question" className="size-9" onClick={() => patchSection(i, { questions: s.questions.filter((_, j) => j !== k) })} />
                </div>
              </li>
            ))}
          </ol>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={Plus}
            className="mt-2"
            disabled={total >= WAVE2_LIMITS.guideQuestionsMax}
            onClick={() => patchSection(i, { questions: [...s.questions, { text: "", roomId: null }] })}
          >
            Add question
          </Button>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="secondary" icon={Plus} disabled={sections.length >= 10} onClick={() => setSections((p) => [...p, { title: "", questions: [{ text: "", roomId: null }] }])}>
          Add section
        </Button>
        <p className={cx("text-xs text-ink-muted", total > WAVE2_LIMITS.guideQuestionsMax && "text-error")}>
          {total} of {WAVE2_LIMITS.guideQuestionsMax} questions
        </p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={total === 0 || total > WAVE2_LIMITS.guideQuestionsMax}>
          Save guide
        </Button>
      </div>
    </form>
  );
}
