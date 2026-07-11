import { describe, expect, it } from "vitest";
import { parseRoomId } from "./rota";

describe("parseRoomId", () => {
  it("parses a compact room ID", () => {
    expect(parseRoomId(" n203 ")).toEqual({ building: "N", number: 203, floor: 2 });
  });

  it("rejects a room ID containing spaces", () => {
    expect(parseRoomId("North 203")).toBeNull();
  });
});
