#!/usr/bin/env python3
"""Self-test for check_trailers.py: a scratch repository with good and bad commits.

Run: python3 .github/scripts/test_check_trailers.py   (needs git; CI runs it before the check itself)

Every refused form is a bad commit that must be reported with its own sha; every allowed form, and the human commit
with no trailers, must pass (the positive controls). The same texts go through the PR title and body too.
"""

import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_trailers.py")
GOOD_TRAILERS = "Co-Authored-By: ukubi-claude-cloud <noreply@bnei.dev>\nAgent-Session: session_abc123"

# (name, message) that must pass
ALLOWED = [
    ("human, no trailers", "feat: add a thing\n\nA body that mentions nothing special."),
    ("cloud agent", "fix: a bug\n\n" + GOOD_TRAILERS),
    ("laptop agent", "fix: a bug\n\nCo-Authored-By: ukubi-claude-laptop-1 <noreply@bnei.dev>\nAgent-Session: s1"),
    ("fleet agent", "fix: a bug\n\nCo-Authored-By: ukubi-agent <noreply@bnei.dev>\nAgent-Session: s1"),
    ("lower-case key", "fix: a bug\n\nco-authored-by: ukubi-claude-cloud <noreply@bnei.dev>"),
    ("definition trailer", "fix: a bug\n\nAgent-Session: s1\nAgent-Definition: reviewer@0123abc"),
    ("human co-author", "fix: a bug\n\nCo-Authored-By: Jane Doe <jane@example.org>"),
    ("host that spells a family", "fix: x\n\nCo-Authored-By: ukubi-claude-sonnet-box <noreply@bnei.dev>"),
    ("env names", "fix: read CLAUDE_MODEL and CLAUDE_CODE_OAUTH_TOKEN\n\nthe ukubi-claude-cloud host sets them"),
    ("word claude alone", "docs: claude is named in a sentence"),
    ("word opus without a number", "docs: an opus of tiles"),
    ("prose that says generated with", "docs: dist/ is generated with bun run build\n\nthe lock is generated with bun run lock"),
    ("host that spells a trailer word", "fix: x\n\nCo-Authored-By: ukubi-claude-session-host <noreply@bnei.dev>"),
    ("word that starts like the trailer", "docs: the claude-sessionizer tool"),
    ("allowed co-author, trailing space", "fix: a bug\n\nCo-Authored-By: ukubi-claude-cloud <noreply@bnei.dev>  "),
    ("lookalike domain", "docs: see notclaude.ai and claude.company"),
    ("empty message part", "chore: x\n\n\n"),
]

# (name, message, text that must be in the report) that must fail
FORBIDDEN = [
    ("claude co-author", "fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>", "Co-Authored-By"),
    ("claude model co-author", "fix: x\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>", "Co-Authored-By"),
    ("claude name, our address", "fix: x\n\nCo-Authored-By: Claude <noreply@bnei.dev>", "Co-Authored-By"),
    ("agent name, anthropic address", "fix: x\n\nCo-Authored-By: ukubi-claude-cloud <noreply@anthropic.com>", "Co-Authored-By"),
    ("agent name, other address", "fix: x\n\nCo-Authored-By: ukubi-claude-cloud <a@example.org>", "Co-Authored-By"),
    ("agent name, word before the address", "fix: x\n\nCo-Authored-By: ukubi-claude-cloud Claude <noreply@bnei.dev>", "Co-Authored-By"),
    ("claude name, agent name in brackets", "fix: x\n\nCo-Authored-By: Claude (ukubi-claude-cloud) <noreply@bnei.dev>", "Co-Authored-By"),
    ("agent name, text after", "fix: x\n\nCo-Authored-By: ukubi-claude-cloud <noreply@bnei.dev> too", "Co-Authored-By"),
    ("indented co-author", "fix: x\n\n   Co-authored-by: Claude <noreply@anthropic.com>", "Co-Authored-By"),
    ("anthropic address, agent name", "fix: x\n\nCo-Authored-By: ukubi-agent <noreply@anthropic.com>", "Co-Authored-By"),
    ("anthropic co-author", "fix: x\n\nCo-Authored-By: Anthropic <x@example.org>", "Co-Authored-By"),
    ("space before the colon", "fix: x\n\nCo-Authored-By : Claude <x@example.org>", "Co-Authored-By"),
    ("generated with", "fix: x\n\nGenerated with a tool", "generated-with"),
    ("generated with, two spaces", "fix: x\n\nGenerated  with a tool", "generated-with"),
    ("generated with, quoted", "fix: x\n\n> Generated with a tool", "generated-with"),
    ("generated with, emoji", "fix: x\n\n\U0001F916 Generated with [Claude Code](https://example.org)", "generated-with"),
    ("claude.ai url", "fix: x\n\nsee https://claude.ai/code/session_1", "claude.ai or claude.com"),
    ("claude.com url", "fix: x\n\nsee https://www.claude.com/x", "claude.ai or claude.com"),
    ("claude.ai bare", "fix: x\n\nsee claude.ai", "claude.ai or claude.com"),
    ("claude-session", "fix: x\n\nClaude-Session: https://example.org/s", "Claude-Session"),
    ("claude-session lower", "fix: x\n\nclaude-session: abc", "Claude-Session"),
    ("id opus", "fix: x\n\nmade by claude-opus-4-1", "model name"),
    ("id sonnet", "fix: x\n\nmade by claude-sonnet-5-5", "model name"),
    ("id haiku", "fix: x\n\nmade by claude-haiku-4-5", "model name"),
    ("id fable", "fix: x\n\nmade by claude-fable-1", "model name"),
    ("id numbered", "fix: x\n\nmade by claude-3-5-sonnet-20241022", "model name"),
    ("claude opus", "fix: x\n\nwritten with Claude Opus", "model name"),
    ("id instant", "fix: x\n\nmade by claude-instant-1", "model name"),
    ("id of a number only", "fix: x\n\nmade by claude-3-5", "model name"),
    ("id after an underscore", "fix: x\n\nmade by x_claude-3", "model name"),
    ("id with a no-break hyphen", "fix: x\n\nmade by claude\u2011instant", "model name"),
    ("claude, no-break space, opus", "fix: x\n\nwritten with Claude\u00a0Opus", "model name"),
    ("claude v4 opus", "fix: x\n\nwritten with Claude v4.5 Opus", "model name"),
    ("claude code opus", "fix: x\n\nwritten with Claude Code Opus", "model name"),
    ("claude 4 opus", "fix: x\n\nwritten with Claude 4 Opus", "model name"),
    ("opus 5", "fix: x\n\nwritten by Opus 5", "model name"),
    ("sonnet 4", "fix: x\n\nwritten by Sonnet 4", "model name"),
    ("haiku 4.5", "fix: x\n\nwritten by haiku 4.5", "model name"),
    ("opus v5", "fix: x\n\nwritten by Opus v5", "model name"),
    ("opus glued to its number", "fix: x\n\nwritten by Opus4", "model name"),
    ("opus dashed", "fix: x\n\nwritten by opus-4-1", "model name"),
    ("opus, no-break space", "fix: x\n\nwritten by Opus\u00a05", "model name"),
    ("fable 1", "fix: x\n\nwritten by Fable 1", "model name"),
    ("in the subject", "feat: claude-opus-4-1 support", "model name"),
]


class Repo:
    """A scratch repository; commits get a message and nothing else."""

    def __init__(self, path):
        self.path = path
        self.git("init", "-q", "-b", "main")
        self.n = 0

    def git(self, *args, **kw):
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.org",
                   GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.org")
        return subprocess.run(["git", "-c", "commit.gpgsign=false", *args], cwd=self.path, env=env, check=True,
                              capture_output=True, text=True, **kw).stdout.strip()

    def commit(self, message, author=("t", "t@example.org"), committer=("t", "t@example.org")):
        self.n += 1
        with open(os.path.join(self.path, "f.txt"), "w") as f:
            f.write(f"{self.n}\n")
        self.git("add", "f.txt")
        ident = {"GIT_AUTHOR_NAME": author[0], "GIT_AUTHOR_EMAIL": author[1],
                 "GIT_COMMITTER_NAME": committer[0], "GIT_COMMITTER_EMAIL": committer[1]}
        subprocess.run(["git", "-c", "commit.gpgsign=false", "commit", "-q", "-F", "-"], cwd=self.path,
                       env=dict(os.environ, **ident), check=True, capture_output=True, text=True, input=message)
        return self.git("rev-parse", "HEAD")


def run(repo, base, head, title="feat: t", body="", env_extra=None):
    env = {k: v for k, v in os.environ.items() if k not in ("BASE_SHA", "HEAD_SHA", "PR_TITLE", "PR_BODY")}
    if base is not None:
        env["BASE_SHA"] = base
    if head is not None:
        env["HEAD_SHA"] = head
    env["PR_TITLE"], env["PR_BODY"] = title, body
    env.update(env_extra or {})
    done = subprocess.run([sys.executable, SCRIPT], cwd=repo.path, env=env, capture_output=True, text=True)
    return done.returncode, done.stdout + done.stderr


class CheckTrailers(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Repo(self.tmp.name)
        self.base = self.repo.commit("chore: base")

    def test_allowed_commits_pass(self):
        for name, message in ALLOWED:
            with self.subTest(name):
                head = self.repo.commit(message)
                code, out = run(self.repo, self.base, head)
                self.assertEqual(code, 0, out)
                self.base = head

    def test_forbidden_commits_fail_with_their_sha(self):
        for name, message, expect in FORBIDDEN:
            with self.subTest(name):
                base = self.repo.git("rev-parse", "HEAD")
                bad = self.repo.commit(message)
                code, out = run(self.repo, base, bad)
                self.assertEqual(code, 1, out)
                self.assertIn(bad, out)
                self.assertIn(expect, out)

    def test_forbidden_texts_fail_in_title_and_body(self):
        for name, message, expect in FORBIDDEN:
            text = message.split("\n\n", 1)[1] if "\n\n" in message else message
            with self.subTest(name):
                code, out = run(self.repo, self.base, self.base, body=text)
                self.assertEqual((code, "pr-body: line 1" in out, expect in out), (1, True, True), out)
                code, out = run(self.repo, self.base, self.base, title=text)
                self.assertEqual((code, "pr-title: line 1" in out, expect in out), (1, True, True), out)

    def test_allowed_texts_pass_in_title_and_body(self):
        for name, message in ALLOWED:
            text = message.split("\n\n", 1)[1] if "\n\n" in message else message
            with self.subTest(name):
                code, out = run(self.repo, self.base, self.base, title=text.splitlines()[0] if text else "", body=text)
                self.assertEqual(code, 0, out)

    def test_empty_title_and_body_pass(self):
        code, out = run(self.repo, self.base, self.base, title="", body="")
        self.assertEqual(code, 0, out)

    def test_bad_commit_in_the_middle_is_found_and_only_it(self):
        first = self.repo.commit("feat: one\n\n" + GOOD_TRAILERS)
        bad = self.repo.commit("feat: two\n\nCo-Authored-By: Claude <noreply@anthropic.com>")
        tip = self.repo.commit("feat: three\n\n" + GOOD_TRAILERS)
        code, out = run(self.repo, self.base, tip)
        self.assertEqual(code, 1, out)
        self.assertIn(bad, out)
        self.assertNotIn(first, out)
        self.assertNotIn(tip, out)

    def test_offences_are_reported_oldest_commit_first(self):
        one = self.repo.commit("feat: one\n\nsee claude.ai")
        two = self.repo.commit("feat: two\n\nsee claude.ai")
        code, out = run(self.repo, self.base, two)
        self.assertEqual(code, 1, out)
        self.assertLess(out.index(one), out.index(two), out)

    def test_a_long_offending_line_is_cut_in_the_report(self):
        bad = self.repo.commit("feat: x\n\nsee claude.ai " + "z" * 300)
        code, out = run(self.repo, self.base, bad)
        self.assertEqual(code, 1, out)
        self.assertIn("...", out)
        self.assertNotIn("z" * 250, out)

    def test_one_line_breaking_two_rules_reports_both(self):
        bad = self.repo.commit("fix: x\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>")
        code, out = run(self.repo, self.base, bad)
        self.assertEqual(code, 1, out)
        self.assertIn("Co-Authored-By naming", out)
        self.assertIn("model name", out)

    def test_every_offence_is_reported_not_only_the_first(self):
        bad = self.repo.commit("feat: x\n\nGenerated with a tool\nClaude-Session: s\nsee claude.ai")
        code, out = run(self.repo, self.base, bad)
        self.assertEqual(code, 1, out)
        self.assertEqual(out.count(bad), 3, out)

    def test_a_claude_identity_fails_even_with_a_clean_message(self):
        for name, role, author, committer in (
            ("author", "author", ("Claude", "noreply@anthropic.com"), ("t", "t@example.org")),
            ("committer", "committer", ("t", "t@example.org"), ("Claude", "noreply@anthropic.com")),
            ("anthropic email", "author", ("t", "someone@anthropic.com"), ("t", "t@example.org")),
        ):
            with self.subTest(name):
                bad = self.repo.commit("fix: clean message", author=author, committer=committer)
                code, out = run(self.repo, self.base, bad)
                self.assertEqual(code, 1, out)
                self.assertIn(f"{bad}: {role}: names Claude or Anthropic", out)
                self.repo.git("reset", "-q", "--hard", self.base)

    def test_the_agents_identity_passes(self):
        head = self.repo.commit("fix: clean message", author=("ukubi-claude-cloud", "noreply@bnei.dev"),
                                committer=("ukubi-claude-cloud", "noreply@bnei.dev"))
        code, out = run(self.repo, self.base, head)
        self.assertEqual(code, 0, out)

    def test_history_before_base_is_not_scanned(self):
        old = self.repo.commit("feat: old\n\nCo-Authored-By: Claude <noreply@anthropic.com>")
        new_base = self.repo.commit("feat: ok\n\n" + GOOD_TRAILERS)
        head = self.repo.commit("feat: ok too")
        code, out = run(self.repo, new_base, head)
        self.assertEqual(code, 0, out)
        self.assertNotIn(old, out)

    def test_a_line_starting_with_workflow_command_marker_is_prefixed(self):
        bad = self.repo.commit("feat: x\n\n::error::see claude.ai")
        code, out = run(self.repo, self.base, bad)
        self.assertEqual(code, 1, out)
        for line in out.splitlines():
            self.assertFalse(line.startswith("::"), line)

    def test_title_and_body_are_data_not_shell(self):
        marker = os.path.join(self.tmp.name, "pwned")
        text = f"$(touch {marker}) `touch {marker}`; touch {marker}"
        code, out = run(self.repo, self.base, self.base, title=text, body=text)
        self.assertEqual(code, 0, out)
        self.assertFalse(os.path.exists(marker))

    def test_missing_or_bad_input_fails_closed(self):
        head = self.repo.commit("feat: ok")
        for base, tip in [(None, head), (self.base, None), ("", head), ("--all", head), ("--glob=zzz", head),
                          ("0" * 40, head), (self.base, "no-such-ref")]:
            with self.subTest((base, tip)):
                code, out = run(self.repo, base, tip)
                self.assertEqual(code, 2, out)


if __name__ == "__main__":
    unittest.main(verbosity=1)
