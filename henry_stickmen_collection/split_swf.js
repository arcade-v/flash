/* split_swf.js
 * Browser-side SWF part loader for The Henry Stickmin Collection.
 *
 * Supports:
 *   Henry.swf.part000, Henry.swf.part001, ...
 *   HenryFtC.swf.part000, ...
 *   HenryCtM.swf.part000, ...
 *   HenryCtM2.swf.part000, ...
 *
 * Load this script BEFORE ruffle-loader.js and script.js.
 */

(function () {
  "use strict";

  const PART_COUNTS = {
    "Henry.swf": 6,
    "HenryCtM.swf": 6,
    "HenryCtM2.swf": 7,
    "HenryFtC.swf": 3
  };

  const GAME_DIR = new URL("Game%20Files/", document.baseURI);
  const originalFetch = window.fetch.bind(window);
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  const cache = new Map();

  function resolveUrl(input) {
    try {
      return new URL(
        typeof input === "string" ? input : input.url,
        document.baseURI
      );
    } catch {
      return null;
    }
  }

  function getSwfName(input) {
    const url = resolveUrl(input);
    if (!url) return null;

    let pathname;

    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = url.pathname;
    }

    const match = pathname.match(
      /(?:^|\/)(Henry(?:CtM2|CtM|FtC)?\.swf)$/i
    );

    if (!match) return null;

    const name = Object.keys(PART_COUNTS).find(
      (candidate) => candidate.toLowerCase() === match[1].toLowerCase()
    );

    return name || null;
  }

  async function assemble(name) {
    if (cache.has(name)) return cache.get(name);

    const promise = (async () => {
      const count = PART_COUNTS[name];
      const parts = [];
      let total = 0;

      for (let i = 0; i < count; i++) {
        const partName = name + ".part" + String(i).padStart(3, "0");
        const partUrl = new URL(encodeURIComponent(partName), GAME_DIR);

        const response = await originalFetch(partUrl.href, {
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error(
            "Could not load " + partName + " (" + response.status + ")."
          );
        }

        const buffer = await response.arrayBuffer();
        parts.push(buffer);
        total += buffer.byteLength;

        console.info(
          "[split_swf] " + name + ": part " + (i + 1) + "/" + count +
          " loaded (" + Math.round(total / 1048576) + " MiB)"
        );
      }

      const blob = new Blob(parts, {
        type: "application/x-shockwave-flash"
      });

      console.info(
        "[split_swf] Assembled " + name + " (" +
        Math.round(blob.size / 1048576) + " MiB)"
      );

      return blob;
    })();

    cache.set(name, promise);

    try {
      return await promise;
    } catch (error) {
      cache.delete(name);
      throw error;
    }
  }

  function isSwfRequest(input) {
    return getSwfName(input) !== null;
  }

  // Intercept Ruffle's fetch-based SWF and chapter requests.
  window.fetch = async function (input, init) {
    const name = getSwfName(input);

    if (!name) {
      return originalFetch(input, init);
    }

    const blob = await assemble(name);
    const url = resolveUrl(input);

    return new Response(blob, {
      status: 200,
      statusText: "OK",
      headers: {
        "Content-Type": "application/x-shockwave-flash",
        "Content-Length": String(blob.size),
        "Access-Control-Allow-Origin": "*",
        "X-Split-SWF": name,
        "X-Split-SWF-URL": url ? url.href : ""
      }
    });
  };

  // Intercept XMLHttpRequest-based SWF requests as well.
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__splitSwfName = getSwfName(String(url));
    this.__splitSwfMethod = String(method).toUpperCase();

    if (this.__splitSwfName) {
      this.__splitSwfUrl = resolveUrl(String(url)).href;
      return originalXhrOpen.call(
        this,
        method,
        this.__splitSwfUrl,
        true
      );
    }

    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const name = this.__splitSwfName;

    if (!name) {
      return originalXhrSend.call(this, body);
    }

    const xhr = this;
    let aborted = false;

    xhr.abort = function () {
      aborted = true;
      if (typeof xhr.onabort === "function") {
        xhr.onabort(new ProgressEvent("abort"));
      }
    };

    (async () => {
      try {
        const blob = await assemble(name);
        if (aborted) return;

        const buffer = await blob.arrayBuffer();
        if (aborted) return;

        Object.defineProperty(xhr, "readyState", {
          configurable: true,
          value: 4
        });

        Object.defineProperty(xhr, "status", {
          configurable: true,
          value: 200
        });

        Object.defineProperty(xhr, "statusText", {
          configurable: true,
          value: "OK"
        });

        Object.defineProperty(xhr, "responseURL", {
          configurable: true,
          value: xhr.__splitSwfUrl
        });

        Object.defineProperty(xhr, "response", {
          configurable: true,
          get: () =>
            xhr.responseType === "blob"
              ? blob
              : xhr.responseType === "json"
                ? null
                : xhr.responseType === "text"
                  ? ""
                  : buffer
        });

        if (typeof xhr.onreadystatechange === "function") {
          xhr.onreadystatechange(new Event("readystatechange"));
        }

        if (typeof xhr.onload === "function") {
          xhr.onload(new ProgressEvent("load", {
            lengthComputable: true,
            loaded: blob.size,
            total: blob.size
          }));
        }

        if (typeof xhr.onloadend === "function") {
          xhr.onloadend(new ProgressEvent("loadend"));
        }
      } catch (error) {
        console.error("[split_swf] Failed to assemble " + name, error);

        if (aborted) return;

        if (typeof xhr.onerror === "function") {
          xhr.onerror(new ProgressEvent("error"));
        }
      }
    })();
  };

  window.SplitSWF = {
    assemble,
    getSwfName,
    partCounts: Object.assign({}, PART_COUNTS)
  };

  console.info("[split_swf] Split SWF loader installed.");
})();