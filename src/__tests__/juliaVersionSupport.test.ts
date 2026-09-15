import { isJuliaVersionSupportedByPluto } from "../platformUtils.js";

describe("isJuliaVersionSupportedByPluto", () => {
  it.each(["1.12.7", "1.12.0", "1.11.7", "1.10.4", "v1.12.7", "1.12.7+dyad"])(
    "accepts %s",
    (version) => {
      expect(isJuliaVersionSupportedByPluto(version)).toBe(true);
    }
  );

  it.each(["1.13.0", "1.13.0-rc1", "1.14.2", "2.0.0"])(
    "rejects %s",
    (version) => {
      expect(isJuliaVersionSupportedByPluto(version)).toBe(false);
    }
  );

  it("assumes an unparsable version is supported", () => {
    expect(isJuliaVersionSupportedByPluto("")).toBe(true);
    expect(isJuliaVersionSupportedByPluto("nightly")).toBe(true);
  });
});
