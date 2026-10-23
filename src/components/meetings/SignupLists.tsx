import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SIGNUP_KINDS, type SignupKind } from "@shared/constants";
import type { MeetingDetail, SignupList } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { clubApi, useSharedMutation } from "@/components/records";
import { Badge, Button, Card, cx, Field, IconButton, Input, SectionTitle, Select } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { meetingInvalidations } from "./api";

export const SIGNUP_KIND_LABELS: Record<SignupKind, string> = { potluck: "Potluck", supplies: "Supplies", tasks: "Tasks", other: "Sign-up" };

/** Items still short of their quantity across every list. */
export function signupGaps(lists: SignupList[]): { list: string; item: string; needed: number }[] {
  const gaps: { list: string; item: string; needed: number }[] = [];
  for (const l of lists) for (const it of l.items) if (it.claims.length < it.quantity) gaps.push({ list: l.title, item: it.label, needed: it.quantity - it.claims.length });
  return gaps;
}

function ListCard({ list, clubId }: { list: SignupList; clubId: string }) {
  const keys = meetingInvalidations(clubId);
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const addItem = useSharedMutation(() => api(clubApi(clubId, `/signups/${list.id}/items`), { body: { label: label.trim(), quantity: Number(quantity) || 1 } }), keys);
  const removeItem = useSharedMutation((itemId: string) => api(clubApi(clubId, `/signups/items/${itemId}`), { method: "DELETE" }), keys);
  const removeList = useSharedMutation(() => api(clubApi(clubId, `/signups/${list.id}`), { method: "DELETE" }), keys, "List removed.");
  const qc = useQueryClient();
  const toast = useToast();
  const claim = useMutation({
    mutationFn: (v: { itemId: string; note: string | null }) => api(clubApi(clubId, `/signups/items/${v.itemId}/claim`), { method: "PUT", body: { note: v.note } }),
    onSuccess: () => {
      for (const k of keys) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (err) => {
      for (const k of keys) void qc.invalidateQueries({ queryKey: k });
      toast(err instanceof ApiRequestError && err.code === "item_taken" ? "Someone claimed that first. The list is refreshed." : errorMessage(err), "error");
    },
  });
  return (
    <Card as="article" className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="heading-s flex items-center gap-2">
          {list.title} <Badge tone="neutral">{SIGNUP_KIND_LABELS[list.kind]}</Badge>
        </h3>
        <IconButton icon={Trash2} label={`Remove the ${list.title} list`} onClick={() => removeList.mutate(undefined)} />
      </div>
      <ul className="mt-3 divide-y divide-line/70">
        {list.items.length === 0 && <li className="py-2 text-sm text-ink-muted">Nothing on this list yet.</li>}
        {list.items.map((item) => {
          const short = item.quantity - item.claims.length;
          return (
            <li key={item.id} className="py-2.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {item.label}
                    {item.quantity > 1 && <span className="text-ink-muted">×{item.quantity}</span>}
                    {short > 0 ? (
                      <Badge tone="brass">
                        <AlertCircle className="size-3" aria-hidden /> {short} more needed
                      </Badge>
                    ) : (
                      <Badge tone="success">Covered</Badge>
                    )}
                  </p>
                  {item.claims.length > 0 && (
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
                      {item.claims.map((c) => (
                        <li key={c.id} className="flex items-center gap-1">
                          <Avatar member={c} size="xs" /> {c.displayName}
                          {c.note ? `: ${c.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  {noteFor === item.id && (
                    <form
                      className="mt-2 flex flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        claim.mutate({ itemId: item.id, note: note.trim() || null }, { onSuccess: () => setNoteFor(null) });
                      }}
                    >
                      <Field label="What you're bringing (optional)" className="min-w-48 flex-1">
                        {(id) => <Input id={id} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lemon cake, gluten free" autoFocus />}
                      </Field>
                      <Button type="submit" size="sm" loading={claim.isPending}>
                        Claim
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setNoteFor(null)}>
                        Cancel
                      </Button>
                    </form>
                  )}
                </div>
                {item.mine ? (
                  <Button size="sm" variant="secondary" loading={claim.isPending && claim.variables?.itemId === item.id} onClick={() => claim.mutate({ itemId: item.id, note: null })}>
                    Unclaim
                  </Button>
                ) : (
                  short > 0 &&
                  noteFor !== item.id && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setNote("");
                        setNoteFor(item.id);
                      }}
                    >
                      Claim
                    </Button>
                  )
                )}
                <IconButton icon={Trash2} label={`Remove ${item.label}`} onClick={() => removeItem.mutate(item.id)} />
              </div>
            </li>
          );
        })}
      </ul>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          addItem.mutate(undefined, {
            onSuccess: () => {
              setLabel("");
              setQuantity("1");
            },
          });
        }}
      >
        <Field label="Add item" className="min-w-40 flex-1">
          {(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={list.kind === "potluck" ? "Main dish" : "Folding chairs"} />}
        </Field>
        <Field label="How many" className="w-24">
          {(id) => <Input id={id} type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
        </Field>
        <Button type="submit" size="sm" variant="secondary" icon={Plus} loading={addItem.isPending} disabled={!label.trim()}>
          Add
        </Button>
      </form>
    </Card>
  );
}

/** Potluck, supplies and task lists for a meeting, with claims and gaps. */
export function SignupLists({ meeting: m, clubId }: { meeting: MeetingDetail; clubId: string }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SignupKind>("potluck");
  const create = useSharedMutation(() => api(clubApi(clubId, `/meetings/${m.id}/signups`), { body: { title: title.trim(), kind } }), meetingInvalidations(clubId), "List created.");
  const gaps = signupGaps(m.signupLists);
  return (
    <section>
      <SectionTitle
        as="h2"
        action={
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
            New list
          </Button>
        }
      >
        Sign-ups
      </SectionTitle>
      {m.signupLists.length === 0 ? (
        <p className={cx("rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted")}>No sign-up lists yet. Start one for food, supplies or tasks.</p>
      ) : (
        <>
          {gaps.length > 0 && (
            <p className="mb-3 text-sm text-ink-muted">
              Still needed: {gaps.map((g) => `${g.item} (${g.needed})`).join(", ")}.
            </p>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {m.signupLists.map((l) => (
              <ListCard key={l.id} list={l} clubId={clubId} />
            ))}
          </div>
        </>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New sign-up list">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            create.mutate(undefined, {
              onSuccess: () => {
                setCreating(false);
                setTitle("");
              },
            });
          }}
        >
          <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Potluck" autoFocus />}</Field>
          <Field label="Kind">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as SignupKind)}>
                {SIGNUP_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {SIGNUP_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" loading={create.isPending} disabled={!title.trim()}>
            Create list
          </Button>
        </form>
      </Dialog>
    </section>
  );
}
