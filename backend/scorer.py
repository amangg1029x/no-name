"""
suspicion_scorer.py
===================
Scores each suspicious account detected by FraudDetectionEngine on a
0–100 float scale using the following additive formula:

    +40   — cycle participation
    +30   — fan-in or fan-out  (×1.3 if the window is ≤ 72 hours)
    +20   — shell-network membership
    +10   — high velocity  (≥ velocity_threshold distinct txns in 24 h)
    ────
    Cap at 100.0

Accounts with 50+ total transactions are SKIPPED entirely (score = None).

Usage
-----
    from fraud_detection_engine import FraudDetectionEngine
    from suspicion_scorer import SuspicionScorer

    engine  = FraudDetectionEngine(df)
    summary = engine.analyse(...)          # populates engine._suspicious

    scorer  = SuspicionScorer(engine)
    scores  = scorer.score_all()           # → pd.DataFrame
    print(scores)
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import timedelta
from typing import Dict, Optional

import pandas as pd

# ── Scoring weights ────────────────────────────────────────────────────────────
_W_CYCLE    = 40.0   # ring / cycle participation
_W_FAN      = 30.0   # fan-in or fan-out pattern base
_FAN_MULT   = 1.3    # multiplier when fan window ≤ 72 h
_FAN_72H    = 72     # threshold in hours for the multiplier
_W_SHELL    = 20.0   # shell-network chain membership
_W_VELOCITY = 10.0   # high-velocity burst
_SCORE_CAP  = 100.0
_TX_SKIP    = 50     # accounts with ≥ this many total txns are skipped


class SuspicionScorer:
    """
    Scores accounts flagged by a :class:`FraudDetectionEngine` run.

    Parameters
    ----------
    engine : FraudDetectionEngine
        A fully initialised engine on which ``analyse()`` (or individual
        ``detect_*`` methods) has already been called.
    velocity_threshold : int
        Minimum number of distinct transactions within any 24-hour window
        that triggers the +10 velocity bonus.  Default: 5.
    fan_window_hours : int
        The rolling window (hours) used by ``detect_fan_in_out``.  Used to
        decide whether the 1.3× multiplier applies.  Default: 72.
    """

    def __init__(
        self,
        engine,                        # FraudDetectionEngine instance
        velocity_threshold: int = 5,
        fan_window_hours: int = 72,
    ):
        self.engine             = engine
        self.velocity_threshold = velocity_threshold
        self.fan_window_hours   = fan_window_hours

        # Pre-compute per-account transaction count once
        self._tx_count: Dict[str, int] = self._build_tx_counts()
        # Pre-compute per-account velocity flag once
        self._velocity_hit: Dict[str, bool] = self._build_velocity_flags()

    # ── Private helpers ────────────────────────────────────────────────────────

    def _build_tx_counts(self) -> Dict[str, int]:
        """Total transactions (as sender OR receiver) per account."""
        counts: Dict[str, int] = defaultdict(int)
        df = self.engine.df
        for col in ("sender_id", "receiver_id"):
            for acct in df[col].astype(str):
                counts[acct] += 1
        return counts

    def _build_velocity_flags(self) -> Dict[str, bool]:
        """
        For every account, check whether it appears in ≥ velocity_threshold
        distinct transactions within any rolling 24-hour window.
        """
        df = self.engine.df.sort_values("timestamp")
        window = timedelta(hours=24)
        flagged: Dict[str, bool] = {}

        all_accounts = set(df["sender_id"].astype(str)) | set(
            df["receiver_id"].astype(str)
        )

        for acct in all_accounts:
            mask = (df["sender_id"].astype(str) == acct) | (
                df["receiver_id"].astype(str) == acct
            )
            sub = df[mask].reset_index(drop=True)
            hit = False
            for i, ts in enumerate(sub["timestamp"]):
                window_end = ts + window
                count = ((sub["timestamp"] >= ts) & (sub["timestamp"] <= window_end)).sum()
                if count >= self.velocity_threshold:
                    hit = True
                    break
            flagged[acct] = hit

        return flagged

    def _parse_fan_window(self, reasons: list[str]) -> Optional[int]:
        """
        Extract the window size (hours) from a fan-in/out reason string.
        Returns None if not found.  Reason format:
            "FAN-IN pattern (N counterparties in Xh)"
        """
        for reason in reasons:
            if "FAN-" in reason and "in " in reason and "h)" in reason:
                try:
                    part = reason.split("in ")[-1].rstrip("h)")
                    return int(part)
                except ValueError:
                    pass
        return None

    # ── Public API ─────────────────────────────────────────────────────────────

    def score_account(self, account_id: str) -> Optional[float]:
        """
        Compute the suspicion score for a single account.

        Returns
        -------
        float in [0.0, 100.0], or ``None`` if the account has 50+ total
        transactions (ineligible) or is not flagged at all.
        """
        # --- eligibility gate ------------------------------------------------
        total_txns = self._tx_count.get(account_id, 0)
        if total_txns >= _TX_SKIP:
            return None  # too active to be a targeted shell / ring participant

        info = self.engine._suspicious.get(account_id)
        if info is None:
            return 0.0  # not flagged — clean score

        reasons: list[str] = info.get("reasons", [])
        score = 0.0

        # --- +40 cycle -------------------------------------------------------
        has_cycle = any("cycle" in r.lower() for r in reasons)
        if has_cycle:
            score += _W_CYCLE

        # --- +30 fan-in / fan-out (×1.3 if window ≤ 72 h) -------------------
        has_fan = any("fan-" in r.lower() for r in reasons)
        if has_fan:
            fan_hours = self._parse_fan_window(reasons)
            fan_score = _W_FAN
            if fan_hours is not None and fan_hours <= _FAN_72H:
                fan_score *= _FAN_MULT
            score += fan_score

        # --- +20 shell -------------------------------------------------------
        has_shell = any("shell" in r.lower() for r in reasons)
        if has_shell:
            score += _W_SHELL

        # --- +10 velocity ----------------------------------------------------
        if self._velocity_hit.get(account_id, False):
            score += _W_VELOCITY

        return round(min(score, _SCORE_CAP), 4)

    def score_all(self) -> pd.DataFrame:
        """
        Score every account known to the engine's last detection run.

        Accounts with 50+ transactions are included in the output with
        ``score=None`` and ``skipped=True`` for full auditability.

        Returns
        -------
        pd.DataFrame sorted by score descending with columns:
            account_id, ring_id, score, skipped,
            has_cycle, has_fan, has_shell, has_velocity,
            total_txns, reasons
        """
        records = []

        for account_id, info in self.engine._suspicious.items():
            total_txns = self._tx_count.get(account_id, 0)
            skipped    = total_txns >= _TX_SKIP
            score      = None if skipped else self.score_account(account_id)

            reasons: list[str] = info.get("reasons", [])
            records.append(
                {
                    "account_id"   : account_id,
                    "ring_id"      : info.get("ring_id"),
                    "score"        : score,
                    "skipped"      : skipped,
                    "has_cycle"    : any("cycle" in r.lower() for r in reasons),
                    "has_fan"      : any("fan-"  in r.lower() for r in reasons),
                    "has_shell"    : any("shell" in r.lower() for r in reasons),
                    "has_velocity" : self._velocity_hit.get(account_id, False),
                    "total_txns"   : total_txns,
                    "reasons"      : "; ".join(reasons),
                }
            )

        df_out = pd.DataFrame(records)
        if df_out.empty:
            return df_out

        # Sort: non-skipped first (highest score first), then skipped
        df_out = df_out.sort_values(
            ["skipped", "score"], ascending=[True, False]
        ).reset_index(drop=True)

        return df_out

    def report(self) -> str:
        """
        Human-readable scoring report for the terminal.
        """
        df = self.score_all()
        if df.empty:
            return "No suspicious accounts to score."

        sep = "─" * 72
        lines = [
            sep,
            f"{'SUSPICION SCORER REPORT':^72}",
            sep,
            f"  Velocity threshold : ≥{self.velocity_threshold} txns in 24 h  →  +{_W_VELOCITY:.0f} pts",
            f"  Fan multiplier     : ×{_FAN_MULT} when window ≤ {_FAN_72H} h",
            f"  Skip gate          : accounts with ≥ {_TX_SKIP} total txns",
            sep,
            f"{'ACCOUNT':<14} {'RING_ID':<14} {'SCORE':>7}  {'C':>2} {'F':>2} {'SH':>2} {'V':>2}  {'TXNS':>5}  NOTES",
            sep,
        ]

        for _, row in df.iterrows():
            score_str = f"{row['score']:6.1f}" if row["score"] is not None else "  SKIP"
            flags = (
                f"{'✓' if row['has_cycle']    else '·':>2} "
                f"{'✓' if row['has_fan']      else '·':>2} "
                f"{'✓' if row['has_shell']    else '·':>2} "
                f"{'✓' if row['has_velocity'] else '·':>2}"
            )
            notes = "SKIPPED (≥50 txns)" if row["skipped"] else ""
            lines.append(
                f"{str(row['account_id']):<14} {str(row['ring_id']):<14} "
                f"{score_str}  {flags}  {row['total_txns']:>5}  {notes}"
            )

        lines += [
            sep,
            "  Flags:  C=cycle  F=fan-in/out  SH=shell  V=velocity",
            sep,
        ]
        return "\n".join(lines)


# ── Demo ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import random
    from datetime import datetime

    # We import locally so the file can be run standalone alongside the engine
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from graph_engine import FraudDetectionEngine

    random.seed(99)
    base = datetime(2024, 3, 1)

    rows = []
    _tid = [1]  # mutable container to allow mutation from inner scope

    def tx(src, dst, amount, hours_offset):
        rows.append(dict(
            transaction_id=f"T{_tid[0]:04d}",
            sender_id=src,
            receiver_id=dst,
            amount=round(amount, 2),
            timestamp=base + timedelta(hours=hours_offset),
        ))
        _tid[0] += 1

    # ── Pattern 1: clean cycle  A→B→C→A  ─────────────────────────────────────
    tx("A", "B", 4_200,  1)
    tx("B", "C", 3_800,  2)
    tx("C", "A", 3_500,  3)

    # ── Pattern 2: fan-in into HUB within 72 h  ──────────────────────────────
    for i in range(12):
        tx(f"FSRC{i}", "HUB", random.uniform(500, 2_000), i * 4)

    # ── Pattern 3: shell chain  S1→S2→S3→S4  ────────────────────────────────
    tx("S1", "S2", 900,  50)
    tx("S2", "S3", 850,  51)
    tx("S3", "S4", 800,  52)

    # ── Pattern 4: COMBO account that hits cycle + velocity  ─────────────────
    # COMBO participates in a cycle and also fires 6 rapid txns in 24 h
    tx("COMBO", "X",     1_000, 10)
    tx("X",     "Y",     1_000, 11)
    tx("Y",     "COMBO", 1_000, 12)   # closes the cycle
    for h in range(6):                 # rapid burst → velocity flag
        tx("COMBO", f"VDST{h}", 200, 10 + h * 2)

    # ── Pattern 5: HIGH-VOLUME account (≥50 txns) → should be SKIPPED ────────
    for i in range(55):
        tx("WHALE", f"W_DST{i}", 100, i)

    df = pd.DataFrame(rows)

    # ── Run engine ────────────────────────────────────────────────────────────
    engine = FraudDetectionEngine(df)
    engine.analyse(
        cycle_min_len=3, cycle_max_len=5,
        fan_threshold=10, fan_window_hours=72,
        shell_max_txns=2, shell_min_hops=3,
    )

    # ── Score ─────────────────────────────────────────────────────────────────
    scorer = SuspicionScorer(engine, velocity_threshold=5, fan_window_hours=72)

    print(scorer.report())
    print()

    scores_df = scorer.score_all()
    print("=== score_all() DataFrame ===")
    pd.set_option("display.max_columns", None)
    pd.set_option("display.width", 120)
    print(scores_df.to_string(index=False))