/*
 * sw.js - retired.
 *
 * Older versions of this port registered a service worker here that rewrote
 * every .swf on the fly. The patched Ruffle build (AIR-Runtime/vendor/ruffle/)
 * makes that unnecessary. Browsers that still have the old worker installed
 * re-fetch this file on their next visit; this version removes itself.
 * script.js also unregisters it from the page side.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.registration.unregister());
});
