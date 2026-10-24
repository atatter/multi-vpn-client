import { describe, expect, it } from "vitest";
import { progressText, terminalOutput } from "./output.ts";

describe("the download counter", () => {
  const size = 260_242_719;

  it("says how much is downloaded and how much is left, adding up to the archive's size", () => {
    expect(progressText(0, size)).toBe("0 MB downloaded, 260 MB left");
    expect(progressText(0.5, size)).toBe("130 MB downloaded, 130 MB left");
    expect(progressText(0.9999, size)).toBe("260 MB downloaded, 0 MB left");
  });

  it("says the archive is being unpacked once it's all downloaded", () => {
    expect(progressText(1, size)).toBe("260 MB downloaded, unpacking…");
  });
});

function fakeStream(isTTY: boolean) {
  const written: string[] = [];
  const write = (text: string) => {
    written.push(text);
    return true;
  };
  return { stream: { isTTY, write }, written };
}

describe("the launcher's messages", () => {
  it("rewrites the counter on one terminal line, only when it changes, and starts the next message below it", () => {
    const { stream, written } = fakeStream(true);
    const output = terminalOutput(stream);
    output.log("Downloading…");
    output.progress(0, 2e6);
    output.progress(0.0001, 2e6);
    output.progress(1, 2e6);
    output.log("Started.");
    expect(written.join("")).toBe("Downloading…\n\r0 MB downloaded, 2 MB left\x1b[K\r2 MB downloaded, unpacking…\x1b[K\nStarted.\n");
  });

  it("leaves the counter out when the output isn't a terminal", () => {
    const { stream, written } = fakeStream(false);
    const output = terminalOutput(stream);
    output.log("Downloading…");
    output.progress(0.5, 2e6);
    output.log("Started.");
    expect(written.join("")).toBe("Downloading…\nStarted.\n");
  });
});
