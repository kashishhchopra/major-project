"""Train the RandomForest safety-score regressor and report R2/MAE."""
from __future__ import annotations

import json
import os

import joblib
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

from app.ml import registry
from app.ml.generate_data import generate_safety_data

FEATURES = ["zone_risk", "hour", "anomaly_score", "crime_index", "weather_risk"]


def train(models_dir: str = "ml_models") -> dict:
    os.makedirs(models_dir, exist_ok=True)
    df = generate_safety_data()
    X = df[FEATURES].values
    y = df["safety_score"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42
    )

    model = RandomForestRegressor(
        n_estimators=200, max_depth=12, random_state=42, n_jobs=-1
    )
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    r2 = r2_score(y_test, pred)
    mae = mean_absolute_error(y_test, pred)

    joblib.dump(model, os.path.join(models_dir, "safety_rf.joblib"))

    # A thinned predicted-vs-actual sample lets the dashboard show fit quality
    # instead of asking the reader to trust a single R2 number.
    sample = [
        {"actual": round(float(a), 2), "predicted": round(float(b), 2)}
        for a, b in zip(y_test[::10], pred[::10], strict=True)
    ]

    importances = dict(zip(FEATURES, [round(float(i), 4) for i in model.feature_importances_],
                          strict=True))
    metrics = {
        "model": "RandomForestRegressor",
        "task": "tourist safety score (0-100 regression)",
        "features": FEATURES,
        "n_train": len(X_train),
        "n_test": len(X_test),
        "r2": round(float(r2), 4),
        "mae": round(float(mae), 4),
        "feature_importances": importances,
        "predicted_vs_actual": sample,
    }
    version_record = registry.record_version(
        models_dir, "safety", registry.dataset_hash(df), metrics,
        active_files=["safety_rf.joblib"],
    )
    metrics["version"] = version_record["version"]

    print("=== RandomForest safety-score model ===")
    print(json.dumps(metrics, indent=2))
    return metrics


if __name__ == "__main__":
    train()
