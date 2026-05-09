import stringSimilarity from "string-similarity";

export function calculateMatchScore(
  queryTrackName: string,
  trackName: string,
  queryArtistName: string | null = null,
  artistName: string | null = null,
  trackWeight = 0.7,
  artistWeight = 0.3,
) {
  const trackSimilarity = stringSimilarity.compareTwoStrings(
    queryTrackName,
    trackName,
  );

  let matchScore = trackSimilarity;

  if (queryArtistName && artistName) {
    const artistSimilarity = stringSimilarity.compareTwoStrings(
      queryArtistName,
      artistName,
    );
    matchScore =
      trackWeight * trackSimilarity + artistWeight * artistSimilarity;
  }

  return matchScore;
}
