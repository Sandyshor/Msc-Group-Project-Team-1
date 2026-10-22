
const memoryCache = new Map();
const STORAGE_KEY = "dublin-place-photos-v1";

function readStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeStorage(cache) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Continue if browser storage is unavailable.
  }
}

const stored = readStorage();

export function placePhotoCredit(place, photo) {
  if (!photo) return "";
  if (place.image) return place.imageCredit || "";
  return "Photo: Wikipedia / Wikimedia Commons";
}

export async function getPlacePhoto(place) {
  if (!place) return null;

  if (place.image) {
    return {
      url: place.image,
      sourceUrl: place.sourceUrl,
    };
  }

  if (!place.wiki) return null;

  const key = place.wiki;

  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }

  if (key in stored) {
    const cached = Promise.resolve(stored[key]);
    memoryCache.set(key, cached);
    return cached;
  }

  const request = fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      key.replace(/ /g, "_")
    )}`
  )
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const url =
        data?.thumbnail?.source ||
        data?.originalimage?.source ||
        null;

      const result = url
        ? {
            url,
            sourceUrl: data?.content_urls?.desktop?.page ?? null,
          }
        : null;

      stored[key] = result;
      writeStorage(stored);

      return result;
    })
    .catch(() => null);

  memoryCache.set(key, request);
  return request;
}
