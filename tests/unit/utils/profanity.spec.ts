import { containsProfanity } from "../../../src/utils/profanity.js";

describe("containsProfanity", () => {
  it("returns false for ordinary names", () => {
    expect(containsProfanity("Los Muchachos")).toBe(false);
    expect(containsProfanity("Timosabi")).toBe(false);
  });

  it("returns true for an obviously profane word", () => {
    expect(containsProfanity("shit")).toBe(true);
  });

  it("catches profanity embedded in a longer string", () => {
    expect(containsProfanity("this is such bullshit honestly")).toBe(true);
  });
});
