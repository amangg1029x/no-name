"""
main.py
=======
FastAPI application exposing a single POST /api/analyze endpoint.

Accepts a CSV file upload with columns:
    transaction_id, sender_id, receiver_id, amount, timestamp

Runs FraudDetectionEngine + SuspicionScorer, then returns — and saves
to results.json — a structured JSON payload with three top-level fields:

    {
        "suspicious_accounts": [...],
        "fraud_rings":         {...},
        "summary":             {...}
    }

Run:
    uvicorn main:app --reload --port 8000

Then POST a CSV:
    curl -X POST http://localhost:8000/api/analyze \
         -F "file=@transactions.csv"
"""

from __future__ import annotations

import io
import json
import traceback
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

# ── Local modules (same directory) ────────────────────────────────────────────
from graph_engine import FraudDetectionEngine
from scorer import SuspicionScorer

# ── Config ────────────────────────────────────────────────────────────────────
RESULTS_PATH = Path("results.json")          # saved next to main.py at runtime

ANALYSE_KWARGS = dict(
    cycle_min_len=3,
    cycle_max_len=5,
    fan_threshold=10,
    fan_window_hours=72,
    shell_max_txns=3,
    shell_min_hops=3,
)
SCORER_KWARGS = dict(
    velocity_threshold=5,
    fan_window_hours=72,
)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Fraud Detection API",
    description="Upload a transaction CSV and receive a full fraud analysis.",
    version="1.0.0",
)


# ── Helper: build the exact JSON structure ────────────────────────────────────

def _nan_to_none(value: Any) -> Any:
    """Convert NaN / Inf floats to None so json.dumps doesn't choke."""
    if isinstance(value, float) and (value != value):   # NaN check
        return None
    return value


def _build_response(
    engine: FraudDetectionEngine,
    scorer: SuspicionScorer,
    scores_df: pd.DataFrame,
    cycles: List[dict],
    fans: List[dict],
    shells: List[dict],
) -> Dict[str, Any]:
    """
    Assemble the canonical response dict.

    suspicious_accounts
    ───────────────────
    One object per flagged account (ordered by score desc, skipped last):
        account_id, ring_id, score, skipped,
        has_cycle, has_fan, has_shell, has_velocity,
        total_txns, reasons

    fraud_rings
    ───────────
    Keyed by ring_id, each entry has:
        ring_id, type (CYCLE|FAN-IN|FAN-OUT|SHELL),
        accounts, total_amount, tx_ids, [pattern-specific fields]

    summary
    ───────
    High-level statistics + a timestamp.
    """

    # ── suspicious_accounts ───────────────────────────────────────────────────
    suspicious_accounts: List[dict] = []
    for _, row in scores_df.iterrows():
        suspicious_accounts.append({
            "account_id"   : row["account_id"],
            "ring_id"      : row["ring_id"],
            "score"        : _nan_to_none(row["score"]),
            "skipped"      : bool(row["skipped"]),
            "has_cycle"    : bool(row["has_cycle"]),
            "has_fan"      : bool(row["has_fan"]),
            "has_shell"    : bool(row["has_shell"]),
            "has_velocity" : bool(row["has_velocity"]),
            "total_txns"   : int(row["total_txns"]),
            "reasons"      : row["reasons"],
        })

    # ── fraud_rings ───────────────────────────────────────────────────────────
    fraud_rings: Dict[str, dict] = {}

    for c in cycles:
        ring_id = c["ring_id"]
        fraud_rings[ring_id] = {
            "ring_id"      : ring_id,
            "type"         : "CYCLE",
            "accounts"     : c["accounts"],
            "total_amount" : c["total_amount"],
            "tx_ids"       : c["tx_ids"],
            "cycle_length" : len(c["cycle"]),
        }

    for f in fans:
        ring_id = f["ring_id"]
        fraud_rings[ring_id] = {
            "ring_id"            : ring_id,
            "type"               : f.get("pattern", "FAN"),
            "accounts"           : [f["account_id"]],
            "total_amount"       : f.get("total_amount", 0.0),
            "tx_ids"             : f.get("tx_ids", []),
            "counterparty_count" : f.get("counterparty_count"),
            "window_start"       : f.get("window_start"),
            "window_end"         : f.get("window_end"),
        }

    for s in shells:
        ring_id = s["ring_id"]
        fraud_rings[ring_id] = {
            "ring_id"      : ring_id,
            "type"         : "SHELL",
            "accounts"     : s["accounts"],
            "total_amount" : s["total_amount"],
            "tx_ids"       : s["tx_ids"],
            "hops"         : s["hops"],
        }

    # ── summary ───────────────────────────────────────────────────────────────
    scored = scores_df[~scores_df["skipped"]]
    skipped_count = int(scores_df["skipped"].sum())

    ring_type_counts: Dict[str, int] = defaultdict(int)
    for r in fraud_rings.values():
        ring_type_counts[r["type"]] += 1

    summary = {
        "analysed_at"          : datetime.now(timezone.utc).isoformat(),
        "total_transactions"   : len(engine.df),
        "total_accounts"       : int(
            engine.df["sender_id"].astype(str).nunique()
            + engine.df["receiver_id"].astype(str).nunique()
        ),
        "suspicious_accounts"  : len(suspicious_accounts),
        "skipped_accounts"     : skipped_count,
        "fraud_rings_detected" : len(fraud_rings),
        "rings_by_type"        : dict(ring_type_counts),
        "cycles_detected"      : len(cycles),
        "fan_patterns_detected": len(fans),
        "shell_chains_detected": len(shells),
        "score_distribution"   : {
            "max"  : _nan_to_none(float(scored["score"].max()))  if not scored.empty else None,
            "mean" : _nan_to_none(float(scored["score"].mean())) if not scored.empty else None,
            "min"  : _nan_to_none(float(scored["score"].min()))  if not scored.empty else None,
            "high_risk_count"   : int((scored["score"] >= 70).sum()),
            "medium_risk_count" : int(((scored["score"] >= 40) & (scored["score"] < 70)).sum()),
            "low_risk_count"    : int((scored["score"] < 40).sum()),
        },
    }

    return {
        "suspicious_accounts": suspicious_accounts,
        "fraud_rings"        : fraud_rings,
        "summary"            : summary,
    }


# ── Endpoint ──────────────────────────────────────────────────────────────────

@app.post(
    "/api/analyze",
    summary="Analyze a transaction CSV for fraud patterns",
    response_description="Fraud analysis with suspicious accounts, rings, and summary",
)
async def analyze(
    file: UploadFile = File(..., description="CSV with columns: transaction_id, sender_id, receiver_id, amount, timestamp"),
):
    # ── 1. Validate file type ─────────────────────────────────────────────────
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=400,
            detail="Only .csv files are accepted.",
        )

    # ── 2. Read CSV ───────────────────────────────────────────────────────────
    try:
        contents = await file.read()
        df = pd.read_csv(io.BytesIO(contents))
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Could not parse CSV: {exc}",
        )

    required_cols = {"transaction_id", "sender_id", "receiver_id", "amount", "timestamp"}
    missing = required_cols - set(df.columns)
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"CSV is missing required columns: {sorted(missing)}",
        )

    if df.empty:
        raise HTTPException(status_code=422, detail="CSV contains no data rows.")

    # ── 3. Run detection engine ───────────────────────────────────────────────
    try:
        engine = FraudDetectionEngine(df)

        # Run individual detectors so we keep the raw ring lists
        cycles = engine.detect_cycles(
            min_len=ANALYSE_KWARGS["cycle_min_len"],
            max_len=ANALYSE_KWARGS["cycle_max_len"],
        )
        fans = engine.detect_fan_in_out(
            threshold=ANALYSE_KWARGS["fan_threshold"],
            window_hours=ANALYSE_KWARGS["fan_window_hours"],
        )
        shells = engine.detect_shell_networks(
            max_txns=ANALYSE_KWARGS["shell_max_txns"],
            min_hops=ANALYSE_KWARGS["shell_min_hops"],
        )

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Detection engine error: {exc}\n{traceback.format_exc()}",
        )

    # ── 4. Score ──────────────────────────────────────────────────────────────
    try:
        scorer = SuspicionScorer(engine, **SCORER_KWARGS)
        scores_df = scorer.score_all()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Scorer error: {exc}\n{traceback.format_exc()}",
        )

    # ── 5. Build response ─────────────────────────────────────────────────────
    result = _build_response(engine, scorer, scores_df, cycles, fans, shells)

    # ── 6. Save results.json locally ─────────────────────────────────────────
    try:
        RESULTS_PATH.write_text(
            json.dumps(result, indent=2, default=str),
            encoding="utf-8",
        )
    except Exception as exc:
        # Non-fatal — log but don't fail the request
        print(f"[WARN] Could not save results.json: {exc}")

    return JSONResponse(content=result)


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


# ── Dev runner ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)