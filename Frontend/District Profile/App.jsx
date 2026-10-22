
import { useState } from "react";
import { districts } from "./districtData";
import { districtProfiles } from "./districtProfiles";
import DistrictMap from "./DistrictMap";
import "./App.css";

const amenityLabels = [
  ["supermarkets", "Supermarkets"],
  ["groceries", "Groceries"],
  ["restaurants", "Restaurants"],
  ["asianRestaurants", "Asian Restaurants"],
  ["cafes", "Cafes"],
  ["gyms", "Gyms"],
  ["parks", "Parks"],
  ["pharmacies", "Pharmacies"],
  ["hospitals", "Hospitals"],
  ["shoppingMalls", "Shopping Malls"],
];

// Merge profile data while preserving existing famous-place details.
const profileDistricts = districts.map((district) => {
  const data = districtProfiles[district.id];

  if (!data) return district;

  return {
    ...district,
    name: data.name || district.name,
    rent: {
      ...(district.rent && typeof district.rent === "object"
        ? district.rent
        : {}),
      ...(data.rent || {}),
    },
    transport: data.transport ?? district.transport,
    amenities: {
      ...(district.amenities || {}),
      ...(data.amenities || {}),
    },
    famousPlaces: data.famousPlaces?.length
  ? data.famousPlaces
  : (district.famousPlaces || []),
  };
});

const visibleDistricts = profileDistricts.filter((district) =>
  /^D([1-9]|10)$/.test(district.id)
);

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Data not available";
  }

  return value;
}

function formatRent(rent) {
  if (!rent) return "Data not available";

  if (typeof rent === "number") {
    return `€${rent.toLocaleString("en-IE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}/month`;
  }

  if (typeof rent === "object") {
    const details = [];

    if (rent.oneBed != null) {
      details.push(
        `1-bedroom: €${Number(rent.oneBed).toLocaleString("en-IE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}/month`
      );
    }

    if (rent.twoBed != null) {
      details.push(
        `2-bedroom: €${Number(rent.twoBed).toLocaleString("en-IE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}/month`
      );
    }

    return details.length
      ? details.join(" | ")
      : "Data not available";
  }

  return "Data not available";
}

function FamousPlaceCard({ place }) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <article className="place-card">
      {place.image && !imageFailed ? (
        <img
          className="place-image"
          src={place.image}
          alt={place.name}
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="place-image place-image-fallback">
          Photo unavailable
        </div>
      )}

      <div className="place-content">
        <h4>{place.name}</h4>
        {place.description && <p>{place.description}</p>}
        {place.imageCredit && <small>{place.imageCredit}</small>}
      </div>
    </article>
  );
}

export default function App() {
  const [selectedDistrictId, setSelectedDistrictId] = useState("D1");

  const selectedDistrict =
    visibleDistricts.find(
      (district) => district.id === selectedDistrictId
    ) ?? visibleDistricts[0];

  function handleMapSelection(districtId) {
    const district = visibleDistricts.find(
      (item) =>
        item.id.toUpperCase() === String(districtId).toUpperCase()
    );

    if (district) {
      setSelectedDistrictId(district.id);
    }
  }

  return (
    <main className="district-page">
      <header className="page-header">
        <p className="eyebrow">DUBLIN AREA GUIDE</p>
        <h1>Dublin District Profile</h1>
      </header>

      <section className="district-layout">
        <div className="map-card">
          <div className="section-heading">
            <div>
              <h2>Explore the map</h2>
              <p>Select a district to view its profile.</p>
            </div>

            <span className="map-badge">Interactive map</span>
          </div>

          <DistrictMap
            selectedDistrict={selectedDistrict.id}
            onSelectDistrict={handleMapSelection}
          />

          <div className="district-picker">
            <label htmlFor="district-select">
              Choose a district (D1–D10)
            </label>

            <select
              id="district-select"
              value={selectedDistrict.id}
              onChange={(event) =>
                setSelectedDistrictId(event.target.value)
              }
            >
              {visibleDistricts.map((district) => (
                <option key={district.id} value={district.id}>
                  {district.id} — {district.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="profile-card" key={selectedDistrict.id}>
          <div className="profile-heading">
            <div>
              <p className="eyebrow">DISTRICT PROFILE</p>
              <h2>{selectedDistrict.name}</h2>
            </div>

            <span className="district-pill">
              {selectedDistrict.id}
            </span>
          </div>

          <div className="profile-detail">
            <span>Average rent (RTB 2025)</span>
            <strong className="rent-value">
              {formatRent(selectedDistrict.rent)}
            </strong>
          </div>

          <section className="amenities-section">
            <h3>Available Amenities</h3>

            <div className="amenities-list">
              {amenityLabels.map(([key, label]) => (
                <div className="amenity-row" key={key}>
                  <span>{label}</span>
                  <strong>
                    {formatValue(selectedDistrict.amenities?.[key])}
                  </strong>
                </div>
              ))}
            </div>
          </section>

          <section className="famous-places-section">
            <div className="section-heading">
              <h3>Famous Places</h3>

              <span className="place-count">
                {selectedDistrict.famousPlaces?.length ?? 0} places
              </span>
            </div>

            {selectedDistrict.famousPlaces?.length > 0 ? (
              <div className="places-list">
                {selectedDistrict.famousPlaces.map((place) => (
                  <FamousPlaceCard
                    key={place.name}
                    place={place}
                  />
                ))}
              </div>
            ) : (
              <p>No famous places available for this district yet.</p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
