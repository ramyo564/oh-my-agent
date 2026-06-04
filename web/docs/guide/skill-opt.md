---
title: "Skill Optimization"
description: How to use oma skills opt to maximize a skill's measured utility lift by iteratively proposing and accepting SKILL.md edits against a held-out validation split.
---

# Skill Optimization

`oma skills opt` optimizes a skill's `SKILL.md` to maximize its measured `utilityLift` as produced by `oma skills eval`. It treats the skill document as the trainable "external state" of a frozen agent: an optimizer LLM proposes bounded add/delete/replace edits, each edit is applied to a candidate copy, re-scored by the eval harness, and **accepted only when the held-out validation lift strictly improves** — guarded against negative-transfer regression. At deployment there is zero inference-time cost: the output is a better `SKILL.md`.

Research basis: SkillOpt — *Executive Strategy for Self-Evolving Agent Skills* (arXiv:2605.23904, MSRA).

---

## Hard dependency: eval task fixtures

`oma skills opt` cannot run without eval task fixtures. It requires at least **5 task fixtures** (`MIN_TASKS = 5`) in `.agents/eval/<skill>/`. If fewer are found, the command errors immediately:

```
[oma skills opt] no eval coverage for skill "oma-scholar": found 2 task fixture(s), need at least 5. Author tasks first — see web/docs/guide/skill-eval.md
```

See the [Skill Utility Eval guide](./skill-eval.md) for the `.agents/eval/<skill>/` directory convention, fixture schema, checker types, and how to seed rollouts for mock replay.

---

## How it works

Fixtures are split deterministically into a **train set** and a **held-out validation set** (default 50/50, controlled by `OPT_TRAIN_VAL_SPLIT = 0.5`). The split is stable across runs — tasks are sorted by ID before splitting, so no randomness is involved.

For each epoch (up to `--max-epochs`, default 8):

1. **Score current best `SKILL.md` on the TRAIN split** — `oma skills eval` returns findings including per-task lift.
2. **Optimizer LLM proposes K candidate edits** (up to `--edits-per-epoch`, default 4). Edits already in the rejected-edit buffer are skipped.
3. **For each candidate edit:**
   - Apply the edit to an in-memory copy of `SKILL.md`.
   - Validate the candidate (frontmatter `name`/`description` must survive; body must parse).
   - Enforce the textual learning-rate budget: discard edits whose net character change exceeds `--lr` (default 600 chars).
   - Re-score the candidate on the **held-out validation split**.
4. **Accept the best candidate IFF** the validation lift strictly improves (`Δlift > 0`) AND no negative-transfer entry breaches the regression floor (`NEG_TRANSFER_FAIL = -0.1`). All proposed edits from a rejected epoch are added to the rejected-edit buffer.
5. **Early stop** after 2 consecutive epochs with no accepted edit (`OPT_EARLY_STOP_PATIENCE = 2`).

The optimizer never edits the live `SKILL.md` during the loop — it always works on an in-memory candidate copy.

---

## Usage

```
oma skills opt --skill <id>
               [--dry-run | --apply]
               [--mock | --live]
               [--max-epochs <n>] [--edits-per-epoch <k>] [--lr <chars>]
               [--yes]
               [--json] [--output <format>]
```

### Flags

| Flag | Default | Description |
|:-----|:--------|:-----------|
| `--skill <id>` | `_all` | Skill ID to optimize (simple name, no path separators). |
| `--dry-run` | **yes (default)** | Propose edits and print the diff; write nothing. |
| `--apply` | — | Apply accepted edits to `SKILL.md` — backs up the original as `SKILL.md.bak` before writing. Only runs when a validated improvement exists. |
| `--mock` | **yes (default)** | Replay recorded optimizer edits and eval verdicts from `_rollouts/`. Deterministic, offline. Safe for CI. |
| `--live` | — | Live LLM optimizer dispatch — incurs real model calls per epoch. Prints a cost preview and asks for confirmation unless `--yes`. |
| `--max-epochs <n>` | `8` | Maximum optimization epochs. |
| `--edits-per-epoch <k>` | `4` | Candidate edits the optimizer LLM proposes per epoch. |
| `--lr <chars>` | `600` | Textual learning-rate budget: maximum net character change per accepted edit. |
| `--yes` | — | Skip the cost-preview confirmation. Only meaningful with `--live`. |
| `--json` | — | Output as JSON for CI/CD. |
| `--output <format>` | `text` | Output format (`text` or `json`). |

---

## Minimal end-to-end example

```bash
# Propose edits (dry-run, mock mode — writes nothing, fully offline)
oma skills opt --skill oma-scholar --mock --dry-run
```

Example output:

```
[oma skills opt] skill: oma-scholar, tasks: 8 (train: 4, val: 4), dry-run: true

Skill opt  (skill: oma-scholar)
  applied: false
  baselineLift: 18.5%  finalLift: 32.0%
  epochs: 3  acceptedEdits: 2  rejected: 6

  diff:
--- a/SKILL.md
+++ b/SKILL.md
@@ -12,6 +12,9 @@
 ### When to use
 - User asks to look up an academic paper or technical claim.
+- User asks for a summary of arxiv abstracts or DOI-linked documents.
 - User wants citations or sources for a factual statement.
```

The diff shows what the optimizer would write; nothing is persisted with `--dry-run`.

---

## Applying a validated improvement

When you are satisfied with the proposed diff, re-run with `--apply`:

```bash
# Apply accepted edits (backs up original as SKILL.md.bak)
oma skills opt --skill oma-scholar --mock --apply
```

`--apply` writes only when the optimization found a strictly positive improvement on the held-out validation split. A `.bak` backup of the original `SKILL.md` is created before writing. The diff is always printed so you can review what changed.

---

## Live mode

Live mode calls the real optimizer LLM and re-runs live eval arms per epoch. It is expensive — each epoch runs two eval arms (baseline and treatment) per validation task, plus the optimizer LLM call.

```bash
# Cost preview + confirm
oma skills opt --skill oma-scholar --live

# Skip confirmation
oma skills opt --skill oma-scholar --live --yes

# Live opt, then apply if improved
oma skills opt --skill oma-scholar --live --apply --yes
```

The cost preview lists the number of tasks, epochs, estimated arm dispatches, and the resolved vendor before any LLM call is made.

---

## JSON output

```bash
oma skills opt --skill oma-scholar --json
```

```json
{
  "ok": true,
  "skill": "oma-scholar",
  "baselineLift": 0.1850,
  "finalLift": 0.3200,
  "epochCount": 3,
  "acceptedEdits": [
    { "op": "add", "anchor": "### When to use", "after": "\n- User asks for a summary of arxiv abstracts or DOI-linked documents." }
  ],
  "rejectedCount": 6,
  "applied": false,
  "diff": "--- a/SKILL.md\n+++ b/SKILL.md\n...",
  "_dryRun": true,
  "_split": { "trainCount": 4, "valCount": 4 }
}
```

`ok` is `true` when the final lift exceeds the baseline or `applied` is `true`.

---

## SSOT caveat for `oma-*` skills

Skills whose ID starts with `oma-` are owned by oh-my-agent and are **overwritten by `oma update`**. For these skills, `--apply` is discouraged — use `--dry-run` (the default), review the proposed diff, and upstream changes to the registry if the improvement is meaningful. For user-authored skills, `--apply` is safe.

The command prints a warning when the target skill is oma-owned:

```
[oma skills opt] warning: "oma-scholar" is an oma-owned skill. --apply output will be overwritten by oma update. Consider using --dry-run and upstreaming the diff instead.
```

---

## Overfitting guard

The optimizer sees only the TRAIN split's rollout findings when proposing edits. The **accept gate always uses the held-out VALIDATION split**. An edit that improves training-set lift but regresses on the held-out set is rejected. Both train and validation lift are reported so overfit is visible.

---

## CI integration

In `--mock` mode, `oma skills opt` is fully deterministic and offline — no LLM is called. Use it in CI to verify that a proposed skill diff still shows lift over the recorded rollouts:

```bash
oma skills opt --skill oma-scholar --mock --json
```

Exit codes:
- `0` — optimization completed (with or without improvement)
- `1` — fewer than `MIN_TASKS` fixtures, or invalid `--skill` argument

---

## See also

- [Skill Utility Eval](./skill-eval.md) — authoring task fixtures, checker types, mock/live modes, the `_rollouts/` directory.
- [CLI Commands](../cli-interfaces/commands.md) — flag reference for all skill management commands.
