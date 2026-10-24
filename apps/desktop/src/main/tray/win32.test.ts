import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ nativeTheme: {}, nativeImage: {} }));

const { taskbarIsDark } = await import("./win32.ts");

const query = (value: string) => `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\r\n    SystemUsesLightTheme    REG_DWORD    ${value}\r\n\r\n`;

describe("the taskbar's theme", () => {
  it("is dark when the system doesn't use the light theme", () => {
    expect(taskbarIsDark(query("0x0"))).toBe(true);
    expect(taskbarIsDark(query("0x1"))).toBe(false);
  });

  it("is unknown when the registry doesn't say", () => {
    expect(taskbarIsDark("")).toBeUndefined();
    expect(taskbarIsDark("    AppsUseLightTheme    REG_DWORD    0x0\r\n")).toBeUndefined();
  });
});
