# AIR-Runtime

The engine side of the port: a patched [Ruffle](https://ruffle.rs) build plus
the small amount of page JavaScript it talks to.

```
ruffle-loader.js        loads vendor/ruffle/ruffle.js, creates the player, wraps window.fetch
                        to report .swf download progress
air-fs.js               window.__ruffleAirFS: the browser half of the AIR APIs (see below)
vendor/ruffle/          patched Ruffle build: ruffle.js + ruffle_web_bg.*.wasm (+ licenses, BUILD_INFO.txt)
ruffle-patches/
  henry-web.patch       the changes to Ruffle (applies to the commit in RUFFLE_COMMIT)
  RUFFLE_COMMIT         the upstream Ruffle commit the patch is based on
  build-ruffle.mjs      clones, patches, builds, and copies the result into vendor/ruffle/
fonts/                  Liberation Sans/Serif (SIL OFL) for Flash's _sans/_serif device fonts
```

## What the patch changes

### 1. Lazy shape tessellation (`core/src/display_object/graphic.rs`, `movie_clip.rs`)

Upstream Ruffle, on encountering each `DefineShape` tag during preload, parses
the full shape record list *and* tessellates it for the GPU, then keeps both
for the life of the movie. That's fine for small Flash games. Henry Stickmin
is hand-drawn vector animation: measured on `Henry.swf`, the WebAssembly heap
reached about 1.7 GB before the game's first line of code ran (40 s of
preloading), and the three chapter files pushed it past the 4 GB wasm32 limit.
Ruffle then aborted with `RuntimeError: unreachable` in the allocator.

With the patch, preload reads only the tag header (id and bounds) and keeps a
zero-copy `SwfSlice` of the tag body. The shape is parsed and tessellated the
first time it's actually rendered (`GraphicShared::render_handle`), and
re-parsed on demand for hit tests and zoom re-tessellation. That costs nothing
up front and pays only for what's on screen.

| | Stock Ruffle | Patched |
|---|---|---|
| Henry.swf preload until game code runs | ~40 s | < 1 s |
| All four SWFs loaded | crash (> 4 GB) | ~4 s, ~1.4 GB heap |

### 2. AIR file APIs (`core/src/avm2/globals/flash/filesystem/*.as`)

Ruffle's `File` and `FileStream` were empty stubs, and `FileMode` didn't exist.
They are reimplemented in ActionScript. A `File` is a `(root, path)` pair:

| root | AIR equivalent | backing |
|---|---|---|
| `app` | `File.applicationDirectory` | read-only files in `Game Files/` (synchronous XHR; the game reads its subtitle files synchronously) |
| `storage` | `File.applicationStorageDirectory` | `localStorage` keys `henry-air:storage:<path>` |
| `other` | anything else | `localStorage` keys `henry-air:other:<path>` |

`FileStream` buffers the whole file in a `ByteArray` (open → read, close →
write back), and implements the full `IDataInput`/`IDataOutput` surface.
`File` supports `resolvePath`, `exists`, `url`/`nativePath`, `parent`,
`deleteFile`, `moveTo`/`copyTo` (the game saves via write-temp-then-`moveTo`),
and `getDirectoryListing`. For `app` files, `url` is an absolute URL next to
the SWF, so `Loader` resolves chapter files correctly.

All I/O goes through one synchronous call, `ExternalInterface.call("__ruffleAirFS", op, ...)`.
File contents cross it as hex strings. If the page provides no bridge (or
`allowScriptAccess` is off), files are kept in memory for the session.

### 3. Steam and quitting

- `com.amanitadesign.steam.FRESteamWorks` (the Steam native extension) is
  defined in Ruffle's globals. `init()` returns `false`, so the game behaves as
  it does with Steam closed. `setAchievement(name)` is forwarded to the page as
  `__ruffleAirFS("achievement", name)`.
- `NativeApplication.exit()` calls `__ruffleAirFS("exit", code)`. The page
  unloads the player and shows a "Play again" screen.

### 4. Animation/audio sync (`core/src/backend/audio.rs`, `core/src/player.rs`)

Most of the game's animations are timed to "stream" sounds (audio stored frame
by frame in the timeline), and Ruffle keeps the timeline in step with them.
Upstream measures the timeline's position using the movie's **header** frame
rate. This game's headers don't match its content:

| File | header fps | stream audio authored at | game sets `stage.frameRate` |
|---|---|---|---|
| HenryFtC.swf | 30 | 24 | 24 |
| Henry.swf (Escaping the Prison / Stealing the Diamond scenes) | 24 | 30 | 30 |

So upstream Ruffle saw the timeline drift 0.2 s per second away from its audio
(measured), then "corrected" it by running several frames in one tick. That
showed up as animations playing a couple of frames and then jumping ahead.
Past 1 s of drift it even cut the audio stream and restarted it.

The patch uses each stream's own rate instead: `num_samples_per_block /
sample_rate` from its `SoundStreamHead`, which is how Flash Player paced
stream sound. Measured skew now stays within ±0.04 s. The correction applied
after a genuinely slow frame is also capped at one frame per tick, so a
catch-up is a brief speed-up instead of a visible jump.

Only the exact patch above was built and tested. Everything else is upstream
Ruffle at the commit in `RUFFLE_COMMIT`.

## Page configuration that matters

`ruffle-loader.js` sets:

- `playerRuntime: "air"` exposes `flash.desktop` / `flash.filesystem`, which are AIR-only.
- `allowScriptAccess: true` is required for the `__ruffleAirFS` bridge.
- `contextMenu: "off"`: the game uses right-click itself ("right-click a
  character to unlock their bio"), so Ruffle's menu must not cover it.
- `base: "Game Files/"`, so relative loads resolve next to the SWFs.
- `autoplay: "on"`, `unmuteOverlay: "hidden"`: the game starts as soon as it
  loads. While the browser still blocks audio, the intro holds on a black frame,
  because it's synced to streamed audio. The page then shows "Click to start",
  and that click resumes Ruffle's AudioContext (captured in `ruffle-loader.js`)
  without being passed to the game.

## Rebuilding Ruffle

Needed only if you change the patch or move to a newer Ruffle.

Requirements: git, Node 20+, Rust via rustup with the `wasm32-unknown-unknown`
target, `wasm-bindgen-cli` at the version Ruffle pins (0.2.127 at this commit:
`cargo install wasm-bindgen-cli --version 0.2.127`), Java 17+ on `PATH`
(Ruffle compiles its ActionScript globals with it), and optionally binaryen's
`wasm-opt`. On Windows, use the MSVC Rust toolchain (Visual Studio Build Tools
with C++).

```
node AIR-Runtime/ruffle-patches/build-ruffle.mjs --workdir C:\rb
```

On Windows, keep `--workdir` short. Cargo's git checkouts fail with "path too
long" under deep folders. The first build takes several minutes; rebuilds
after editing only the `.as` files take about a minute.

To edit the patch: make changes in the work directory's checkout, then
regenerate it with
`git add -N core && git diff -- core > <this folder>/ruffle-patches/henry-web.patch`.

## Known limitations

- Fonts: the game asks for Arial, Franklin Gothic Medium and Ebrima by name.
  Web builds of Ruffle can't see system fonts, and those can't be
  redistributed, so text falls back to Ruffle's bundled font or Liberation
  Sans. Expect slightly different text rendering.
- The game's "fullscreen" setting can't switch to fullscreen on startup,
  because browsers only allow that from a click. Press F11, or use the
  in-game toggle.
- If the browser stalls hard (a background tab, a very slow machine), a
  scene still has to catch up with its audio afterwards. It now does that as a
  short speed-up rather than a jump.
- The console shows a few `relative URL without a base` messages while the
  chapters load. They come from how Ruffle names child movies internally and
  are harmless.
