#!/usr/bin/env python3
"""
serve.py - local server for the Henry Stickmin Collection web port.

    python serve.py          # tries port 8000, then 8001, 8002, ...
    python serve.py 8080     # tries 8080 first

Then open http://localhost:<port>.

Why not plain `python -m http.server`?
  * It asks the OS what Content-Type a file has. On Windows the registry can
    report .js as "text/plain" and .wasm as unknown, which slows or breaks
    loading Ruffle. The types that matter are set explicitly here.
  * It is single-threaded: one 120MB .swf download blocks every other request,
    and the game downloads four of them at once.

If the port is taken (WinError 10048 / "address already in use") an older
server is still running in another window; this script moves on to the next
free port instead of crashing, and tells you which one it picked.
"""

import http.server
import sys

MIME_OVERRIDES = {
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".swf": "application/x-shockwave-flash",
    ".abc": "application/octet-stream",
    ".ttf": "font/ttf",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        lower = str(path).lower()
        for ext, mime in MIME_OVERRIDES.items():
            if lower.endswith(ext):
                return mime
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets a *second* server bind a port that is already
    # in use and silently share it, which is how you end up talking to the old
    # server without realising. Keep it off so a busy port is reported as busy.
    allow_reuse_address = False
    daemon_threads = True


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    httpd = None
    for port in range(start, start + 50):
        try:
            httpd = Server(("127.0.0.1", port), Handler)
            break
        except OSError:
            if port == start:
                print(f"Port {start} is already in use (an older server is probably still "
                      f"running in another window) - trying the next one...")
    if httpd is None:
        sys.exit(f"No free port found between {start} and {start + 49}.")

    port = httpd.server_address[1]
    print(f"\nServing on  http://localhost:{port}   ")
    print("Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
