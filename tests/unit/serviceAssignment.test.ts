import { describe, expect, it } from "vitest";
import { buildServiceAssignmentFields, resolveServiceAssignment } from "../../src/lib/serviceAssignment";

describe("service assignment", () => {
  it("represents a free service with explicit nulls", () => expect(buildServiceAssignmentFields({ packageId: null, folderId: null })).toEqual({ packageId: null, pacoteId: null, folderId: null, pastaId: null }));
  it("reads legacy aliases", () => expect(resolveServiceAssignment({ pacoteId: "p", pastaId: "f" })).toEqual({ packageId: "p", folderId: "f" }));
});
