import { describe, expect, it } from "vitest";
import { canonicalRosterJson, computeRosterRevision } from "./roster-revision";

describe("roster revision", () => {
  it("uses only authoritative names, departments, room ids, and forms", async () => {
    const people = [{ name: "A", dept: "Team", active: false, id: "random" }];
    const rooms = [{ id: "N201", form: "9A", enabled: false, floor: 2 }];

    expect(canonicalRosterJson(people, rooms)).toBe(
      '{"people":[{"name":"A","dept":"Team"}],"rooms":[{"id":"N201","form":"9A"}]}',
    );
    await expect(computeRosterRevision(people, rooms)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when an authoritative roster field changes", async () => {
    const first = await computeRosterRevision([{ name: "A" }], [{ id: "N201", form: "9A" }]);
    const second = await computeRosterRevision([{ name: "A" }], [{ id: "N201", form: "9B" }]);

    expect(second).not.toBe(first);
  });
});
