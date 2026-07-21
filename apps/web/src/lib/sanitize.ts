import DOMPurify from "dompurify";

// Feed HTML is already sanitized server-side at ingestion; this is a
// defense-in-depth pass at render time so that content reaching the DOM by any
// other path (CLI, manual DB edits, a future parser change) still cannot run
// script. The iframe host allowlist mirrors the worker's sanitizer so that
// legitimate embeds keep working.
const ALLOWED_IFRAME_HOSTS = new Set([
  "www.youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
  "open.spotify.com",
  "w.soundcloud.com",
  "embed.podcasts.apple.com",
]);

let hookInstalled = false;

function ensureHook() {
  if (hookInstalled)
    return;

  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "iframe")
      return;

    const element = node as Element;
    let host = "";

    try {
      host = new URL(element.getAttribute("src") ?? "", window.location.origin).hostname;
    }
    catch {
      host = "";
    }

    if (!ALLOWED_IFRAME_HOSTS.has(host))
      element.remove();
  });

  hookInstalled = true;
}

export function sanitizeArticleHtml(html: string): string {
  ensureHook();

  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "loading", "referrerpolicy", "sandbox", "target"],
    ADD_TAGS: ["iframe"],
  });
}
