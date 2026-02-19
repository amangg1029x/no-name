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
        """Build a directed weighted graph. Vectorized — much faster than iterrows."""
        G = nx.DiGraph()
        df2 = self.df.assign(
            sender_id=self.df["sender_id"].astype(str),
            receiver_id=self.df["receiver_id"].astype(str),
        )
        grouped = (
            df2.groupby(["sender_id", "receiver_id"], sort=False)
            .agg(weight=("amount", "sum"), tx_count=("transaction_id", "count"),
                 tx_ids=("transaction_id", list))
            .reset_index()
        )
        for _, row in grouped.iterrows():
            G.add_edge(row["sender_id"], row["receiver_id"],
                       weight=float(row["weight"]), tx_count=int(row["tx_count"]),
                       tx_ids=row["tx_ids"])
        return G

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _is_likely_legitimate(self, account_id: str) -> bool:
        """
        Heuristic classifier to distinguish legitimate high-volume entities
        (payroll companies, merchants) from actual fraud hubs.

        A legitimate FAN entity typically:
          1. Sends to the SAME counterparties repeatedly over time (payroll)
             OR receives from the SAME counterparties repeatedly (merchant sales)
          2. Has consistent amounts across transactions (salary = regular)
          3. Shows no INBOUND aggregation followed immediately by outbound dispersal
             (the hallmark of a money mule hub is: collect → immediately scatter)

        Returns True if the account should be considered legitimate.
        """
        df = self.df
        sent     = df[df["sender_id"].astype(str) == account_id]
        received = df[df["receiver_id"].astype(str) == account_id]

        # Rule 1: Payroll pattern — sends to many, but same recipients repeat
        if len(sent) > 0:
            recipient_counts = sent["receiver_id"].value_counts()
            repeat_ratio = (recipient_counts > 1).sum() / len(recipient_counts)
            # If ≥40% of recipients appear more than once → recurring payroll
            if repeat_ratio >= 0.4:
                return True

        # Rule 2: Merchant pattern — receives from many but counterparties repeat
        if len(received) > 0:
            sender_counts = received["sender_id"].value_counts()
            repeat_ratio = (sender_counts > 1).sum() / len(sender_counts)
            if repeat_ratio >= 0.4:
                return True

        # Rule 3: Amount regularity + outbound-dominant pattern
        # Payroll companies: consistent salaries AND they send far more than they receive.
        # A mule hub has balanced in/out (collects then disburses similar volume).
        if len(sent) >= 5:
            amounts  = sent["amount"]
            cv       = amounts.std() / (amounts.mean() + 1e-9)
            # Only consider this a legitimate payroll signal if outbound >> inbound
            # (payroll companies receive revenue infrequently, pay employees frequently)
            outbound_dominant = len(sent) >= len(received) * 3
            if cv < 0.15 and outbound_dominant:
                return True

        # Rule 4: Mule hub fingerprint — all-unique counterparties on BOTH sides
        # A real mule hub has: many different senders AND many different receivers,
        # with almost no repeat counterparties on either side (every sender/receiver is new).
        # Legitimate entities (payroll, merchants) have high repeat rates on at least one side.
        if len(received) >= 5 and len(sent) >= 5:
            recv_repeat = (received["sender_id"].value_counts() > 1).sum()
            sent_repeat = (sent["receiver_id"].value_counts() > 1).sum()
            recv_uniq   = received["sender_id"].nunique()
            sent_uniq   = sent["receiver_id"].nunique()
            # If both sides are mostly unique → mule hub → NOT legitimate
            recv_repeat_ratio = recv_repeat / max(recv_uniq, 1)
            sent_repeat_ratio = sent_repeat / max(sent_uniq, 1)
            if recv_repeat_ratio < 0.1 and sent_repeat_ratio < 0.1:
                return False  # both sides all-unique → classic mule topology

        return False

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
        Detect circular money flows using Strongly Connected Components.

        Uses SCC decomposition first to isolate cycle-containing subgraphs,
        then runs simple_cycles only within each SCC. This is correct and fast:
        - Finds ALL cycles of the right length regardless of graph density
        - Avoids exhausting the cap on irrelevant parts of the graph
        - O(V+E) for SCC + O(cycles) for enumeration

        Parameters
        ----------
        min_len : int
            Minimum cycle length (number of nodes). Default 3.
        max_len : int
            Maximum cycle length (number of nodes). Default 5.
        """
        results = []
        ring_counter = 0

        # Step 1: find strongly connected components (nodes that can form cycles)
        # Only SCCs of size >= min_len can contain valid cycles
        sccs = [
            scc for scc in nx.strongly_connected_components(self.graph)
            if len(scc) >= min_len
        ]

        seen_cycles: set = set()

        # Step 2: enumerate cycles within each SCC independently
        # This prevents dense parts of the graph from exhausting the global cap
        PER_SCC_CAP = 10_000  # generous per-component cap

        for scc in sccs:
            subG = self.graph.subgraph(scc)
            for cycle in islice(nx.simple_cycles(subG), PER_SCC_CAP):
                if min_len <= len(cycle) <= max_len:
                    # Canonicalise to avoid duplicates
                    key = tuple(sorted(cycle))
                    if key in seen_cycles:
                        continue
                    seen_cycles.add(key)

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

                    # Skip trivially small cycles — bill-splitting, micropayments
                    # Real laundering cycles involve meaningful sums (>$1,000 total)
                    if total_amount < 1_000.0:
                        continue

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
                    # Only flag if entity classification doesn't suggest it's legitimate
                    if not self._is_likely_legitimate(account_id):
                        self._mark_suspicious(
                            account_id,
                            reason=f"{pattern} pattern ({counterparties} counterparties in {window_hours}h)",
                            ring_id=ring_id,
                            extra=info,
                        )
                    break  # one finding per account per pattern is enough

        # Pre-filter: only check accounts that have enough transactions
        # to possibly hit the threshold — massive speedup at scale
        sender_counts  = self.df["sender_id"].astype(str).value_counts()
        receiver_counts= self.df["receiver_id"].astype(str).value_counts()
        fan_out_candidates = set(sender_counts[sender_counts >= threshold].index)
        fan_in_candidates  = set(receiver_counts[receiver_counts >= threshold].index)

        for acct in fan_in_candidates:
            _check_account(acct, as_receiver=True)   # fan-in
        for acct in fan_out_candidates:
            _check_account(acct, as_receiver=False)  # fan-out

        return results

    def detect_shell_networks(
        self, max_txns: int = 5, min_hops: int = 3
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

    def detect_structuring(
        self,
        amount_ceiling: float = 10_000.0,
        band_pct: float = 0.08,
        min_senders: int = 5,
        window_hours: int = 168,
    ) -> List[dict]:
        """
        Detect structuring (smurfing) — multiple senders each sending amounts
        clustered just below a reporting threshold within a time window.

        Classic pattern: 6+ people each send $9,500–$9,999 to the same account
        within a week to stay below the $10,000 CTR filing threshold.

        Parameters
        ----------
        amount_ceiling : float
            The regulatory reporting threshold to test against (default $10,000).
        band_pct : float
            How far below the ceiling counts as "structured" (default 8% → $9,200+).
        min_senders : int
            Minimum number of structured senders to flag (default 5).
        window_hours : int
            Time window in hours (default 168 = 1 week).
        """
        results = []
        ring_counter = 0
        lower_bound  = amount_ceiling * (1.0 - band_pct)  # e.g. $9,200
        window       = timedelta(hours=window_hours)

        # Only look at transactions in the structured amount band
        df = self.df.copy()
        df["sender_id"]   = df["sender_id"].astype(str)
        df["receiver_id"] = df["receiver_id"].astype(str)
        in_band = df[(df["amount"] >= lower_bound) & (df["amount"] < amount_ceiling)]

        if in_band.empty:
            return results

        in_band = in_band.sort_values("timestamp")

        # For each receiver, find windows where many different senders
        # send structured amounts
        for receiver, group in in_band.groupby("receiver_id"):
            timestamps = group["timestamp"].values
            for i, ts in enumerate(timestamps):
                window_end  = pd.Timestamp(ts) + window
                window_txns = group[
                    (group["timestamp"] >= pd.Timestamp(ts))
                    & (group["timestamp"] <= window_end)
                ]
                unique_senders = window_txns["sender_id"].nunique()
                if unique_senders >= min_senders:
                    ring_counter += 1
                    ring_id = f"STRUCT-{ring_counter:04d}"
                    total   = round(window_txns["amount"].sum(), 2)
                    tx_ids  = window_txns["transaction_id"].tolist()
                    info = {
                        "ring_id":           ring_id,
                        "account_id":        receiver,
                        "pattern":           "STRUCTURING",
                        "counterparty_count": unique_senders,
                        "window_start":      str(pd.Timestamp(ts)),
                        "window_end":        str(window_end),
                        "tx_ids":            tx_ids,
                        "total_amount":      total,
                        "amount_ceiling":    amount_ceiling,
                    }
                    results.append(info)
                    if not self._is_likely_legitimate(receiver):
                        self._mark_suspicious(
                            receiver,
                            reason=f"Structuring pattern: {unique_senders} senders with amounts"
                                   f" ${lower_bound:,.0f}–${amount_ceiling:,.0f} within {window_hours}h",
                            ring_id=ring_id,
                            extra=info,
                        )
                    break  # one finding per receiver is enough

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
        shell_max_txns: int = 5,
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
        self.detect_structuring()

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