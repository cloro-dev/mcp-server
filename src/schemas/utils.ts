export const getAvailableCountries = (
  allowedCountries: string[],
  blockedCountries: string[],
): string[] => {
  return allowedCountries.filter(
    (country) => !blockedCountries.includes(country),
  );
};
