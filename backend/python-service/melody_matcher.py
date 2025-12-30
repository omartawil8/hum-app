# melody_matcher.py
import os
import json
import math
import tempfile
from typing import Dict, List, Any

import numpy as np
import librosa
import crepe
from flask import Flask, request, jsonify

# Try fast DTW C-extension; gracefully fall back to python
try:
    from dtaidistance import dtw
    _DTW_OK = True
except Exception:
    _DTW_OK = False

app = Flask(__name__)

# =========================
# TUNABLE KNOBS (safe defaults)
# =========================
CONFIDENCE_THRESHOLD_CREPE = 0.50   # keep more frames than 0.60
STEP_MS = 10
SR_TARGET = 16000
MAX_DURATION_S = 30

# Rebalance weights: emphasize pitch a bit more, curb CENS
W_PITCH   = 0.45
W_RHYTHM  = 0.15
W_TEMPO   = 0.10
W_CENS    = 0.30

VARIANT_SCORING_METHOD = "consensus"  # "consensus" or "simple"
VARIANT_GOOD_THRESHOLD = 0.80

# Decision logic
MIN_ABS_SCORE = 0.65
TOP2_MARGIN   = 0.02
SHOW_TOP_K    = 5

# Variant boosting safety rails
CENS_MIN_ADVANTAGE = 0.08   # variant set must beat base on CENS by ≥ this
MAX_VARIANT_BOOST  = 1.10   # hard cap on final boost multiplier
BOOST_NEED_MARGIN  = 0.02   # boosted score must beat base by this margin

# Pitch gate for the final winner (prevents CENS-only wins)
PITCH_GATE_TOP1 = 0.12

# =========================
# Utility helpers
# =========================
def hz_to_midi(f):
    return 69.0 + 12.0 * np.log2(f / 440.0)

def safe_nan_to_num(x):
    return np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)

def dtw_distance(a: np.ndarray, b: np.ndarray) -> float:
    if a.size == 0 or b.size == 0:
        return float("inf")
    if _DTW_OK:
        return float(dtw.distance(safe_nan_to_num(a), safe_nan_to_num(b)))
    # basic DTW fallback — OK for short sequences
    a = safe_nan_to_num(a)
    b = safe_nan_to_num(b)
    n, m = len(a), len(b)
    D = np.full((n + 1, m + 1), np.inf)
    D[0, 0] = 0.0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = abs(a[i - 1] - b[j - 1])
            D[i, j] = cost + min(D[i - 1, j], D[i, j - 1], D[i - 1, j - 1])
    return float(D[n, m])

def cosine_sim(A: np.ndarray, B: np.ndarray) -> float:
    # shape: (frames, dims) — average then cosine
    if A.size == 0 or B.size == 0:
        return 0.5
    a = safe_nan_to_num(A.mean(axis=0))
    b = safe_nan_to_num(B.mean(axis=0))
    na = np.linalg.norm(a) + 1e-10
    nb = np.linalg.norm(b) + 1e-10
    return float(np.dot(a, b) / (na * nb))

def beat_sync_matrix(M: np.ndarray, beats: np.ndarray) -> np.ndarray:
    if M.size == 0 or beats.size == 0:
        return M
    pooled = []
    for i in range(len(beats) - 1):
        s, e = beats[i], beats[i + 1]
        seg = M[:, s:e]
        if seg.size == 0:
            pooled.append(M[:, s:s+1].mean(axis=1))
        else:
            pooled.append(seg.mean(axis=1))
    if not pooled:
        return M
    return np.stack(pooled, axis=1)

def best_rotated_cens_cosine(A: np.ndarray, B: np.ndarray) -> float:
    """
    Key-invariant cosine similarity between two CENS matrices.
    Tries all 12 pitch-class rotations and returns the best cosine.
    A, B: (12, T)
    """
    if A.size == 0 or B.size == 0:
        return 0.5
    T = min(A.shape[1], B.shape[1])
    if T == 0:
        return 0.5
    A = A[:, :T]
    B = B[:, :T]
    a = A.mean(axis=1)
    b = B.mean(axis=1)
    a = a / (np.linalg.norm(a) + 1e-9)
    b = b / (np.linalg.norm(b) + 1e-9)
    best = -1.0
    for r in range(12):
        br = np.roll(b, r)
        best = max(best, float(np.dot(a, br)))
    return max(0.0, min(1.0, best))

# =========================
# Core class
# =========================
class MelodyMatcher:
    def __init__(self, db_path="song_database.json"):
        self.db_path = db_path
        self.song_database = self.load_database()
        print(f"Loaded {len(self.song_database)} songs from database")

    # ---------- DB ----------
    def load_database(self):
        if os.path.exists(self.db_path):
            with open(self.db_path, "r") as f:
                return json.load(f)
        return {}

    def save_database(self):
        with open(self.db_path, "w") as f:
            json.dump(self.song_database, f, indent=2)
        print(f"Database saved with {len(self.song_database)} songs")

    # ---------- Feature extraction ----------
    def extract_melody_features(self, audio_path: str, confidence_threshold: float = CONFIDENCE_THRESHOLD_CREPE) -> Dict[str, Any]:
        """
        Multi-feature extractor:
        - PITCH (CREPE) → MIDI notes → INTERVALS (relative)
        - RHYTHM: onsets → durations (+ normalized pattern)
        - TEMPO (librosa.beat)
        - HARMONY: CENS chroma (frame & beat-synced)
        """
        try:
            print(f"Extracting multi-features from {audio_path}...")
            y, sr = librosa.load(audio_path, sr=SR_TARGET, mono=True, duration=MAX_DURATION_S)

            # --- Pitch via CREPE (no HMM) ---
            time, freq, conf, _ = crepe.predict(y, sr, viterbi=False, step_size=STEP_MS)

            # keep confident frames
            mask = (conf >= confidence_threshold) & (freq > 0)
            freq_conf = freq.copy()
            freq_conf[~mask] = np.nan

            # MIDI notes & relative intervals
            notes = hz_to_midi(freq_conf)
            notes = notes[~np.isnan(notes)]

            # NEW: denoise notes to stabilize intervals
            if notes.size >= 3:
                # median-like smoothing via nn_filter on a 1xT "matrix"
                notes = librosa.decompose.nn_filter(
                    notes[None, :], aggregate=np.median, metric='l2', width=9
                )[0]
                # light moving average
                notes = np.convolve(notes, np.ones(5) / 5.0, mode='same')

            if notes.size >= 2:
                intervals = np.diff(notes)  # relative melody fingerprint
            else:
                intervals = np.array([], dtype=float)

            # --- Rhythm: onsets & durations ---
            hop = 512
            onset_frames = librosa.onset.onset_detect(y=y, sr=sr, backtrack=True, hop_length=hop)
            onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop)
            durations: np.ndarray = np.array([], dtype=float)
            if onset_times.size > 0:
                if onset_times.size > 1:
                    durations = np.diff(onset_times).astype(float)
                # final tail to end (avoid super long tail)
                tail = max(0.05, min((len(y) / sr) - onset_times[-1], 1.0))
                durations = np.append(durations, tail)
            durations = np.asarray(durations, dtype=float)

            # normalized rhythm (tempo-invariant pattern)
            if durations.size > 0:
                rp = durations / (durations.sum() + 1e-9)
            else:
                rp = np.array([], dtype=float)

            # --- Tempo & beat info ---
            tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop)
            beats = np.asarray(beats, dtype=int)

            # --- Harmony: CENS chroma (robust) ---
            cens = librosa.feature.chroma_cens(y=y, sr=sr)         # (12, frames)
            cens_bs = beat_sync_matrix(cens, beats)                # (12, beats-1) pooled

            features = {
                "pitch_midi": notes.tolist(),
                "intervals": intervals.tolist(),
                "durations": durations.tolist(),
                "rhythm_pattern": rp.tolist(),
                "tempo": float(tempo),
                "onset_count": int(onset_times.size),
                "cens": cens.astype(float).tolist(),
                "cens_beatsync": cens_bs.astype(float).tolist(),
            }

            tempo_val = float(np.asarray(tempo).squeeze())
            print(f"✅ Extracted: {len(notes)} notes, {len(durations)} durations, {tempo_val:.1f} BPM, CENS frames={cens.shape[1]}")
            return features

        except Exception as e:
            print(f"❌ Error extracting features: {e}")
            import traceback; traceback.print_exc()
            return None

    # ---------- Similarities ----------
    def _pitch_similarity(self, hum: Dict, song: Dict) -> float:
        a = np.asarray(hum.get("intervals", []), dtype=float)
        b = np.asarray(song.get("intervals", []), dtype=float)
        if a.size < 4 or b.size < 4:
            return 0.0
        dist = dtw_distance(a, b)
        norm = dist / max(len(a), len(b))
        return math.exp(-4.0 * norm)

    def _rhythm_similarity(self, hum: Dict, song: Dict) -> float:
        a = np.asarray(hum.get("rhythm_pattern", []), dtype=float)
        b = np.asarray(song.get("rhythm_pattern", []), dtype=float)
        if a.size < 2 or b.size < 2:
            return 0.5
        dist = dtw_distance(a, b)
        norm = dist / max(len(a), len(b))
        return math.exp(-3.0 * norm)

    def _tempo_similarity(self, hum: Dict, song: Dict) -> float:
        # octave-invariant tempo (½× / 1× / 2×)
        t1 = float(hum.get("tempo", 0.0))
        t2 = float(song.get("tempo", 0.0))
        if t1 <= 0 or t2 <= 0:
            return 0.5
        best = 1.0
        for k in (0.5, 1.0, 2.0):
            pct = abs(t1 - t2 * k) / ((t1 + t2 * k) / 2.0 + 1e-9)
            best = min(best, pct)
        return math.exp(-3.0 * best)

    def _cens_similarity(self, hum: Dict, song: Dict) -> float:
        # Get CENS and beat-synced CENS
        H = np.asarray(hum.get("cens", []), dtype=float)
        S = np.asarray(song.get("cens", []), dtype=float)
        Hb = np.asarray(hum.get("cens_beatsync", []), dtype=float)
        Sb = np.asarray(song.get("cens_beatsync", []), dtype=float)

        def as_2d(M):
            M = np.asarray(M, dtype=float)
            if M.ndim == 1:
                M = M.reshape(12, -1)
            return M

        H = as_2d(H); S = as_2d(S)
        Hb = as_2d(Hb); Sb = as_2d(Sb)

        # Global key-invariant cosine
        cos = best_rotated_cens_cosine(H, S)

        # Beat-synced per-beat cosine distance with rotation, then DTW
        def per_beat_rotated_cos_dist(A, B):
            T = min(A.shape[1], B.shape[1])
            if T == 0:
                return np.array([], dtype=float)
            d = []
            for i in range(T):
                a = A[:, i]; a = a / (np.linalg.norm(a) + 1e-9)
                b = B[:, i]; b = b / (np.linalg.norm(b) + 1e-9)
                best = -1.0
                for r in range(12):
                    br = np.roll(b, r)
                    best = max(best, float(np.dot(a, br)))
                d.append(1.0 - best)  # cosine distance
            return np.asarray(d, dtype=float)

        if Hb.size == 0 or Sb.size == 0:
            dtw_sim = 0.5
        else:
            per_beat_d = per_beat_rotated_cos_dist(Hb, Sb)
            if per_beat_d.size == 0:
                dtw_sim = 0.5
            else:
                dist = dtw_distance(per_beat_d, np.zeros_like(per_beat_d))
                norm = dist / (len(per_beat_d) + 1e-9)
                dtw_sim = math.exp(-4.0 * norm)

        # Blend global cosine with beat-synced DTW similarity
        return 0.5 * cos + 0.5 * dtw_sim

    def multi_feature_similarity(self, humF: Dict, songF: Dict) -> float:
        sp = self._pitch_similarity(humF, songF)
        sr = self._rhythm_similarity(humF, songF)
        st = self._tempo_similarity(humF, songF)
        sc = self._cens_similarity(humF, songF)

        score = W_PITCH * sp + W_RHYTHM * sr + W_TEMPO * st + W_CENS * sc
        print(f"      [Pitch:{sp:.2f} Rhythm:{sr:.2f} Tempo:{st:.2f} CENS:{sc:.2f}] → {score:.2f}")
        return float(score)

    # ---------- Variants ----------
    def _simple_average(self, sims: List[float]) -> float:
        if not sims:
            return 0.0
        avg = sum(sims) / len(sims)
        print(f"    Full average ({len(sims)} variants) - score: {avg:.3f}")
        return avg

    def _consensus(self, sims: List[float], threshold: float = VARIANT_GOOD_THRESHOLD) -> float:
        if not sims:
            return 0.0
        total = len(sims)
        good = [s for s in sims if s >= threshold]
        n_good = len(good)
        if total <= 2:
            min_req = 1
        elif total <= 5:
            min_req = 2
        else:
            min_req = max(2, int(total * 0.4))
        if n_good < min_req:
            avg = sum(sims) / total
            print(f"    Low consensus ({n_good}/{total}) - conservative score: {avg:.3f}")
            return avg
        strong = sum(good) / n_good
        print(f"    Strong consensus ({n_good}/{total}) - confident score: {strong:.3f}")
        return strong

    # ---------- Public API ----------
    def add_song(self, song_id: str, title: str, artist: str, audio_path: str) -> Dict[str, Any]:
        print(f"Adding song: {title} by {artist}")
        F = self.extract_melody_features(audio_path, confidence_threshold=CONFIDENCE_THRESHOLD_CREPE)
        if not F or len(F.get("pitch_midi", [])) < 10:
            return {"success": False, "error": "Could not extract features"}

        self.song_database[song_id] = {
            "title": title,
            "artist": artist,
            "features": F,
            "melody": F["pitch_midi"],  # backward-compatible
            "variants": []
        }
        self.save_database()
        return {"success": True, "song_id": song_id}

    def match_melody(self, humming_path: str, top_k: int = SHOW_TOP_K) -> Dict[str, Any]:
        humF = self.extract_melody_features(humming_path)
        if not humF or len(humF.get("pitch_midi", [])) < 5:
            return {"success": False, "message": "Recording too short or unclear", "matches": []}

        results = []
        for song_id, sd in self.song_database.items():
            if "features" not in sd and "melody" not in sd:
                continue

            songF = sd.get("features")
            if not songF:
                # very old format fallback
                songF = {
                    "pitch_midi": sd.get("melody", []),
                    "intervals": np.diff(sd.get("melody", [])).tolist() if len(sd.get("melody", [])) > 1 else [],
                    "durations": [],
                    "rhythm_pattern": [],
                    "tempo": 0.0,
                    "cens": [],
                    "cens_beatsync": [],
                }

            base = self.multi_feature_similarity(humF, songF)
            best = base
            mtype = "original"

            # ---------------- Variants (with CENS advantage gate, cap, diminishing returns, margin) ----------------
            v = sd.get("variants", [])
            if v:
                sims = []

                # base CENS once for gating
                sc_base = self._cens_similarity(humF, songF)

                # full multi-feature score for each variant
                for var in v:
                    vF = var if isinstance(var, dict) else {
                        "pitch_midi": var,
                        "intervals": np.diff(var).tolist() if len(var) > 1 else [],
                        "durations": [],
                        "rhythm_pattern": [],
                        "tempo": 0.0,
                        "cens": [],
                        "cens_beatsync": [],
                    }
                    sims.append(self.multi_feature_similarity(humF, vF))

                vscore = self._simple_average(sims) if VARIANT_SCORING_METHOD == "simple" else self._consensus(sims)

                # estimate CENS gain for the *set* of variants
                sc_variants = []
                for var in v:
                    vF = var if isinstance(var, dict) else {
                        "pitch_midi": var,
                        "intervals": np.diff(var).tolist() if len(var) > 1 else [],
                        "durations": [],
                        "rhythm_pattern": [],
                        "tempo": 0.0,
                        "cens": [],
                        "cens_beatsync": [],
                    }
                    sc_variants.append(self._cens_similarity(humF, vF))
                sc_var = sum(sc_variants) / max(1, len(sc_variants))
                cens_gain = sc_var - sc_base

                allow_boost = (vscore >= 0.80) and (cens_gain >= CENS_MIN_ADVANTAGE)

                if allow_boost:
                    # diminishing returns for many variants
                    raw_boost = 1.02 + 0.03 * np.tanh(len(sims) / 3.0)
                    boost = min(MAX_VARIANT_BOOST, float(raw_boost))
                    vboost = vscore * boost

                    # do not dethrone base unless there is a real margin
                    if vboost <= base + BOOST_NEED_MARGIN:
                        vboost = base

                    print(
                        f"  {sd.get('title')}: original={base:.3f}, variant={vscore:.3f} "
                        f"(CENS gain {cens_gain:+.3f}) (boost {boost:.3f} → {vboost:.3f}, {len(sims)} variants)"
                    )
                else:
                    vboost = vscore
                    why = []
                    if vscore < 0.80:
                        why.append("low vscore")
                    if cens_gain < CENS_MIN_ADVANTAGE:
                        why.append(f"insufficient CENS gain ({cens_gain:+.3f} < {CENS_MIN_ADVANTAGE})")
                    msg = "; ".join(why) if why else "no boost"
                    print(f"  {sd.get('title')}: original={base:.3f}, variant={vscore:.3f} ({msg})")

                if vboost > best:
                    best = vboost
                    mtype = "variants"
            # --------------------------------------------------------------------------------------------------------

            results.append({
                "song_id": song_id,
                "title": sd.get("title", "Unknown"),
                "artist": sd.get("artist", "Unknown"),
                "similarity": min(best, 1.0),
                "similarity_raw": best,
                "confidence": int(min(best, 1.0) * 100),
                "match_type": mtype,
                "variant_count": len(sd.get("variants", []))
            })

        # Sort by score; break near-ties via CENS first, then tempo proximity
        results.sort(key=lambda x: x["similarity_raw"], reverse=True)

        if len(results) >= 2 and (results[0]["similarity_raw"] - results[1]["similarity_raw"]) < 0.01:
            sid0, sid1 = results[0]["song_id"], results[1]["song_id"]
            s0 = self.song_database.get(sid0, {}).get("features")
            s1 = self.song_database.get(sid1, {}).get("features")
            if s0 and s1:
                # CENS tie-break
                c0 = self._cens_similarity(humF, s0)
                c1 = self._cens_similarity(humF, s1)
                swapped = False
                if c1 > c0 + 0.01:
                    results[0], results[1] = results[1], results[0]
                    swapped = True

                # Tempo tie-break (octave-invariant) if still very close
                if not swapped and (abs(results[0]["similarity_raw"] - results[1]["similarity_raw"]) < 0.005):
                    def tempo_cost(F):
                        t = float(F.get("tempo", 0.0))
                        ht = float(humF.get("tempo", 0.0))
                        if t <= 0 or ht <= 0:
                            return 1.0
                        best = 1.0
                        for k in (0.5, 1.0, 2.0):
                            pct = abs(ht - t * k) / ((ht + t * k) / 2.0 + 1e-9)
                            best = min(best, pct)
                        return best
                    tc0, tc1 = tempo_cost(s0), tempo_cost(s1)
                    if tc1 + 0.01 < tc0:
                        results[0], results[1] = results[1], results[0]

        # --- Top-1 pitch gate: require some pitch evidence for the winner ---
        if results:
            top_sid = results[0]["song_id"]
            top_feat = self.song_database[top_sid].get("features")
            if top_feat:
                sp_top = self._pitch_similarity(humF, top_feat)
                if sp_top < PITCH_GATE_TOP1:
                    # find the highest-ranked candidate that clears the pitch gate
                    for i in range(1, len(results)):
                        sid_i = results[i]["song_id"]
                        fi = self.song_database[sid_i].get("features")
                        if fi and self._pitch_similarity(humF, fi) >= PITCH_GATE_TOP1:
                            results[0], results[i] = results[i], results[0]
                            break

        # Confidence gating (for UX)
        if results:
            top1 = results[0]["similarity_raw"]
            top2 = results[1]["similarity_raw"] if len(results) > 1 else 0.0
            margin = top1 - top2
            confident = (top1 >= MIN_ABS_SCORE) and (margin >= TOP2_MARGIN)
            print(
                f"\n🎯 Top: {results[0]['title']} ({results[0]['confidence']}%) via {results[0]['match_type']} "
                f"| margin={margin:.3f} | confident={confident}"
            )
            if not confident:
                results[0]["note"] = "Low confidence — consider user confirm"

        return {"success": True, "matches": results[:top_k], "melody_length": len(humF.get("pitch_midi", []))}

# ---------- global instance ----------
matcher = MelodyMatcher()

# ---------- Flask endpoints ----------
@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "songs_in_db": len(matcher.song_database)})

@app.route('/identify', methods=['POST'])
def identify():
    if "audio" not in request.files:
        return jsonify({"success": False, "error": "No audio file"}), 400
    audio_file = request.files["audio"]
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name
    try:
        result = matcher.match_melody(tmp_path, top_k=SHOW_TOP_K)
        return jsonify(result)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.route('/add-song', methods=['POST'])
def add_song():
    if "audio" not in request.files:
        return jsonify({"success": False, "error": "No audio file"}), 400
    song_id = request.form.get("song_id")
    title = request.form.get("title")
    artist = request.form.get("artist")
    audio_file = request.files["audio"]
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name
    try:
        result = matcher.add_song(song_id, title, artist, tmp_path)
        return jsonify(result)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.route('/feedback', methods=['POST'])
def feedback():
    if "audio" not in request.files:
        return jsonify({"success": False, "error": "No audio file"}), 400
    sid = request.form.get("song_id")
    audio_file = request.files["audio"]
    print(f"📚 Learning from feedback: correct song is {sid}")
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name
    try:
        F = matcher.extract_melody_features(tmp_path)
        if not F:
            return jsonify({"success": False, "message": "Could not extract features"})
        if sid in matcher.song_database:
            matcher.song_database[sid].setdefault("variants", []).append(F)
            matcher.save_database()
            n = len(matcher.song_database[sid]["variants"])
            print(f"✅ Added variant #{n} for {matcher.song_database[sid]['title']}")
            return jsonify({"success": True, "message": "Feedback recorded", "variant_count": n})
        else:
            return jsonify({"success": False, "message": "Song not in database"})
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.route('/stats', methods=['GET'])
def stats():
    total_variants = sum(len(s.get("variants", [])) for s in matcher.song_database.values())
    return jsonify({
        "total_songs": len(matcher.song_database),
        "total_variants": total_variants,
        "avg_variants_per_song": (total_variants / len(matcher.song_database)) if matcher.song_database else 0.0
    })

@app.route('/migrate', methods=['POST'])
def migrate():
    needs = []
    for sid, sd in matcher.song_database.items():
        if "features" not in sd:
            needs.append(sid)
    return jsonify({
        "success": True,
        "migrated": 0,
        "needs_migration": needs,
        "message": "Re-add songs via /add-song to store multi-feature profiles"
    })

if __name__ == "__main__":
    print("🎵 Starting CREPE Melody Matcher v4 (Intervals + Rhythm + CENS)")
    print(f"📚 Songs in database: {len(matcher.song_database)}")
    totvar = sum(len(s.get("variants", [])) for s in matcher.song_database.values())
    if totvar:
        print(f"🧠 Total learned variants: {totvar}")
        for sid, sd in matcher.song_database.items():
            n = len(sd.get("variants", []))
            if n:
                print(f"   - {sd['title']}: {n} variants")
    print("🚀 Server starting on http://localhost:5001")
    app.run(host="0.0.0.0", port=5001, debug=True)
