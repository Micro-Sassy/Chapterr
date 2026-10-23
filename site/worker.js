// Minimal entry point for the marketing site: every request is answered from
// the static assets in ./public (404.html for unknown paths). Having an
// explicit script keeps Cloudflare from reusing any earlier Worker code.
export default {
  fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
