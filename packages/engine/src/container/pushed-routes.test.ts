import { describe, expect, it } from "vitest";
import { parsePushedRoutes } from "./pushed-routes.ts";

describe("parsePushedRoutes", () => {
  it("reads one network per line, clearing host bits and dropping duplicates and junk", () => {
    expect(parsePushedRoutes("10.140.0.0/16\n172.24.0.5/14\n10.140.0.0/16\nnot-a-route\n")).toEqual({ all: false, cidrs: ["10.140.0.0/16", "172.24.0.0/14"] });
  });

  it("knows when the server sends everything, also in pieces", () => {
    expect(parsePushedRoutes("all\n")).toEqual({ all: true, cidrs: [] });
    expect(parsePushedRoutes("0.0.0.0/0\n")).toEqual({ all: true, cidrs: [] });
    expect(parsePushedRoutes("0.0.0.0/1\n128.0.0.0/1\n")).toEqual({ all: true, cidrs: [] });
  });

  it("reads an empty record as nothing sent", () => {
    expect(parsePushedRoutes("")).toEqual({ all: false, cidrs: [] });
  });
});
