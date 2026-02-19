"""
FraudDetectionEngine
====================
Detects fraudulent transaction patterns using a directed graph built from
a pandas DataFrame with columns:
    transaction_id, sender_id, receiver_id, amount, timestamp
"""

import networkx as nx
import pandas as pd
from itertools import islice
from collections import defaultdict
from datetime import timedelta
from typing import Dict, List, Optional, Set


class FraudDetectionEngine:
    """
    Graph-based fraud detection over a transaction DataFrame.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain columns: transaction_id, sender_id, receiver_id,
        amount, timestamp (datetime-like or parseable string).
    """

    def __init__(self, df: pd.DataFrame):
        required = {"transaction_id", "sender_id", "receiver_id", "amount", "timestamp"}
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"DataFrame is missing columns: {missing}")

        self.df = df.copy()
        self.df["timestamp"] = pd.to_datetime(self.df["timestamp"])
        self.graph: nx.DiGraph = self._build_graph()

        # Populated after calling analyse() or individual detect_* methods
        self._suspicious: Dict[str, dict] = {}  # account_id -> info dict

    # ------------------------------------------------------------------
    # Graph construction
    # ------------------------------------------------------------------

    def _build_graph(self) -> nx.DiGraph:
        """Build a directed, multi-edge weighted graph from transactions."""
        G = nx.DiGraph()
        for _, row in self.df.iterrows():
            src, dst = str(row["sender_id"]), str(row["receiver_id"])
            if G.has_edge(src, dst):
                # Accumulate weight (total amount) and transaction count
                G[src][dst]["weight"] += float(row["amount"])
                G[src][dst]["tx_count"] += 1
                G[src][dst]["tx_ids"].append(row["transaction_id"])
            else:
                G.add_edge(
                    src,
                    dst,
                    weight=float(row["amount"]),
                    tx_count=1,
                    tx_ids=[row["transaction_id"]],
                )
        return G

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _mark_suspicious(
        self,
        account_id: str,
        reason: str,
        ring_id: str,
        extra: Optional[dict] = None,
    ):
        """Register an account as suspicious, merging if already present."""
        if account_id not in self._suspicious:
            self._suspicious[account_id] = {
                "account_id": account_id,
                "ring_id": ring_id,
                "reasons": [],
            }
        entry = self._suspicious[account_id]
        entry["reasons"].append(reason)
        # Keep the first ring_id assigned unless it's still None
        if entry.get("ring_id") is None:
            entry["ring_id"] = ring_id
        if extra:
            entry.update(extra)

    def _transactions_between(
        self,
        sender_id: str,
        receiver_id: str,
        start: pd.Timestamp,
        end: pd.Timestamp,
    ) -> pd.DataFrame:
        mask = (
            (self.df["sender_id"].astype(str) == sender_id)
            & (self.df["receiver_id"].astype(str) == receiver_id)
            & (self.df["timestamp"] >= start)
            & (self.df["timestamp"] <= end)
        )
        return self.df[mask]

    # ------------------------------------------------------------------
    # Public detection methods
    # ------------------------------------------------------------------

    def detect_cycles(
        self, min_len: int = 3, max_len: int = 5
    ) -> List[dict]:
        """
        Detect circular money flows (ring transactions).

        Parameters
        ----------
        min_len : int
            Minimum cycle length (number of nodes). Default 3.
        max_len : int
            Maximum cycle length (number of nodes). Default 5.

        Returns
        -------
        List of dicts, one per cycle, with keys:
            ring_id, cycle, accounts, total_amount, tx_ids
        """
        results = []
        ring_counter = 0

        # nx.simple_cycles can be expensive on large graphs; we cap it
        for cycle in islice(nx.simple_cycles(self.graph), 50_000):
            if min_len <= len(cycle) <= max_len:
                ring_counter += 1
                ring_id = f"CYCLE-{ring_counter:04d}"

                total_amount = 0.0
                tx_ids: List = []
                for i, node in enumerate(cycle):
                    nxt = cycle[(i + 1) % len(cycle)]
                    if self.graph.has_edge(node, nxt):
                        edge = self.graph[node][nxt]
                        total_amount += edge["weight"]
                        tx_ids.extend(edge["tx_ids"])

                cycle_info = {
                    "ring_id": ring_id,
                    "cycle": cycle,
                    "accounts": list(cycle),
                    "total_amount": round(total_amount, 2),
                    "tx_ids": tx_ids,
                }
                results.append(cycle_info)

                for account in cycle:
                    self._mark_suspicious(
                        account,
                        reason=f"Participates in transaction cycle {ring_id}",
                        ring_id=ring_id,
                        extra={"cycle_length": len(cycle)},
                    )

        return results

    def detect_fan_in_out(
        self, threshold: int = 10, window_hours: int = 72
    ) -> List[dict]:
        """
        Detect accounts that rapidly aggregate funds from many senders
        (fan-in) or distribute funds to many receivers (fan-out).

        Parameters
        ----------
        threshold : int
            Minimum number of distinct counterparties within the window.
        window_hours : int
            Rolling time window in hours.

        Returns
        -------
        List of dicts per suspicious account with pattern details.
        """
        results = []
        ring_counter = 0
        window = timedelta(hours=window_hours)
        df_sorted = self.df.sort_values("timestamp")

        def _check_account(account_id: str, as_receiver: bool):
            nonlocal ring_counter
            col = "receiver_id" if as_receiver else "sender_id"
            other_col = "sender_id" if as_receiver else "receiver_id"
            pattern = "FAN-IN" if as_receiver else "FAN-OUT"

            subset = df_sorted[df_sorted[col].astype(str) == account_id]
            if subset.empty:
                return

            timestamps = subset["timestamp"].values
            for i, ts in enumerate(timestamps):
                window_end = pd.Timestamp(ts) + window
                window_txns = subset[
                    (subset["timestamp"] >= pd.Timestamp(ts))
                    & (subset["timestamp"] <= window_end)
                ]
                counterparties = window_txns[other_col].astype(str).nunique()
                if counterparties >= threshold:
                    ring_counter += 1
                    ring_id = f"{pattern}-{ring_counter:04d}"
                    info = {
                        "ring_id": ring_id,
                        "account_id": account_id,
                        "pattern": pattern,
                        "counterparty_count": counterparties,
                        "window_start": str(pd.Timestamp(ts)),
                        "window_end": str(window_end),
                        "tx_ids": window_txns["transaction_id"].tolist(),
                        "total_amount": round(window_txns["amount"].sum(), 2),
                    }
                    results.append(info)
                    self._mark_suspicious(
                        account_id,
                        reason=f"{pattern} pattern ({counterparties} counterparties in {window_hours}h)",
                        ring_id=ring_id,
                        extra=info,
                    )
                    break  # one finding per account per pattern is enough

        all_accounts = (
            set(self.df["sender_id"].astype(str))
            | set(self.df["receiver_id"].astype(str))
        )
        for acct in all_accounts:
            _check_account(acct, as_receiver=True)   # fan-in
            _check_account(acct, as_receiver=False)  # fan-out

        return results

    def detect_shell_networks(
        self, max_txns: int = 3, min_hops: int = 3
    ) -> List[dict]:
        """
        Identify shell-account chains: sequences of accounts that each
        transact very few times but form a long layering chain.

        Parameters
        ----------
        max_txns : int
            Maximum total transactions an account may have to be considered
            a "shell" (low-activity account).
        min_hops : int
            Minimum chain length to flag.

        Returns
        -------
        List of dicts describing each shell chain found.
        """
        results = []
        ring_counter = 0

        # Count total transactions per account
        tx_counts: Dict[str, int] = defaultdict(int)
        for _, row in self.df.iterrows():
            tx_counts[str(row["sender_id"])] += 1
            tx_counts[str(row["receiver_id"])] += 1

        shell_nodes: Set[str] = {
            node for node, cnt in tx_counts.items() if cnt <= max_txns
        }

        visited_chains: Set[tuple] = set()

        def dfs(path: List[str]) -> None:
            nonlocal ring_counter
            current = path[-1]
            extended = False
            for neighbor in self.graph.successors(current):
                if neighbor in shell_nodes and neighbor not in path:
                    dfs(path + [neighbor])
                    extended = True

            if not extended and len(path) >= min_hops:
                chain_key = tuple(path)
                if chain_key not in visited_chains:
                    visited_chains.add(chain_key)
                    ring_counter += 1
                    ring_id = f"SHELL-{ring_counter:04d}"

                    tx_ids: List = []
                    total_amount = 0.0
                    for i in range(len(path) - 1):
                        edge = self.graph.get_edge_data(path[i], path[i + 1])
                        if edge:
                            tx_ids.extend(edge["tx_ids"])
                            total_amount += edge["weight"]

                    chain_info = {
                        "ring_id": ring_id,
                        "chain": path,
                        "accounts": path,
                        "hops": len(path) - 1,
                        "total_amount": round(total_amount, 2),
                        "tx_ids": tx_ids,
                    }
                    results.append(chain_info)

                    for account in path:
                        self._mark_suspicious(
                            account,
                            reason=f"Shell network chain {ring_id} (length {len(path)})",
                            ring_id=ring_id,
                            extra={"chain_length": len(path)},
                        )

        # Start DFS from shell nodes that have no incoming edges in the shell
        # (potential entry points)
        for node in shell_nodes:
            predecessors_in_shell = [
                p for p in self.graph.predecessors(node) if p in shell_nodes
            ]
            if not predecessors_in_shell:
                dfs([node])

        return results

    # ------------------------------------------------------------------
    # Aggregate analysis
    # ------------------------------------------------------------------

    def analyse(
        self,
        cycle_min_len: int = 3,
        cycle_max_len: int = 5,
        fan_threshold: int = 10,
        fan_window_hours: int = 72,
        shell_max_txns: int = 3,
        shell_min_hops: int = 3,
    ) -> pd.DataFrame:
        """
        Run all three detectors and return a consolidated DataFrame of
        suspicious accounts with ring_id assignments.

        Returns
        -------
        pd.DataFrame with columns:
            account_id, ring_id, reasons, [extra fields per pattern]
        """
        self._suspicious.clear()

        self.detect_cycles(min_len=cycle_min_len, max_len=cycle_max_len)
        self.detect_fan_in_out(threshold=fan_threshold, window_hours=fan_window_hours)
        self.detect_shell_networks(max_txns=shell_max_txns, min_hops=shell_min_hops)

        if not self._suspicious:
            return pd.DataFrame(
                columns=["account_id", "ring_id", "reasons"]
            )

        records = []
        for info in self._suspicious.values():
            record = info.copy()
            record["reasons"] = "; ".join(info["reasons"])
            records.append(record)

        return pd.DataFrame(records).sort_values("ring_id").reset_index(drop=True)

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    def summary(self) -> str:
        """Return a human-readable summary of the last analysis run."""
        if not self._suspicious:
            return "No suspicious accounts detected (run analyse() first)."
        lines = [f"Suspicious accounts detected: {len(self._suspicious)}", ""]
        by_ring: Dict[str, List[str]] = defaultdict(list)
        for acct, info in self._suspicious.items():
            by_ring[info["ring_id"]].append(acct)
        for ring_id, accounts in sorted(by_ring.items()):
            lines.append(f"  [{ring_id}]  accounts: {', '.join(accounts)}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Demo / smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import random
    from datetime import datetime, timedelta

    random.seed(42)
    base_time = datetime(2024, 1, 1)

    rows = []
    tx_id = 1

    # ── Ring: A→B→C→A ──────────────────────────────────────────────────
    for src, dst in [("A", "B"), ("B", "C"), ("C", "A")]:
        rows.append(
            dict(
                transaction_id=f"T{tx_id:04d}",
                sender_id=src,
                receiver_id=dst,
                amount=round(random.uniform(1_000, 5_000), 2),
                timestamp=base_time + timedelta(hours=tx_id),
            )
        )
        tx_id += 1

    # ── Fan-in: many senders → hub ─────────────────────────────────────
    for i in range(15):
        rows.append(
            dict(
                transaction_id=f"T{tx_id:04d}",
                sender_id=f"FAN_SRC_{i}",
                receiver_id="HUB",
                amount=round(random.uniform(500, 2_000), 2),
                timestamp=base_time + timedelta(hours=i * 2),
            )
        )
        tx_id += 1

    # ── Shell chain: S1→S2→S3→S4 (each node used only once) ───────────
    chain = ["S1", "S2", "S3", "S4"]
    for i in range(len(chain) - 1):
        rows.append(
            dict(
                transaction_id=f"T{tx_id:04d}",
                sender_id=chain[i],
                receiver_id=chain[i + 1],
                amount=round(random.uniform(200, 800), 2),
                timestamp=base_time + timedelta(hours=50 + i),
            )
        )
        tx_id += 1

    df = pd.DataFrame(rows)
    print("=== Sample transactions ===")
    print(df.to_string(index=False))
    print()

    engine = FraudDetectionEngine(df)
    result_df = engine.analyse(
        cycle_min_len=3,
        cycle_max_len=5,
        fan_threshold=10,
        fan_window_hours=72,
        shell_max_txns=2,
        shell_min_hops=3,
    )

    print("=== Suspicious Accounts ===")
    print(result_df.to_string(index=False))
    print()
    print(engine.summary())