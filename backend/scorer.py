"""
suspicion_scorer.py
===================
Scores each suspicious account detected by FraudDetectionEngine on a
0-100 float scale.

PROPORTIONAL SCORING MODEL
──────────────────────────
Scores reflect SEVERITY, not just presence of a pattern.

  CYCLE  (base 30, up to 45)
    +3 per extra node beyond 3-node minimum
    3-node→30  4-node→33  5-node→36  6-node→39 …

  FAN-IN / FAN-OUT  (base 20, up to 45, then ×1.3 if window ≤ 72h)
    +1 per counterparty above the detection threshold (10)
    12 counterparties in 72h → (20+2)×1.3 = 28.6
    20 counterparties in 72h → (20+10)×1.3 = 39.0

  SHELL  (base 15, up to 35)
    +4 per hop above the minimum (3 hops)
    3-hop→15  4-hop→19  5-hop→23  6-hop→27 …

  VELOCITY  (base 5, up to 15)
    +1 per txn above the velocity threshold in the 24-h window

Total capped at 100. Accounts with ≥50 total txns are SKIPPED (score=None).
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import timedelta
from typing import Dict, Optional

import pandas as pd

# ── Weights ────────────────────────────────────────────────────────────────────
_BASE_CYCLE     = 30.0
_PER_CYCLE_NODE = 3.0
_MAX_CYCLE      = 45.0

_BASE_FAN       = 20.0
_PER_COUNTERP   = 1.0
_FAN_THRESHOLD  = 10
_MAX_FAN_BASE   = 45.0   # cap before multiplier
_FAN_MULT       = 1.3
_FAN_72H        = 72

_BASE_SHELL     = 15.0
_PER_HOP        = 4.0
_MIN_HOPS       = 3
_MAX_SHELL      = 35.0

_BASE_VELOCITY  = 5.0
_PER_VEL_TXN    = 1.0
_MAX_VELOCITY   = 15.0

_SCORE_CAP      = 100.0
_TX_SKIP        = 50


class SuspicionScorer:
    """
    Proportional suspicion scorer for accounts flagged by FraudDetectionEngine.

    Parameters
    ----------
    engine : FraudDetectionEngine
    velocity_threshold : int   Min txns in 24h window to trigger velocity bonus (default 5)
    fan_window_hours : int     Fan detection window, used for 1.3x multiplier (default 72)
    """

    def __init__(self, engine, velocity_threshold: int = 5, fan_window_hours: int = 72):
        self.engine             = engine
        self.velocity_threshold = velocity_threshold
        self.fan_window_hours   = fan_window_hours

        self._tx_count: Dict[str, int]    = self._build_tx_counts()
        self._velocity_data: Dict[str, int] = self._build_velocity_data()

    # ── Private ────────────────────────────────────────────────────────────────

    def _build_tx_counts(self) -> Dict[str, int]:
        counts: Dict[str, int] = defaultdict(int)
        df = self.engine.df
        for col in ("sender_id", "receiver_id"):
            for acct in df[col].astype(str):
                counts[acct] += 1
        return counts

    def _build_velocity_data(self) -> Dict[str, int]:
        """Return max txns seen in any 24-h window per account (0 if below threshold)."""
        df     = self.engine.df.sort_values("timestamp")
        window = timedelta(hours=24)
        result: Dict[str, int] = {}
        all_accounts = set(df["sender_id"].astype(str)) | set(df["receiver_id"].astype(str))

        for acct in all_accounts:
            mask = (df["sender_id"].astype(str) == acct) | (df["receiver_id"].astype(str) == acct)
            sub  = df[mask].reset_index(drop=True)
            peak = 0
            for ts in sub["timestamp"]:
                count = int(((sub["timestamp"] >= ts) & (sub["timestamp"] <= ts + window)).sum())
                if count > peak:
                    peak = count
            result[acct] = peak if peak >= self.velocity_threshold else 0
        return result

    def _parse_fan_info(self, reasons: list) -> tuple:
        """Return (counterparty_count, window_hours) from reason string, or (0,0)."""
        for r in reasons:
            m = re.search(r'(\d+)\s+counterparties\s+in\s+(\d+)h', r)
            if m:
                return int(m.group(1)), int(m.group(2))
        return 0, 0

    def _parse_shell_length(self, reasons: list) -> int:
        """Return chain length from shell reason string, or 0."""
        for r in reasons:
            m = re.search(r'length\s+(\d+)', r, re.IGNORECASE)
            if m:
                return int(m.group(1))
        return 0

    def _parse_cycle_length(self, account_id: str) -> int:
        """Look up cycle_length stored in _suspicious extra, default 3."""
        return int(self.engine._suspicious.get(account_id, {}).get("cycle_length", 3))

    # ── Public ─────────────────────────────────────────────────────────────────

    def score_account(self, account_id: str) -> Optional[float]:
        """Return proportional score 0-100, or None if account is skipped."""
        if self._tx_count.get(account_id, 0) >= _TX_SKIP:
            return None

        info = self.engine._suspicious.get(account_id)
        if info is None:
            return 0.0

        reasons = info.get("reasons", [])
        score   = 0.0

        # CYCLE — proportional to cycle length
        if any("cycle" in r.lower() for r in reasons):
            length      = self._parse_cycle_length(account_id)
            extra_nodes = max(0, length - 3)
            score      += min(_BASE_CYCLE + extra_nodes * _PER_CYCLE_NODE, _MAX_CYCLE)

        # FAN — proportional to counterparty count
        if any("fan-" in r.lower() for r in reasons):
            cp, hours   = self._parse_fan_info(reasons)
            extra_cp    = max(0, cp - _FAN_THRESHOLD)
            fan_score   = min(_BASE_FAN + extra_cp * _PER_COUNTERP, _MAX_FAN_BASE)
            if hours > 0 and hours <= _FAN_72H:
                fan_score *= _FAN_MULT
            score += fan_score

        # SHELL — proportional to hop depth
        if any("shell" in r.lower() for r in reasons):
            chain_len   = self._parse_shell_length(reasons)
            hops        = max(0, chain_len - 1)        # length 5 = 4 hops
            extra_hops  = max(0, hops - _MIN_HOPS)
            score      += min(_BASE_SHELL + extra_hops * _PER_HOP, _MAX_SHELL)

        # VELOCITY — proportional to burst intensity
        vel = self._velocity_data.get(account_id, 0)
        if vel >= self.velocity_threshold:
            extra_vel = max(0, vel - self.velocity_threshold)
            score    += min(_BASE_VELOCITY + extra_vel * _PER_VEL_TXN, _MAX_VELOCITY)

        return round(min(score, _SCORE_CAP), 2)

    def score_all(self) -> pd.DataFrame:
        """Score all flagged accounts; return DataFrame sorted by score desc."""
        records = []
        for account_id, info in self.engine._suspicious.items():
            total_txns = self._tx_count.get(account_id, 0)
            skipped    = total_txns >= _TX_SKIP
            score      = None if skipped else self.score_account(account_id)
            reasons    = info.get("reasons", [])

            cp, fh  = self._parse_fan_info(reasons)
            clen    = self._parse_cycle_length(account_id) if any("cycle" in r.lower() for r in reasons) else None
            slen    = self._parse_shell_length(reasons) or None
            vel     = self._velocity_data.get(account_id, 0)

            records.append({
                "account_id"    : account_id,
                "ring_id"       : info.get("ring_id"),
                "score"         : score,
                "skipped"       : skipped,
                "has_cycle"     : any("cycle" in r.lower() for r in reasons),
                "has_fan"       : any("fan-"  in r.lower() for r in reasons),
                "has_shell"     : any("shell" in r.lower() for r in reasons),
                "has_velocity"  : vel >= self.velocity_threshold,
                "cycle_length"  : clen,
                "counterparties": cp or None,
                "chain_length"  : slen,
                "velocity_txns" : vel if vel >= self.velocity_threshold else 0,
                "total_txns"    : total_txns,
                "reasons"       : "; ".join(reasons),
            })

        df_out = pd.DataFrame(records)
        if df_out.empty:
            return df_out
        return df_out.sort_values(["skipped", "score"], ascending=[True, False]).reset_index(drop=True)

    def report(self) -> str:
        df  = self.score_all()
        if df.empty:
            return "No suspicious accounts to score."
        sep = "─" * 82
        lines = [
            sep,
            f"{'SUSPICION SCORER  ·  PROPORTIONAL MODEL':^82}",
            sep,
            f"  Cycle    : base {_BASE_CYCLE:.0f}  + {_PER_CYCLE_NODE:.0f}/extra node   (cap {_MAX_CYCLE:.0f})",
            f"  Fan      : base {_BASE_FAN:.0f}  + {_PER_COUNTERP:.0f}/extra cp  × 1.3 if ≤72h  (cap {_MAX_FAN_BASE:.0f}×1.3={_MAX_FAN_BASE*_FAN_MULT:.0f})",
            f"  Shell    : base {_BASE_SHELL:.0f}  + {_PER_HOP:.0f}/extra hop  (cap {_MAX_SHELL:.0f})",
            f"  Velocity : base {_BASE_VELOCITY:.0f}  + {_PER_VEL_TXN:.0f}/extra txn  (cap {_MAX_VELOCITY:.0f})",
            f"  Skip gate: >= {_TX_SKIP} total txns",
            sep,
            f"{'ACCOUNT':<16} {'RING_ID':<16} {'SCORE':>6}  C  F SH  V  SEVERITY DETAIL",
            sep,
        ]
        for _, row in df.iterrows():
            ss = f"{row['score']:6.1f}" if row["score"] is not None else "  SKIP"
            fl = (
                f"{'✓' if row['has_cycle']    else '·'} "
                f"{'✓' if row['has_fan']      else '·'} "
                f"{'✓' if row['has_shell']    else '·'} "
                f"{'✓' if row['has_velocity'] else '·'}"
            )
            detail = []
            cl = row["cycle_length"]
            if cl and str(cl) != "nan": detail.append(f"{int(cl)}-node cycle")
            cp = row["counterparties"]
            if cp and str(cp) != "nan": detail.append(f"{int(cp)} counterparties")
            sl = row["chain_length"]
            if sl and str(sl) != "nan": detail.append(f"{int(sl)-1}-hop shell")
            if row["velocity_txns"]:  detail.append(f"{row['velocity_txns']} txns/24h")
            if row["skipped"]:        detail.append("SKIPPED")
            lines.append(f"{str(row['account_id']):<16} {str(row['ring_id']):<16} {ss}  {fl}  {'  '.join(detail)}")
        lines += [sep, "  C=cycle  F=fan  SH=shell  V=velocity", sep]
        return "\n".join(lines)


# ── Demo ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys, os, random
    from datetime import datetime
    sys.path.insert(0, os.path.dirname(__file__))
    from graph_engine import FraudDetectionEngine

    random.seed(42)
    base = datetime(2024, 3, 1)
    rows, _tid = [], [1]

    def tx(s, d, amt, h):
        rows.append(dict(transaction_id=f"T{_tid[0]:04d}", sender_id=s, receiver_id=d,
                         amount=round(amt,2), timestamp=base+timedelta(hours=h)))
        _tid[0] += 1

    tx("A","B",1000,1); tx("B","C",1000,2); tx("C","A",1000,3)                       # 3-node cycle → 30
    tx("P","Q",2000,1); tx("Q","R",2000,2); tx("R","S",2000,3)                        # 3-node cycle → 30
    tx("S","T",2000,4); tx("T","P",2000,5)                                             # makes it 5-node → 36
    for i in range(12): tx(f"F{i}","HUB",500,i*4)                                     # fan-in 12 cp → 28.6
    for i in range(20): tx("DIST",f"D{i}",300,i*3)                                    # fan-out 20 cp → 52.0
    tx("S1","S2",900,50); tx("S2","S3",850,51); tx("S3","S4",800,52)                   # 3-hop shell → 15
    tx("L1","L2",900,60); tx("L2","L3",800,61); tx("L3","L4",700,62)                   # 5-hop shell → 23
    tx("L4","L5",600,63); tx("L5","L6",500,64)

    df = pd.DataFrame(rows)
    engine = FraudDetectionEngine(df)
    engine.detect_cycles(3,5)
    engine.detect_fan_in_out(10,72)
    engine.detect_shell_networks(3,3)

    scorer = SuspicionScorer(engine, velocity_threshold=5, fan_window_hours=72)
    print(scorer.report())