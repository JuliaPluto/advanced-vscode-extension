import { describe, it, expect } from "@jest/globals";
import { isWindows, getExecutableName } from "../platformUtils.ts";

describe("platformUtils", () => {
  describe("isWindows", () => {
    it("should return boolean", () => {
      expect(typeof isWindows()).toBe("boolean");
    });
  });

  describe("getExecutableName", () => {
    it("should return executable name with platform-specific extension", () => {
      const result = getExecutableName("julia");
      if (isWindows()) {
        expect(result).toBe("julia.exe");
      } else {
        expect(result).toBe("julia");
      }
    });

    it("should work with different base names", () => {
      const result = getExecutableName("jh");
      if (isWindows()) {
        expect(result).toBe("jh.exe");
      } else {
        expect(result).toBe("jh");
      }
    });
  });
});
