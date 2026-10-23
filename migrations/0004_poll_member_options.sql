-- Migration 0004: polls remember whether members (not just the creator and
-- admins) may add options while the poll is open (docs/FEATURES-2.md §2).
ALTER TABLE polls ADD COLUMN allow_member_options INTEGER NOT NULL DEFAULT 1;
