# v0.2.17
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
import re
import typing

from genlayer import *


@gl.evm.contract_interface
class _Recipient:
    """EVM-interface stub used solely to route native GEN payouts through
    GenLayer's EVM-compatibility layer. This is the mechanism confirmed
    (by live probe against this exact pinned runner) to actually deliver
    value to a plain wallet (EOA): `gl.get_contract_at(addr).emit_transfer(...)`
    (the pattern shown in genvm's own docs/examples) instead fails with
    "Contract ... not found" against any address without deployed
    contract code, which is what every user's custodial wallet is.
    Route ALL payouts through _send_gen below — never call emit_transfer
    directly elsewhere."""

    class View:
        pass

    class Write:
        pass


def _send_gen(to_address: str, amount: u256) -> None:
    """Single choke point for every native GEN payout this contract
    makes. Callers must zero the ledger field the amount is drawn from
    and persist state BEFORE calling this — state mutation always
    precedes the external transfer, so there is no reentrancy window
    where a payout could be claimed twice."""
    if not to_address:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Missing recipient address")
    if amount <= u256(0):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Transfer amount must be positive")
    _Recipient(Address(to_address)).emit_transfer(value=amount)


# ---------------------------------------------------------------------------
# Error classification prefixes (see module docstring)
# ---------------------------------------------------------------------------

ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"


# ---------------------------------------------------------------------------
# Domain constants
# ---------------------------------------------------------------------------

# Impact dimensions. Each is scored 0..20 by the LLM; total is 0..100.
DIMENSIONS = (
    "downstream_usage",
    "technical_importance",
    "originality",
    "ecosystem_influence",
    "community_adoption",
)

DIM_MAX = 20
TOTAL_MAX = 100

# Score buckets used for validator agreement. Two honest evaluations of
# the same repository land in the same or an adjacent bucket; requiring
# exact score equality would be needlessly strict and cause rotation.
BUCKET_SIZE = 25  # buckets: 0-24, 25-49, 50-74, 75-100

# Contribution lifecycle states.
ST_SUBMITTED = "submitted"
ST_EVALUATING = "evaluating"
ST_EVALUATED = "evaluated"
ST_REJECTED = "rejected"
ST_FLAGGED = "flagged"
ST_FUNDED = "funded"
ST_APPEALED = "appealed"

# Epoch lifecycle states.
EPOCH_OPEN = "open"
EPOCH_CLOSED = "closed"

# Appeal lifecycle states.
APPEAL_OPEN = "open"
APPEAL_UPHELD = "upheld"
APPEAL_DENIED = "denied"

# Categories accepted at submission time.
VALID_CATEGORIES = (
    "library",
    "sdk",
    "tooling",
    "documentation",
    "smart-contract",
    "infrastructure",
    "education",
    "research",
    "application",
)

GITHUB_API = "https://api.github.com"

# Hard caps that keep transactions inside compute limits.
MAX_LIST_PAGE = 50
MAX_AUDIT_RETURN = 100
MAX_DESCRIPTION_LEN = 2000
MAX_REASON_LEN = 1500
MAX_REPO_NAME_LEN = 140
MAX_USERNAME_LEN = 39  # GitHub maximum
MAX_CONTRIBUTIONS_PER_DEV = 25
MAX_EPOCH_CONTRIBUTIONS = 500

_REPO_RE = r"^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$"
_USER_RE = r"^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$"


# ---------------------------------------------------------------------------
# Pure helpers (deterministic, no chain state)
# ---------------------------------------------------------------------------


def _clamp_int(value, lo: int, hi: int) -> int:
    """Coerce an arbitrary LLM-provided value to an int within [lo, hi]."""
    try:
        n = int(round(float(str(value).strip())))
    except (ValueError, TypeError):
        raise gl.vm.UserError(f"{ERROR_LLM} Non-numeric score value: {value!r}")
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n


def _extract_json_object(text: str) -> dict:
    """Clean typical LLM JSON output: strip wrapping prose / code fences,
    remove trailing commas, then parse. Raises a classified LLM error on
    failure so validators can force rotation on genuinely broken output."""
    if isinstance(text, dict):
        return text
    if not isinstance(text, str):
        raise gl.vm.UserError(f"{ERROR_LLM} LLM returned non-text, non-dict output")
    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last == -1 or last <= first:
        raise gl.vm.UserError(f"{ERROR_LLM} No JSON object found in LLM output")
    body = text[first : last + 1]
    body = re.sub(r",(\s*[}\]])", r"\1", body)  # trailing commas
    try:
        parsed = json.loads(body)
    except Exception:
        raise gl.vm.UserError(f"{ERROR_LLM} Unparseable JSON in LLM output")
    if not isinstance(parsed, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} Parsed JSON is not an object")
    return parsed


def _get_scored_dimension(payload: dict, key: str) -> int:
    """Fetch one dimension score from an LLM payload with key aliasing."""
    raw = payload.get(key)
    if raw is None:
        scores = payload.get("scores")
        if isinstance(scores, dict):
            raw = scores.get(key)
    if raw is None:
        # Common LLM shorthand aliases per dimension.
        aliases = {
            "downstream_usage": ("usage", "downstream", "adoption_downstream"),
            "technical_importance": ("importance", "technical", "criticality"),
            "originality": ("novelty", "original", "innovation"),
            "ecosystem_influence": ("influence", "ecosystem", "impact"),
            "community_adoption": ("community", "adoption", "popularity"),
        }
        for alt in aliases.get(key, ()):
            if alt in payload:
                raw = payload[alt]
                break
    if raw is None:
        raise gl.vm.UserError(
            f"{ERROR_LLM} Missing dimension '{key}'. Keys: {sorted(payload.keys())}"
        )
    return _clamp_int(raw, 0, DIM_MAX)


def _bool_field(payload: dict, key: str, default: bool) -> bool:
    """Coerce an LLM-provided boolean-ish field."""
    raw = payload.get(key, default)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return raw != 0
    if isinstance(raw, str):
        return raw.strip().lower() in ("true", "yes", "1", "y")
    return default


def _text_field(payload: dict, key: str, max_len: int = 1200) -> str:
    raw = payload.get(key, "")
    if not isinstance(raw, str):
        raw = str(raw)
    return raw[:max_len]


def _bucket(total: int) -> int:
    """Map a 0..100 total score to a coarse agreement bucket."""
    if total >= TOTAL_MAX:
        return (TOTAL_MAX - 1) // BUCKET_SIZE
    if total < 0:
        return 0
    return total // BUCKET_SIZE


def _buckets_agree(a: int, b: int) -> bool:
    """Adjacent-bucket tolerance: honest evaluations may straddle a
    boundary; only a gap of two or more buckets is a real disagreement."""
    return abs(a - b) <= 1


def _validate_repo_name(repo_full_name: str) -> str:
    name = (repo_full_name or "").strip()
    if not name or len(name) > MAX_REPO_NAME_LEN:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid repository name length")
    if not re.match(_REPO_RE, name):
        raise gl.vm.UserError(
            f"{ERROR_EXPECTED} Repository must be in 'owner/name' format"
        )
    return name


def _validate_username(username: str) -> str:
    name = (username or "").strip()
    if not name or len(name) > MAX_USERNAME_LEN:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid GitHub username length")
    if not re.match(_USER_RE, name):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid GitHub username format")
    return name.lower()


def _stable_repo_projection(data: dict) -> dict:
    """Project a GitHub repository API response onto fields that do not
    change between a leader call and a validator call moments later.
    Volatile fields (stargazers_count, updated_at, pushed_at, watchers)
    are intentionally excluded from consensus-critical comparisons."""
    return {
        "id": int(data.get("id", 0)),
        "full_name": str(data.get("full_name", "")).lower(),
        "owner_login": str((data.get("owner") or {}).get("login", "")).lower(),
        "fork": bool(data.get("fork", False)),
        "private": bool(data.get("private", False)),
        "archived": bool(data.get("archived", False)),
        "created_at": str(data.get("created_at", "")),
        "language": str(data.get("language") or ""),
        "license": str(((data.get("license") or {}) or {}).get("spdx_id") or ""),
        "default_branch": str(data.get("default_branch", "")),
    }


def _stable_user_projection(data: dict) -> dict:
    """Stable-field projection of a GitHub user API response."""
    return {
        "id": int(data.get("id", 0)),
        "login": str(data.get("login", "")).lower(),
        "type": str(data.get("type", "")),
        "created_at": str(data.get("created_at", "")),
    }


def _coarse_metric(value: int) -> str:
    """Order-of-magnitude bucket for volatile popularity metrics so they
    can inform LLM reasoning without breaking validator agreement."""
    v = max(0, int(value))
    if v == 0:
        return "0"
    if v < 10:
        return "1-9"
    if v < 100:
        return "10-99"
    if v < 1000:
        return "100-999"
    if v < 10000:
        return "1k-10k"
    return "10k+"


def _evidence_digest(repo: dict, stars_bucket: str, forks_bucket: str) -> str:
    """Human/LLM-readable evidence summary assembled from fetched data."""
    lines = [
        f"Repository: {repo['full_name']}",
        f"Owner: {repo['owner_login']}",
        f"Primary language: {repo['language'] or 'unknown'}",
        f"License: {repo['license'] or 'none detected'}",
        f"Created at: {repo['created_at']}",
        f"Is fork of another repository: {repo['fork']}",
        f"Archived: {repo['archived']}",
        f"Stars (order of magnitude): {stars_bucket}",
        f"Forks (order of magnitude): {forks_bucket}",
    ]
    return "\n".join(lines)


def _leader_error_agreement(leaders_res, rerun_fn) -> bool:
    """Canonical validator behaviour when the leader errored.

    Deterministic errors ([EXPECTED]/[EXTERNAL]) must match exactly;
    transient errors agree if the validator also hit a transient
    failure; anything else disagrees to force rotation."""
    leader_msg = getattr(leaders_res, "message", "") or ""
    try:
        rerun_fn()
        return False  # leader failed, validator succeeded
    except gl.vm.UserError as exc:
        validator_msg = getattr(exc, "message", None) or str(exc)
        if validator_msg.startswith(ERROR_EXPECTED) or validator_msg.startswith(
            ERROR_EXTERNAL
        ):
            return validator_msg == leader_msg
        if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(
            ERROR_TRANSIENT
        ):
            return True
        return False
    except Exception:
        return False


def _validate_score_consistency(dims: dict, total: int, bucket: int) -> None:
    """Guard the invariant that funding math relies on: the per-dimension
    scores must sum to the recorded total, and the recorded bucket must
    be the bucket that total actually falls into. This is checked once
    when a score is written (evaluate_contribution) and again right
    before it is used to compute a grant weight (close_epoch), so a
    corrupted or hand-edited record can never silently skew payouts."""
    dim_sum = sum(int(v) for v in dims.values())
    if dim_sum != int(total):
        raise gl.vm.UserError(
            f"{ERROR_EXPECTED} Dimension scores ({dim_sum}) do not sum to total ({total})"
        )
    if _bucket(int(total)) != int(bucket):
        raise gl.vm.UserError(
            f"{ERROR_EXPECTED} Score bucket ({bucket}) does not match total ({total})"
        )


def _weight_for_score(total: int) -> int:
    """Funding weight: quadratic-ish emphasis on high impact while still
    rewarding mid-tier work. Deterministic integer math only."""
    if total <= 0:
        return 0
    return total * total  # 0..10000


# ---------------------------------------------------------------------------
# The contract
# ---------------------------------------------------------------------------


class ImpactDNA(gl.Contract):
    """Retroactive Public Goods Funding with validator-verified evidence."""

    # ---- governance / configuration -------------------------------------
    owner: Address
    paused: bool
    curators: TreeMap[str, bool]  # address hex -> active
    curator_count: u256

    # config values are stored as string to keep one homogeneous map
    config: TreeMap[str, str]

    # ---- developers -------------------------------------------------------
    # github username (lowercase) -> JSON developer record
    developers: TreeMap[str, str]
    # wallet address hex -> github username, for reverse lookup
    developer_by_address: TreeMap[str, str]
    developer_usernames: DynArray[str]
    developer_count: u256

    # ---- contributions ----------------------------------------------------
    # contribution id (c-<n>) -> JSON contribution record
    contributions: TreeMap[str, str]
    contribution_ids: DynArray[str]
    contribution_count: u256
    # repo full_name (lowercase) -> contribution id, duplicate guard
    contribution_by_repo: TreeMap[str, str]
    # per-developer counters (O(1) instead of scans)
    contributions_per_dev: TreeMap[str, u256]

    # ---- epochs & grants ----------------------------------------------------
    epochs: TreeMap[str, str]  # epoch id (e-<n>) -> JSON epoch record
    epoch_ids: DynArray[str]
    epoch_count: u256
    current_epoch: str  # "" when none open

    grants: TreeMap[str, str]  # grant id (g-<n>) -> JSON grant record
    grant_ids: DynArray[str]
    grant_count: u256
    total_granted_atto: u256
    treasury_atto: u256  # available, unallocated funds (may back a new epoch)
    reserved_atto: u256  # funds committed to closed-epoch grants, unclaimed

    # ---- appeals ------------------------------------------------------------
    appeals: TreeMap[str, str]  # appeal id (a-<n>) -> JSON appeal record
    appeal_ids: DynArray[str]
    appeal_count: u256

    # ---- audit log ------------------------------------------------------------
    audit_log: DynArray[str]  # JSON entries, append-only
    audit_count: u256

    # ---- aggregate stats -------------------------------------------------------
    stats: TreeMap[str, u256]

    # =======================================================================
    # Construction
    # =======================================================================

    def __init__(self, platform_name: str, min_eligible_score: int):
        """Deploy the platform.

        platform_name       display name recorded in config
        min_eligible_score  0..100 gate below which contributions are not
                            funded (default recommendation: 40)
        """
        self.owner = gl.message.sender_address
        self.paused = False
        self.curator_count = u256(0)
        self.developer_count = u256(0)
        self.contribution_count = u256(0)
        self.epoch_count = u256(0)
        self.grant_count = u256(0)
        self.appeal_count = u256(0)
        self.audit_count = u256(0)
        self.total_granted_atto = u256(0)
        self.treasury_atto = u256(0)
        self.reserved_atto = u256(0)
        self.current_epoch = ""

        gate = min_eligible_score
        if gate < 0 or gate > TOTAL_MAX:
            gate = 40
        self.config["platform_name"] = (platform_name or "ImpactDNA")[:80]
        self.config["min_eligible_score"] = str(gate)
        self.config["version"] = "1.0.0"
        self.config["max_contributions_per_dev"] = str(MAX_CONTRIBUTIONS_PER_DEV)

        # deployer is the first curator
        self.curators[self.owner.as_hex] = True
        self.curator_count = u256(1)

        self._audit("deploy", self.owner.as_hex, {"platform": self.config["platform_name"]})

    # =======================================================================
    # Internal utilities
    # =======================================================================

    def _sender_hex(self) -> str:
        return gl.message.sender_address.as_hex

    def _require_not_paused(self) -> None:
        if self.paused:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract is paused")

    def _require_owner(self) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the owner may call this")

    def _require_curator(self) -> None:
        if not self.curators.get(self._sender_hex(), False):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only a curator may call this")

    def _audit(self, action: str, actor: str, payload: dict) -> None:
        entry = {
            "seq": int(self.audit_count),
            "action": action,
            "actor": actor,
            "data": payload,
        }
        self.audit_log.append(json.dumps(entry, sort_keys=True))
        self.audit_count = u256(int(self.audit_count) + 1)

    def _bump_stat(self, key: str, amount: int = 1) -> None:
        self.stats[key] = u256(int(self.stats.get(key, u256(0))) + amount)

    def _load(self, table: str, record_id: str) -> dict:
        """Load a JSON record from one of the entity maps."""
        maps = {
            "developer": self.developers,
            "contribution": self.contributions,
            "epoch": self.epochs,
            "grant": self.grants,
            "appeal": self.appeals,
        }
        m = maps[table]
        raw = m.get(record_id, "")
        if not raw:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown {table}: {record_id}")
        return json.loads(raw)

    def _save(self, table: str, record_id: str, record: dict) -> None:
        maps = {
            "developer": self.developers,
            "contribution": self.contributions,
            "epoch": self.epochs,
            "grant": self.grants,
            "appeal": self.appeals,
        }
        maps[table][record_id] = json.dumps(record, sort_keys=True)

    def _min_eligible_score(self) -> int:
        return _clamp_int(self.config.get("min_eligible_score", "40"), 0, TOTAL_MAX)

    # =======================================================================
    # Nondeterministic primitives
    # =======================================================================

    def _fetch_github_json(self, path: str) -> dict:
        """Fetch a GitHub REST endpoint inside the *current* nondet
        context and return parsed JSON. Raises classified errors."""
        url = f"{GITHUB_API}{path}"
        res = gl.nondet.web.get(url, headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "ImpactDNA-IntelligentContract",
        })
        status = int(res.status)
        if status == 404:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} GitHub 404 for {path}")
        if status in (403, 429):
            # Rate limiting is time-dependent -> transient, both
            # validators hitting it should agree instead of rotating.
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} GitHub rate limited on {path}")
        if 400 <= status < 500:
            raise gl.vm.UserError(f"{ERROR_EXTERNAL} GitHub {status} for {path}")
        if status >= 500:
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} GitHub {status} for {path}")
        try:
            body = json.loads(res.body.decode("utf-8"))
        except Exception:
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} GitHub returned non-JSON body")
        if not isinstance(body, dict):
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} GitHub returned unexpected JSON shape")
        return body

    def _strict_repo_snapshot(self, repo_full_name: str) -> dict:
        """Deterministic, consensus-safe repository snapshot: fetch the
        repo, project onto stable fields, and agree via strict equality.
        Also returns coarse popularity buckets (excluded from strict
        comparison would be ideal, but order-of-magnitude buckets are
        stable enough over the seconds between leader and validators)."""

        def fetch():
            data = self._fetch_github_json(f"/repos/{repo_full_name}")
            stable = _stable_repo_projection(data)
            stable["stars_bucket"] = _coarse_metric(int(data.get("stargazers_count", 0)))
            stable["forks_bucket"] = _coarse_metric(int(data.get("forks_count", 0)))
            return json.loads(json.dumps(stable, sort_keys=True))

        return gl.eq_principle.strict_eq(fetch)

    # =======================================================================
    # Governance (write)
    # =======================================================================

    @gl.public.write
    def transfer_ownership(self, new_owner: str) -> None:
        """Transfer contract ownership to another address."""
        self._require_owner()
        addr = Address(new_owner)
        self.owner = addr
        self.curators[addr.as_hex] = True
        self._audit("transfer_ownership", self._sender_hex(), {"new_owner": addr.as_hex})

    @gl.public.write
    def add_curator(self, curator: str) -> None:
        """Grant curator role (may open/close epochs, resolve appeals)."""
        self._require_owner()
        addr = Address(curator)
        if not self.curators.get(addr.as_hex, False):
            self.curators[addr.as_hex] = True
            self.curator_count = u256(int(self.curator_count) + 1)
        self._audit("add_curator", self._sender_hex(), {"curator": addr.as_hex})

    @gl.public.write
    def remove_curator(self, curator: str) -> None:
        """Revoke curator role. The owner always retains curator power."""
        self._require_owner()
        addr = Address(curator)
        if addr == self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Cannot remove the owner as curator")
        if self.curators.get(addr.as_hex, False):
            self.curators[addr.as_hex] = False
            self.curator_count = u256(max(0, int(self.curator_count) - 1))
        self._audit("remove_curator", self._sender_hex(), {"curator": addr.as_hex})

    @gl.public.write
    def set_pause(self, paused: bool) -> None:
        """Emergency stop for all state-changing user operations."""
        self._require_owner()
        self.paused = bool(paused)
        self._audit("set_pause", self._sender_hex(), {"paused": bool(paused)})

    @gl.public.write
    def set_min_eligible_score(self, score: int) -> None:
        """Adjust the funding-eligibility gate (0..100)."""
        self._require_owner()
        if score < 0 or score > TOTAL_MAX:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Score gate must be 0..100")
        self.config["min_eligible_score"] = str(score)
        self._audit("set_min_eligible_score", self._sender_hex(), {"score": score})

    @gl.public.write.payable
    def deposit_to_treasury(self) -> None:
        """Deposit real GEN into the contract's own custody.

        The amount is read from gl.message.value — the authoritative
        record of what was actually sent — never from a caller-supplied
        parameter. The contract itself now holds the funds; payouts are
        sent directly from here via _send_gen (see claim_grant), not by
        an off-chain treasury wallet."""
        self._require_curator()
        amount = gl.message.value
        if amount <= u256(0):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Deposit must be funded with GEN value")
        self.treasury_atto = u256(int(self.treasury_atto) + int(amount))
        self._bump_stat("treasury_deposits")
        self._audit("deposit_to_treasury", self._sender_hex(), {"atto": str(amount)})

    # =======================================================================
    # Developer registry (write)
    # =======================================================================

    @gl.public.write
    def register_developer(self, github_username: str, display_name: str) -> str:
        """Register the calling wallet as a developer bound to a GitHub
        username. Identity is unverified until verify_developer() checks
        real GitHub evidence."""
        self._require_not_paused()
        username = _validate_username(github_username)
        sender = self._sender_hex()

        if self.developers.get(username, ""):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Username already registered")
        if self.developer_by_address.get(sender, ""):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Wallet already has a developer profile")

        record = {
            "github_username": username,
            "display_name": (display_name or username)[:80],
            "wallet": sender,
            "verified": False,
            "github_id": 0,
            "github_created_at": "",
            "total_score": 0,
            "funded_count": 0,
            "total_granted_atto": "0",
            "registered_seq": int(self.audit_count),
        }
        self._save("developer", username, record)
        self.developer_by_address[sender] = username
        self.developer_usernames.append(username)
        self.developer_count = u256(int(self.developer_count) + 1)
        self.contributions_per_dev[username] = u256(0)
        self._bump_stat("developers_registered")
        self._audit("register_developer", sender, {"username": username})
        return username

    @gl.public.write
    def verify_developer(self, github_username: str) -> dict:
        """Verify that the registered GitHub account actually exists by
        fetching it from the GitHub API inside consensus. Validators
        independently re-fetch — real evidence, not user-submitted text.

        The stable projection (id, login, type, created_at) is agreed
        via strict equality; those fields do not drift between the
        leader call and validator calls."""
        self._require_not_paused()
        username = _validate_username(github_username)
        record = self._load("developer", username)
        if record["verified"]:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Developer already verified")
        caller = self._sender_hex()
        if record["wallet"] != caller and not self.curators.get(caller, False):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Only the profile owner or a curator may verify"
            )

        def fetch_user():
            data = self._fetch_github_json(f"/users/{username}")
            return json.loads(json.dumps(_stable_user_projection(data), sort_keys=True))

        user = gl.eq_principle.strict_eq(fetch_user)

        if user["login"] != username:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} GitHub login mismatch")
        if user["type"] not in ("User", "Organization"):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unsupported GitHub account type")

        record["verified"] = True
        record["github_id"] = int(user["id"])
        record["github_created_at"] = user["created_at"]
        self._save("developer", username, record)
        self._bump_stat("developers_verified")
        self._audit("verify_developer", caller, {"username": username, "github_id": user["id"]})
        return {"username": username, "verified": True, "github_id": int(user["id"])}

    # =======================================================================
    # Contribution submission (write)
    # =======================================================================

    @gl.public.write
    def submit_contribution(
        self, repo_full_name: str, category: str, description: str
    ) -> str:
        """Submit an already-shipped open-source repository for
        retroactive impact evaluation. The caller must be a verified
        developer, and the repository owner must match their verified
        GitHub identity (checked against live GitHub data at
        evaluation time)."""
        self._require_not_paused()
        repo = _validate_repo_name(repo_full_name)
        repo_key = repo.lower()

        if category not in VALID_CATEGORIES:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Category must be one of: {', '.join(VALID_CATEGORIES)}"
            )
        desc = (description or "").strip()
        if len(desc) < 20:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Description must be at least 20 characters"
            )
        if len(desc) > MAX_DESCRIPTION_LEN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Description too long")

        sender = self._sender_hex()
        username = self.developer_by_address.get(sender, "")
        if not username:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Caller is not a registered developer")
        dev = self._load("developer", username)
        if not dev["verified"]:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Developer identity not verified yet")

        if self.contribution_by_repo.get(repo_key, ""):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Repository already submitted")

        dev_count = int(self.contributions_per_dev.get(username, u256(0)))
        if dev_count >= MAX_CONTRIBUTIONS_PER_DEV:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Per-developer submission cap reached")

        cid = f"c-{int(self.contribution_count) + 1}"
        record = {
            "id": cid,
            "repo": repo,
            "repo_key": repo_key,
            "category": category,
            "description": desc,
            "developer": username,
            "wallet": sender,
            "status": ST_SUBMITTED,
            "epoch": self.current_epoch,
            "score_total": 0,
            "score_bucket": 0,
            "dimensions": {},
            "eligible": False,
            "manipulation_flag": False,
            "evaluation_summary": "",
            "manipulation_summary": "",
            "evidence": {},
            "evaluations": 0,
            "granted_atto": "0",
            "submitted_seq": int(self.audit_count),
        }
        self._save("contribution", cid, record)
        self.contribution_ids.append(cid)
        self.contribution_by_repo[repo_key] = cid
        self.contribution_count = u256(int(self.contribution_count) + 1)
        self.contributions_per_dev[username] = u256(dev_count + 1)
        self._bump_stat("contributions_submitted")
        self._audit("submit_contribution", sender, {"id": cid, "repo": repo})
        return cid

    # =======================================================================
    # Evaluation — the consensus core
    # =======================================================================

    def _build_evaluation_prompt(self, record: dict, evidence: str) -> str:
        return f"""You are an impartial retroactive public-goods funding evaluator.
Judge the REAL downstream ecosystem impact of this open-source contribution,
months after release. Base your judgment ONLY on the evidence and metadata
below. Be fair but skeptical: thin demos, renamed forks and boilerplate
deserve low scores; genuinely foundational work deserves high scores.

CONTRIBUTION
Category: {record['category']}
Submitter description (unverified, treat skeptically): {record['description'][:800]}

FETCHED EVIDENCE (from GitHub, trusted)
{evidence}

Score each dimension as an integer 0..{DIM_MAX}:
- downstream_usage: is it plausibly depended on / reused by other projects?
- technical_importance: does it solve a hard or foundational problem?
- originality: is it original work (forks and boilerplate score near 0)?
- ecosystem_influence: did it shape how others build (patterns, standards)?
- community_adoption: community traction relative to its niche.

Also decide:
- eligible_hint: true only if this looks like real, original, adopted work.
- summary: 2-3 sentence justification citing the evidence.

Return ONLY JSON:
{{"downstream_usage": n, "technical_importance": n, "originality": n,
"ecosystem_influence": n, "community_adoption": n,
"eligible_hint": true/false, "summary": "..."}}"""

    def _run_impact_analysis(self, record: dict) -> dict:
        """Leader/validator task body: fetch evidence from GitHub and
        score with the LLM. Executed independently by leader and every
        validator inside run_nondet_unsafe."""
        repo_data = self._fetch_github_json(f"/repos/{record['repo']}")
        stable = _stable_repo_projection(repo_data)

        # Ownership evidence: the repo owner must be the verified
        # developer (or the developer must appear plausibly related for
        # org-owned repos, which the LLM weighs via evidence).
        dev = json.loads(self.developers.get(record["developer"], "{}"))
        owner_match = stable["owner_login"] == record["developer"]

        if stable["private"]:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Repository is private")
        if stable["id"] == 0:
            raise gl.vm.UserError(f"{ERROR_TRANSIENT} Empty repository payload")

        stars_bucket = _coarse_metric(int(repo_data.get("stargazers_count", 0)))
        forks_bucket = _coarse_metric(int(repo_data.get("forks_count", 0)))
        evidence = _evidence_digest(stable, stars_bucket, forks_bucket)
        evidence += f"\nRepository owner matches verified submitter: {owner_match}"
        evidence += (
            f"\nSubmitter GitHub account created: {dev.get('github_created_at', 'unknown')}"
        )

        raw = gl.nondet.exec_prompt(
            self._build_evaluation_prompt(record, evidence), response_format="json"
        )
        payload = raw if isinstance(raw, dict) else _extract_json_object(str(raw))

        dims = {}
        total = 0
        for key in DIMENSIONS:
            v = _get_scored_dimension(payload, key)
            dims[key] = v
            total += v

        # Deterministic hard gates layered over LLM judgment: a fork
        # can never score originality, and non-owned repos are capped.
        if stable["fork"]:
            dims["originality"] = 0
            total = min(total, 30)
        if not owner_match:
            total = min(total, self._min_eligible_score() - 1 if self._min_eligible_score() > 0 else 0)

        eligible = total >= self._min_eligible_score() and not stable["fork"] and owner_match

        return {
            "dims": dims,
            "total": int(total),
            "bucket": _bucket(int(total)),
            "eligible": bool(eligible),
            "fork": bool(stable["fork"]),
            "owner_match": bool(owner_match),
            "summary": _text_field(payload, "summary"),
            "evidence": {
                "repo_id": stable["id"],
                "language": stable["language"],
                "license": stable["license"],
                "created_at": stable["created_at"],
                "stars_bucket": stars_bucket,
                "forks_bucket": forks_bucket,
            },
        }

    @gl.public.write
    def evaluate_contribution(self, contribution_id: str) -> dict:
        """Evaluate a submitted contribution.

        Consensus: the leader fetches GitHub evidence and scores impact
        with the LLM; every validator independently re-fetches and
        re-scores, then compares the substantive decision fields:

          * hard gates (fork, ownership, eligibility) must MATCH,
          * total score must land in the same or an adjacent bucket.

        Format-only checks are never used. Tolerances are generous so
        honest validators converge (no needless rotation), while a
        leader who lies about the gates is always caught."""
        self._require_not_paused()
        record = self._load("contribution", contribution_id)
        if record["status"] not in (ST_SUBMITTED, ST_APPEALED):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Contribution not evaluable in status {record['status']}"
            )
        caller = self._sender_hex()
        if record["wallet"] != caller and not self.curators.get(caller, False):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Only the submitter or a curator may trigger evaluation"
            )

        def leader_fn():
            return self._run_impact_analysis(record)

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _leader_error_agreement(leaders_res, leader_fn)

            leader = leaders_res.calldata
            if not isinstance(leader, dict):
                return False

            try:
                mine = leader_fn()
            except gl.vm.UserError as exc:
                msg = getattr(exc, "message", None) or str(exc)
                # Leader succeeded but validator hit a transient issue:
                # accept the leader rather than rotating pointlessly.
                return msg.startswith(ERROR_TRANSIENT)
            except Exception:
                return False

            # Hard gates must match exactly — these are what a
            # dishonest leader would falsify.
            for gate in ("fork", "owner_match", "eligible"):
                if bool(leader.get(gate)) != bool(mine.get(gate)):
                    # Eligibility near the threshold can honestly flip
                    # when the score straddles the gate; tolerate only
                    # that narrow case.
                    if gate == "eligible":
                        gap = abs(int(leader.get("total", 0)) - self._min_eligible_score())
                        if gap <= 8 and _buckets_agree(
                            int(leader.get("bucket", -9)), int(mine["bucket"])
                        ):
                            continue
                    return False

            # Score agreement: same or adjacent bucket.
            if not _buckets_agree(int(leader.get("bucket", -9)), int(mine["bucket"])):
                return False

            # Evidence sanity: repo identity cannot differ.
            l_ev = leader.get("evidence", {})
            if int(l_ev.get("repo_id", -1)) != int(mine["evidence"]["repo_id"]):
                return False

            return True

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        _validate_score_consistency(result["dims"], result["total"], result["bucket"])

        record["status"] = ST_EVALUATED if result["eligible"] else ST_REJECTED
        record["score_total"] = int(result["total"])
        record["score_bucket"] = int(result["bucket"])
        record["dimensions"] = result["dims"]
        record["eligible"] = bool(result["eligible"])
        record["evaluation_summary"] = result["summary"]
        record["evidence"] = result["evidence"]
        record["evaluations"] = int(record.get("evaluations", 0)) + 1
        record["epoch"] = self.current_epoch
        self._save("contribution", contribution_id, record)

        dev = self._load("developer", record["developer"])
        dev["total_score"] = int(dev.get("total_score", 0)) + int(result["total"])
        self._save("developer", record["developer"], dev)

        self._bump_stat("evaluations_completed")
        if result["eligible"]:
            self._bump_stat("contributions_eligible")
        self._audit(
            "evaluate_contribution",
            caller,
            {"id": contribution_id, "total": int(result["total"]), "eligible": bool(result["eligible"])},
        )
        return {
            "id": contribution_id,
            "total": int(result["total"]),
            "bucket": int(result["bucket"]),
            "eligible": bool(result["eligible"]),
            "dimensions": result["dims"],
            "summary": result["summary"],
        }

    # =======================================================================
    # Manipulation / fraud detection
    # =======================================================================

    def _run_manipulation_analysis(self, record: dict) -> dict:
        repo_data = self._fetch_github_json(f"/repos/{record['repo']}")
        stable = _stable_repo_projection(repo_data)
        stars_bucket = _coarse_metric(int(repo_data.get("stargazers_count", 0)))
        forks_bucket = _coarse_metric(int(repo_data.get("forks_count", 0)))
        issues_bucket = _coarse_metric(int(repo_data.get("open_issues_count", 0)))

        evidence = _evidence_digest(stable, stars_bucket, forks_bucket)
        evidence += f"\nOpen issues (order of magnitude): {issues_bucket}"

        prompt = f"""You are a fraud analyst for a retroactive funding platform.
Assess whether this repository shows signs of MANIPULATION intended to game
impact scoring. Signals include: renamed fork passed off as original,
boilerplate/template with trivial changes, popularity metrics wildly
inconsistent with activity (star farming), archived or abandoned shells.
Absence of popularity is NOT fraud — small honest projects are fine.

EVIDENCE (fetched from GitHub, trusted)
{evidence}

Submitter description (unverified): {record['description'][:600]}

Return ONLY JSON:
{{"manipulative": true/false, "risk": "low"/"medium"/"high",
"summary": "1-2 sentences citing evidence"}}"""

        raw = gl.nondet.exec_prompt(prompt, response_format="json")
        payload = raw if isinstance(raw, dict) else _extract_json_object(str(raw))

        manipulative = _bool_field(payload, "manipulative", False)
        risk = str(payload.get("risk", "low")).strip().lower()
        if risk not in ("low", "medium", "high"):
            risk = "medium" if manipulative else "low"
        # Deterministic overlay: forks are always at least medium risk.
        if stable["fork"] and risk == "low":
            risk = "medium"

        return {
            "manipulative": bool(manipulative),
            "risk": risk,
            "fork": bool(stable["fork"]),
            "repo_id": int(stable["id"]),
            "summary": _text_field(payload, "summary", 600),
        }

    @gl.public.write
    def detect_manipulation(self, contribution_id: str) -> dict:
        """Curator-triggered fraud screen. Validators independently
        re-run the analysis; agreement is on the manipulative flag with
        a tolerance corridor on the risk level (adjacent risk levels
        agree, low vs high does not)."""
        self._require_not_paused()
        self._require_curator()
        record = self._load("contribution", contribution_id)
        if record["status"] in (ST_FUNDED,):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Funded contributions are immutable")

        risk_order = {"low": 0, "medium": 1, "high": 2}

        def leader_fn():
            return self._run_manipulation_analysis(record)

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _leader_error_agreement(leaders_res, leader_fn)
            leader = leaders_res.calldata
            if not isinstance(leader, dict):
                return False
            try:
                mine = leader_fn()
            except gl.vm.UserError as exc:
                msg = getattr(exc, "message", None) or str(exc)
                return msg.startswith(ERROR_TRANSIENT)
            except Exception:
                return False

            if int(leader.get("repo_id", -1)) != int(mine["repo_id"]):
                return False
            if bool(leader.get("fork")) != bool(mine["fork"]):
                return False

            l_risk = risk_order.get(str(leader.get("risk", "")), -5)
            m_risk = risk_order.get(mine["risk"], -5)
            if abs(l_risk - m_risk) > 1:
                return False

            # The manipulative verdict itself: must match unless both
            # sit in the ambiguous medium-risk band.
            if bool(leader.get("manipulative")) != bool(mine["manipulative"]):
                if l_risk == 1 and m_risk == 1:
                    return True
                return False
            return True

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        record["manipulation_flag"] = bool(result["manipulative"])
        record["manipulation_summary"] = result["summary"]
        if result["manipulative"]:
            record["status"] = ST_FLAGGED
            record["eligible"] = False
            self._bump_stat("contributions_flagged")
        self._save("contribution", contribution_id, record)
        self._audit(
            "detect_manipulation",
            self._sender_hex(),
            {"id": contribution_id, "manipulative": bool(result["manipulative"]), "risk": result["risk"]},
        )
        return {
            "id": contribution_id,
            "manipulative": bool(result["manipulative"]),
            "risk": result["risk"],
            "summary": result["summary"],
        }

    # =======================================================================
    # Epochs & retroactive funding (deterministic settlement)
    # =======================================================================

    @gl.public.write
    def open_epoch(self, pool_atto: int, label: str) -> str:
        """Open a funding epoch backed by the treasury. Contributions
        evaluated while the epoch is open compete for its pool."""
        self._require_not_paused()
        self._require_curator()
        if self.current_epoch:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} An epoch is already open")
        if pool_atto <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Pool must be positive")
        if pool_atto > int(self.treasury_atto):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Pool exceeds treasury balance")

        eid = f"e-{int(self.epoch_count) + 1}"
        record = {
            "id": eid,
            "label": (label or eid)[:80],
            "status": EPOCH_OPEN,
            "pool_atto": str(pool_atto),
            "allocated_atto": "0",
            "contribution_ids": [],
            "grant_ids": [],
            "opened_seq": int(self.audit_count),
            "closed_seq": 0,
        }
        self._save("epoch", eid, record)
        self.epoch_ids.append(eid)
        self.epoch_count = u256(int(self.epoch_count) + 1)
        self.current_epoch = eid
        self.treasury_atto = u256(int(self.treasury_atto) - pool_atto)
        self._audit("open_epoch", self._sender_hex(), {"id": eid, "pool_atto": pool_atto})
        return eid

    @gl.public.write
    def close_epoch(self) -> dict:
        """Close the open epoch and settle grants deterministically.

        Every eligible, unflagged contribution evaluated during the
        epoch receives pool * weight / total_weight, where weight is
        score^2 (quadratic emphasis on high impact). Pure integer math —
        no LLM, no web — so consensus is trivial for this step."""
        self._require_not_paused()
        self._require_curator()
        if not self.current_epoch:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No epoch is open")

        eid = self.current_epoch
        epoch = self._load("epoch", eid)
        pool = int(epoch["pool_atto"])

        # Collect eligible contributions attributed to this epoch.
        winners = []
        total_weight = 0
        scanned = 0
        for i in range(len(self.contribution_ids)):
            if scanned >= MAX_EPOCH_CONTRIBUTIONS:
                break
            cid = self.contribution_ids[i]
            c = json.loads(self.contributions[cid])
            if c.get("epoch") != eid:
                continue
            scanned += 1
            if c["status"] != ST_EVALUATED or not c["eligible"] or c["manipulation_flag"]:
                continue
            _validate_score_consistency(c["dimensions"], c["score_total"], c["score_bucket"])
            w = _weight_for_score(int(c["score_total"]))
            if w <= 0:
                continue
            winners.append((cid, w))
            total_weight += w

        allocated = 0
        grant_summaries = []
        for cid, w in winners:
            amount = (pool * w) // total_weight if total_weight > 0 else 0
            if amount <= 0:
                continue
            gid = f"g-{int(self.grant_count) + 1}"
            c = json.loads(self.contributions[cid])
            grant = {
                "id": gid,
                "epoch": eid,
                "contribution": cid,
                "developer": c["developer"],
                "wallet": c["wallet"],
                "amount_atto": str(amount),
                "weight": w,
                "claimed": False,
                "created_seq": int(self.audit_count),
            }
            self._save("grant", gid, grant)
            self.grant_ids.append(gid)
            self.grant_count = u256(int(self.grant_count) + 1)
            allocated += amount

            c["status"] = ST_FUNDED
            c["granted_atto"] = str(amount)
            self.contributions[cid] = json.dumps(c, sort_keys=True)

            dev = self._load("developer", c["developer"])
            dev["funded_count"] = int(dev.get("funded_count", 0)) + 1
            dev["total_granted_atto"] = str(int(dev.get("total_granted_atto", "0")) + amount)
            self._save("developer", c["developer"], dev)

            epoch["grant_ids"].append(gid)
            grant_summaries.append({"grant": gid, "contribution": cid, "amount_atto": str(amount)})

        # Allocated funds move into the reserved bucket, walled off from
        # the general treasury so they stay claimable regardless of what
        # later epochs or deposits do to treasury_atto. Only the
        # unallocated remainder returns to available treasury.
        remainder = pool - allocated
        if allocated > 0:
            self.reserved_atto = u256(int(self.reserved_atto) + allocated)
        if remainder > 0:
            self.treasury_atto = u256(int(self.treasury_atto) + remainder)

        epoch["status"] = EPOCH_CLOSED
        epoch["allocated_atto"] = str(allocated)
        epoch["closed_seq"] = int(self.audit_count)
        self._save("epoch", eid, epoch)
        self.current_epoch = ""
        self.total_granted_atto = u256(int(self.total_granted_atto) + allocated)
        self._bump_stat("epochs_closed")
        self._audit(
            "close_epoch",
            self._sender_hex(),
            {"id": eid, "allocated_atto": allocated, "grants": len(grant_summaries)},
        )
        return {
            "epoch": eid,
            "allocated_atto": str(allocated),
            "returned_to_treasury_atto": str(remainder),
            "grants": grant_summaries,
        }

    @gl.public.write
    def claim_grant(self, grant_id: str) -> dict:
        """Claim a grant and pay it out in real GEN, directly from this
        contract's own custody — no off-chain treasury wallet involved.

        Checks-effects-interactions: the grant is marked claimed and the
        treasury ledger is debited and persisted BEFORE the transfer is
        attempted, so a second claim call (re-entrant or repeated) finds
        the grant already claimed and the balance it would draw from
        already reduced — double-spend is structurally impossible."""
        self._require_not_paused()
        grant = self._load("grant", grant_id)
        if grant["claimed"]:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Grant already claimed")
        if grant["wallet"] != self._sender_hex():
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the recipient may claim")
        amount = u256(int(grant["amount_atto"]))
        if amount <= u256(0):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No amount owed on this grant")
        if amount > self.reserved_atto:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract balance insufficient for claim")
        grant["claimed"] = True
        self.reserved_atto = u256(int(self.reserved_atto) - int(amount))
        self._save("grant", grant_id, grant)
        self._bump_stat("grants_claimed")
        self._audit("claim_grant", self._sender_hex(), {"id": grant_id, "atto": str(amount)})
        _send_gen(grant["wallet"], amount)
        return {"id": grant_id, "claimed": True, "amount_atto": grant["amount_atto"]}

    # =======================================================================
    # Appeals
    # =======================================================================

    @gl.public.write
    def request_appeal(self, contribution_id: str, reason: str) -> str:
        """A rejected or flagged submitter may appeal once per
        contribution; the contribution re-enters the evaluable state
        after a curator upholds the appeal."""
        self._require_not_paused()
        record = self._load("contribution", contribution_id)
        if record["wallet"] != self._sender_hex():
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the submitter may appeal")
        if record["status"] not in (ST_REJECTED, ST_FLAGGED):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Only rejected or flagged contributions can be appealed"
            )
        clean_reason = (reason or "").strip()
        if len(clean_reason) < 20 or len(clean_reason) > MAX_REASON_LEN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Appeal reason must be 20..1500 chars")

        for i in range(len(self.appeal_ids)):
            existing = json.loads(self.appeals[self.appeal_ids[i]])
            if existing["contribution"] == contribution_id:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} Contribution already appealed")

        aid = f"a-{int(self.appeal_count) + 1}"
        appeal = {
            "id": aid,
            "contribution": contribution_id,
            "appellant": self._sender_hex(),
            "reason": clean_reason,
            "status": APPEAL_OPEN,
            "verdict_summary": "",
            "created_seq": int(self.audit_count),
        }
        self._save("appeal", aid, appeal)
        self.appeal_ids.append(aid)
        self.appeal_count = u256(int(self.appeal_count) + 1)
        self._bump_stat("appeals_opened")
        self._audit("request_appeal", self._sender_hex(), {"id": aid, "contribution": contribution_id})
        return aid

    @gl.public.write
    def resolve_appeal(self, appeal_id: str) -> dict:
        """Curator-triggered appeal resolution: validators independently
        judge whether the appeal has merit, given the original evidence,
        the recorded verdict, and the appellant's reason. Agreement is
        comparative on the uphold/deny decision."""
        self._require_not_paused()
        self._require_curator()
        appeal = self._load("appeal", appeal_id)
        if appeal["status"] != APPEAL_OPEN:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Appeal is not open")
        record = self._load("contribution", appeal["contribution"])

        def leader_fn():
            repo_data = self._fetch_github_json(f"/repos/{record['repo']}")
            stable = _stable_repo_projection(repo_data)
            evidence = _evidence_digest(
                stable,
                _coarse_metric(int(repo_data.get("stargazers_count", 0))),
                _coarse_metric(int(repo_data.get("forks_count", 0))),
            )
            prompt = f"""You are an appeals judge for a retroactive funding platform.

ORIGINAL DECISION
Status: {record['status']}
Score: {record['score_total']}/100
Evaluation summary: {record['evaluation_summary'][:500]}
Manipulation summary: {record['manipulation_summary'][:400]}

APPELLANT'S ARGUMENT (unverified)
{appeal['reason'][:1000]}

FRESH EVIDENCE (fetched from GitHub, trusted)
{evidence}

Uphold the appeal ONLY if the fresh evidence materially contradicts the
original decision. A well-argued complaint without contradicting evidence
is denied. Return ONLY JSON:
{{"uphold": true/false, "summary": "1-2 sentences citing evidence"}}"""
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            payload = raw if isinstance(raw, dict) else _extract_json_object(str(raw))
            return {
                "uphold": _bool_field(payload, "uphold", False),
                "repo_id": int(stable["id"]),
                "fork": bool(stable["fork"]),
                "summary": _text_field(payload, "summary", 500),
            }

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _leader_error_agreement(leaders_res, leader_fn)
            leader = leaders_res.calldata
            if not isinstance(leader, dict):
                return False
            try:
                mine = leader_fn()
            except gl.vm.UserError as exc:
                msg = getattr(exc, "message", None) or str(exc)
                return msg.startswith(ERROR_TRANSIENT)
            except Exception:
                return False
            if int(leader.get("repo_id", -1)) != int(mine["repo_id"]):
                return False
            if bool(leader.get("fork")) != bool(mine["fork"]):
                return False
            return bool(leader.get("uphold")) == bool(mine["uphold"])

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        if result["uphold"]:
            appeal["status"] = APPEAL_UPHELD
            record["status"] = ST_APPEALED
            record["manipulation_flag"] = False
            self._save("contribution", appeal["contribution"], record)
            self._bump_stat("appeals_upheld")
        else:
            appeal["status"] = APPEAL_DENIED
            self._bump_stat("appeals_denied")
        appeal["verdict_summary"] = result["summary"]
        self._save("appeal", appeal_id, appeal)
        self._audit(
            "resolve_appeal",
            self._sender_hex(),
            {"id": appeal_id, "uphold": bool(result["uphold"])},
        )
        return {"id": appeal_id, "uphold": bool(result["uphold"]), "summary": result["summary"]}

    # =======================================================================
    # Views
    # =======================================================================

    @gl.public.view
    def get_platform_info(self) -> dict:
        """Platform metadata, configuration, and headline stats."""
        return {
            "name": self.config.get("platform_name", "ImpactDNA"),
            "version": self.config.get("version", ""),
            "owner": self.owner.as_hex,
            "paused": self.paused,
            "curator_count": int(self.curator_count),
            "min_eligible_score": self._min_eligible_score(),
            "developer_count": int(self.developer_count),
            "contribution_count": int(self.contribution_count),
            "epoch_count": int(self.epoch_count),
            "grant_count": int(self.grant_count),
            "appeal_count": int(self.appeal_count),
            "current_epoch": self.current_epoch,
            "treasury_atto": str(int(self.treasury_atto)),
            "reserved_atto": str(int(self.reserved_atto)),
            "total_granted_atto": str(int(self.total_granted_atto)),
        }

    @gl.public.view
    def get_stats(self) -> dict:
        """Operational counters (submissions, evaluations, flags, ...)."""
        keys = (
            "developers_registered",
            "developers_verified",
            "contributions_submitted",
            "evaluations_completed",
            "contributions_eligible",
            "contributions_flagged",
            "epochs_closed",
            "grants_claimed",
            "appeals_opened",
            "appeals_upheld",
            "appeals_denied",
            "treasury_deposits",
        )
        return {k: int(self.stats.get(k, u256(0))) for k in keys}

    @gl.public.view
    def is_curator(self, address: str) -> bool:
        return bool(self.curators.get(Address(address).as_hex, False))

    @gl.public.view
    def get_developer(self, github_username: str) -> dict:
        raw = self.developers.get(_validate_username(github_username), "")
        if not raw:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown developer")
        return json.loads(raw)

    @gl.public.view
    def get_developer_by_wallet(self, wallet: str) -> dict:
        username = self.developer_by_address.get(Address(wallet).as_hex, "")
        if not username:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No developer for wallet")
        return json.loads(self.developers[username])

    @gl.public.view
    def list_developers(self, offset: int, limit: int) -> dict:
        total = len(self.developer_usernames)
        off = max(0, int(offset))
        lim = min(max(1, int(limit)), MAX_LIST_PAGE)
        out = []
        for i in range(off, min(off + lim, total)):
            out.append(json.loads(self.developers[self.developer_usernames[i]]))
        return {"total": total, "offset": off, "items": out}

    @gl.public.view
    def get_contribution(self, contribution_id: str) -> dict:
        raw = self.contributions.get(contribution_id, "")
        if not raw:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown contribution")
        return json.loads(raw)

    @gl.public.view
    def get_contribution_by_repo(self, repo_full_name: str) -> dict:
        cid = self.contribution_by_repo.get(_validate_repo_name(repo_full_name).lower(), "")
        if not cid:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Repository not submitted")
        return json.loads(self.contributions[cid])

    @gl.public.view
    def list_contributions(self, offset: int, limit: int, status_filter: str) -> dict:
        """Paged contribution listing; status_filter '' returns all."""
        total = len(self.contribution_ids)
        off = max(0, int(offset))
        lim = min(max(1, int(limit)), MAX_LIST_PAGE)
        out = []
        i = off
        while i < total and len(out) < lim:
            c = json.loads(self.contributions[self.contribution_ids[i]])
            if not status_filter or c["status"] == status_filter:
                out.append(c)
            i += 1
        return {"total": total, "offset": off, "next_offset": i, "items": out}

    @gl.public.view
    def get_leaderboard(self, limit: int) -> dict:
        """Top developers by cumulative impact score. Bounded scan —
        acceptable for view calls (executed off consensus-critical path)."""
        lim = min(max(1, int(limit)), MAX_LIST_PAGE)
        rows = []
        total = len(self.developer_usernames)
        for i in range(min(total, MAX_EPOCH_CONTRIBUTIONS)):
            d = json.loads(self.developers[self.developer_usernames[i]])
            rows.append(
                {
                    "username": d["github_username"],
                    "display_name": d["display_name"],
                    "verified": d["verified"],
                    "total_score": int(d.get("total_score", 0)),
                    "funded_count": int(d.get("funded_count", 0)),
                    "total_granted_atto": d.get("total_granted_atto", "0"),
                }
            )
        rows.sort(key=lambda r: (-r["total_score"], r["username"]))
        return {"items": rows[:lim]}

    @gl.public.view
    def get_epoch(self, epoch_id: str) -> dict:
        raw = self.epochs.get(epoch_id, "")
        if not raw:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown epoch")
        return json.loads(raw)

    @gl.public.view
    def list_epochs(self) -> dict:
        out = []
        for i in range(len(self.epoch_ids)):
            out.append(json.loads(self.epochs[self.epoch_ids[i]]))
        return {"items": out, "current": self.current_epoch}

    @gl.public.view
    def get_grant(self, grant_id: str) -> dict:
        raw = self.grants.get(grant_id, "")
        if not raw:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown grant")
        return json.loads(raw)

    @gl.public.view
    def list_grants(self, offset: int, limit: int) -> dict:
        total = len(self.grant_ids)
        off = max(0, int(offset))
        lim = min(max(1, int(limit)), MAX_LIST_PAGE)
        out = []
        for i in range(off, min(off + lim, total)):
            out.append(json.loads(self.grants[self.grant_ids[i]]))
        return {"total": total, "offset": off, "items": out}

    @gl.public.view
    def get_appeal(self, appeal_id: str) -> dict:
        raw = self.appeals.get(appeal_id, "")
        if not raw:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown appeal")
        return json.loads(raw)

    @gl.public.view
    def list_appeals(self) -> dict:
        out = []
        for i in range(len(self.appeal_ids)):
            out.append(json.loads(self.appeals[self.appeal_ids[i]]))
        return {"items": out}

    @gl.public.view
    def get_audit_log(self, offset: int, limit: int) -> dict:
        """Tamper-evident append-only audit trail."""
        total = len(self.audit_log)
        off = max(0, int(offset))
        lim = min(max(1, int(limit)), MAX_AUDIT_RETURN)
        out = []
        for i in range(off, min(off + lim, total)):
            out.append(json.loads(self.audit_log[i]))
        return {"total": total, "offset": off, "items": out}
