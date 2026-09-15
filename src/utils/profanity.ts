import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

// Single shared matcher instance -- obscenity's dataset/transformer setup is
// the expensive part, so build it once rather than per-call. Used for every
// piece of user-authored text another user can see (display names, friends
// group names/slugs) as the app's one required content-filtering precaution
// for App Store guideline 1.2 (User-Generated Content).
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export function containsProfanity(text: string): boolean {
  return matcher.hasMatch(text);
}
