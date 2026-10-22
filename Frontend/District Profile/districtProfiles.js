
export const districtProfiles = {
  D1: {
    name: "North Inner City",
    rent: { oneBed: 1682.83, twoBed: 2262.23 },
    transport: null,
    amenities: {
      supermarkets: 30,
      groceries: 49,
      restaurants: 124,
      asianRestaurants: 39,
      cafes: 114,
      gyms: 8,
      parks: 13,
      pharmacies: 19,
      hospitals: 3,
      shoppingMalls: 4,
    },
  },
  D2: {
    name: "South East Inner City",
    rent: { oneBed: 1796.44, twoBed: 2191.48 },
    transport: null,
    amenities: {
      supermarkets: 13,
      groceries: 48,
      restaurants: 292,
      asianRestaurants: 38,
      cafes: 202,
      gyms: 26,
      parks: 13,
      pharmacies: 14,
      hospitals: 3,
      shoppingMalls: 2,
    },
  },
  D3: {
    name: "Clontarf",
    rent: { oneBed: 1585.58, twoBed: 2133.86 },
    transport: null,
    amenities: {
      supermarkets: 11,
      groceries: 21,
      restaurants: 18,
      asianRestaurants: 4,
      cafes: 24,
      gyms: 18,
      parks: 37,
      pharmacies: 20,
      hospitals: 5,
      shoppingMalls: 0,
    },
  },
  D4: {
    name: "Dublin 4",
    rent: { oneBed: 1840.47, twoBed: 2460.53 },
    transport: null,
    amenities: {
      supermarkets: 9,
      groceries: 20,
      restaurants: 56,
      asianRestaurants: 13,
      cafes: 33,
      gyms: 14,
      parks: 12,
      pharmacies: 12,
      hospitals: 4,
      shoppingMalls: 1,
    },
  },
  D5: {
    name: "Dublin 5",
    rent: { oneBed: 1567.20, twoBed: 1996.00 },
    transport: null,
    amenities: {
      supermarkets: 9,
      groceries: 20,
      restaurants: 56,
      asianRestaurants: 13,
      cafes: 33,
      gyms: 14,
      parks: 12,
      pharmacies: 12,
      hospitals: 4,
      shoppingMalls: 1,
    },
  },
  D6: {
    name: "Dublin 6",
    rent: { oneBed: 1702.07, twoBed: 2228.19 },
    transport: null,
    amenities: {
      supermarkets: 13,
      groceries: 8,
      restaurants: 54,
      asianRestaurants: 18,
      cafes: 30,
      gyms: 8,
      parks: 21,
      pharmacies: 15,
      hospitals: 3,
      shoppingMalls: 3,
    },
  },
  D7: {
    name: "Dublin 7",
    rent: { oneBed: 1539.51, twoBed: 2257.35 },
    transport: null,
    amenities: {
      supermarkets: 14,
      groceries: 40,
      restaurants: 48,
      asianRestaurants: 13,
      cafes: 51,
      gyms: 19,
      parks: 42,
      pharmacies: 20,
      hospitals: 5,
      shoppingMalls: 1,
    },
  },
  D8: {
    name: "Dublin 8",
    rent: { oneBed: 1621.26, twoBed: 1981.84 },
    transport: null,
    amenities: {
      supermarkets: 8,
      groceries: 61,
      restaurants: 47,
      asianRestaurants: 10,
      cafes: 97,
      gyms: 11,
      parks: 33,
      pharmacies: 24,
      hospitals: 4,
      shoppingMalls: 0,
    },
  },
  D9: {
    name: "Dublin 9",
    rent: { oneBed: 1645.20, twoBed: 2040.29 },
    transport: null,
    amenities: {
      supermarkets: 9,
      groceries: 33,
      restaurants: 35,
      asianRestaurants: 9,
      cafes: 34,
      gyms: 12,
      parks: 58,
      pharmacies: 17,
      hospitals: 6,
      shoppingMalls: 0,
    },
  },
  D10: {
    name: "Dublin 10",
    rent: { oneBed: null, twoBed: null },
    transport: null,
    amenities: {
      supermarkets: 3,
      groceries: 15,
      restaurants: 0,
      asianRestaurants: 0,
      cafes: 4,
      gyms: 3,
      parks: 15,
      pharmacies: 7,
      hospitals: 1,
      shoppingMalls: 0,
    },
  },
};

const famousPlacesByDistrict = {
  D4: [
    {
      name: "Herbert Park",
      description: "A popular public park in Ballsbridge.",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/A_scene_in_Herbert_Park,_Dublin.jpg",
      imageCredit: "Wikimedia Commons",
    },
    {
      name: "Aviva Stadium",
      description: "A major sports stadium in Dublin 4.",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Aviva_Stadium_Dublin.jpg",
      imageCredit: "Wikimedia Commons",
    },
  ],
  D5: [
    {
      name: "St Anne's Park",
      description: "A large park with gardens and walking routes.",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/St._Anne%27s_Park_-_Dublin.jpg",
      imageCredit: "Wikimedia Commons",
    },
    {
      name: "North Bull Island",
      description: "A coastal nature area in Dublin Bay.",
      image:
        "https://commons.wikimedia.org/wiki/Special:FilePath/North_Bull_Island.jpg",
      imageCredit: "Wikimedia Commons",
    },
  ],
  D6: [
    {
      name: "Rathmines Town Hall",
      description: "A distinctive landmark in Rathmines.",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Rathmines_in_Dublin.jpg",
      imageCredit: "Wikimedia Commons",
    },
    {
      name: "Ranelagh",
      description: "A lively neighbourhood with cafes and local shops.",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Ranelagh_Main_Street.jpg",
      imageCredit: "Wikimedia Commons",
    },
  ],
  D7: [
    {
      name: "Phoenix Park",
      description: "One of Europe's largest enclosed city parks.",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Phoenix_Park_-_Dublin_%282506342801%29.jpg",
      imageCredit: "Wikimedia Commons",
    },
    {
      name: "National Museum at Collins Barracks",
      description: "A museum in a historic military building.",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Main_entrance_to_the_National_Museum_of_Ireland-_Decorative_Arts_%26_History-_Collins_Barracks,_Dublin_%282019%29.jpg",
      imageCredit: "Wikimedia Commons",
    },
  ],
  D8: [
    {
      name: "Kilmainham Gaol",
      description: "A historic prison and museum.",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Kilmainham_Gaol_Prison.jpg",
      imageCredit: "Wikimedia Commons",
    },
    {
      name: "Guinness Storehouse",
      description: "A well-known visitor attraction at St James's Gate.",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Dublin_Guinness_Storehouse.JPG",
      imageCredit: "Wikimedia Commons",
    },
  ],
  D9: [
    {
      name: "National Botanic Gardens",
      description: "Historic botanical gardens in Glasnevin.",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Botanic_Gardens_In_Glasnevin_(Dublin)_(7951851502).jpg",
      imageCredit: "Wikimedia Commons",
    },
    {
      name: "Croke Park",
      description: "A major stadium and home of Gaelic games.",
      image:
        "https://commons.wikimedia.org/wiki/Special:FilePath/Croke_Park.jpg",
      imageCredit: "Wikimedia Commons",
    },
  ],
  D10: [
    {
      name: "Ballyfermot",
      description: "A residential neighbourhood on Dublin's west side.",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Cherry_Orchard_Park_Lake.jpg",
      imageCredit: "Wikimedia Commons",
    },
    {
      name: "Cherry Orchard",
      description: "A neighbourhood in the Dublin 10 area.",
      image:
        "https://commons.wikimedia.org/wiki/Special:FilePath/Cherry_Orchard_Dublin.jpg",
      imageCredit: "Wikimedia Commons",
    },
  ],
};

Object.entries(famousPlacesByDistrict).forEach(([districtId, places]) => {
  if (districtProfiles[districtId]) {
    districtProfiles[districtId].famousPlaces = places;
  }
});
