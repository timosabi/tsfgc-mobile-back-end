import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  pattern,
} from "obscenity";

// obscenity's bundled dataset is US-English-leaning and misses several mild
// British insults that are still genuinely abusive as a display name (e.g.
// calling someone a "bellend" or "tosser" is not something we want to allow
// through untouched) -- supplement it rather than relying on the default
// list alone.
const dataset = new DataSet()
  .addAll(englishDataset)
  .addPhrase((phrase) => phrase.addPattern(pattern`bellend`))
  .addPhrase((phrase) => phrase.addPattern(pattern`tosser`))
  .addPhrase((phrase) => phrase.addPattern(pattern`knobhead`))
  .addPhrase((phrase) => phrase.addPattern(pattern`munter`))
  .addPhrase((phrase) => phrase.addPattern(pattern`slag`))
  .addPhrase((phrase) => phrase.addPattern(pattern`minger`));

// Single shared matcher instance -- obscenity's dataset/transformer setup is
// the expensive part, so build it once rather than per-call. Used for every
// piece of user-authored text another user can see (display names, friends
// group names/slugs) as the app's one required content-filtering precaution
// for App Store guideline 1.2 (User-Generated Content).
const matcher = new RegExpMatcher({
  ...dataset.build(),
  ...englishRecommendedTransformers,
});

export function containsProfanity(text: string): boolean {
  return matcher.hasMatch(text);
}
