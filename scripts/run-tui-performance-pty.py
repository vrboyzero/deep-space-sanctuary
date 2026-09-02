import argparse
import fcntl
import json
import os
import platform as host_platform
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time


REPLAY_MARKER = "TUI_PERF_END"
MAX_CAPTURE_BYTES = 2_000_000


def parse_args():
    parser = argparse.ArgumentParser(description="Collect TUI performance samples from a Unix PTY.")
    parser.add_argument("--repo", required=True)
    parser.add_argument("--warmup-runs", type=int, default=1)
    parser.add_argument("--sample-runs", type=int, default=7)
    parser.add_argument("--replay-character-count", type=int, default=256)
    parser.add_argument("--startup-timeout-seconds", type=float, default=30.0)
    return parser.parse_args()


def create_replay_input(character_count):
    if character_count < len(REPLAY_MARKER):
        raise RuntimeError(f"replay character count must be at least {len(REPLAY_MARKER)}")
    return ("x" * (character_count - len(REPLAY_MARKER)) + REPLAY_MARKER).encode("ascii")


def resize(fd, rows, columns):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    foreground_group = os.tcgetpgrp(fd)
    os.killpg(foreground_group, signal.SIGWINCH)


def process_group_alive(process_group_id):
    try:
        os.killpg(process_group_id, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def terminate_process_group(pid):
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        waited_pid, status = os.waitpid(pid, os.WNOHANG)
        if waited_pid == pid:
            return status
        time.sleep(0.05)
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        return os.waitpid(pid, 0)[1]
    except ChildProcessError:
        return None


def child_environment():
    allowed = {
        "HOME",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "LOGNAME",
        "PATH",
        "SHELL",
        "TMPDIR",
        "USER",
        "WSL_DISTRO_NAME",
        "WSL_INTEROP",
    }
    environment = {key: value for key, value in os.environ.items() if key in allowed}
    environment["TERM"] = "xterm-256color"
    return environment


def append_capture(data, chunk):
    data.extend(chunk)
    if len(data) > MAX_CAPTURE_BYTES:
        raise RuntimeError(f"TUI output exceeded the {MAX_CAPTURE_BYTES}-byte capture limit")


def drain_pty(fd, data):
    deadline = time.monotonic() + 0.25
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.02)
        if not ready:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        append_capture(data, chunk)


def strip_ansi(value):
    return re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", value)


def has_inverse_label(value, label):
    inverse = False
    index = 0
    while index < len(value):
        match = re.match(rb"\x1b\[([0-9;]*)m", value[index:])
        if match:
            codes = [0] if not match.group(1) else [int(item) for item in match.group(1).split(b";")]
            if 0 in codes or 27 in codes:
                inverse = False
            if 7 in codes:
                inverse = True
            index += len(match.group(0))
            continue
        if inverse and value.startswith(label, index):
            return True
        index += 1
    return False


def has_required_labels(value):
    visible = strip_ansi(value)
    return all(label in visible for label in [
        b"Star Sanctuary", b"CHAT", b"SESSIONS", b"CHANGES", b"RUNTIME",
    ])


def run_sample(repo, startup_timeout, replay_input, sequence):
    entry = os.path.join(repo, "packages", "belldandy-core", "dist", "bin", "bdd.js")
    if not os.path.isfile(entry):
        raise RuntimeError(f"Built CLI entry is missing: {entry}. Run corepack pnpm build first.")

    state_dir = tempfile.mkdtemp(prefix="belldandy-tui-performance-")
    command = ["node", entry, "tui", "--state-dir", state_dir, "--cwd", repo]
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(repo)
        os.execvpe(command[0], command, child_environment())

    data = bytearray()
    stage = "startup"
    stage_offset = 0
    started_at = time.monotonic()
    resize_started_at = None
    input_started_at = None
    exit_started_at = None
    mouse_changes_ready_at = None
    mouse_chat_ready_at = None
    ctrl_c_ready_at = None
    durations = {}
    first_frame = False
    narrow_fallback = False
    wide_layout_restored = False
    mouse_changes_rendered = False
    mouse_tab_navigation = False
    keyboard_navigation = False
    focus_visible = False
    input_replay_rendered = False
    ctrl_c_sent = False
    wait_status = None
    timed_out = False

    try:
        resize(fd, 30, 100)
        deadline = started_at + startup_timeout
        while True:
            now = time.monotonic()
            if now >= deadline:
                timed_out = True
                wait_status = terminate_process_group(pid)
                break

            ready, _, _ = select.select([fd], [], [], min(0.05, deadline - now))
            if ready:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    chunk = b""
                if chunk:
                    append_capture(data, chunk)

            current = bytes(data[stage_offset:])
            now = time.monotonic()
            if stage == "startup" and b"Star Sanctuary" in current:
                first_frame = True
                durations["startup"] = (now - started_at) * 1000
                resize_started_at = now
                stage_offset = len(data)
                resize(fd, 8, 24)
                stage = "narrow"
            elif stage == "narrow" and b"Terminal too small." in current:
                narrow_fallback = True
                stage_offset = len(data)
                resize(fd, 20, 72)
                stage = "restore"
            elif stage == "restore" and b"Star Sanctuary" in current:
                wide_layout_restored = True
                durations["resize"] = (now - resize_started_at) * 1000
                stage_offset = len(data)
                os.write(fd, b"\t")
                mouse_changes_ready_at = now + 1.0
                stage = "keyboard_sessions"
            elif stage == "keyboard_sessions" and (
                b"No persisted conversations." in strip_ansi(current)
                or now >= mouse_changes_ready_at
            ):
                keyboard_navigation = b"No persisted conversations." in strip_ansi(current)
                focus_visible = has_inverse_label(current, b"SESSIONS")
                stage_offset = len(data)
                os.write(fd, b"\x1b[<0;18;2M")
                stage = "mouse_changes"
            elif stage == "mouse_changes" and b"Revision Checkpoints" in current:
                mouse_changes_rendered = True
                mouse_chat_ready_at = now + 0.5
                stage = "mouse_chat_wait"
            elif stage == "mouse_chat_wait" and now >= mouse_chat_ready_at:
                stage_offset = len(data)
                os.write(fd, b"\x1b[<0;3;2M")
                stage = "mouse_chat"
            elif stage == "mouse_chat" and b"Activity" in current:
                mouse_tab_navigation = mouse_changes_rendered
                input_started_at = now
                stage_offset = len(data)
                os.write(fd, replay_input)
                stage = "input"
            elif stage == "input" and REPLAY_MARKER.encode("ascii") in current:
                input_replay_rendered = True
                durations["inputReplay"] = (now - input_started_at) * 1000
                ctrl_c_ready_at = now + 0.5
                stage = "exit_wait"
            elif stage == "exit_wait" and now >= ctrl_c_ready_at:
                ctrl_c_sent = True
                exit_started_at = now
                os.write(fd, b"\x03")
                stage = "exit"
                deadline = now + 8.0

            waited_pid, status = os.waitpid(pid, os.WNOHANG)
            if waited_pid == pid:
                wait_status = status
                if exit_started_at is not None:
                    durations["exit"] = (time.monotonic() - exit_started_at) * 1000
                break

        drain_pty(fd, data)
    finally:
        if wait_status is None:
            wait_status = terminate_process_group(pid)
        try:
            os.close(fd)
        except OSError:
            pass
        shutil.rmtree(state_dir, ignore_errors=True)

    time.sleep(0.1)
    residual_process_count = 1 if process_group_alive(pid) else 0
    exit_code = os.waitstatus_to_exitcode(wait_status) if wait_status is not None else None
    alternate_screen_leave_at = data.rfind(b"\x1b[?1049l")
    bracketed_paste_leave_at = data.rfind(b"\x1b[?2004l")
    mouse_tracking_leave_at = data.rfind(b"\x1b[?1000l")
    sgr_mouse_leave_at = data.rfind(b"\x1b[?1006l")
    state_dir_removed = not os.path.exists(state_dir)

    return {
        "sequence": sequence,
        "durationsMs": durations,
        "capturedBytes": len(data),
        "accessibility": {
            "keyboardNavigation": keyboard_navigation,
            "focusVisible": focus_visible,
            "labelsPresent": has_required_labels(bytes(data)),
        },
        "lifecycle": {
            "firstFrame": first_frame,
            "narrowFallback": narrow_fallback,
            "wideLayoutRestored": wide_layout_restored,
            "mouseTabNavigation": mouse_tab_navigation,
            "inputReplayRendered": input_replay_rendered,
            "ctrlCSent": ctrl_c_sent,
            "bracketedPasteRestored": b"\x1b[?2004h" in data and bracketed_paste_leave_at >= 0,
            "mouseTrackingRestored": b"\x1b[?1000h" in data and mouse_tracking_leave_at >= 0,
            "sgrMouseRestored": b"\x1b[?1006h" in data and sgr_mouse_leave_at >= 0,
            "alternateScreenRestored": b"\x1b[?1049h" in data and alternate_screen_leave_at >= 0,
            "inputModesRestoredBeforeScreen": (
                alternate_screen_leave_at >= 0
                and 0 <= bracketed_paste_leave_at < alternate_screen_leave_at
                and 0 <= mouse_tracking_leave_at < alternate_screen_leave_at
                and 0 <= sgr_mouse_leave_at < alternate_screen_leave_at
            ),
            "exitCode": exit_code,
            "timedOut": timed_out,
            "observedProcessCount": 1,
            "residualProcessCount": residual_process_count,
            "stateDirRemoved": state_dir_removed,
        },
    }


def main():
    args = parse_args()
    if args.warmup_runs < 0 or args.sample_runs < 1:
        raise RuntimeError("warmup-runs must be non-negative and sample-runs must be positive")
    repo = os.path.abspath(args.repo)
    kernel = host_platform.release()
    is_wsl = bool(os.environ.get("WSL_DISTRO_NAME")) or "microsoft" in kernel.lower()
    if sys.platform != "linux" or not is_wsl:
        raise RuntimeError("wsl2-linux collector requires a Linux process running under WSL")
    node_version = subprocess.run(
        ["node", "--version"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    replay_input = create_replay_input(args.replay_character_count)

    for index in range(args.warmup_runs):
        print(f"[tui-performance:wsl] warm-up {index + 1}/{args.warmup_runs}", file=sys.stderr)
        run_sample(repo, max(5.0, args.startup_timeout_seconds), replay_input, index + 1)

    samples = []
    for index in range(args.sample_runs):
        print(f"[tui-performance:wsl] sample {index + 1}/{args.sample_runs}", file=sys.stderr)
        samples.append(run_sample(
            repo,
            max(5.0, args.startup_timeout_seconds),
            replay_input,
            index + 1,
        ))

    print(json.dumps({
        "platform": "wsl2-linux",
        "environment": {
            "platform": "linux",
            "arch": host_platform.machine(),
            "release": kernel,
            "nodeVersion": node_version,
            "terminalBackend": "unix-pty",
            "wsl": True,
            "distribution": os.environ.get("WSL_DISTRO_NAME", "unknown"),
        },
        "samples": samples,
    }, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"[tui-performance:wsl] {error}", file=sys.stderr)
        sys.exit(1)
