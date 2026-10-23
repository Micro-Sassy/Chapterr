import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { WAVE2_LIMITS } from "@shared/constants";
import type { BulkInviteResult } from "@shared/types";
import { clubApi } from "@/components/records";
import { Alert, Badge, Button, buttonClass, Field, Select, Textarea } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/api";
import { parseInviteCsv, toInviteCsv } from "./csv";

/** Paste or upload a CSV of email[,name] rows, preview, then send one invite per row. */
export function BulkInvite({ clubId }: { clubId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [expires, setExpires] = useState("14");
  const [result, setResult] = useState<BulkInviteResult | null>(null);
  const preview = useMemo(() => (text.trim() ? parseInviteCsv(text) : null), [text]);
  const send = useMutation({
    mutationFn: () => api<BulkInviteResult>(clubApi(clubId, "/invites/bulk"), { body: { csv: toInviteCsv(preview!), expiresInDays: Number(expires) } }),
    onSuccess: (r) => {
      setResult(r);
      setText("");
      void qc.invalidateQueries({ queryKey: ["club-invites", clubId] });
    },
  });
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setText(await file.text());
  };
  const invalidRows = preview?.rows.filter((r) => !r.valid) ?? [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        One person per line: an email address, then an optional name. Each address receives its own single-use invite by email. Up to {WAVE2_LIMITS.bulkInviteRowsMax} per batch.
      </p>
      <Field label="Addresses" hint="jane@example.com, Jane Doe">
        {(id, d) => (
          <Textarea
            id={id}
            aria-describedby={d}
            rows={6}
            value={text}
            spellCheck={false}
            onChange={(e) => {
              setResult(null);
              setText(e.target.value);
            }}
            placeholder={"jane@example.com, Jane Doe\nsam@example.com"}
            className="font-mono text-sm"
          />
        )}
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <label className={buttonClass("secondary", "sm", "cursor-pointer")}>
          <FileUp className="size-4" aria-hidden /> Upload CSV
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        <Field label="Invites expire in" className="w-44">
          {(id) => (
            <Select id={id} className="h-9 text-sm" value={expires} onChange={(e) => setExpires(e.target.value)}>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </Select>
          )}
        </Field>
      </div>
      {preview && preview.rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="success">{preview.valid} ready</Badge>
            {preview.invalid > 0 && <Badge tone="error">{preview.invalid} will be skipped</Badge>}
            {preview.hadHeader && <span className="text-xs text-ink-muted">Header row ignored.</span>}
          </div>
          {preview.tooMany && <Alert tone="warning">That is more than {WAVE2_LIMITS.bulkInviteRowsMax} addresses. Send them in smaller batches.</Alert>}
          <div className="max-h-72 overflow-auto rounded-control border border-line">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface-2 text-xs text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Row</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.rows.map((r) => (
                  <tr key={r.row} className={r.valid ? undefined : "bg-error-soft/50"}>
                    <td className="px-3 py-1.5 text-ink-muted">{r.row}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{r.email || <span className="text-ink-muted">(none)</span>}</td>
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="px-3 py-1.5">{r.valid ? <span className="text-ink-muted">Ready</span> : <span className="font-medium text-error">{r.reason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {send.isError && <Alert tone="error">{errorMessage(send.error)}</Alert>}
          <Button icon={Send} loading={send.isPending} disabled={preview.valid === 0 || preview.tooMany} onClick={() => send.mutate()}>
            Send {preview.valid} {preview.valid === 1 ? "invite" : "invites"}
          </Button>
          {invalidRows.length > 0 && <p className="text-xs text-ink-muted">Rows marked as skipped are left out. Fix them above to include them.</p>}
        </div>
      )}
      {result && (
        <Alert tone="success" title={`${result.sent} ${result.sent === 1 ? "invite" : "invites"} sent`}>
          {result.skipped.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {result.skipped.slice(0, 20).map((s) => (
                <li key={`${s.row}-${s.email}`}>
                  Row {s.row} {s.email ? `(${s.email})` : ""}: {s.reason}
                </li>
              ))}
              {result.skipped.length > 20 && <li>and {result.skipped.length - 20} more</li>}
            </ul>
          ) : (
            "Everyone on the list has an email on the way."
          )}
        </Alert>
      )}
    </div>
  );
}
