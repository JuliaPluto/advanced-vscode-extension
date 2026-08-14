import { describe, it, expect } from "@jest/globals";
import {
  isWindows,
  getExecutableName,
  escapeJuliaCode,
  toJuliaPath,
} from "../platformUtils.ts";

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

  describe("escapeJuliaCode", () => {
    it("should not escape double quotes on Windows", () => {
      const code = 'println("Hello World")';
      const result = escapeJuliaCode(code);

      // On both Windows and Unix, double quotes remain as-is
      expect(result).toBe('println("Hello World")');
    });

    it("should handle code without quotes", () => {
      const code = "println(42)";
      const result = escapeJuliaCode(code);
      expect(result).toBe("println(42)");
    });

    it("should escape single quotes on Windows", () => {
      const code = "println('Hello World')";
      const result = escapeJuliaCode(code);

      if (isWindows()) {
        // On Windows PowerShell, single quotes are doubled
        expect(result).toBe("println(''Hello World'')");
      } else {
        // On Unix, no escaping needed
        expect(result).toBe("println('Hello World')");
      }
    });

    it("should handle complex Julia code with double quotes", () => {
      const code = 'open("file.txt", "w") do io; write(io, "content"); end';
      const result = escapeJuliaCode(code);

      // Double quotes should remain unchanged on all platforms
      expect(result).toBe(
        'open("file.txt", "w") do io; write(io, "content"); end'
      );
    });
  });

  describe("toJuliaPath", () => {
    it("should convert Windows backslashes to forward slashes", () => {
      const windowsPath = "c:\\Users\\user\\Documents\\file.txt";
      const result = toJuliaPath(windowsPath);
      expect(result).toBe("c:/Users/user/Documents/file.txt");
    });

    it("should handle Unix paths unchanged", () => {
      const unixPath = "/home/user/documents/file.txt";
      const result = toJuliaPath(unixPath);
      expect(result).toBe("/home/user/documents/file.txt");
    });

    it("should handle mixed slashes", () => {
      const mixedPath = "c:\\Users/user\\Documents/file.txt";
      const result = toJuliaPath(mixedPath);
      expect(result).toBe("c:/Users/user/Documents/file.txt");
    });

    it("should handle paths with no slashes", () => {
      const simplePath = "file.txt";
      const result = toJuliaPath(simplePath);
      expect(result).toBe("file.txt");
    });
  });
});
