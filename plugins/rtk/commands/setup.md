---
description: Check for the rtk binary, install it if missing, and verify the PreToolUse rewrite hook is actually firing.
allowed-tools: Bash(rtk:*), Bash(where:*), Bash(command:*), Bash(curl:*), Bash(tar:*), Bash(unzip:*), Bash(cargo:*), Bash(brew:*)
---

First-time setup for the `rtk` pack. This pack ships no binary and no rewrite
rules of its own; it only wires the external `rtk` executable into a PreToolUse
hook once that executable exists on this machine.

Steps:

1. Check whether `rtk` is already on `PATH`. Use `rtk --version` directly rather
   than `which`/`command -v`, since neither exists in `cmd.exe`. If it prints a
   version, skip to step 4.

2. **Do not run `cargo install rtk`.** The crate named `rtk` on crates.io is a
   different, unrelated project: `reachingforthejack/rtk`, "Rust Type Kit",
   stuck at v0.1.0. Upstream's `Cargo.toml` declares the package name `rtk` but
   the binary this pack wants has never been published to crates.io under that
   name, so `cargo install rtk` silently installs the wrong tool and every
   subsequent step appears to work while doing nothing. Verified against
   crates.io and `rtk-ai/rtk` at tag v0.46.0.

3. Install it. Pick by platform:

   **Windows** (this is the case that matters here, and upstream's `INSTALL.md`
   has no Windows section at all, even though the release does ship the asset;
   it is simply undocumented). Download the prebuilt binary from the release
   assets:

   ```
   rtk-x86_64-pc-windows-msvc.zip
   ```

   from `https://github.com/rtk-ai/rtk/releases/latest`, unzip it, and put
   `rtk.exe` somewhere already on `PATH`. `C:\Users\<you>\.local\bin` is the
   convention this machine already uses (`code-review-graph.exe` lives there).
   No Rust toolchain is required, and none is installed here.

   **macOS / Linux**, if a toolchain is present:

   ```
   cargo install --git https://github.com/rtk-ai/rtk --tag v0.46.0
   ```

   Note the `--git`: that is what routes around the crates.io name collision in
   step 2. Homebrew and upstream's `install.sh` are also options on those
   platforms, but `install.sh` is a `curl | sh` pipe, so read it first if that
   matters to you.

   **Verify the download before unzipping it.** The release ships a
   `checksums.txt`. At v0.46.0 the Windows zip is
   `9bc5acd54d35a916e4a561435963e0acf2f1a0115cf43dcfe2b719f361c8a970`, checked
   against that file. Compare with:

   ```
   Get-FileHash rtk-x86_64-pc-windows-msvc.zip -Algorithm SHA256
   ```

   Be clear about what that buys. It catches a corrupted or tampered download.
   It does not catch a compromised upstream account, because `checksums.txt`
   sits in the same release and the same credentials can replace both. There is
   no stronger guarantee available: the assets carry no `.sig` or `.asc`, the
   release workflow runs no cosign or sigstore step, and GitHub's attestation
   API returns 404 for this binary. Verified at v0.46.0.

4. **Do not run `rtk init -g`.** That is upstream's own installer. It writes
   rtk's hook into your **global** `~/.claude/settings.json`, drops a
   `~/.claude/RTK.md`, and appends an `@RTK.md` reference to your **global**
   `~/.claude/CLAUDE.md`. None of that is undone when you disable a plugin, and
   the CLAUDE.md edit lands unreviewed in the file that governs every project.
   This pack owns its own hook in `hooks/hooks.json` precisely so that toggling
   the plugin toggles the behavior. Running both installers means two hooks fire
   on every Bash call.

5. Verify the hook actually fires. Enable the plugin, restart Claude Code, then
   run something rtk has a rule for and check whether the output came back as a
   digest:

   ```
   git log --oneline -30
   ```

   Then confirm the escape hatch works, since that is the thing you will reach
   for when a rewrite is wrong:

   ```
   CLAUDE_KIT_RTK_OFF=1 git log --oneline -30
   ```

   The second should return the raw, unrewritten output. If both return the same
   thing, the hook is not firing at all. Check that the plugin is enabled and
   that Claude Code was restarted.

6. If `rtk` is not installed, the plugin is **inert, not broken**.
   `scripts/rtk-rewrite.mjs` probes `PATH` and exits silently when the binary is
   absent, deliberately without writing to stderr, because a warning on every single
   Bash call would be worse than the feature being off. So "I enabled it and
   nothing changed" is the expected symptom of a missing binary, not a bug.
   Re-run step 1 to tell the two apart.

7. Configuration lives in `~/.config/rtk/config.toml` (`exclude_commands` is the
   key for carving out commands rtk should leave alone). This is **global to
   rtk**, not per-project. Upstream's hook has no project-local config path. If
   you need a per-repo exception, the escape hatch in step 5 is the mechanism,
   not the config file.
