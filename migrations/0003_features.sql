-- Migration 0003: feature wave 2.
-- Polls, RSVPs and attendance, recurring meetings and reminders, sign-up
-- lists, documents, join screening, email invites, scheduled messages,
-- threads/reactions/attachments in chat, discussion rooms with progress
-- gating, discussion guides, reading log and streaks, challenges, push
-- subscriptions, roles ledger, pace plans, edition mappings, branding.
-- Conventions as in 0002 (text ids, ISO timestamps, club_id-first indexes).

-- ---------------------------------------------------------------------------
-- Clubs: branding, policies, welcome message, rotation settings
-- ---------------------------------------------------------------------------
ALTER TABLE clubs ADD COLUMN banner_file_id TEXT;
ALTER TABLE clubs ADD COLUMN accent_color TEXT;                 -- "#RRGGBB" or NULL (brand default)
ALTER TABLE clubs ADD COLUMN welcome_message TEXT;              -- posted to the club chat as a DM-style note to new members
ALTER TABLE clubs ADD COLUMN join_policy TEXT NOT NULL DEFAULT 'link' CHECK (join_policy IN ('link', 'approval'));
ALTER TABLE clubs ADD COLUMN screening_questions TEXT NOT NULL DEFAULT '[]'; -- JSON [{id,label,required}]
ALTER TABLE clubs ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Chicago';
ALTER TABLE clubs ADD COLUMN discord_webhook_url TEXT;          -- optional bridge target (admin-set, never returned to members)
ALTER TABLE clubs ADD COLUMN roles_rotation TEXT NOT NULL DEFAULT '{"host":true,"picker":true,"notetaker":true}';
ALTER TABLE clubs ADD COLUMN reminder_offsets TEXT NOT NULL DEFAULT '[1440,120]'; -- minutes before a meeting

-- Member phone / SMS opt-in (SMS is an optional adapter; see worker/sms)
ALTER TABLE profiles ADD COLUMN phone TEXT;
ALTER TABLE profiles ADD COLUMN sms_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN timezone TEXT;                  -- IANA; null = browser default
ALTER TABLE notification_preferences ADD COLUMN push_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN push_meeting_reminders INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN push_mentions INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN email_meeting_reminders INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN sms_meeting_reminders INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_preferences ADD COLUMN digest_catch_up INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- Files (documents, photos, banners, chat attachments). Bytes live in R2
-- when the FILES bucket is bound, otherwise inline in file_blobs (<= 2 MB).
-- ---------------------------------------------------------------------------
CREATE TABLE files (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT REFERENCES clubs (id) ON DELETE CASCADE,
  owner_id TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('document', 'photo', 'recipe', 'minutes', 'banner', 'attachment')),
  title TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage TEXT NOT NULL CHECK (storage IN ('r2', 'd1')),
  r2_key TEXT,
  meeting_id TEXT,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX files_club_idx ON files (club_id, kind, created_at);
CREATE INDEX files_meeting_idx ON files (meeting_id);
CREATE TABLE file_blobs (
  file_id TEXT PRIMARY KEY NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  data BLOB NOT NULL
);

-- ---------------------------------------------------------------------------
-- Meetings: RSVP, attendance, recurrence, reminders, roles, notes, copies
-- ---------------------------------------------------------------------------
ALTER TABLE club_meetings ADD COLUMN timezone TEXT;                      -- IANA zone the time was entered in
ALTER TABLE club_meetings ADD COLUMN location_url TEXT;                  -- video call or map link
ALTER TABLE club_meetings ADD COLUMN rsvp_deadline TEXT;
ALTER TABLE club_meetings ADD COLUMN recurrence TEXT;                    -- JSON {freq:'weekly'|'monthly'|'custom', interval, byDay, byMonthDay, until, count}
ALTER TABLE club_meetings ADD COLUMN series_id TEXT;                     -- id shared by every occurrence of a recurring meeting
ALTER TABLE club_meetings ADD COLUMN host_user_id TEXT REFERENCES "user" ("id") ON DELETE SET NULL;
ALTER TABLE club_meetings ADD COLUMN picker_user_id TEXT REFERENCES "user" ("id") ON DELETE SET NULL;
ALTER TABLE club_meetings ADD COLUMN notetaker_user_id TEXT REFERENCES "user" ("id") ON DELETE SET NULL;
ALTER TABLE club_meetings ADD COLUMN notes TEXT;                         -- meeting notes / minutes (markdown)
ALTER TABLE club_meetings ADD COLUMN agenda TEXT;                        -- cached meeting pack (JSON)
ALTER TABLE club_meetings ADD COLUMN copied_from_id TEXT;
CREATE INDEX club_meetings_series_idx ON club_meetings (series_id);

CREATE TABLE meeting_rsvps (
  meeting_id TEXT NOT NULL REFERENCES club_meetings (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'no')),
  guests INTEGER NOT NULL DEFAULT 0 CHECK (guests BETWEEN 0 AND 10),
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE meeting_attendance (
  meeting_id TEXT NOT NULL REFERENCES club_meetings (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  present INTEGER NOT NULL DEFAULT 1,
  marked_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  marked_at TEXT NOT NULL,
  PRIMARY KEY (meeting_id, user_id)
);

-- One row per reminder actually sent, so the cron never sends twice.
CREATE TABLE meeting_reminders_sent (
  meeting_id TEXT NOT NULL REFERENCES club_meetings (id) ON DELETE CASCADE,
  offset_minutes INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (meeting_id, offset_minutes)
);

-- Potluck / sign-up lists attached to a meeting.
CREATE TABLE signup_lists (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES club_meetings (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'potluck' CHECK (kind IN ('potluck', 'supplies', 'tasks', 'other')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  updated_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX signup_lists_meeting_idx ON signup_lists (meeting_id);
CREATE TABLE signup_items (
  id TEXT PRIMARY KEY NOT NULL,
  list_id TEXT NOT NULL REFERENCES signup_lists (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100),
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX signup_items_list_idx ON signup_items (list_id, position);
CREATE TABLE signup_claims (
  item_id TEXT NOT NULL REFERENCES signup_items (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id, user_id)
);

-- Rotating roles ledger: one row per role assignment, used for fairness.
CREATE TABLE role_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('host', 'picker', 'notetaker')),
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  meeting_id TEXT REFERENCES club_meetings (id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL
);
CREATE INDEX role_ledger_club_idx ON role_ledger (club_id, role, assigned_at);

-- ---------------------------------------------------------------------------
-- Polls (next book, meeting dates, anything)
-- ---------------------------------------------------------------------------
CREATE TABLE polls (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('book', 'date', 'custom')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closes_at TEXT,
  allow_multiple INTEGER NOT NULL DEFAULT 0,   -- approval voting when 1
  anonymous INTEGER NOT NULL DEFAULT 0,        -- hide who voted for what (counts still shown)
  meeting_id TEXT REFERENCES club_meetings (id) ON DELETE SET NULL,  -- date polls can create/update this meeting when applied
  year INTEGER,                                 -- book polls: list year the winner is added to
  winner_option_id TEXT,
  applied_at TEXT,                              -- when the winner was added to the list / meeting scheduled
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  updated_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX polls_club_idx ON polls (club_id, status, created_at);
CREATE TABLE poll_options (
  id TEXT PRIMARY KEY NOT NULL,
  poll_id TEXT NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  edition_id TEXT REFERENCES book_editions (id) ON DELETE SET NULL,  -- book polls
  starts_at TEXT,                                                     -- date polls
  ends_at TEXT,
  added_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX poll_options_poll_idx ON poll_options (poll_id, position);
CREATE TABLE poll_votes (
  poll_id TEXT NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES poll_options (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (option_id, user_id)
);
CREATE INDEX poll_votes_poll_user_idx ON poll_votes (poll_id, user_id);

-- ---------------------------------------------------------------------------
-- Membership growth: join requests (screening), email invites
-- ---------------------------------------------------------------------------
CREATE TABLE join_requests (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  invite_id TEXT REFERENCES club_invites (id) ON DELETE SET NULL,
  answers TEXT NOT NULL DEFAULT '[]',          -- JSON [{questionId,label,answer}]
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  decided_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (club_id, user_id)
);
CREATE INDEX join_requests_club_idx ON join_requests (club_id, status, created_at);

-- Email invites (bulk CSV or one at a time). Each has its own single-use code.
ALTER TABLE club_invites ADD COLUMN email TEXT;
ALTER TABLE club_invites ADD COLUMN sent_at TEXT;
ALTER TABLE club_invites ADD COLUMN accepted_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL;
CREATE INDEX club_invites_email_idx ON club_invites (club_id, email);

-- ---------------------------------------------------------------------------
-- Chat: threads, reactions, attachments, mentions, scheduled messages
-- ---------------------------------------------------------------------------
ALTER TABLE messages ADD COLUMN parent_id TEXT REFERENCES messages (id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';  -- JSON [{fileId,contentType,width,height,title}]
ALTER TABLE messages ADD COLUMN mentions TEXT NOT NULL DEFAULT '[]';     -- JSON [userId]
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'system', 'welcome', 'digest'));
CREATE INDEX messages_parent_idx ON messages (parent_id, created_at);

CREATE TABLE message_reactions (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE scheduled_messages (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  body TEXT NOT NULL,
  send_at TEXT NOT NULL,
  sent_message_id TEXT,
  sent_at TEXT,
  canceled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX scheduled_messages_due_idx ON scheduled_messages (send_at) WHERE sent_at IS NULL AND canceled_at IS NULL;
CREATE INDEX scheduled_messages_sender_idx ON scheduled_messages (club_id, sender_id, send_at);

-- Discussion rooms get their own conversations.
-- (SQLite cannot alter a CHECK; conversations.kind keeps 'club'|'direct' and rooms link by room_id.)
ALTER TABLE conversations ADD COLUMN room_id TEXT;
CREATE UNIQUE INDEX conversations_room_idx ON conversations (room_id) WHERE room_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Discussion rooms (chapter / milestone / reflection), gated by progress
-- ---------------------------------------------------------------------------
CREATE TABLE discussion_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES book_editions (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('chapter', 'milestone', 'reflection')),
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  -- A member may enter when their club reading position reaches the gate.
  gate_type TEXT NOT NULL DEFAULT 'none' CHECK (gate_type IN ('none', 'chapter', 'page', 'percent', 'finished')),
  gate_value INTEGER,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  updated_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX discussion_rooms_club_book_idx ON discussion_rooms (club_id, edition_id, position);

-- Where each member is in a club book (chapter/page/percent), used for gating,
-- catch-up digests and the pace planner. Separate from the personal library so
-- "club" progress can be shared without exposing private notes.
CREATE TABLE club_reading_progress (
  club_id TEXT NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES book_editions (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  chapter INTEGER,
  page INTEGER,
  percent INTEGER CHECK (percent IS NULL OR percent BETWEEN 0 AND 100),
  finished INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (club_id, edition_id, user_id)
);

-- Per-member read marker for catch-up digests per conversation already exists
-- (conversation_participants.last_read_at). Digest deliveries are recorded here.
CREATE TABLE digest_deliveries (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  delivered_at TEXT NOT NULL,
  through_message_id TEXT,
  PRIMARY KEY (user_id, conversation_id)
);

-- Discussion guides / questions per book per club.
CREATE TABLE discussion_guides (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES book_editions (id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'template', 'ai')),
  sections TEXT NOT NULL DEFAULT '[]',   -- JSON [{title, questions:[{id,text,roomId?}]}]
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  updated_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (club_id, edition_id)
);

-- ---------------------------------------------------------------------------
-- Reading log (streaks), challenges
-- ---------------------------------------------------------------------------
CREATE TABLE reading_log (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  day TEXT NOT NULL,                     -- YYYY-MM-DD in the member's zone
  edition_id TEXT REFERENCES book_editions (id) ON DELETE SET NULL,
  pages INTEGER NOT NULL DEFAULT 0,
  minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT REFERENCES clubs (id) ON DELETE CASCADE,         -- NULL = personal challenge
  owner_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('books', 'pages', 'genre', 'streak', 'custom')),
  target INTEGER NOT NULL CHECK (target > 0),
  genre_id TEXT,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX challenges_club_idx ON challenges (club_id, ends_on);
CREATE INDEX challenges_owner_idx ON challenges (owner_id, ends_on);
CREATE TABLE challenge_participants (
  challenge_id TEXT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  manual_progress INTEGER NOT NULL DEFAULT 0,   -- for 'custom' challenges
  joined_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (challenge_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Push notifications (Web Push / VAPID)
-- ---------------------------------------------------------------------------
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- Pace plans and edition mappings (page <-> Kindle location <-> audio time)
-- ---------------------------------------------------------------------------
CREATE TABLE pace_plans (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES book_editions (id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES club_meetings (id) ON DELETE SET NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  total_pages INTEGER NOT NULL CHECK (total_pages > 0),
  cadence TEXT NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('weekly', 'twice_weekly', 'daily')),
  rest_days TEXT NOT NULL DEFAULT '[]',          -- JSON [0-6] weekdays with no reading
  schedule TEXT NOT NULL DEFAULT '[]',           -- JSON [{dueDate, fromPage, toPage, assignmentId}]
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  updated_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (club_id, edition_id)
);

CREATE TABLE edition_mappings (
  edition_id TEXT NOT NULL REFERENCES book_editions (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('kindle', 'audio')),
  total INTEGER NOT NULL CHECK (total > 0),      -- kindle: last location; audio: total seconds
  label TEXT,                                     -- e.g. "Audible, narrated by X (11h 32m)"
  created_by TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (edition_id, kind)
);
ALTER TABLE club_assignments ADD COLUMN from_page INTEGER;
ALTER TABLE club_assignments ADD COLUMN to_page INTEGER;
ALTER TABLE club_assignments ADD COLUMN pace_plan_id TEXT;

-- Monthly recap / wrapped caches (computed; cached JSON per club per period).
CREATE TABLE recap_cache (
  scope TEXT NOT NULL,          -- 'club:<id>' or 'user:<id>'
  period TEXT NOT NULL,         -- 'YYYY-MM' or 'YYYY'
  data TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (scope, period)
);
