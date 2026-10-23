/* Chapterr marketing site: page chrome: preloader, nav, reveal, parallax,
   and the hero's book→phone handoff. Progressive: the page is complete
   without it (static book render + content). */
(function () {
  "use strict";

  var doc = document, root = doc.documentElement;
  root.classList.add("js");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Header ---------- */
  var header = doc.querySelector(".site-header");
  var toggle = doc.querySelector(".menu-toggle");
  var nav = doc.getElementById("site-nav");
  if (header && toggle && nav) {
    var setOpen = function (open) {
      header.classList.toggle("is-open", open);
      root.classList.toggle("menu-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    toggle.addEventListener("click", function () { setOpen(toggle.getAttribute("aria-expanded") !== "true"); });
    nav.addEventListener("click", function (e) { if (e.target.closest("a")) setOpen(false); });
    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
    });
    var desktop = window.matchMedia("(min-width: 880px)");
    var onDesktop = function (mq) { if (mq.matches) setOpen(false); };
    if (desktop.addEventListener) desktop.addEventListener("change", onDesktop);
  }
  if (header) {
    var onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 8); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- Reveal on scroll ---------- */
  var revealEls = doc.querySelectorAll(".reveal");
  function startReveal() {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      revealEls.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("is-visible"); io.unobserve(entry.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Parallax on the glows (transform only, rAF-throttled) ---------- */
  var glows = [];
  doc.querySelectorAll("[data-parallax]").forEach(function (el) {
    glows.push({ el: el, f: parseFloat(el.getAttribute("data-parallax")) || 0, top: 0 });
  });
  function measureGlows() {
    glows.forEach(function (g) {
      var p = g.el.parentElement, t = 0;
      while (p && p !== doc.body) { t += p.offsetTop; p = p.offsetParent; }
      g.top = t;
    });
  }
  var ticking = false;
  function parallax() {
    ticking = false;
    var y = window.scrollY, vh = window.innerHeight;
    glows.forEach(function (g) {
      var d = y - g.top;
      if (d < -vh * 1.5 || d > vh * 2.5) return;
      g.el.style.transform = "translate3d(0," + (d * g.f).toFixed(1) + "px,0)";
    });
  }
  if (glows.length && !reduceMotion) {
    measureGlows(); parallax();
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(parallax); } }, { passive: true });
    window.addEventListener("resize", function () { measureGlows(); parallax(); });
  }

  /* ---------- FAQ: open the item named in the hash ---------- */
  var openFromHash = function () {
    var id = location.hash && location.hash.slice(1);
    if (!id) return;
    var target = doc.getElementById(id);
    var details = target && target.closest("details");
    if (details) details.open = true;
  };
  openFromHash();
  window.addEventListener("hashchange", openFromHash);

  /* ---------- Hero stage: book → phone → live demo ---------- */
  var stage = doc.getElementById("stage");
  var video = doc.getElementById("stage-video");
  var phone = doc.getElementById("phone");
  var caption = doc.querySelector(".stage-caption");
  var demo = window.ChapterrDemo;

  /* Screen corners of the phone on the video's final frame, as fractions of
     the 1:1 frame (measured on 3d/book-to-phone-last.png). Order: TL, TR, BR, BL. */
  var QUAD = [[0.3421, 0.0563], [0.6435, 0.0963], [0.7194, 0.8995], [0.3944, 0.9083]];

  /* 2D projective transform (3x3 homography) from four source points to four
     destination points, expressed as a CSS matrix3d. */
  function adj(m) {
    return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
      m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
      m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
  }
  function mul(a, b) {
    var r = [], i, j, k;
    for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) { var s = 0; for (k = 0; k < 3; k++) s += a[3 * i + k] * b[3 * k + j]; r[3 * i + j] = s; }
    return r;
  }
  function basis(p) {
    var m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1];
    var a = adj(m), v = [p[3][0], p[3][1], 1];
    var w = [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]];
    return mul(m, [w[0], 0, 0, 0, w[1], 0, 0, 0, w[2]]);
  }
  function homography(src, dst) {
    var h = mul(basis(dst), adj(basis(src)));
    for (var i = 0; i < 9; i++) h[i] /= h[8];
    return "matrix3d(" + [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]].map(function (n) { return n.toFixed(6); }).join(",") + ")";
  }

  /* The CSS phone posed so its screen sits exactly on the rendered screen. */
  function poseMatrix() {
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var V = Math.min(sw, sh); /* the 1:1 video box, centred */
    var ox = (sw - V) / 2, oy = (sh - V) / 2;
    var W = phone.offsetWidth, H = phone.offsetHeight, pad = 8;
    var px = phone.offsetLeft + phone.offsetParent.offsetLeft, py = phone.offsetTop + phone.offsetParent.offsetTop;
    var src = [[pad, pad], [W - pad, pad], [W - pad, H - pad], [pad, H - pad]];
    var dst = QUAD.map(function (q) { return [ox + q[0] * V - px, oy + q[1] * V - py]; });
    return homography(src, dst);
  }

  var state = "idle", timers = [], videoPlayed = false;
  function after(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearAll() { timers.forEach(clearTimeout); timers = []; }

  function goLive(fromVideo) {
    if (state === "live") return;
    clearAll();
    state = "live";
    if (demo && !demo.isBooted()) demo.boot();
    phone.removeAttribute("aria-hidden");
    if (fromVideo && !reduceMotion) {
      /* Hold the final frame as a still, pose the CSS phone exactly over its screen,
         cross-fade (600 ms), then let the phone settle front-facing (1 s). */
      stage.setAttribute("data-state", "ended");
      phone.style.transition = "none";
      phone.style.transform = poseMatrix();
      void phone.offsetWidth;
      stage.setAttribute("data-state", "live");
      phone.style.transition = "";
      after(function () { phone.style.transform = "none"; }, 40);
    } else {
      phone.style.transform = "none";
      stage.setAttribute("data-state", "live");
    }
    if (caption) caption.classList.add("is-on");
  }

  function startVideo() {
    if (!video || reduceMotion || !video.canPlayType || !(video.canPlayType("video/webm") || video.canPlayType("video/mp4"))) { goLive(false); return; }
    state = "playing";
    var started = false;
    var fail = function () { if (state === "playing" && !started) goLive(false); };
    var sources = video.querySelectorAll("source");
    if (sources.length) sources[sources.length - 1].addEventListener("error", fail);
    video.addEventListener("error", fail);
    /* The sources may already have failed (404) before this deferred script ran. */
    if (video.networkState === 3 /* NETWORK_NO_SOURCE */ || video.error) { goLive(false); return; }
    video.addEventListener("playing", function () {
      if (state !== "playing") return;
      started = true; videoPlayed = true;
      stage.setAttribute("data-state", "playing");
      if (demo) demo.boot();
      clearAll();
      after(function () { goLive(true); }, ((video.duration || 5) * 1000) + 2500); /* watchdog if `ended` never fires */
    });
    video.addEventListener("ended", function () { if (state === "playing") goLive(true); });
    try { video.currentTime = 0; } catch (e) { /* not loaded yet; fine */ }
    var p = video.play();
    if (p && p.catch) p.catch(fail); /* autoplay blocked or source unsupported: straight to the phone */
    after(function () { if (!started) goLive(false); }, 4500); /* slow network: don't keep people waiting */
  }

  function replay() {
    if (!video || reduceMotion || !videoPlayed) { if (demo) demo.boot(); goLive(false); return; }
    clearAll();
    state = "playing";
    phone.setAttribute("aria-hidden", "true");
    if (caption) caption.classList.remove("is-on");
    phone.style.transform = "none";
    stage.setAttribute("data-state", "replaying");
    try { video.currentTime = 0; } catch (e) { /* ignore */ }
    var p = video.play();
    if (p && p.catch) p.catch(function () { goLive(false); });
    after(function () { if (state === "playing") goLive(true); }, ((video.duration || 5) * 1000) + 2500);
  }

  if (stage && phone) {
    var replayBtn = doc.getElementById("replay-btn"), tourBtn = doc.getElementById("tour-btn");
    if (replayBtn) replayBtn.addEventListener("click", replay);
    if (tourBtn) tourBtn.addEventListener("click", function () { if (state !== "live") goLive(false); if (demo) demo.tour(); });
    /* The video has `autoplay` so it starts even before this script runs; hold it
       back until the preloader has lifted so nobody misses the first second. */
    if (video) { try { video.pause(); } catch (e) { /* ignore */ } }
  }

  /* ---------- Preloader (≤ 1.2 s, skippable, off under reduced motion) ---------- */
  var pre = doc.getElementById("preloader");
  var begun = false;
  function begin() {
    if (begun) return;
    begun = true;
    if (pre) {
      pre.classList.add("is-done");
      setTimeout(function () { pre.remove(); }, 400);
    }
    startReveal();
    if (stage && phone) startVideo();
  }
  if (pre && !reduceMotion) {
    var line = doc.getElementById("preloader-line");
    var swap = setTimeout(function () {
      if (!line) return;
      line.classList.add("is-swapping");
      setTimeout(function () { line.textContent = "Worth the wait."; line.classList.remove("is-swapping"); }, 200);
    }, 520);
    var done = setTimeout(begin, 1100);
    var skip = function () { clearTimeout(swap); clearTimeout(done); begin(); };
    pre.addEventListener("click", skip);
    doc.addEventListener("keydown", function (e) { if (!begun && (e.key === "Escape" || e.key === "Enter" || e.key === " ")) skip(); }, { once: true });
  } else {
    begin();
  }
})();
