from math import asin, cos, radians, sin, sqrt

CITY_CENTROIDS = {
    "bengaluru": (12.9716, 77.5946), "bangalore": (12.9716, 77.5946), "mumbai": (19.0760, 72.8777),
    "delhi": (28.6139, 77.2090), "new delhi": (28.6139, 77.2090), "hyderabad": (17.3850, 78.4867),
    "chennai": (13.0827, 80.2707), "kolkata": (22.5726, 88.3639), "pune": (18.5204, 73.8567),
    "ahmedabad": (23.0225, 72.5714), "jaipur": (26.9124, 75.7873), "lucknow": (26.8467, 80.9462),
    "surat": (21.1702, 72.8311), "kochi": (9.9312, 76.2673), "chandigarh": (30.7333, 76.7794),
    "indore": (22.7196, 75.8577), "gurgaon": (28.4595, 77.0266), "noida": (28.5355, 77.3910),
    "coimbatore": (11.0168, 76.9558), "nagpur": (21.1458, 79.0882), "bhopal": (23.2599, 77.4126),
}


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    a = sin((p2 - p1) / 2) ** 2 + cos(p1) * cos(p2) * sin(radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * asin(sqrt(a))
