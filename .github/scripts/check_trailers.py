#!/usr/bin/env python3
"""Refuse AI-attribution text in a pull request's commits, title and body.

An agent's commit may carry exactly these trailers (CLAUDE.md, "Rules"):

    Co-Authored-By: ukubi-claude-<host> <noreply@bnei.dev>   (or ukubi-agent)
    Agent-Session: <id>

Refused, on any line of any commit message in BASE_SHA..HEAD_SHA, of the PR title or of the PR body:

  * a Co-Authored-By line that names Claude or Anthropic and is not exactly the allowed form above
  * a "Generated with" footer
  * a claude.ai or claude.com address
  * a Claude-Session trailer
  * a model name: a claude-<model> id, "Claude Opus", "Opus 5", "Sonnet 4", and so on

A message with no trailers at all passes. "claude" inside "ukubi-claude-<host>" or in an environment name such as
CLAUDE_MODEL is not a model name and passes.

Input is the environment, never the command line or a shell string, so a title or body cannot reach a shell:
BASE_SHA and HEAD_SHA (any git revision), PR_TITLE and PR_BODY (both may be empty). Git runs in the current directory.

Exit 0: clean. Exit 1: at least one offending line, each printed as "<where>: <rule>: <line>". Exit 2: the check
itself could not run (a missing input, a git failure); that fails the job rather than passing it.
"""

import os
import re
import subprocess
import sys

# The one Co-Authored-By value an agent may use. Host names are lowercase or not; nothing else may follow the address.
ALLOWED_COAUTHOR = re.compile(
    r"^co-authored-by:[ \t]+(?:ukubi-claude-[a-z0-9][a-z0-9._-]*|ukubi-agent)[ \t]+<noreply@bnei\.dev>$",
    re.IGNORECASE,
)
COAUTHOR_LINE = re.compile(r"^[ \t]*co-authored-by[ \t]*:", re.IGNORECASE)
AI_NAME = re.compile(r"claude|anthropic", re.IGNORECASE)

# Each rule is (name, pattern). The Co-Authored-By rule is not here: it needs the allowed form (see check_line).
#
# A model id starts at a boundary that is not a word character, "_" or "-", so "ukubi-claude-cloud" (preceded by "-")
# and CLAUDE_MODEL (an underscore, no dash) never match. The family names are bare words, so "Opus 5" and "Sonnet 4"
# match only with a version number after them.
MODELS = r"opus|sonnet|haiku|fable"
RULES = [
    ("generated-with footer", re.compile(r"generated\s+with", re.IGNORECASE)),
    ("claude.ai or claude.com address", re.compile(r"(?<![A-Za-z0-9-])claude\.(?:ai|com)(?![A-Za-z0-9-])", re.IGNORECASE)),
    ("Claude-Session trailer", re.compile(r"(?<![A-Za-z0-9_-])claude-session\b", re.IGNORECASE)),
    (
        "model name",
        re.compile(
            r"(?<![A-Za-z0-9_-])claude-(?:" + MODELS + r"|instant|\d)"  # an id: claude-opus-4-1, claude-3-5-sonnet
            r"|(?<![A-Za-z0-9_-])claude[ \t]+(?:code[ \t]+)?(?:v?\d[\d.]*[ \t]+)?(?:" + MODELS + r")\b"  # "Claude Opus"
            r"|\b(?:" + MODELS + r")[ \t]+v?\d",  # "Opus 5", "Sonnet 4.5"
            re.IGNORECASE,
        ),
    ),
]


def check_line(line):
    """The names of the rules this one line breaks, in a fixed order."""
    broken = []
    if COAUTHOR_LINE.match(line) and AI_NAME.search(line) and not ALLOWED_COAUTHOR.match(line.strip()):
        broken.append("Co-Authored-By naming Claude or Anthropic")
    for name, pattern in RULES:
        if pattern.search(line):
            broken.append(name)
    return broken


def check_text(where, text):
    """Offences in one message as printable lines."""
    found = []
    for number, line in enumerate(text.splitlines(), 1):
        for rule in check_line(line):
            shown = line.strip()
            if len(shown) > 200:
                shown = shown[:200] + "..."
            # "<where>:" always leads, so a line that starts with "::" cannot become a workflow command
            found.append(f"{where}: line {number}: {rule}: {shown}")
    return found


def git(*args):
    done = subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout


def main():
    base, head = os.environ.get("BASE_SHA", ""), os.environ.get("HEAD_SHA", "")
    if not base or not head:
        print("check_trailers: BASE_SHA and HEAD_SHA must both be set", file=sys.stderr)
        return 2
    if base.startswith("-") or head.startswith("-"):
        print("check_trailers: BASE_SHA and HEAD_SHA must be revisions, not options", file=sys.stderr)
        return 2
    try:
        commits = git("rev-list", "--reverse", f"{base}..{head}", "--").split()
        found = []
        for sha in commits:
            found += check_text(sha, git("log", "-1", "--format=%B", sha, "--"))
    except RuntimeError as err:
        print(f"check_trailers: {err}", file=sys.stderr)
        return 2
    found += check_text("pr-title", os.environ.get("PR_TITLE", ""))
    found += check_text("pr-body", os.environ.get("PR_BODY", ""))

    for line in found:
        print(line)
    if found:
        print(f"check_trailers: {len(found)} offending line(s) in {len(commits)} commit(s), the PR title and body")
        return 1
    print(f"check_trailers: {len(commits)} commit(s), the PR title and body: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
