import { useState } from "react";
import { useNavigate } from "react-router";
import { inviteCodeSchema } from "@shared/schemas";
import { Button, Field, Input } from "./ui";
import { Dialog } from "./ui/Dialog";

/** Type or paste an invite code (or a full join link) and go to its landing page. */
export function JoinCodeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const candidate = raw.trim().split("/").pop() ?? "";
    const parsed = inviteCodeSchema.safeParse(candidate);
    if (!parsed.success) return setError("That invite code is not valid. Codes are 10 letters and numbers.");
    setError(null);
    setRaw("");
    onClose();
    navigate(`/join/${parsed.data}`);
  };
  return (
    <Dialog open={open} onClose={onClose} title="Join with a code">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Invite code or link" hint="Ask a club admin for an invite link or its 10-character code." error={error ?? undefined}>
          {(id, d) => <Input id={id} aria-describedby={d} autoCapitalize="characters" autoComplete="off" spellCheck={false} value={raw} onChange={(e) => setRaw(e.target.value)} autoFocus />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Continue</Button>
        </div>
      </form>
    </Dialog>
  );
}
