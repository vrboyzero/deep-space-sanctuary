import argparse
import fcntl
import json
import os
import pty
import select
import shutil
import signal
import struct
import sys
import tempfile
import termios
import time


def parse_args():
    parser = argparse.ArgumentParser(description="Smoke-test the built TUI in a Unix PTY.")
    parser.add_argument("--repo", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    parser.add_argument("--startup-timeout", type=float, default=60.0)
    return parser.parse_args()


def resize(fd, rows, columns):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    foreground_group = os.tcgetpgrp(fd)
    os.killpg(foreground_group, signal.SIGWINCH)


def terminate(pid):
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return None
    return os.waitpid(pid, 0)[1]


def run_smoke(repo, startup_timeout):
    entry = os.path.join(repo, "packages", "belldandy-core", "dist", "bin", "bdd.js")
    if not os.path.isfile(entry):
        raise RuntimeError(f"Built CLI entry is missing: {entry}. Run corepack pnpm build first.")

    state_dir = tempfile.mkdtemp(prefix="belldandy-tui-pty-")
    command = ["node", entry, "tui", "--state-dir", state_dir, "--cwd", repo]
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(repo)
        os.environ["TERM"] = "xterm-256color"
        os.execvp(command[0], command)

    data = b""
    first_frame_at = None
    narrow_at = None
    restore_offset = None
    restored_at = None
    mouse_changes_at = None
    mouse_changes_offset = None
    mouse_chat_at = None
    mouse_chat_offset = None
    input_at = None
    ctrl_c_at = None
    wait_status = None
    timed_out = False
    startup_deadline = time.monotonic() + startup_timeout

    try:
        resize(fd, 30, 100)
        while True:
            now = time.monotonic()
            deadline = ctrl_c_at + 8.0 if ctrl_c_at is not None else startup_deadline
            if now >= deadline:
                timed_out = True
                wait_status = terminate(pid)
                break

            ready, _, _ = select.select([fd], [], [], min(0.1, deadline - now))
            if ready:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    chunk = b""
                if chunk:
                    data += chunk
                    if len(data) > 2_000_000:
                        data = data[-2_000_000:]

            raw_mode = (termios.tcgetattr(fd)[3] & termios.ISIG) == 0
            if first_frame_at is None and raw_mode and b"Star Sanctuary" in data:
                first_frame_at = time.monotonic()

            if first_frame_at is not None and narrow_at is None and time.monotonic() - first_frame_at >= 1.0:
                resize(fd, 8, 24)
                narrow_at = time.monotonic()

            if narrow_at is not None and restore_offset is None and b"Terminal too small." in data:
                restore_offset = len(data)
                resize(fd, 20, 72)

            if restore_offset is not None and restored_at is None and b"Star Sanctuary" in data[restore_offset:]:
                restored_at = time.monotonic()

            if (
                restored_at is not None
                and mouse_changes_at is None
                and time.monotonic() - restored_at >= 0.5
            ):
                mouse_changes_offset = len(data)
                os.write(fd, b"\x1b[<0;18;2M")
                mouse_changes_at = time.monotonic()

            if (
                mouse_changes_at is not None
                and mouse_chat_at is None
                and (
                    b"Revision Checkpoints" in data[mouse_changes_offset:]
                    or time.monotonic() - mouse_changes_at >= 1.0
                )
            ):
                mouse_chat_offset = len(data)
                os.write(fd, b"\x1b[<0;3;2M")
                mouse_chat_at = time.monotonic()

            if (
                mouse_chat_at is not None
                and input_at is None
                and (
                    b"Activity" in data[mouse_chat_offset:]
                    or time.monotonic() - mouse_chat_at >= 1.0
                )
            ):
                os.write(fd, b"q")
                input_at = time.monotonic()

            if input_at is not None and ctrl_c_at is None:
                if b"> q" in data[restore_offset:] or time.monotonic() - input_at >= 1.0:
                    os.write(fd, b"\x03")
                    ctrl_c_at = time.monotonic()

            waited_pid, status = os.waitpid(pid, os.WNOHANG)
            if waited_pid == pid:
                wait_status = status
                break

        exit_code = os.waitstatus_to_exitcode(wait_status) if wait_status is not None else None
        alternate_screen_leave_at = data.rfind(b"\x1b[?1049l")
        mouse_tracking_leave_at = data.rfind(b"\x1b[?1000l")
        sgr_mouse_leave_at = data.rfind(b"\x1b[?1006l")
        bracketed_paste_leave_at = data.rfind(b"\x1b[?2004l")
        result = {
            "exitCode": exit_code,
            "timedOut": timed_out,
            "firstFrame": first_frame_at is not None,
            "narrowFallback": restore_offset is not None,
            "wideLayoutRestored": restored_at is not None,
            "mouseChangesSent": mouse_changes_at is not None,
            "mouseChangesRendered": (
                mouse_changes_offset is not None
                and b"Revision Checkpoints" in data[mouse_changes_offset:]
            ),
            "mouseChatSent": mouse_chat_at is not None,
            "mouseChatAcceptedInput": mouse_chat_offset is not None and b"> q" in data[mouse_chat_offset:],
            "mouseTabNavigation": (
                mouse_changes_at is not None
                and mouse_chat_at is not None
                and b"Revision Checkpoints" in data[mouse_changes_offset or 0 :]
                and b"> q" in data[mouse_chat_offset or 0 :]
            ),
            "visibleKeyboardInput": input_at is not None and b"> q" in data[restore_offset or 0 :],
            "ctrlCSent": ctrl_c_at is not None,
            "bracketedPasteEnter": b"\x1b[?2004h" in data,
            "bracketedPasteLeave": bracketed_paste_leave_at >= 0,
            "mouseTrackingEnter": b"\x1b[?1000h" in data,
            "mouseTrackingLeave": mouse_tracking_leave_at >= 0,
            "sgrMouseEnter": b"\x1b[?1006h" in data,
            "sgrMouseLeave": sgr_mouse_leave_at >= 0,
            "alternateScreenEnter": b"\x1b[?1049h" in data,
            "alternateScreenLeave": alternate_screen_leave_at >= 0,
            "inputModesRestoredBeforeScreen": (
                alternate_screen_leave_at >= 0
                and 0 <= bracketed_paste_leave_at < alternate_screen_leave_at
                and 0 <= mouse_tracking_leave_at < alternate_screen_leave_at
                and 0 <= sgr_mouse_leave_at < alternate_screen_leave_at
            ),
            "capturedBytes": len(data),
        }
        expected = all(
            [
                result["exitCode"] == 0,
                not result["timedOut"],
                result["firstFrame"],
                result["narrowFallback"],
                result["wideLayoutRestored"],
                result["mouseTabNavigation"],
                result["visibleKeyboardInput"],
                result["ctrlCSent"],
                result["bracketedPasteEnter"],
                result["bracketedPasteLeave"],
                result["mouseTrackingEnter"],
                result["mouseTrackingLeave"],
                result["sgrMouseEnter"],
                result["sgrMouseLeave"],
                result["alternateScreenEnter"],
                result["alternateScreenLeave"],
                result["inputModesRestoredBeforeScreen"],
            ]
        )
        if not expected:
            raise RuntimeError(f"TUI PTY smoke failed: {json.dumps(result, sort_keys=True)}")
        return result
    finally:
        os.close(fd)
        shutil.rmtree(state_dir, ignore_errors=True)


def main():
    args = parse_args()
    repo = os.path.abspath(args.repo)
    result = run_smoke(repo, max(5.0, args.startup_timeout))
    print("[tui-pty-smoke] resize, keyboard/mouse input, and terminal lifecycle passed.")
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"[tui-pty-smoke] {error}", file=sys.stderr)
        sys.exit(1)
