import numpy as np
import pandas as pd
import pytest

from app import config
from app.data import generate_synthetic, load_kaggle
from app.features import FEATURE_COLUMNS, build_frame, canonical_amenities, norm_furnishing


def test_amenity_aliases_normalised():
    assert canonical_amenities(["Car Parking", "ELEVATOR", "Swimming Pool", "unknown thing"]) == {"parking", "lift", "pool"}
    assert canonical_amenities(None) == set()


@pytest.mark.parametrize("raw,expected", [
    ("Semi-Furnished", "semi-furnished"), ("semi_furnished", "semi-furnished"),
    ("Unfurnished", "unfurnished"), ("FURNISHED", "furnished"), ("???", "unfurnished"),
])
def test_furnishing(raw, expected):
    assert norm_furnishing(raw) == expected


def test_build_frame_shape_and_values():
    df = build_frame([{"city": " Pune ", "area": "Baner", "size_sqft": 1000, "bhk": 2, "bathrooms": 2,
                       "furnishing": "furnished", "amenities": ["gym", "Parking"]}])
    assert list(df.columns) == FEATURE_COLUMNS
    r = df.iloc[0]
    assert r.city == "pune" and r.n_amenities == 2 and r.am_gym == 1 and r.am_pool == 0
    assert r.size_per_bhk == 500
    assert np.isclose(r.log_size, np.log(1000))


def test_synthetic_is_reproducible_and_sane():
    a, b = generate_synthetic(500, seed=1), generate_synthetic(500, seed=1)
    pd.testing.assert_frame_equal(a, b)
    assert (a.rent > 0).all() and a.size_sqft.between(200, 6000).all() and a.bhk.between(1, 5).all()
    assert a.city.nunique() == 8


def test_kaggle_loader_maps_columns_and_drops_outliers(tmp_path):
    rows = [{"Posted On": "2022-01-01", "BHK": 2, "Rent": 20000 + i * 100, "Size": 800 + i, "Floor": "1 out of 3",
             "Area Type": "Super Area", "Area Locality": "Bandra West", "City": "Mumbai",
             "Furnishing Status": "Semi-Furnished", "Tenant Preferred": "Family", "Bathroom": 2,
             "Point of Contact": "Contact Owner"} for i in range(300)]
    rows.append({**rows[0], "Rent": 9_999_999})  # absurd outlier
    p = tmp_path / "k.csv"
    pd.DataFrame(rows).to_csv(p, index=False)
    df = load_kaggle(p)
    assert 298 <= len(df) <= 300          # outlier removed; at most the top 0.5% trimmed
    assert df.rent.max() < 100000
    assert df.iloc[0].city == "mumbai" and df.iloc[0].area == "bandra west" and df.iloc[0].furnishing == "semi-furnished"


def test_kaggle_loader_rejects_wrong_schema(tmp_path):
    p = tmp_path / "bad.csv"
    pd.DataFrame({"foo": [1]}).to_csv(p, index=False)
    with pytest.raises(ValueError, match="missing columns"):
        load_kaggle(p)
