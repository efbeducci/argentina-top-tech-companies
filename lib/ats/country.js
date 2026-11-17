// The country the crawl searches when a board filters by country on the server
// (Eightfold, iCIMS, Phenom, Radancy, Apple). Upstream (spanish-top-tech-companies)
// had Spain written into each adapter; here it is Argentina, in one place.
export const COUNTRY = {
    name: "Argentina",
    /** How Phenom sites name it in their country facet. */
    pattern: /^(?:argentina|arg|ar)$/i,
    /** GeoNames id, Radancy's country facet. */
    geoname: "3865483",
    /** jobs.apple.com location slug. */
    apple: "argentina-ARGC",
};
