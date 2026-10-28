# Optional real training data

To train on real rents instead of the built-in synthetic data, download the Kaggle
"House Rent Prediction Dataset" and save it here as `House_Rent_Dataset.csv`
(columns used: BHK, Rent, Size, Area Locality, City, Furnishing Status, Bathroom), then retrain:

    docker compose build ml-service && docker compose up -d ml-service
    # or, locally:  cd ml-service && python -m app.train

The admin overview shows which dataset the live model was trained on.
Note: this dataset has no amenity column, so amenities will not influence predictions when trained on it.
