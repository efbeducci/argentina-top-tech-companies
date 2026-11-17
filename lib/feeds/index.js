// Job boards that list many employers' postings, read beside the companies'
// own ATS boards (lib/ats). Each feed returns { total, items }, an item being
// { externalId, company, title, url, location, cls, workplace, posted_at,
// salary, text } for a posting someone in Argentina could take.
// scripts/jobs.mjs turns items into index rows and credits the feed (`via`).

import getonboard from "./getonboard.js";
import himalayas from "./himalayas.js";
import weworkremotely from "./weworkremotely.js";
import jobicy from "./jobicy.js";

/** In order of preference when two feeds carry the same posting. */
export const FEEDS = [getonboard, weworkremotely, jobicy, himalayas];
export { client } from "./common.js";
