/* Chapterr marketing site — small, dependency-free enhancements.
   Everything here is progressive: the page is complete without it. */
(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  root.classList.add("js");

  /* ---- Mobile menu ---- */
  var header = doc.querySelector(".site-header");
  var toggle = doc.querySelector(".menu-toggle");
  var nav = doc.getElementById("site-nav");

  if (header && toggle && nav) {
    var desktop = window.matchMedia("(min-width: 880px)");

    var setOpen = function (open) {
      header.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });

    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });

    doc.addEventListener("click", function (e) {
      if (header.classList.contains("is-open") && !header.contains(e.target)) setOpen(false);
    });

    var onDesktopChange = function (mq) { if (mq.matches) setOpen(false); };
    if (desktop.addEventListener) desktop.addEventListener("change", onDesktopChange);
    else if (desktop.addListener) desktop.addListener(onDesktopChange);
  }

  /* ---- Header hairline once the page has scrolled ---- */
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- Gentle reveal on scroll (skipped when motion is reduced) ---- */
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealEls = doc.querySelectorAll(".reveal");

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* ---- Open the FAQ item named in the URL hash, if any ---- */
  var openFromHash = function () {
    var id = location.hash && location.hash.slice(1);
    if (!id) return;
    var target = doc.getElementById(id);
    if (!target) return;
    var details = target.closest("details");
    if (details) details.open = true;
  };
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
})();
