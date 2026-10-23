/* Chapterr marketing site — the interactive demo that runs inside the hero
   phone, plus the "switch club" strip further down the page. Vanilla JS,
   no framework, state in memory only. Nothing here talks to a server. */
(function () {
  "use strict";

  var VW = 280; /* the demo is laid out at 280 virtual px wide and scaled to the phone screen */
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function first(name) { return name.split(" ")[0]; }

  /* ---------- Seed data ---------- */
  var PEOPLE = {
    maya: { n: "Maya Bennett", i: "MB", c: 1 },
    ada: { n: "Ada Okafor", i: "AO", c: 2 },
    theo: { n: "Theo Jansen", i: "TJ", c: 3 },
    rosa: { n: "Rosa Klein", i: "RK", c: 4 },
    sam: { n: "Sam Idowu", i: "SI", c: 2 },
    priya: { n: "Priya Nair", i: "PN", c: 4 },
    leo: { n: "Leo Marsh", i: "LM", c: 3 },
    june: { n: "June Park", i: "JP", c: 2 },
    omar: { n: "Omar Haddad", i: "OH", c: 1 },
    dana: { n: "Dana Whitfield", i: "DW", c: 3 },
    chris: { n: "Chris Lowe", i: "CL", c: 4 },
    hana: { n: "Hana Sato", i: "HS", c: 2 },
    felix: { n: "Felix Brand", i: "FB", c: 1 }
  };

  var CLUBS = {
    riverside: {
      id: "riverside", name: "Riverside Readers", role: "Owner", members: 18, mark: 1, code: "RV7K-29QX-M3",
      note: "Next meeting Thu 7pm",
      book: { title: "The Remains of the Day", author: "Kazuo Ishiguro", pages: 258, cover: 1, short: "Remains" },
      finished: 12, due: "Chapter 3 by Thursday",
      schedule: [
        { what: "Chapters 1–2", when: "by 24 Oct" },
        { what: "Chapter 3", when: "by Thu 31 Oct" },
        { what: "Chapters 4–6", when: "by 7 Nov" },
        { what: "Discussion", when: "Sun 10 Nov" }
      ],
      meeting: { day: "Thursday 7 November", time: "7:00 pm", where: "Ada’s place", scope: "Chapters 1–6", going: 14 },
      upcoming: [{ when: "Sun 10 Nov · 4:00 pm", what: "Discussion · video call" }, { when: "Thu 5 Dec · 7:00 pm", what: "December pick · Theo’s" }],
      past: [{ when: "Thu 3 Oct", what: "Piranesi" }, { when: "Thu 5 Sep", what: "Braiding Sweetgrass" }],
      people: [["maya", "Owner"], ["ada", "Admin"], ["theo", "Member"], ["rosa", "Member"], ["sam", "Member"]],
      activity: [["rosa", "finished The Remains of the Day", "2h"], ["ada", "set the next meeting", "yesterday"], ["theo", "added a quote", "Mon"], ["sam", "joined the club", "last week"]],
      chat: [
        ["ada", "Chapter 3 by Thursday. Who’s in?"], ["maya", "In. Stevens is breaking my heart."],
        ["theo", "Finished. Saying nothing until Sunday."], ["rosa", "Bringing the lemon cake again."],
        ["sam", "Can someone post the page numbers for chapter 3?"], ["ada", "Pages 71–112 in the Faber edition."]
      ]
    },
    nightowls: {
      id: "nightowls", name: "Night Owls", role: "Member", members: 9, mark: 2, code: "NO3P-77HD-K8",
      note: "Chapter 9 due Sunday",
      book: { title: "Tomorrow, and Tomorrow, and Tomorrow", author: "Gabrielle Zevin", pages: 416, cover: 2, short: "Tomorrow" },
      finished: 4, due: "Chapter 9 by Sunday",
      schedule: [
        { what: "Chapters 1–4", when: "by 12 Oct" },
        { what: "Chapters 5–8", when: "by 19 Oct" },
        { what: "Chapter 9", when: "by Sun 26 Oct" },
        { what: "Chapters 10–12", when: "by 2 Nov" }
      ],
      meeting: { day: "Tuesday 4 November", time: "9:00 pm", where: "Video call", scope: "Chapters 1–12", going: 7 },
      upcoming: [{ when: "Tue 2 Dec · 9:00 pm", what: "December pick · video call" }],
      past: [{ when: "Tue 7 Oct", what: "Sea of Tranquility" }, { when: "Tue 2 Sep", what: "The Overstory" }],
      people: [["priya", "Owner"], ["leo", "Admin"], ["maya", "Member"], ["june", "Member"], ["omar", "Member"]],
      activity: [["leo", "assigned chapter 9", "3h"], ["june", "started the book", "yesterday"], ["priya", "posted the call link", "Mon"]],
      chat: [
        ["priya", "Late readers, assemble."], ["leo", "Chapter 9 by Sunday, then we talk."],
        ["june", "Sadie is so frustrating and I love her."], ["omar", "No spoilers past nine, please."],
        ["priya", "Video call link is in Meetings."], ["maya", "I’ll be there."]
      ]
    },
    office: {
      id: "office", name: "Office Book Swap", role: "Admin", members: 24, mark: 3, code: "OB5W-14ZT-Q2",
      note: "2 unread",
      book: { title: "Braiding Sweetgrass", author: "Robin Wall Kimmerer", pages: 408, cover: 3, short: "Sweetgrass" },
      finished: 6, due: "Tending Sweetgrass by 31 Oct",
      schedule: [
        { what: "Planting Sweetgrass", when: "by 17 Oct" },
        { what: "Tending Sweetgrass", when: "by 31 Oct" },
        { what: "Picking Sweetgrass", when: "by 14 Nov" },
        { what: "Braiding Sweetgrass", when: "by 28 Nov" }
      ],
      meeting: { day: "Friday 31 October", time: "12:30 pm", where: "Kitchen, 4th floor", scope: "Lunch swap · first two parts", going: 11 },
      upcoming: [{ when: "Fri 14 Nov · 12:30 pm", what: "Picking Sweetgrass · kitchen" }, { when: "Fri 28 Nov · 12:30 pm", what: "Book swap · kitchen" }],
      past: [{ when: "Fri 3 Oct", what: "Lessons in Chemistry" }, { when: "Fri 5 Sep", what: "The Lincoln Highway" }],
      people: [["dana", "Owner"], ["maya", "Admin"], ["chris", "Member"], ["hana", "Member"], ["felix", "Member"]],
      activity: [["hana", "finished part one", "1h"], ["dana", "set the next meeting", "yesterday"], ["felix", "added 3 books to the list", "Tue"]],
      chat: [
        ["dana", "Swap is Friday. Bring a book you’re done with."], ["chris", "Bringing three. Shelf space is at a premium."],
        ["hana", "The strawberry chapter made me cry at my desk."], ["felix", "Same. Didn’t expect that from a botany book."],
        ["dana", "Reminder: 12:30 in the kitchen."], ["chris", "Saving you a seat, Maya."]
      ]
    }
  };
  var CLUB_ORDER = ["riverside", "nightowls", "office"];

  var DMS = {
    ada: [["ada", "Are you bringing the cake or am I?"], ["maya", "You are. I’m on tea."], ["ada", "Deal."]],
    _default: [["them", "Hi Maya, are you caught up for this week?"], ["maya", "Nearly. Finishing tonight."]]
  };

  var REPLIES = [
    "Chapter 3 by Thursday?",
    "Loved the ending — no spoilers in here.",
    "Who’s bringing the snacks?",
    "Anyone else reading on the train?",
    "I’ll post the page numbers tonight."
  ];

  function seedShelf() {
    return [
      { id: "b1", t: "Piranesi", a: "Susanna Clarke", s: "tbr", c: 2 },
      { id: "b2", t: "The Hare with Amber Eyes", a: "Edmund de Waal", s: "tbr", c: 4 },
      { id: "b3", t: "Pachinko", a: "Min Jin Lee", s: "tbr", c: 1 },
      { id: "b4", t: "The Overstory", a: "Richard Powers", s: "tbr", c: 3 },
      { id: "b5", t: "The Remains of the Day", a: "Kazuo Ishiguro", s: "reading", p: 62, c: 1 },
      { id: "b6", t: "Tomorrow, and Tomorrow, and Tomorrow", a: "Gabrielle Zevin", s: "reading", p: 41, c: 2 },
      { id: "b7", t: "Braiding Sweetgrass", a: "Robin Wall Kimmerer", s: "reading", p: 28, c: 3 },
      { id: "b8", t: "A Gentleman in Moscow", a: "Amor Towles", s: "reading", p: 10, c: 4 },
      { id: "b9", t: "Klara and the Sun", a: "Kazuo Ishiguro", s: "finished", d: "Sep", c: 2 },
      { id: "b10", t: "Lessons in Chemistry", a: "Bonnie Garmus", s: "finished", d: "Aug", c: 3 },
      { id: "b11", t: "Station Eleven", a: "Emily St. John Mandel", s: "finished", d: "Jul", c: 1 },
      { id: "b12", t: "Circe", a: "Madeline Miller", s: "finished", d: "Jun", c: 4 },
      { id: "b13", t: "Demon Copperhead", a: "Barbara Kingsolver", s: "finished", d: "May", c: 2 }
    ];
  }

  /* ---------- Icons (1.75px stroke, 24 grid) ---------- */
  function icon(name) {
    var p = {
      home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/>',
      shelf: '<path d="M4 4v16"/><path d="M9 7v13"/><path d="M14 4v16"/><path d="m18 7 2.5 13"/>',
      club: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
      chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
      more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
      bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
      back: '<path d="m15 18-6-6 6-6"/>',
      chev: '<path d="m9 18 6-6-6-6"/>',
      swap: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
      send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      cal: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
      pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
      link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
      phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
      card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
      moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
      upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
      lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
      out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
      close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
      plus: '<path d="M12 5v14"/><path d="M5 12h14"/>'
    }[name];
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>";
  }

  /* ---------- State ---------- */
  var S, timers = [], bars = {};
  function freshState() {
    var chats = {};
    CLUB_ORDER.forEach(function (id) { chats[id] = CLUBS[id].chat.map(function (m) { return { who: m[0], text: m[1] }; }); });
    return {
      club: "riverside", view: "home", stack: [], sheet: null, theme: "light",
      shelfTab: "reading", shelf: seedShelf(), goal: { done: 14, target: 24 },
      read: { riverside: [0], nightowls: [0, 1], office: [0] },
      chats: chats, dms: {}, typing: null, unread: { office: 2 }, notifs: 3,
      calendar: {}, copied: false, tour: -1, booted: false
    };
  }

  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  /* ---------- Elements ---------- */
  var root = document.getElementById("demo");
  var screenEl, sheetEl, toastEl, tourEl, splashEl;

  function build() {
    root.innerHTML =
      '<div class="d-status" aria-hidden="true"><span>9:41</span><span class="d-status-icons"><i></i><i></i><b></b></span></div>' +
      '<div class="d-screen" id="d-screen"></div>' +
      '<nav class="d-tabbar" aria-label="Sections" id="d-tabbar"></nav>' +
      '<div class="d-sheet-host" id="d-sheet"></div>' +
      '<div class="d-toasts" id="d-toasts" aria-live="polite"></div>' +
      '<div class="d-tour-host" id="d-tour"></div>' +
      '<div class="d-splash" id="d-splash" aria-hidden="true"><img src="/brand/mark-color-on-dark.svg" alt="" width="46" height="42"></div>';
    screenEl = root.querySelector("#d-screen");
    sheetEl = root.querySelector("#d-sheet");
    toastEl = root.querySelector("#d-toasts");
    tourEl = root.querySelector("#d-tour");
    splashEl = root.querySelector("#d-splash");
  }

  /* ---------- Small view helpers ---------- */
  function club() { return CLUBS[S.club]; }
  function avatar(id, size) {
    var p = PEOPLE[id] || { i: "??", c: 1 };
    return '<span class="d-avatar d-avatar--' + p.c + (size ? " d-avatar--" + size : "") + '" aria-hidden="true">' + p.i + "</span>";
  }
  function cover(c, short) {
    return '<span class="d-cover d-cover--' + c + '" aria-hidden="true"><i></i><b>' + esc(short) + "</b></span>";
  }
  function chip(role) { return '<span class="d-role d-role--' + role.toLowerCase() + '">' + role + "</span>"; }
  function bar(key, pct, label) {
    return '<div class="d-progress"' + (label ? ' role="img" aria-label="' + esc(label) + '"' : "") + '><span class="d-progress-fill" data-bar="' + key + '" data-w="' + pct + '"></span></div>';
  }
  function top(title, eyebrow, right, back) {
    return '<header class="d-top">' +
      (back ? '<button class="d-icon-btn d-back" data-act="back" aria-label="Back">' + icon("back") + "</button>" : "") +
      "<div>" + (eyebrow ? '<p class="d-eyebrow">' + eyebrow + "</p>" : "") + '<h1 class="d-h1">' + title + "</h1></div>" +
      (right || "") + "</header>";
  }
  function clubTop(extraRight) {
    var c = club();
    return '<header class="d-top d-top--club">' +
      '<button class="d-club-switch" data-act="sheet" data-sheet="switcher" aria-haspopup="dialog" aria-label="Switch club. Current club: ' + esc(c.name) + '">' +
      '<span class="d-club-mark d-club-mark--' + c.mark + '"></span><span class="d-club-switch-text"><strong>' + esc(c.name) + "</strong><small>" + c.members + " members · " + c.role + "</small></span>" + icon("swap") + "</button>" +
      (extraRight || "") + "</header>";
  }
  function bellBtn() {
    return '<button class="d-icon-btn" data-act="go" data-view="notifications" aria-label="Notifications' + (S.notifs ? ", " + S.notifs + " unread" : "") + '">' + icon("bell") + (S.notifs ? '<span class="d-badge">' + S.notifs + "</span>" : "") + "</button>";
  }

  /* ---------- Screens ---------- */
  var VIEWS = {
    home: function () {
      var reading = S.shelf.filter(function (b) { return b.s === "reading"; })[0];
      var pct = Math.round(S.goal.done / S.goal.target * 100);
      return top("Welcome back, Maya", "Tuesday 21 October", bellBtn()) +
        '<section class="d-block" data-tour="clubs"><p class="d-label">Your clubs</p><ul class="d-clubs">' +
        CLUB_ORDER.map(function (id) {
          var c = CLUBS[id];
          var note = id === "office" && S.unread.office ? S.unread.office + " unread" : (id === "office" ? "All caught up" : c.note);
          return '<li><button class="d-club" data-act="open-club" data-club="' + id + '"><span class="d-club-mark d-club-mark--' + c.mark + '"></span><span class="d-club-text"><strong>' + esc(c.name) + "</strong><small>" + chip(c.role) + " <span>" + esc(note) + "</span></small></span>" + icon("chev") + "</button></li>";
        }).join("") + "</ul></section>" +
        '<section class="d-card"><p class="d-label">Your reading</p>' +
        '<div class="d-progress-row"><strong>2026 goal</strong><span>' + S.goal.done + " of " + S.goal.target + "</span></div>" + bar("goal", pct, "Reading goal: " + S.goal.done + " of " + S.goal.target + " books") +
        (reading ? '<div class="d-bookrow d-bookrow--tight">' + cover(reading.c, first(reading.t)) + '<div><p class="d-meta">Currently reading</p><p class="d-booktitle">' + esc(reading.t) + '</p><p class="d-meta">' + esc(reading.a) + " · " + reading.p + "%</p></div></div>" : "") +
        '<button class="d-textbtn" data-act="tab" data-view="shelf">Open shelf</button></section>';
    },

    club: function () {
      var c = club();
      var done = S.read[c.id].length, pct = Math.round(done / c.schedule.length * 100);
      var cpct = Math.round(c.finished / c.members * 100);
      return clubTop('<button class="d-btn d-btn--secondary d-btn--sm" data-act="sheet" data-sheet="invite" data-tour="invite">Invite</button>') +
        '<section class="d-card"><p class="d-label">This month’s book</p><div class="d-bookrow">' + cover(c.book.cover, c.book.short) +
        '<div><p class="d-booktitle">' + esc(c.book.title) + '</p><p class="d-meta">' + esc(c.book.author) + " · " + c.book.pages + ' pages</p><span class="d-chip">' + esc(c.due) + "</span></div></div>" +
        '<div class="d-progress-row"><strong>' + c.finished + " of " + c.members + " have finished</strong><span>" + cpct + "%</span></div>" + bar("club-" + c.id, cpct) + "</section>" +
        '<button class="d-card d-card--tap" data-act="go" data-view="meetings" data-tour="meeting"><p class="d-label">Next meeting</p><p class="d-strong">' + c.meeting.day + ", " + c.meeting.time + '</p><p class="d-meta">' + esc(c.meeting.where) + " · " + esc(c.meeting.scope) + " · " + c.meeting.going + " going</p>" + icon("chev") + "</button>" +
        '<section class="d-card"><div class="d-progress-row"><p class="d-label">Reading schedule</p><span class="d-meta">You · ' + done + " of " + c.schedule.length + "</span></div>" + bar("sched-" + c.id, pct, "Your schedule progress: " + done + " of " + c.schedule.length) +
        '<ul class="d-schedule">' + c.schedule.map(function (s, i) {
          var on = S.read[c.id].indexOf(i) > -1;
          return '<li><button class="d-sched' + (on ? " is-done" : "") + '" data-act="markread" data-i="' + i + '" aria-pressed="' + on + '"><span class="d-dot">' + icon("check") + "</span><span>" + esc(s.what) + "</span><small>" + esc(s.when) + "</small></button></li>";
        }).join("") + '</ul><p class="d-hint">Tap a line to mark it read.</p></section>' +
        '<section class="d-card"><p class="d-label">Recent activity</p><ul class="d-feed">' + c.activity.map(function (a) {
          return "<li>" + avatar(a[0], "sm") + "<p><strong>" + esc(first(PEOPLE[a[0]].n)) + "</strong> " + esc(a[1]) + "<small>" + a[2] + "</small></p></li>";
        }).join("") + "</ul></section>" +
        '<div class="d-links"><button class="d-link" data-act="go" data-view="members">' + icon("club") + "Members<small>" + c.members + '</small></button><button class="d-link" data-act="go" data-view="meetings">' + icon("cal") + "Meetings</button></div>";
    },

    shelf: function () {
      var tabs = [["tbr", "To be read"], ["reading", "Reading"], ["finished", "Finished"]];
      var pct = Math.round(S.goal.done / S.goal.target * 100);
      var list = S.shelf.filter(function (b) { return b.s === S.shelfTab; });
      return top("Reading list", "Your shelf · every club") +
        '<section class="d-card" data-tour="shelf"><div class="d-progress-row"><strong>2026 goal</strong><span>' + S.goal.done + " of " + S.goal.target + "</span></div>" + bar("goal", pct, "Reading goal: " + S.goal.done + " of " + S.goal.target + " books") + "</section>" +
        '<div class="d-tabs" role="tablist" aria-label="Shelf">' + tabs.map(function (t) {
          var n = S.shelf.filter(function (b) { return b.s === t[0]; }).length + (t[0] === "finished" ? 8 : 0);
          return '<button role="tab" aria-selected="' + (S.shelfTab === t[0]) + '" data-act="shelf-tab" data-tab="' + t[0] + '">' + t[1] + "<span>" + n + "</span></button>";
        }).join("") + "</div>" +
        '<ul class="d-books" role="list">' + list.map(function (b) {
          var action = b.s === "tbr" ? '<button class="d-btn d-btn--secondary d-btn--sm" data-act="shelf-move" data-id="' + b.id + '" data-to="reading">Start</button>' :
            b.s === "reading" ? '<button class="d-btn d-btn--primary d-btn--sm" data-act="shelf-move" data-id="' + b.id + '" data-to="finished">Mark read</button>' :
            '<span class="d-meta d-done">Finished · ' + b.d + "</span>";
          return '<li class="d-book">' + cover(b.c, first(b.t)) + '<div class="d-book-text"><p class="d-booktitle">' + esc(b.t) + '</p><p class="d-meta">' + esc(b.a) + "</p>" + (b.s === "reading" ? bar("book-" + b.id, b.p) : "") + "</div>" + action + "</li>";
        }).join("") + "</ul>";
    },

    chat: function () {
      var c = club();
      var msgs = S.chats[c.id];
      return clubTop('<button class="d-icon-btn" data-act="go" data-view="members" aria-label="Members">' + icon("club") + "</button>") +
        '<div class="d-thread" id="d-thread">' + '<p class="d-thread-note">' + icon("lock") + "Private to the club. Never public.</p>" + msgs.map(msgHtml).join("") +
        (S.typing === c.id ? typingHtml(S.typingWho) : "") + "</div>" + composer("Message the club");
    },

    dm: function () {
      var who = S.dmWith, p = PEOPLE[who];
      var msgs = S.dms[who];
      return top(esc(p.n), "Direct message", avatar(who), true) +
        '<div class="d-thread" id="d-thread">' + msgs.map(msgHtml).join("") + (S.typing === "dm:" + who ? typingHtml(who) : "") + "</div>" + composer("Message " + first(p.n));
    },

    meetings: function () {
      var c = club(), m = c.meeting, added = S.calendar[c.id];
      return top("Meetings", esc(c.name), null, true) +
        '<section class="d-card d-card--meeting" data-tour="meeting"><p class="d-label">Next meeting</p><p class="d-h2">' + m.day + '</p><p class="d-strong">' + m.time + " · " + esc(m.where) + '</p><p class="d-meta">' + esc(m.scope) + " · " + m.going + ' going</p><div class="d-avatars">' + c.people.slice(1, 5).map(function (p) { return avatar(p[0], "sm"); }).join("") + '<span class="d-avatar d-avatar--sm d-avatar--more" aria-hidden="true">+' + (m.going - 4) + "</span></div>" +
        '<button class="d-btn ' + (added ? "d-btn--secondary" : "d-btn--primary") + '" data-act="calendar"' + (added ? ' aria-pressed="true"' : "") + ">" + icon("cal") + (added ? "Added" : "Add to calendar") + "</button></section>" +
        '<section class="d-block"><p class="d-label">Upcoming</p><ul class="d-list">' + c.upcoming.map(function (u) { return "<li><strong>" + u.when + "</strong><span>" + esc(u.what) + "</span></li>"; }).join("") + "</ul></section>" +
        '<section class="d-block"><p class="d-label">Past</p><ul class="d-list d-list--past">' + c.past.map(function (u) { return "<li><strong>" + u.when + "</strong><span>" + esc(u.what) + "</span></li>"; }).join("") + "</ul></section>";
    },

    members: function () {
      var c = club();
      return top("Members", esc(c.name) + " · " + c.members, null, true) +
        '<ul class="d-members">' + c.people.map(function (p) {
          var person = PEOPLE[p[0]];
          return '<li><button class="d-member" data-act="member" data-id="' + p[0] + '">' + avatar(p[0]) + '<span class="d-member-text"><strong>' + esc(person.n) + (p[0] === "maya" ? " <small>(you)</small>" : "") + "</strong>" + chip(p[1]) + "</span>" + icon("chev") + "</button></li>";
        }).join("") + '</ul><p class="d-hint d-hint--center">and ' + (c.members - c.people.length) + " more</p>";
    },

    member: function () {
      var id = S.memberId, p = PEOPLE[id], c = club();
      var role = (c.people.filter(function (x) { return x[0] === id; })[0] || [])[1] || "Member";
      var shared = CLUB_ORDER.filter(function (cid) { return CLUBS[cid].people.some(function (x) { return x[0] === id; }); }).map(function (cid) { return CLUBS[cid].name; });
      return top(esc(p.n), "Member", null, true) +
        '<section class="d-profile">' + avatar(id, "lg") + "<p>" + chip(role) + ' in ' + esc(c.name) + "</p></section>" +
        '<section class="d-card"><p class="d-label">Shared clubs</p><ul class="d-plain">' + shared.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul></section>" +
        '<section class="d-card"><p class="d-label">Reading now</p><p class="d-booktitle">' + esc(c.book.title) + '</p><p class="d-meta">' + (30 + id.length * 7) + "% · shared with this club</p></section>" +
        (id === "maya" ? "" : '<button class="d-btn d-btn--primary d-btn--block" data-act="dm" data-id="' + id + '">' + icon("chat") + "Message</button>");
    },

    notifications: function () {
      return top("Notifications", null, null, true) +
        '<ul class="d-notifs"><li>' + avatar("ada", "sm") + "<p><strong>Ada</strong> set the next meeting<small>Riverside Readers · 2h</small></p></li>" +
        "<li>" + avatar("chris", "sm") + "<p><strong>Office Book Swap</strong> 2 new messages<small>4h</small></p></li>" +
        "<li>" + avatar("leo", "sm") + "<p><strong>Night Owls</strong> chapter 9 is due Sunday<small>yesterday</small></p></li></ul>" +
        '<p class="d-hint d-hint--center">That’s everything.</p>';
    },

    more: function () {
      var dark = S.theme === "dark";
      return top("More") +
        '<section class="d-card d-card--row">' + avatar("maya") + "<div><strong>Maya Bennett</strong><p class=\"d-meta\">@maya · 3 clubs</p></div></section>" +
        '<ul class="d-settings">' +
        '<li><button class="d-setting" data-act="sheet" data-sheet="install">' + icon("phone") + "<span>Install app<small>Add Chapterr to your home screen</small></span>" + icon("chev") + "</button></li>" +
        '<li><button class="d-setting" data-act="toast" data-text="Nothing to pay during beta.">' + icon("card") + '<span>Billing<small>Free during beta</small></span><span class="d-chip">Beta</span></button></li>' +
        '<li><button class="d-setting" role="switch" aria-checked="' + dark + '" data-act="theme">' + icon("moon") + '<span>Dark mode<small>Only this phone changes</small></span><span class="d-switch" aria-hidden="true"></span></button></li>' +
        '<li><button class="d-setting" data-act="toast" data-text="Upload a Goodreads CSV from Settings in the app.">' + icon("upload") + "<span>Import from Goodreads<small>Shelves, dates and ratings</small></span>" + icon("chev") + "</button></li>" +
        '<li><button class="d-setting" data-act="toast" data-text="No public profiles. No directory. No ads.">' + icon("lock") + "<span>Privacy<small>Private by default</small></span>" + icon("chev") + "</button></li>" +
        '<li><button class="d-setting" data-act="toast" data-text="This is a demo. There is nothing to sign out of.">' + icon("out") + "<span>Sign out</span></button></li></ul>" +
        '<p class="d-hint d-hint--center">Chapterr demo · nothing here is saved</p>';
    }
  };

  function msgHtml(m) {
    var me = m.who === "maya";
    var who = me ? "maya" : (PEOPLE[m.who] ? m.who : S.dmWith);
    return '<div class="d-msg' + (me ? " is-me" : "") + '">' + (me ? "" : avatar(who, "sm")) + '<div><p class="d-msg-name">' + (me ? "You" : esc(first(PEOPLE[who].n))) + '</p><p class="d-bubble">' + esc(m.text) + "</p></div></div>";
  }
  function typingHtml(who) {
    return '<div class="d-msg is-typing">' + avatar(who, "sm") + '<div><p class="d-msg-name">' + esc(first(PEOPLE[who].n)) + '</p><p class="d-bubble d-typing" aria-label="' + esc(first(PEOPLE[who].n)) + ' is typing"><i></i><i></i><i></i></p></div></div>';
  }
  function composer(placeholder) {
    return '<form class="d-composer" data-tour="composer"><input type="text" class="d-input" id="d-input" aria-label="' + esc(placeholder) + '" placeholder="' + esc(placeholder) + '" maxlength="200" autocomplete="off"><button type="submit" class="d-send" aria-label="Send">' + icon("send") + "</button></form>";
  }

  var TABS = [["home", "Home", "home"], ["shelf", "Shelf", "shelf"], ["club", "Club", "club"], ["chat", "Chat", "chat"], ["more", "More", "more"]];
  function tabbar() {
    var sect = { meetings: "club", members: "club", member: "club", notifications: "home", dm: "chat" }[S.view] || S.view;
    var unread = Object.keys(S.unread).reduce(function (n, k) { return n + S.unread[k]; }, 0);
    return TABS.map(function (t) {
      var cur = sect === t[0];
      return '<button data-act="tab" data-view="' + t[0] + '"' + (cur ? ' aria-current="page"' : "") + ">" + icon(t[2]) + "<span>" + t[1] + "</span>" + (t[0] === "chat" && unread ? '<i class="d-dot-badge" aria-label="' + unread + ' unread"></i>' : "") + "</button>";
    }).join("");
  }

  /* ---------- Render ---------- */
  function render(opts) {
    opts = opts || {};
    var html = VIEWS[S.view]();
    screenEl.innerHTML = html;
    screenEl.className = "d-screen d-screen--" + S.view + (S.view === "chat" || S.view === "dm" ? " d-screen--thread" : "");
    root.querySelector("#d-tabbar").innerHTML = tabbar();
    root.setAttribute("data-theme", S.theme);
    animateBars();
    if (!opts.keepScroll) screenEl.scrollTop = 0;
    var thread = screenEl.querySelector("#d-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
    if (opts.enter && !reduceMotion) {
      screenEl.classList.add("is-entering");
      later(function () { screenEl.classList.remove("is-entering"); }, 240);
    }
    renderSheet();
    if (S.tour > -1) later(placeTour, 30);
  }

  function animateBars() {
    var fills = root.querySelectorAll("[data-bar]");
    var pending = [];
    for (var i = 0; i < fills.length; i++) {
      var el = fills[i], key = el.getAttribute("data-bar"), to = el.getAttribute("data-w");
      var from = bars[key] != null ? bars[key] : 0;
      el.style.width = from + "%";
      bars[key] = to;
      pending.push([el, to]);
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        pending.forEach(function (p) { p[0].style.width = p[1] + "%"; });
      });
    });
  }

  function go(view, extra) {
    if (S.view !== view) S.stack.push(S.view);
    if (extra) Object.keys(extra).forEach(function (k) { S[k] = extra[k]; });
    S.view = view;
    if (view === "chat") S.unread[S.club] = 0;
    if (view === "notifications") S.notifs = 0;
    render({ enter: true });
  }
  function back() {
    S.view = S.stack.pop() || "home";
    render({ enter: true });
  }
  function tab(view) {
    S.stack = [];
    S.view = view;
    if (view === "chat") S.unread[S.club] = 0;
    render({ enter: true });
  }

  /* ---------- Sheets ---------- */
  var sheetOpener = null;
  function renderSheet() {
    if (!S.sheet) { sheetEl.innerHTML = ""; return; }
    var body = "";
    if (S.sheet === "switcher") {
      body = '<p class="d-label" id="d-sheet-title">Your clubs</p><ul class="d-clubs">' + CLUB_ORDER.map(function (id) {
        var c = CLUBS[id], cur = id === S.club;
        return '<li><button class="d-club' + (cur ? " is-current" : "") + '" data-act="switch" data-club="' + id + '"' + (cur ? ' aria-current="true"' : "") + '><span class="d-club-mark d-club-mark--' + c.mark + '"></span><span class="d-club-text"><strong>' + esc(c.name) + "</strong><small>" + chip(c.role) + " <span>" + c.members + " members</span></small></span>" + (cur ? icon("check") : "") + "</button></li>";
      }).join("") + '</ul><button class="d-btn d-btn--secondary d-btn--block" data-act="toast" data-text="In the app, a new club takes about a minute.">' + icon("plus") + "Create a club</button>";
    } else if (S.sheet === "invite") {
      var c = club();
      body = '<p class="d-label" id="d-sheet-title">Invite to ' + esc(c.name) + '</p><p class="d-meta">Share the code or the link. Nobody can find the club without one.</p>' +
        '<p class="d-code">' + c.code + "</p>" +
        '<div class="d-row"><button class="d-btn d-btn--primary" data-act="copy"' + (S.copied ? ' aria-pressed="true"' : "") + ">" + icon(S.copied ? "check" : "link") + (S.copied ? "Copied" : "Copy link") + '</button><button class="d-btn d-btn--secondary" data-act="toast" data-text="Invites can expire, be limited, or be revoked.">Options</button></div>' +
        '<p class="d-hint">chapterr.io/join · expires in 7 days · 20 uses</p>';
    } else if (S.sheet === "install") {
      body = '<p class="d-label" id="d-sheet-title">Install Chapterr</p><p class="d-strong">No app store needed.</p><p class="d-meta">Open app.chapterr.io in your browser, then choose “Add to Home Screen”. It opens like an app, and the pages you’ve visited keep working offline.</p><button class="d-btn d-btn--primary d-btn--block" data-act="close">Got it</button>';
    }
    sheetEl.innerHTML = '<div class="d-scrim" data-act="close"></div><div class="d-sheet" role="dialog" aria-modal="true" aria-labelledby="d-sheet-title"><button class="d-icon-btn d-sheet-close" data-act="close" aria-label="Close">' + icon("close") + "</button>" + body + "</div>";
    var f = sheetEl.querySelector(".d-sheet .d-btn, .d-sheet .d-club");
    if (f && !opened.sheet) f.focus({ preventScroll: true });
    opened.sheet = true;
  }
  var opened = { sheet: false };
  function openSheet(name, opener) {
    sheetOpener = opener || null;
    S.sheet = name; S.copied = false; opened.sheet = false;
    renderSheet();
  }
  function closeSheet() {
    if (!S.sheet) return;
    S.sheet = null; renderSheet();
    if (sheetOpener && root.contains(sheetOpener)) sheetOpener.focus({ preventScroll: true });
    sheetOpener = null;
  }

  /* ---------- Toasts ---------- */
  function toast(text) {
    var el = document.createElement("p");
    el.className = "d-toast";
    el.textContent = text;
    toastEl.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("is-in"); });
    later(function () { el.classList.remove("is-in"); later(function () { el.remove(); }, 240); }, 1800);
  }

  /* ---------- Live chat ---------- */
  function scheduleReply(thread) {
    var delay = 3000 + Math.random() * 1000;
    later(function () {
      var who;
      if (thread.indexOf("dm:") === 0) who = thread.slice(3);
      else {
        var pool = CLUBS[thread].people.filter(function (p) { return p[0] !== "maya"; });
        who = pool[Math.floor(Math.random() * pool.length)][0];
      }
      S.typing = thread; S.typingWho = who;
      if (onThread(thread)) render({ keepScroll: true });
      later(function () {
        S.typing = null;
        var text = REPLIES[Math.floor(Math.random() * REPLIES.length)];
        if (thread.indexOf("dm:") === 0) S.dms[who].push({ who: who, text: text });
        else {
          S.chats[thread].push({ who: who, text: text });
          if (!onThread(thread)) S.unread[thread] = (S.unread[thread] || 0) + 1;
        }
        render({ keepScroll: true });
      }, 1400);
    }, delay);
  }
  function onThread(thread) {
    if (thread.indexOf("dm:") === 0) return S.view === "dm" && S.dmWith === thread.slice(3);
    return S.view === "chat" && S.club === thread;
  }
  function send(text) {
    text = text.trim();
    if (!text) return;
    if (S.view === "dm") { S.dms[S.dmWith].push({ who: "maya", text: text }); scheduleReply("dm:" + S.dmWith); }
    else { S.chats[S.club].push({ who: "maya", text: text }); scheduleReply(S.club); }
    render({ keepScroll: true });
    var input = screenEl.querySelector("#d-input");
    if (input) input.focus({ preventScroll: true });
  }

  /* ---------- Guided tour ---------- */
  var TOUR = [
    { view: "home", target: '[data-tour="clubs"]', text: "Every club you’re in, on one screen." },
    { view: "shelf", target: '[data-tour="shelf"]', text: "Your shelf and goal travel across clubs." },
    { view: "chat", target: '[data-tour="composer"]', text: "Realtime chat, private to the club." },
    { view: "meetings", target: '[data-tour="meeting"]', text: "The next meeting, with the reading due." },
    { view: "club", target: '[data-tour="invite"]', text: "Invite with a link or code. No directory." }
  ];
  function tourStart() { closeSheet(); S.tour = 0; tourStep(); }
  function tourStep() {
    var step = TOUR[S.tour];
    S.stack = []; S.view = step.view;
    render();
  }
  function placeTour() {
    if (S.tour < 0) { tourEl.innerHTML = ""; return; }
    var step = TOUR[S.tour], target = screenEl.querySelector(step.target);
    var k = parseFloat(getComputedStyle(root).getPropertyValue("--k")) || 1;
    var rr = root.getBoundingClientRect(), tr = target ? target.getBoundingClientRect() : rr;
    var last = S.tour === TOUR.length - 1;
    tourEl.innerHTML = '<div class="d-tour-ring"></div><div class="d-tour-card" role="dialog" aria-label="Guided tour"><p class="d-label">' + (S.tour + 1) + " of " + TOUR.length + '</p><p>' + step.text + '</p><div class="d-row"><button class="d-btn d-btn--secondary d-btn--sm" data-act="tour-close">' + (last ? "Done" : "Skip") + "</button>" + (last ? "" : '<button class="d-btn d-btn--primary d-btn--sm" data-act="tour-next">Next</button>') + "</div></div>";
    var ring = tourEl.querySelector(".d-tour-ring");
    ring.style.left = (tr.left - rr.left) / k - 6 + "px";
    ring.style.top = (tr.top - rr.top) / k - 6 + "px";
    ring.style.width = tr.width / k + 12 + "px";
    ring.style.height = tr.height / k + 12 + "px";
    var card = tourEl.querySelector(".d-tour-card");
    var below = (tr.bottom - rr.top) / k + 90 < rr.height / k;
    card.classList.toggle("is-top", !below);
    var btn = tourEl.querySelector(".d-btn--primary") || tourEl.querySelector(".d-btn");
    if (btn) btn.focus({ preventScroll: true });
  }
  function tourClose() { S.tour = -1; tourEl.innerHTML = ""; }

  /* ---------- Events ---------- */
  function onClick(e) {
    var t = e.target.closest("[data-act]");
    if (!t || !root.contains(t)) return;
    var act = t.getAttribute("data-act");
    if (S.tour > -1 && act !== "tour-next" && act !== "tour-close") tourClose();
    switch (act) {
      case "go": go(t.getAttribute("data-view")); break;
      case "tab": tab(t.getAttribute("data-view")); break;
      case "back": back(); break;
      case "open-club": S.club = t.getAttribute("data-club"); tab("club"); break;
      case "switch":
        S.club = t.getAttribute("data-club"); closeSheet();
        if (S.view === "member" || S.view === "dm") S.view = "club";
        render({ enter: true }); toast("Now in " + club().name + "."); break;
      case "sheet": openSheet(t.getAttribute("data-sheet"), t); break;
      case "close": closeSheet(); break;
      case "markread": {
        var i = +t.getAttribute("data-i"), list = S.read[S.club], at = list.indexOf(i);
        if (at > -1) list.splice(at, 1); else list.push(i);
        render({ keepScroll: true });
        if (at === -1) toast("Marked read.");
        break;
      }
      case "shelf-tab": S.shelfTab = t.getAttribute("data-tab"); render({ keepScroll: true }); break;
      case "shelf-move": {
        var b = S.shelf.filter(function (x) { return x.id === t.getAttribute("data-id"); })[0];
        var to = t.getAttribute("data-to");
        if (b) {
          b.s = to;
          if (to === "finished") { b.d = "Oct"; S.goal.done += 1; toast("Shelved."); }
          else { b.p = 0; toast("Started."); }
        }
        render({ keepScroll: true }); break;
      }
      case "member": go("member", { memberId: t.getAttribute("data-id") }); break;
      case "dm": {
        var id = t.getAttribute("data-id");
        if (!S.dms[id]) S.dms[id] = (DMS[id] || DMS._default).map(function (m) { return { who: m[0] === "them" ? id : m[0], text: m[1] }; });
        go("dm", { dmWith: id }); break;
      }
      case "calendar": S.calendar[S.club] = true; render({ keepScroll: true }); toast("Added to your calendar."); break;
      case "copy": { S.copied = true; renderSheet(); toast("Link copied."); var cb = sheetEl.querySelector('[data-act="copy"]'); if (cb) cb.focus({ preventScroll: true }); break; }
      case "theme": S.theme = S.theme === "dark" ? "light" : "dark"; render({ keepScroll: true }); break;
      case "toast": toast(t.getAttribute("data-text")); break;
      case "tour-next": S.tour += 1; tourStep(); break;
      case "tour-close": tourClose(); break;
    }
  }
  function onSubmit(e) {
    var f = e.target.closest(".d-composer");
    if (!f) return;
    e.preventDefault();
    var input = f.querySelector("input");
    send(input.value);
  }
  function onKey(e) {
    if (e.key !== "Escape" || !S) return;
    if (S.tour > -1) { tourClose(); e.stopPropagation(); }
    else if (S.sheet) { closeSheet(); e.stopPropagation(); }
  }

  /* ---------- Fit the 300px layout into the phone screen ---------- */
  function fit() {
    var host = root.parentElement;
    if (!host) return;
    var w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    var k = w / VW;
    root.style.setProperty("--k", k.toFixed(4));
    root.style.setProperty("--vh", (h / k).toFixed(1) + "px");
  }

  /* ---------- Boot / reset ---------- */
  function boot() {
    clearTimers();
    S = freshState();
    bars = {};
    build();
    fit();
    render();
    tourClose();
    if (reduceMotion) { splashEl.classList.add("is-gone"); S.booted = true; }
    else {
      splashEl.classList.remove("is-gone");
      later(function () { splashEl.classList.add("is-gone"); S.booted = true; }, 400);
    }
    later(function () { scheduleReply("riverside"); }, 300);
  }

  if (root) {
    root.addEventListener("click", onClick);
    root.addEventListener("submit", onSubmit);
    document.addEventListener("keydown", onKey); /* Escape closes a sheet or the tour even if focus left the phone */
    if ("ResizeObserver" in window && root.parentElement) new ResizeObserver(fit).observe(root.parentElement);
    else window.addEventListener("resize", fit);
  }

  /* ---------- The "switch club" strip on the page ---------- */
  function miniDash(id) {
    var c = CLUBS[id], pct = Math.round(c.finished / c.members * 100);
    return '<div class="mini-head"><span class="d-club-mark d-club-mark--' + c.mark + '" aria-hidden="true"></span><div><p class="mini-name">' + esc(c.name) + '</p><p class="mini-meta">' + c.members + " members · you are " + c.role.toLowerCase() + "</p></div></div>" +
      '<div class="mini-book">' + cover(c.book.cover, c.book.short) + '<div><p class="eyebrow">This month</p><p class="mini-title">' + esc(c.book.title) + '</p><p class="mini-meta">' + esc(c.book.author) + " · " + c.book.pages + ' pages</p><span class="pill pill--light">' + esc(c.due) + "</span></div></div>" +
      '<div class="mini-row"><span>' + c.finished + " of " + c.members + ' have finished</span><span>' + pct + "%</span></div>" +
      '<div class="mini-progress" role="img" aria-label="' + c.finished + " of " + c.members + ' members have finished"><span class="mini-fill" data-mini="' + pct + '"></span></div>' +
      '<div class="mini-meeting"><p class="eyebrow">Next meeting</p><p class="mini-strong">' + c.meeting.day + ", " + c.meeting.time + '</p><p class="mini-meta">' + esc(c.meeting.where) + " · " + esc(c.meeting.scope) + "</p></div>";
  }
  function initStrip() {
    var strip = document.getElementById("switch-strip");
    if (!strip) return;
    var chips = strip.querySelector(".club-chips"), dash = strip.querySelector("#mini-dash");
    chips.innerHTML = CLUB_ORDER.map(function (id, i) {
      return '<button role="tab" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '" data-club="' + id + '" id="chip-' + id + '" aria-controls="mini-dash"><span class="d-club-mark d-club-mark--' + CLUBS[id].mark + '" aria-hidden="true"></span>' + esc(CLUBS[id].name) + "</button>";
    }).join("");
    var current = "riverside", swapping = false;
    function show(id, immediate) {
      current = id;
      var btns = chips.querySelectorAll("[role=tab]");
      for (var i = 0; i < btns.length; i++) {
        var on = btns[i].getAttribute("data-club") === id;
        btns[i].setAttribute("aria-selected", on); btns[i].tabIndex = on ? 0 : -1;
      }
      var apply = function () {
        dash.innerHTML = miniDash(id);
        var fill = dash.querySelector("[data-mini]");
        fill.style.width = "0%";
        requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = fill.getAttribute("data-mini") + "%"; }); });
        dash.classList.remove("is-swapping");
        dash.setAttribute("aria-labelledby", "chip-" + id);
        swapping = false;
      };
      if (immediate || reduceMotion) { apply(); return; }
      if (swapping) return;
      swapping = true;
      dash.classList.add("is-swapping");
      setTimeout(apply, 200);
    }
    chips.addEventListener("click", function (e) {
      var b = e.target.closest("[data-club]");
      if (b && b.getAttribute("data-club") !== current) show(b.getAttribute("data-club"));
    });
    chips.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var i = CLUB_ORDER.indexOf(current) + (e.key === "ArrowRight" ? 1 : -1);
      i = (i + CLUB_ORDER.length) % CLUB_ORDER.length;
      show(CLUB_ORDER[i]);
      chips.querySelector('[data-club="' + CLUB_ORDER[i] + '"]').focus();
      e.preventDefault();
    });
    show("riverside", true);
  }
  initStrip();

  window.ChapterrDemo = { boot: boot, fit: fit, isBooted: function () { return !!S; }, tour: function () { if (!S) boot(); tourStart(); } };
})();
