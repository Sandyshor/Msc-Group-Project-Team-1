
export const placeIconSvg = (category) => {
  const icons = {
    supermarket: "🛒",
    restaurant: "🍽️",
    cafe: "☕",
    park: "🌳",
    gym: "🏋️",
    pharmacy: "💊",
    hospital: "🏥",
    transport: "🚋",
    shopping: "🛍️",
    landmark: "📍",
  };

  return icons[category?.toLowerCase()] || "📍";
};
